import type {
  ActionRepo,
  AlarmEventRepo,
  CustomRingtoneRecord,
  CustomRingtoneRepo,
  PlanRepo,
  RecordRepo,
  SessionStore,
  SettingsRepo,
  TodoRepo,
  UnitOfWork,
} from '@application/ports'
import type { Action, RingtoneValue } from '@core/action'
import { alarmKey, type AlarmFire } from '@core/alarm'
import type { PlanDraft, PlanView } from '@core/plan'
import type { NewTimeRecord, RecordView } from '@core/record'
import type { RecordPatch } from '@core/record-edit'
import type { TimerSession } from '@core/timer'
import { isRingtoneValue } from '@core/ringtone'
import type { Todo, TodoId } from '@core/todo'
import type { ActionId, EpochMs, LocalDate, Weekday } from '@core/types'
import type { Db } from './database'

type ActionRow = {
  readonly id: number
  readonly name: string
  readonly archived: number
  readonly created_at: number
  readonly archived_at: number | null
  readonly timer_target_sec: number | null
  readonly start_ringtone: string | null
  readonly end_ringtone: string | null
  readonly sort_order: number
}

type RecordRow = {
  readonly id: number
  readonly action_id: number
  readonly action_name: string
  readonly start_at: number
  readonly end_at: number
  readonly duration_sec: number
  readonly local_date: string
  readonly source: NewTimeRecord['source']
}

type SessionRow = {
  readonly id: string
  readonly action_id: number
  readonly started_at: number
  readonly target_sec: number | null
}

type PlanRow = {
  readonly id: number
  readonly weekday: number
  readonly start_min: number
  readonly end_min: number
  readonly action_id: number
  readonly created_at: number
  readonly alarm_enabled: number
  readonly action_name: string
}

type TodoRow = {
  readonly id: number
  readonly title: string
  readonly completed: number
  readonly created_at: number
  readonly completed_at: number | null
  readonly sort_order: number
  readonly archived: number
  readonly archived_at: number | null
}

type AlarmEventRow = {
  readonly plan_id: number
  readonly fire_date: string
  readonly start_min: number
}

function toAction(row: ActionRow): Action {
  return {
    id: row.id,
    name: row.name,
    archived: row.archived === 1,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    timerTargetSec: row.timer_target_sec,
    startRingtone: toRingtoneValue(row.start_ringtone),
    endRingtone: toRingtoneValue(row.end_ringtone),
    sortOrder: row.sort_order,
  }
}

// 数据库里是自由文本；非法值按「跟随默认」处理，避免脏数据破坏界面
function toRingtoneValue(value: string | null): RingtoneValue | null {
  return value !== null && isRingtoneValue(value) ? value : null
}

function toRecord(row: RecordRow): RecordView {
  return {
    id: row.id,
    actionId: row.action_id,
    actionName: row.action_name,
    startAt: row.start_at,
    endAt: row.end_at,
    durationSec: row.duration_sec,
    localDate: row.local_date,
    source: row.source,
  }
}

function toPlanView(row: PlanRow): PlanView {
  return {
    id: row.id,
    weekday: row.weekday as Weekday,
    startMin: row.start_min,
    endMin: row.end_min,
    actionId: row.action_id,
    createdAt: row.created_at,
    alarmEnabled: row.alarm_enabled === 1,
    actionName: row.action_name,
  }
}

function toTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    sortOrder: row.sort_order,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
  }
}

