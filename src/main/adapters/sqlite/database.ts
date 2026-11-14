import Database from 'better-sqlite3'
import type { Logger } from '@application/ports'

const SCHEMA_VERSION = 13

const INIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS time_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL REFERENCES actions(id),
  session_id TEXT NOT NULL,
  session_seq INTEGER NOT NULL DEFAULT 0,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'timer',
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, session_seq)
);

CREATE INDEX IF NOT EXISTS idx_records_date ON time_records (local_date, start_at);
CREATE INDEX IF NOT EXISTS idx_records_action ON time_records (action_id, start_at);

-- 只保留未完成会话，用于崩溃/重启后的恢复
CREATE TABLE IF NOT EXISTS timer_sessions (
  id TEXT PRIMARY KEY,
  action_id INTEGER NOT NULL REFERENCES actions(id),
  started_at INTEGER NOT NULL,
  target_sec INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

// v2：周计划；CHECK 只做兜底，业务校验仍在 core
const PLANS_SQL = `
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min INTEGER NOT NULL CHECK (start_min >= 0 AND start_min < 1440),
  end_min INTEGER NOT NULL CHECK (end_min > 0 AND end_min <= 1440),
  action_id INTEGER NOT NULL REFERENCES actions(id),
  created_at INTEGER NOT NULL,
  CHECK (end_min > start_min)
);

CREATE INDEX IF NOT EXISTS idx_plans_weekday ON plans (weekday, start_min);
`

// v3：待办清单；sort_order 由 core 排序规则维护，只用于稳定展示
const TODOS_SQL = `
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  sort_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todos_order ON todos (sort_order, id);
`

// v4：闹钟触发记录，UNIQUE 保证同一计划同一天只提醒一次
const ALARM_EVENTS_SQL = `
CREATE TABLE IF NOT EXISTS alarm_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  fire_date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  fired_at INTEGER NOT NULL,
  UNIQUE (plan_id, fire_date)
);

CREATE INDEX IF NOT EXISTS idx_alarm_events_date ON alarm_events (fire_date);
`

// v5：待办软归档；归档时间用于归档列表倒序，普通列表只看 archived = 0
const TODO_ARCHIVE_SQL = `
ALTER TABLE todos ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE todos ADD COLUMN archived_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_todos_archived ON todos (archived, archived_at);
`

// v6：每个计划单独控制是否提醒，默认开启
const PLAN_ALARM_SQL = `
ALTER TABLE plans ADD COLUMN alarm_enabled INTEGER NOT NULL DEFAULT 1;
`

// v7：每个行动记住自己的倒计时分钟数；无记录表示正计时
const ACTION_TIMER_TARGET_SQL = `
CREATE TABLE IF NOT EXISTS action_timer_targets (
  action_id INTEGER PRIMARY KEY REFERENCES actions(id) ON DELETE CASCADE,
  target_sec INTEGER NOT NULL CHECK (target_sec > 0)
);
`

// v8：每个行动可单独覆盖开始/结束铃声；NULL 表示跟随全局默认
const ACTION_RINGTONE_SQL = `
ALTER TABLE actions ADD COLUMN start_ringtone TEXT;
ALTER TABLE actions ADD COLUMN end_ringtone TEXT;
`

// v9：行动手工排序；旧数据按 id 回填，保持原有展示顺序
const ACTION_SORT_ORDER_SQL = `
ALTER TABLE actions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE actions SET sort_order = id;
CREATE INDEX IF NOT EXISTS idx_actions_sort ON actions (archived, sort_order, id);
`

// v10：用户导入的铃声元数据；文件本体在 userData/ringtones，由协议白名单读取
const CUSTOM_RINGTONES_SQL = `
CREATE TABLE custom_ringtones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL UNIQUE,
  duration_sec INTEGER NOT NULL CHECK (duration_sec BETWEEN 1 AND 60),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_ringtones_created ON custom_ringtones (created_at, id);
`

// v11：取消铃声体积上限，重建表以去掉旧的 size_bytes 上界约束
const CUSTOM_RINGTONES_NO_SIZE_LIMIT_SQL = `
CREATE TABLE custom_ringtones_v11 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL UNIQUE,
  duration_sec INTEGER NOT NULL CHECK (duration_sec BETWEEN 1 AND 60),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 1),
  created_at INTEGER NOT NULL
);
INSERT INTO custom_ringtones_v11 (id, name, file_name, duration_sec, size_bytes, created_at)
  SELECT id, name, file_name, duration_sec, size_bytes, created_at FROM custom_ringtones;
DROP TABLE custom_ringtones;
ALTER TABLE custom_ringtones_v11 RENAME TO custom_ringtones;
CREATE INDEX IF NOT EXISTS idx_custom_ringtones_created ON custom_ringtones (created_at, id);
`

// v12：铃声改为不限原文件时长，另存截取区间；旧行按整段（start=0，end=NULL）迁移
const CUSTOM_RINGTONES_CLIP_SQL = `
CREATE TABLE custom_ringtones_v12 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL UNIQUE,
  duration_sec INTEGER NOT NULL CHECK (duration_sec >= 1),
  clip_start_sec REAL NOT NULL DEFAULT 0,
  clip_end_sec REAL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 1),
  created_at INTEGER NOT NULL
);
INSERT INTO custom_ringtones_v12 (id, name, file_name, duration_sec, clip_start_sec, clip_end_sec, size_bytes, created_at)
  SELECT id, name, file_name, duration_sec, 0, NULL, size_bytes, created_at FROM custom_ringtones;
DROP TABLE custom_ringtones;
ALTER TABLE custom_ringtones_v12 RENAME TO custom_ringtones;
CREATE INDEX IF NOT EXISTS idx_custom_ringtones_created ON custom_ringtones (created_at, id);
`

// v13：行动归档时间，供归档列表显示完整年月日；旧归档行保持 NULL
const ACTION_ARCHIVE_SQL = `
ALTER TABLE actions ADD COLUMN archived_at INTEGER;
`

// 每个版本一段 SQL，只向前执行；新增表时追加一项并递增 SCHEMA_VERSION
export type SchemaMigration = {
  readonly version: number
  readonly sql: string
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, sql: INIT_SCHEMA_SQL },
  { version: 2, sql: PLANS_SQL },
  { version: 3, sql: TODOS_SQL },
  { version: 4, sql: ALARM_EVENTS_SQL },
  { version: 5, sql: TODO_ARCHIVE_SQL },
  { version: 6, sql: PLAN_ALARM_SQL },
  { version: 7, sql: ACTION_TIMER_TARGET_SQL },
  { version: 8, sql: ACTION_RINGTONE_SQL },
  { version: 9, sql: ACTION_SORT_ORDER_SQL },
  { version: 10, sql: CUSTOM_RINGTONES_SQL },
  { version: 11, sql: CUSTOM_RINGTONES_NO_SIZE_LIMIT_SQL },
  { version: 12, sql: CUSTOM_RINGTONES_CLIP_SQL },
  { version: 13, sql: ACTION_ARCHIVE_SQL },
]

