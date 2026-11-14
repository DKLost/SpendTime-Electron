import type { DataPort } from '@application/ports'
import type {
  ExportAction,
  ExportCounts,
  ExportData,
  ExportPlan,
  ExportRecord,
  ExportTodo,
} from '@core/export'
import type { Db } from './sqlite/database'

type ActionRow = {
  readonly id: number
  readonly name: string
  readonly archived: number
  readonly created_at: number
  readonly archived_at: number | null
  readonly start_ringtone: string | null
  readonly end_ringtone: string | null
  readonly sort_order: number
  readonly target_sec: number | null
}

// 导出/导入只覆盖用户数据；设置、自定义铃声文件与提醒事件保持本机状态
export function createDataPort(db: Db): DataPort {
  function snapshotAll(): ExportData {
    const actionRows = db
      .prepare(`
        SELECT a.id, a.name, a.archived, a.created_at, a.archived_at, a.start_ringtone, a.end_ringtone,
               a.sort_order, t.target_sec
        FROM actions a LEFT JOIN action_timer_targets t ON t.action_id = a.id
        ORDER BY a.sort_order, a.id
      `)
      .all() as ActionRow[]
    const actions: ExportAction[] = actionRows.map((row) => ({
      id: row.id,
      name: row.name,
      archived: row.archived === 1,
      createdAt: row.created_at,
      archivedAt: row.archived_at,
      timerTargetSec: row.target_sec,
      startRingtone: row.start_ringtone,
      endRingtone: row.end_ringtone,
      sortOrder: row.sort_order,
    }))
    const plans = db
      .prepare(
        'SELECT id, weekday, start_min, end_min, action_id, created_at, alarm_enabled FROM plans ORDER BY weekday, start_min, id',
      )
      .all() as {
      id: number
      weekday: number
      start_min: number
      end_min: number
      action_id: number
      created_at: number
      alarm_enabled: number
    }[]
    const records = db
      .prepare(
        'SELECT id, action_id, start_at, end_at, duration_sec, local_date, source FROM time_records ORDER BY start_at, id',
      )
      .all() as {
      id: number
      action_id: number
      start_at: number
      end_at: number
      duration_sec: number
      local_date: string
      source: ExportRecord['source']
    }[]
    const todos = db
      .prepare(
        'SELECT id, title, completed, created_at, completed_at, sort_order, archived, archived_at FROM todos ORDER BY sort_order, id',
      )
      .all() as {
      id: number
      title: string
      completed: number
      created_at: number
      completed_at: number | null
      sort_order: number
      archived: number
      archived_at: number | null
    }[]
    return {
      actions,
      plans: plans.map<ExportPlan>((row) => ({
        id: row.id,
        weekday: row.weekday,
        startMin: row.start_min,
        endMin: row.end_min,
        actionId: row.action_id,
        createdAt: row.created_at,
        alarmEnabled: row.alarm_enabled === 1,
      })),
      records: records.map<ExportRecord>((row) => ({
        id: row.id,
        actionId: row.action_id,
        startAt: row.start_at,
        endAt: row.end_at,
        durationSec: row.duration_sec,
        localDate: row.local_date,
        source: row.source,
      })),
      todos: todos.map<ExportTodo>((row) => ({
        id: row.id,
        title: row.title,
        completed: row.completed === 1,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        sortOrder: row.sort_order,
        archived: row.archived === 1,
        archivedAt: row.archived_at,
      })),
    }
  }

  // 先删子表再删行动；整个替换在一个事务内，失败自动回滚
  function replaceAll(data: ExportData): void {
    const run = db.transaction(() => {
      db.prepare('DELETE FROM alarm_events').run()
      db.prepare('DELETE FROM timer_sessions').run()
      db.prepare('DELETE FROM action_timer_targets').run()
      db.prepare('DELETE FROM time_records').run()
      db.prepare('DELETE FROM plans').run()
      db.prepare('DELETE FROM todos').run()
      db.prepare('DELETE FROM actions').run()

      const insertAction = db.prepare(`
        INSERT INTO actions (id, name, archived, created_at, archived_at, start_ringtone, end_ringtone, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertTarget = db.prepare(
        'INSERT INTO action_timer_targets (action_id, target_sec) VALUES (?, ?)',
      )
      for (const action of data.actions) {
        insertAction.run(
          action.id,
          action.name,
          action.archived ? 1 : 0,
          action.createdAt,
          action.archivedAt,
          action.startRingtone,
          action.endRingtone,
          action.sortOrder,
        )
        if (action.timerTargetSec !== null) {
          insertTarget.run(action.id, action.timerTargetSec)
        }
      }

      const insertPlan = db.prepare(`
        INSERT INTO plans (id, weekday, start_min, end_min, action_id, created_at, alarm_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const plan of data.plans) {
        insertPlan.run(
          plan.id,
          plan.weekday,
          plan.startMin,
          plan.endMin,
          plan.actionId,
          plan.createdAt,
          plan.alarmEnabled ? 1 : 0,
        )
      }

      const insertRecord = db.prepare(`
        INSERT INTO time_records
          (id, action_id, session_id, session_seq, start_at, end_at, duration_sec, local_date, source, created_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      `)
      for (const record of data.records) {
        insertRecord.run(
          record.id,
          record.actionId,
          `import-${record.id}`,
          record.startAt,
          record.endAt,
          record.durationSec,
          record.localDate,
          record.source,
          record.endAt,
        )
      }

      const insertTodo = db.prepare(`
        INSERT INTO todos
          (id, title, completed, created_at, completed_at, sort_order, archived, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const todo of data.todos) {
        insertTodo.run(
          todo.id,
          todo.title,
          todo.completed ? 1 : 0,
          todo.createdAt,
          todo.completedAt,
          todo.sortOrder,
          todo.archived ? 1 : 0,
          todo.archivedAt,
        )
      }
    })
    run()
  }

  function counts(): ExportCounts {
    const read = (table: string): number => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
      return row.count
    }
    return {
      actions: read('actions'),
      plans: read('plans'),
      records: read('time_records'),
      todos: read('todos'),
    }
  }

  return { snapshotAll, replaceAll, counts }
}