export function createActionRepo(db: Db): ActionRepo {
  const actionSelect = `
    SELECT a.id, a.name, a.archived, a.created_at, a.archived_at,
           t.target_sec AS timer_target_sec,
           a.start_ringtone, a.end_ringtone, a.sort_order
    FROM actions a
    LEFT JOIN action_timer_targets t ON t.action_id = a.id
  `
  const listAll = db.prepare(`${actionSelect} ORDER BY a.sort_order, a.id`)
  const listActive = db.prepare(`${actionSelect} WHERE a.archived = 0 ORDER BY a.sort_order, a.id`)
  const findById = db.prepare(`${actionSelect} WHERE a.id = ?`)
  const insert = db.prepare(`
    INSERT INTO actions (name, created_at, archived, sort_order)
    VALUES (?, ?, 0, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM actions))
  `)
  const renameStmt = db.prepare('UPDATE actions SET name = ? WHERE id = ?')
  const archive = db.prepare('UPDATE actions SET archived = 1, archived_at = ? WHERE id = ?')
  const restoreStmt = db.prepare('UPDATE actions SET archived = 0, archived_at = NULL WHERE id = ?')
  const removeAction = db.prepare('DELETE FROM actions WHERE id = ?')
  const upsertTarget = db.prepare(`
    INSERT INTO action_timer_targets (action_id, target_sec) VALUES (?, ?)
    ON CONFLICT(action_id) DO UPDATE SET target_sec = excluded.target_sec
  `)
  const deleteTarget = db.prepare('DELETE FROM action_timer_targets WHERE action_id = ?')
  const updateStartRingtone = db.prepare('UPDATE actions SET start_ringtone = ? WHERE id = ?')
  const updateEndRingtone = db.prepare('UPDATE actions SET end_ringtone = ? WHERE id = ?')
  const updateSortOrder = db.prepare('UPDATE actions SET sort_order = ? WHERE id = ?')

  function list(includeArchived: boolean): readonly Action[] {
    const rows = (includeArchived ? listAll.all() : listActive.all()) as ActionRow[]
    return rows.map(toAction)
  }

  function find(id: ActionId): Action | null {
    const row = findById.get(id) as ActionRow | undefined
    return row === undefined ? null : toAction(row)
  }

  function create(name: string, now: EpochMs): Action {
    const info = insert.run(name, now)
    const row = findById.get(Number(info.lastInsertRowid)) as ActionRow
    return toAction(row)
  }

  function rename(id: ActionId, name: string): Action {
    renameStmt.run(name, id)
    const row = findById.get(id) as ActionRow
    return toAction(row)
  }

  function archiveById(id: ActionId, now: EpochMs): void {
    archive.run(now, id)
  }

  function restore(id: ActionId): Action {
    restoreStmt.run(id)
    const row = findById.get(id) as ActionRow
    return toAction(row)
  }

  function remove(id: ActionId): void {
    removeAction.run(id)
  }

  function setTimerTarget(id: ActionId, targetSec: number | null): Action {
    if (targetSec === null) {
      deleteTarget.run(id)
    } else {
      upsertTarget.run(id, targetSec)
    }
    const row = findById.get(id) as ActionRow
    return toAction(row)
  }

  function setRingtone(id: ActionId, kind: 'start' | 'end', value: RingtoneValue | null): Action {
    if (kind === 'start') {
      updateStartRingtone.run(value, id)
    } else {
      updateEndRingtone.run(value, id)
    }
    const row = findById.get(id) as ActionRow
    return toAction(row)
  }

  // 只在同一归档状态内交换相邻顺序，避免活动列表与归档列表互相穿插
  function reorder(id: ActionId, direction: 'up' | 'down'): readonly Action[] {
    const target = find(id)
    if (target === null) {
      return list(true)
    }
    const peers = target.archived ? list(true).filter((item) => item.archived) : list(false)
    const index = peers.findIndex((item) => item.id === id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    const other = swapIndex >= 0 && swapIndex < peers.length ? peers[swapIndex] : undefined
    if (other !== undefined) {
      const run = db.transaction(() => {
        updateSortOrder.run(other.sortOrder, target.id)
        updateSortOrder.run(target.sortOrder, other.id)
      })
      run()
    }
    return target.archived ? list(true) : list(false)
  }

  return {
    list,
    findById: find,
    create,
    rename,
    archive: archiveById,
    restore,
    remove,
    setTimerTarget,
    setRingtone,
    reorder,
  }
}

export function createRecordRepo(db: Db): RecordRepo {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO time_records
      (action_id, session_id, session_seq, start_at, end_at, duration_sec, local_date, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const listByDate = db.prepare(`
    SELECT r.id, r.action_id, a.name AS action_name, r.start_at, r.end_at,
           r.duration_sec, r.local_date, r.source
    FROM time_records r
    JOIN actions a ON a.id = r.action_id
    WHERE r.local_date = ?
    ORDER BY r.start_at
  `)
  const listRangeStmt = db.prepare(`
    SELECT r.id, r.action_id, a.name AS action_name, r.start_at, r.end_at,
           r.duration_sec, r.local_date, r.source
    FROM time_records r
    JOIN actions a ON a.id = r.action_id
    WHERE r.local_date BETWEEN ? AND ?
    ORDER BY r.local_date, r.start_at
  `)
  const selectById = db.prepare(`
    SELECT r.id, r.action_id, a.name AS action_name, r.start_at, r.end_at,
           r.duration_sec, r.local_date, r.source
    FROM time_records r
    JOIN actions a ON a.id = r.action_id
    WHERE r.id = ?
  `)
  const updateById = db.prepare(
    'UPDATE time_records SET start_at = ?, end_at = ?, duration_sec = ?, local_date = ? WHERE id = ?',
  )
  const removeById = db.prepare('DELETE FROM time_records WHERE id = ?')
  const countByActionStmt = db.prepare('SELECT COUNT(*) AS count FROM time_records WHERE action_id = ?')
  const removeByActionStmt = db.prepare('DELETE FROM time_records WHERE action_id = ?')
  const totalsByActionStmt = db.prepare(`
    SELECT action_id, SUM(duration_sec) AS duration_sec
    FROM time_records
    GROUP BY action_id
  `)
  const boundsStmt = db.prepare(
    'SELECT MIN(local_date) AS from_date, MAX(local_date) AS to_date FROM time_records',
  )

  function insertMany(records: readonly NewTimeRecord[]): void {
    // 适配器可以读系统时间：created_at 只做审计，不参与业务判定
    const createdAt = Date.now()
    for (const record of records) {
      insert.run(
        record.actionId,
        record.sessionId,
        record.sessionSeq,
        record.startAt,
        record.endAt,
        record.durationSec,
        record.localDate,
        record.source,
        createdAt,
      )
    }
  }

  function list(date: LocalDate): readonly RecordView[] {
    const rows = listByDate.all(date) as RecordRow[]
    return rows.map(toRecord)
  }

  function listRange(from: LocalDate, to: LocalDate): readonly RecordView[] {
    const rows = listRangeStmt.all(from, to) as RecordRow[]
    return rows.map(toRecord)
  }

  function findById(id: number): RecordView | null {
    const row = selectById.get(id) as RecordRow | undefined
    return row === undefined ? null : toRecord(row)
  }

  function update(id: number, patch: RecordPatch): void {
    updateById.run(patch.startAt, patch.endAt, patch.durationSec, patch.localDate, id)
  }

  function remove(id: number): void {
    removeById.run(id)
  }

  function countByAction(actionId: ActionId): number {
    const row = countByActionStmt.get(actionId) as { count: number }
    return row.count
  }

  function removeByAction(actionId: ActionId): void {
    removeByActionStmt.run(actionId)
  }

  function totalsByAction(): readonly { actionId: ActionId; durationSec: number }[] {
    const rows = totalsByActionStmt.all() as { action_id: number; duration_sec: number }[]
    return rows.map((row) => ({ actionId: row.action_id, durationSec: row.duration_sec }))
  }

  function bounds(): { from: LocalDate | null; to: LocalDate | null } {
    const row = boundsStmt.get() as { from_date: string | null; to_date: string | null }
    return { from: row.from_date, to: row.to_date }
  }

  return {
    insertMany,
    listByDate: list,
    listRange,
    findById,
    update,
    remove,
    countByAction,
    removeByAction,
    totalsByAction,
    bounds,
  }
}

export function createPlanRepo(db: Db): PlanRepo {
  const selectWeek = db.prepare(`
    SELECT p.id, p.weekday, p.start_min, p.end_min, p.action_id, p.created_at, p.alarm_enabled,
           a.name AS action_name
    FROM plans p
    JOIN actions a ON a.id = p.action_id
    ORDER BY p.weekday, p.start_min
  `)
  const selectByWeekday = db.prepare(`
    SELECT p.id, p.weekday, p.start_min, p.end_min, p.action_id, p.created_at, p.alarm_enabled,
           a.name AS action_name
    FROM plans p
    JOIN actions a ON a.id = p.action_id
    WHERE p.weekday = ?
    ORDER BY p.start_min
  `)
  const selectById = db.prepare(`
    SELECT p.id, p.weekday, p.start_min, p.end_min, p.action_id, p.created_at, p.alarm_enabled,
           a.name AS action_name
    FROM plans p
    JOIN actions a ON a.id = p.action_id
    WHERE p.id = ?
  `)
  const insert = db.prepare(
    'INSERT INTO plans (weekday, start_min, end_min, action_id, created_at, alarm_enabled) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const removeById = db.prepare('DELETE FROM plans WHERE id = ?')
  const removeByWeekdayStmt = db.prepare('DELETE FROM plans WHERE weekday = ?')
  const updateById = db.prepare(
    'UPDATE plans SET weekday = ?, start_min = ?, end_min = ?, action_id = ?, alarm_enabled = ? WHERE id = ?',
  )
  const updateAlarmStmt = db.prepare('UPDATE plans SET alarm_enabled = ? WHERE id = ?')
  const countByActionStmt = db.prepare('SELECT COUNT(*) AS count FROM plans WHERE action_id = ?')
  const removeByActionStmt = db.prepare('DELETE FROM plans WHERE action_id = ?')

  function listWeek(): readonly PlanView[] {
    const rows = selectWeek.all() as PlanRow[]
    return rows.map(toPlanView)
  }

  function listByWeekday(weekday: Weekday): readonly PlanView[] {
    const rows = selectByWeekday.all(weekday) as PlanRow[]
    return rows.map(toPlanView)
  }

  function findById(id: number): PlanView | null {
    const row = selectById.get(id) as PlanRow | undefined
    return row === undefined ? null : toPlanView(row)
  }

  function create(draft: PlanDraft, now: EpochMs): PlanView {
    const info = insert.run(
      draft.weekday,
      draft.startMin,
      draft.endMin,
      draft.actionId,
      now,
      draft.alarmEnabled ? 1 : 0,
    )
    const row = selectById.get(Number(info.lastInsertRowid)) as PlanRow
    return toPlanView(row)
  }

  function update(id: number, draft: PlanDraft): PlanView {
    updateById.run(
      draft.weekday,
      draft.startMin,
      draft.endMin,
      draft.actionId,
      draft.alarmEnabled ? 1 : 0,
      id,
    )
    const row = selectById.get(id) as PlanRow
    return toPlanView(row)
  }

  function remove(id: number): void {
    removeById.run(id)
  }

  function removeByWeekday(weekday: Weekday): void {
    removeByWeekdayStmt.run(weekday)
  }

  function insertMany(drafts: readonly PlanDraft[], now: EpochMs): void {
    for (const draft of drafts) {
      insert.run(
        draft.weekday,
        draft.startMin,
        draft.endMin,
        draft.actionId,
        now,
        draft.alarmEnabled ? 1 : 0,
      )
    }
  }

  function setAlarmEnabled(id: number, enabled: boolean): void {
    updateAlarmStmt.run(enabled ? 1 : 0, id)
  }

  function countByAction(actionId: ActionId): number {
    const row = countByActionStmt.get(actionId) as { count: number }
    return row.count
  }

  function removeByAction(actionId: ActionId): void {
    removeByActionStmt.run(actionId)
  }

  return {
    listWeek,
    listByWeekday,
    findById,
    create,
    update,
    remove,
    removeByWeekday,
    insertMany,
    setAlarmEnabled,
    countByAction,
    removeByAction,
  }
}

export function createTodoRepo(db: Db): TodoRepo {
  const selectActive = db.prepare(`
    SELECT id, title, completed, created_at, completed_at, sort_order, archived, archived_at
    FROM todos
    WHERE archived = 0
    ORDER BY sort_order, id
  `)
  const selectArchived = db.prepare(`
    SELECT id, title, completed, created_at, completed_at, sort_order, archived, archived_at
    FROM todos
    WHERE archived = 1
    ORDER BY archived_at DESC, id DESC
  `)
  const selectById = db.prepare(`
    SELECT id, title, completed, created_at, completed_at, sort_order, archived, archived_at
    FROM todos
    WHERE id = ?
  `)
  const insert = db.prepare(
    'INSERT INTO todos (title, completed, created_at, completed_at, sort_order) VALUES (?, 0, ?, NULL, ?)',
  )
  const updateCompleted = db.prepare('UPDATE todos SET completed = ?, completed_at = ? WHERE id = ?')
  // 归档与恢复共用一条语句：archived_at 为 null 即未归档
  const updateArchived = db.prepare('UPDATE todos SET archived = ?, archived_at = ? WHERE id = ?')
  const updateSortOrder = db.prepare('UPDATE todos SET sort_order = ? WHERE id = ?')
  const updateTitleStmt = db.prepare('UPDATE todos SET title = ? WHERE id = ?')
  const removeTodo = db.prepare('DELETE FROM todos WHERE id = ?')

  function listActive(): readonly Todo[] {
    const rows = selectActive.all() as TodoRow[]
    return rows.map(toTodo)
  }

  function listArchived(): readonly Todo[] {
    const rows = selectArchived.all() as TodoRow[]
    return rows.map(toTodo)
  }

  function create(title: string, sortOrder: number, now: EpochMs): Todo {
    const info = insert.run(title, now, sortOrder)
    const row = selectById.get(Number(info.lastInsertRowid)) as TodoRow
    return toTodo(row)
  }

  function setCompleted(id: TodoId, completed: boolean, completedAt: EpochMs | null): void {
    updateCompleted.run(completed ? 1 : 0, completedAt, id)
  }

  function setArchived(id: TodoId, archivedAt: EpochMs | null): void {
    updateArchived.run(archivedAt === null ? 0 : 1, archivedAt, id)
  }

  function updateTitle(id: TodoId, title: string): Todo {
    updateTitleStmt.run(title, id)
    const row = selectById.get(id) as TodoRow
    return toTodo(row)
  }

  function remove(id: TodoId): void {
    removeTodo.run(id)
  }

  function reorder(orderedIds: readonly TodoId[]): void {
    orderedIds.forEach((id, index) => updateSortOrder.run(index + 1, id))
  }

  return { listActive, listArchived, create, setCompleted, setArchived, updateTitle, remove, reorder }
}

export function createAlarmEventRepo(db: Db): AlarmEventRepo {
  const selectKeys = db.prepare('SELECT plan_id, fire_date, start_min FROM alarm_events WHERE fire_date = ?')
  const insert = db.prepare(
    'INSERT OR IGNORE INTO alarm_events (plan_id, fire_date, start_min, fired_at) VALUES (?, ?, ?, ?)',
  )

  function listKeysByDate(date: LocalDate): readonly string[] {
    const rows = selectKeys.all(date) as AlarmEventRow[]
    return rows.map((row) => alarmKey(row.plan_id, row.fire_date, row.start_min))
  }

  function record(fire: AlarmFire, firedAt: EpochMs): void {
    insert.run(fire.planId, fire.fireDate, fire.startMin, firedAt)
  }

  return { listKeysByDate, record }
}

export function createSessionStore(db: Db): SessionStore {
  const selectLatest = db.prepare(
    'SELECT id, action_id, started_at, target_sec FROM timer_sessions ORDER BY started_at DESC LIMIT 1',
  )
  const upsert = db.prepare(`
    INSERT INTO timer_sessions (id, action_id, started_at, target_sec)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET action_id = excluded.action_id,
      started_at = excluded.started_at, target_sec = excluded.target_sec
  `)
  const remove = db.prepare('DELETE FROM timer_sessions WHERE id = ?')
  const removeByAction = db.prepare('DELETE FROM timer_sessions WHERE action_id = ?')

  function load(): TimerSession | null {
    const row = selectLatest.get() as SessionRow | undefined
    if (row === undefined) {
      return null
    }
    return {
      id: row.id,
      actionId: row.action_id,
      startedAt: row.started_at,
      targetSec: row.target_sec,
    }
  }

  function save(session: TimerSession): void {
    upsert.run(session.id, session.actionId, session.startedAt, session.targetSec)
  }

  function clear(sessionId: string): void {
    remove.run(sessionId)
  }

  function clearByAction(actionId: ActionId): void {
    removeByAction.run(actionId)
  }

  return { load, save, clear, clearByAction }
}

export function createUnitOfWork(db: Db): UnitOfWork {
  function run<T>(work: () => T): T {
    return db.transaction(work)()
  }
  return { run }
}

// 设置表是简单键值对，铃声默认值与后续偏好都走这里
export function createSettingsRepo(db: Db): SettingsRepo {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?')
  const readAll = db.prepare('SELECT key, value FROM settings')
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)

  function get(key: string): string | null {
    const row = read.get(key) as { value: string } | undefined
    return row === undefined ? null : row.value
  }

  function set(key: string, value: string): void {
    upsert.run(key, value)
  }

  function getAll(): Record<string, string> {
    const rows = readAll.all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }

  function setMany(values: Readonly<Record<string, string>>): void {
    const run = db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        upsert.run(key, value)
      }
    })
    run()
  }

  return { get, set, getAll, setMany }
}