export const LATEST_SCHEMA_VERSION = SCHEMA_VERSION

export type Db = Database.Database

export function openDatabase(filePath: string, logger: Logger): Db {
  const db = new Database(filePath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    migrate(db, logger)
  } catch (error) {
    // 迁移失败时立刻释放句柄，否则 Windows 上文件会一直被占用
    db.close()
    throw error
  }

  const { version } = db.prepare('SELECT sqlite_version() AS version').get() as { version: string }
  logger.info(`SQLite ${version} ready at ${filePath}`)
  assertIntegrity(db, logger)
  return db
}

// 迁移后做一次快速完整性检查；失败时上层会提示从启动备份恢复
function assertIntegrity(db: Db, logger: Logger): void {
  const row = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
  const result = row?.quick_check ?? 'unknown'
  if (result !== 'ok') {
    throw new Error(`数据库完整性检查失败：${result}，请从 data/backups 恢复`)
  }
  const actions = db.prepare('SELECT COUNT(*) AS count FROM actions').get() as { count: number }
  logger.info(`数据库完整性检查通过，行动 ${actions.count} 条`)
}

// 只向前迁移：升级前先备份由 P1 的启动流程负责
function migrate(db: Db, logger: Logger): void {
  const current = readSchemaVersion(db)
  if (current > SCHEMA_VERSION) {
    throw new Error(`数据库版本 ${current} 高于程序支持的 ${SCHEMA_VERSION}，请升级应用`)
  }
  if (current === SCHEMA_VERSION) {
    return
  }

  for (const migration of SCHEMA_MIGRATIONS) {
    if (migration.version <= current) {
      continue
    }
    const applyMigration = db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    })
    applyMigration()
    logger.info(`schema migrated ${migration.version - 1} -> ${migration.version}`)
  }
}

function readSchemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number
}
