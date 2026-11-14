import Database from 'better-sqlite3'
import { SCHEMA_MIGRATIONS } from '../../../src/main/adapters/sqlite/database'

// 夹具直接由迁移列表生成，避免二进制夹具与代码漂移；每个版本都从空库逐级升上去
export function createFixtureDatabase(filePath: string, version: number): void {
  const db = new Database(filePath)
  try {
    db.pragma('journal_mode = WAL')
    for (const migration of SCHEMA_MIGRATIONS) {
      if (migration.version > version) {
        break
      }
      db.exec(migration.sql)
    }
    db.pragma(`user_version = ${version}`)
  } finally {
    db.close()
  }
}

export type FixtureSeed = {
  readonly actionName: string
  readonly recordDurationSec: number
}

// v1 结构下写入各表的最小样本，升级后用于比对数据未丢失
export function seedV1Fixture(filePath: string, seed: FixtureSeed): void {
  const db = new Database(filePath)
  try {
    db.prepare('INSERT INTO actions (name, created_at, archived) VALUES (?, ?, 0)').run(
      seed.actionName,
      1_700_000_000_000,
    )
    db.prepare(
      `INSERT INTO time_records
         (action_id, session_id, session_seq, start_at, end_at, duration_sec, local_date, source, created_at)
       VALUES (1, 'fixture-session', 0, ?, ?, ?, '2026-11-13', 'timer', ?)`,
    ).run(1_700_000_000_000, 1_700_000_600_000, seed.recordDurationSec, 1_700_000_600_000)
    db.prepare('INSERT INTO timer_sessions (id, action_id, started_at, target_sec) VALUES (?, 1, ?, ?)').run(
      'fixture-session',
      1_700_000_000_000,
      3600,
    )
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('theme', 'porcelain')
  } finally {
    db.close()
  }
}