type CustomRingtoneRow = {
  readonly id: string
  readonly name: string
  readonly file_name: string
  readonly duration_sec: number
  readonly clip_start_sec: number
  readonly clip_end_sec: number | null
  readonly size_bytes: number
  readonly created_at: number
}

export function createCustomRingtoneRepo(db: Db): CustomRingtoneRepo {
  const selectAll = db.prepare(`
    SELECT id, name, file_name, duration_sec, clip_start_sec, clip_end_sec, size_bytes, created_at
    FROM custom_ringtones
    ORDER BY created_at, id
  `)
  const selectById = db.prepare(`
    SELECT id, name, file_name, duration_sec, clip_start_sec, clip_end_sec, size_bytes, created_at
    FROM custom_ringtones WHERE id = ?
  `)
  const insert = db.prepare(`
    INSERT INTO custom_ringtones (id, name, file_name, duration_sec, clip_start_sec, clip_end_sec, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateName = db.prepare('UPDATE custom_ringtones SET name = ? WHERE id = ?')
  const updateClip = db.prepare(
    'UPDATE custom_ringtones SET clip_start_sec = ?, clip_end_sec = ? WHERE id = ?',
  )
  const removeStmt = db.prepare('DELETE FROM custom_ringtones WHERE id = ?')

  function list(): readonly CustomRingtoneRecord[] {
    return (selectAll.all() as CustomRingtoneRow[]).map(toCustomRingtone)
  }

  function findById(id: string): CustomRingtoneRecord | null {
    const row = selectById.get(id) as CustomRingtoneRow | undefined
    return row === undefined ? null : toCustomRingtone(row)
  }

  function create(record: CustomRingtoneRecord): CustomRingtoneRecord {
    insert.run(
      record.id,
      record.name,
      record.fileName,
      record.durationSec,
      record.clipStartSec,
      record.clipEndSec,
      record.sizeBytes,
      record.createdAt,
    )
    return record
  }

  function rename(id: string, name: string): CustomRingtoneRecord | null {
    updateName.run(name, id)
    return findById(id)
  }

  function updateClipRecord(
    id: string,
    clipStartSec: number,
    clipEndSec: number | null,
  ): CustomRingtoneRecord | null {
    updateClip.run(clipStartSec, clipEndSec, id)
    return findById(id)
  }

  function remove(id: string): void {
    removeStmt.run(id)
  }

  return { list, findById, create, rename, updateClip: updateClipRecord, remove }
}

function toCustomRingtone(row: CustomRingtoneRow): CustomRingtoneRecord {
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    durationSec: row.duration_sec,
    clipStartSec: row.clip_start_sec,
    clipEndSec: row.clip_end_sec,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }
}
