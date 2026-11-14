import { isRingtoneValue } from './ringtone'
import { err, ok, type Result } from './result'
import type { LocalDate } from './types'

export const EXPORT_FORMAT = 'spendtime-export'
export const EXPORT_FORMAT_VERSION = 1

export type ExportAction = {
  readonly id: number
  readonly name: string
  readonly archived: boolean
  readonly createdAt: number
  readonly archivedAt: number | null
  readonly timerTargetSec: number | null
  readonly startRingtone: string | null
  readonly endRingtone: string | null
  readonly sortOrder: number
}

export type ExportPlan = {
  readonly id: number
  readonly weekday: number
  readonly startMin: number
  readonly endMin: number
  readonly actionId: number
  readonly createdAt: number
  readonly alarmEnabled: boolean
}

export type ExportRecord = {
  readonly id: number
  readonly actionId: number
  readonly startAt: number
  readonly endAt: number
  readonly durationSec: number
  readonly localDate: LocalDate
  readonly source: 'timer' | 'plan' | 'manual' | 'import'
}

export type ExportTodo = {
  readonly id: number
  readonly title: string
  readonly completed: boolean
  readonly createdAt: number
  readonly completedAt: number | null
  readonly sortOrder: number
  readonly archived: boolean
  readonly archivedAt: number | null
}

export type ExportData = {
  readonly actions: readonly ExportAction[]
  readonly plans: readonly ExportPlan[]
  readonly records: readonly ExportRecord[]
  readonly todos: readonly ExportTodo[]
}

export type ExportPackage = {
  readonly format: typeof EXPORT_FORMAT
  readonly formatVersion: typeof EXPORT_FORMAT_VERSION
  readonly appVersion: string
  readonly exportedAt: number
  readonly data: ExportData
}

export type ExportCounts = {
  readonly actions: number
  readonly plans: number
  readonly records: number
  readonly todos: number
}

export type ExportError = {
  readonly code: 'INVALID_FORMAT' | 'INVALID_DATA' | 'UNSUPPORTED_VERSION'
  readonly message: string
}

export type ParsedExport = {
  readonly package: ExportPackage
  readonly counts: ExportCounts
  readonly warnings: readonly string[]
}

export function buildExport(data: ExportData, appVersion: string, exportedAt: number): ExportPackage {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion,
    exportedAt,
    data,
  }
}

export function countExport(data: ExportData): ExportCounts {
  return {
    actions: data.actions.length,
    plans: data.plans.length,
    records: data.records.length,
    todos: data.todos.length,
  }
}

// 导入前做完整形状与引用校验，任何一条不合法都整体拒绝
export function parseExport(input: unknown): Result<ParsedExport, ExportError> {
  if (!isRecord(input)) {
    return invalid('INVALID_FORMAT', '导入文件不是有效的 JSON 对象')
  }
  if (input['format'] !== EXPORT_FORMAT) {
    return invalid('INVALID_FORMAT', '不是 SpendTime 导出文件')
  }
  if (input['formatVersion'] !== EXPORT_FORMAT_VERSION) {
    return invalid('UNSUPPORTED_VERSION', '导出文件版本不受支持')
  }
  if (!isRecord(input['data'])) {
    return invalid('INVALID_FORMAT', '导出文件缺少 data')
  }
  const data = input['data']
  const actions = parseActions(data['actions'])
  if (!actions.ok) {
    return actions
  }
  const plans = parsePlans(data['plans'])
  if (!plans.ok) {
    return plans
  }
  const records = parseRecords(data['records'])
  if (!records.ok) {
    return records
  }
  const todos = parseTodos(data['todos'])
  if (!todos.ok) {
    return todos
  }
  const exportedAt = typeof input['exportedAt'] === 'number' ? input['exportedAt'] : 0
  const actionIds = new Set(actions.value.map((action) => action.id))
  for (const plan of plans.value) {
    if (!actionIds.has(plan.actionId)) {
      return invalid('INVALID_DATA', `计划 #${plan.id} 引用了不存在的行动`)
    }
  }
  for (const record of records.value) {
    if (!actionIds.has(record.actionId)) {
      return invalid('INVALID_DATA', `记录 #${record.id} 引用了不存在的行动`)
    }
  }
  const warnings: string[] = []
  const future = records.value.filter((record) => record.endAt > exportedAt && exportedAt > 0).length
  if (future > 0) {
    warnings.push(`${future} 条记录结束时间晚于导出时间`)
  }
  const ringtoneValues = new Set(
    actions.value.flatMap((action) => [action.startRingtone, action.endRingtone]).filter(isString),
  )
  for (const value of ringtoneValues) {
    if (!isRingtoneValue(value)) {
      warnings.push(`存在无法识别的铃声引用：${value}`)
    }
  }
  return ok({
    package: {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      appVersion: typeof input['appVersion'] === 'string' ? input['appVersion'] : 'unknown',
      exportedAt,
      data: {
        actions: actions.value,
        plans: plans.value,
        records: records.value,
        todos: todos.value,
      },
    },
    counts: countExport({
      actions: actions.value,
      plans: plans.value,
      records: records.value,
      todos: todos.value,
    }),
    warnings,
  })
}

function parseActions(value: unknown): Result<ExportAction[], ExportError> {
  if (!Array.isArray(value)) {
    return invalid('INVALID_DATA', 'actions 必须是数组')
  }
  const result: ExportAction[] = []
  const ids = new Set<number>()
  for (const [index, row] of value.entries()) {
    if (!isRecord(row)) {
      return invalid('INVALID_DATA', `actions[${index}] 不是对象`)
    }
    const id = asPositiveInt(row['id'])
    if (id === null || ids.has(id)) {
      return invalid('INVALID_DATA', `actions[${index}] id 不合法或重复`)
    }
    ids.add(id)
    const name = row['name']
    if (typeof name !== 'string' || name.trim() === '' || name.length > 100) {
      return invalid('INVALID_DATA', `actions[${index}] 名称不合法`)
    }
    if (typeof row['archived'] !== 'boolean') {
      return invalid('INVALID_DATA', `actions[${index}] archived 不合法`)
    }
    const timerTargetSec = row['timerTargetSec']
    if (
      timerTargetSec !== null &&
      (typeof timerTargetSec !== 'number' || !Number.isInteger(timerTargetSec) || timerTargetSec <= 0)
    ) {
      return invalid('INVALID_DATA', `actions[${index}] 倒计时目标不合法`)
    }
    const startRingtone = parseNullableRingtone(row['startRingtone'])
    const endRingtone = parseNullableRingtone(row['endRingtone'])
    if (startRingtone === undefined || endRingtone === undefined) {
      return invalid('INVALID_DATA', `actions[${index}] 铃声引用不合法`)
    }
    result.push({
      id,
      name: name.trim(),
      archived: row['archived'],
      createdAt: asNonNegativeInt(row['createdAt']) ?? 0,
      // 旧导出文件没有该字段，按未知归档时间处理
      archivedAt: asNullableNonNegativeInt(row['archivedAt']),
      timerTargetSec: timerTargetSec === null ? null : timerTargetSec,
      startRingtone,
      endRingtone,
      sortOrder: asNonNegativeInt(row['sortOrder']) ?? id,
    })
  }
  return ok(result)
}

function parsePlans(value: unknown): Result<ExportPlan[], ExportError> {
  if (!Array.isArray(value)) {
    return invalid('INVALID_DATA', 'plans 必须是数组')
  }
  const result: ExportPlan[] = []
  const ids = new Set<number>()
  for (const [index, row] of value.entries()) {
    if (!isRecord(row)) {
      return invalid('INVALID_DATA', `plans[${index}] 不是对象`)
    }
    const id = asPositiveInt(row['id'])
    const actionId = asPositiveInt(row['actionId'])
    const weekday = asIntInRange(row['weekday'], 1, 7)
    const startMin = asIntInRange(row['startMin'], 0, 1440)
    const endMin = asIntInRange(row['endMin'], 0, 1440)
    if (id === null || ids.has(id) || actionId === null || weekday === null || startMin === null || endMin === null) {
      return invalid('INVALID_DATA', `plans[${index}] 字段不合法`)
    }
    ids.add(id)
    if (startMin >= endMin) {
      return invalid('INVALID_DATA', `plans[${index}] 开始时间必须早于结束时间`)
    }
    result.push({
      id,
      weekday,
      startMin,
      endMin,
      actionId,
      createdAt: asNonNegativeInt(row['createdAt']) ?? 0,
      alarmEnabled: typeof row['alarmEnabled'] === 'boolean' ? row['alarmEnabled'] : true,
    })
  }
  return ok(result)
}

function parseRecords(value: unknown): Result<ExportRecord[], ExportError> {
  if (!Array.isArray(value)) {
    return invalid('INVALID_DATA', 'records 必须是数组')
  }
  const sources = ['timer', 'plan', 'manual', 'import'] as const
  const result: ExportRecord[] = []
  const ids = new Set<number>()
  for (const [index, row] of value.entries()) {
    if (!isRecord(row)) {
      return invalid('INVALID_DATA', `records[${index}] 不是对象`)
    }
    const id = asPositiveInt(row['id'])
    const actionId = asPositiveInt(row['actionId'])
    const startAt = asNonNegativeInt(row['startAt'])
    const endAt = asNonNegativeInt(row['endAt'])
    const durationSec = asNonNegativeInt(row['durationSec'])
    const localDate = row['localDate']
    const source = row['source']
    if (
      id === null ||
      ids.has(id) ||
      actionId === null ||
      startAt === null ||
      endAt === null ||
      durationSec === null ||
      typeof localDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(localDate) ||
      !sources.includes(source as (typeof sources)[number])
    ) {
      return invalid('INVALID_DATA', `records[${index}] 字段不合法`)
    }
    if (endAt < startAt) {
      return invalid('INVALID_DATA', `records[${index}] 结束时间早于开始时间`)
    }
    ids.add(id)
    result.push({
      id,
      actionId,
      startAt,
      endAt,
      durationSec,
      localDate,
      source: source as ExportRecord['source'],
    })
  }
  return ok(result)
}

function parseTodos(value: unknown): Result<ExportTodo[], ExportError> {
  if (!Array.isArray(value)) {
    return invalid('INVALID_DATA', 'todos 必须是数组')
  }
  const result: ExportTodo[] = []
  const ids = new Set<number>()
  for (const [index, row] of value.entries()) {
    if (!isRecord(row)) {
      return invalid('INVALID_DATA', `todos[${index}] 不是对象`)
    }
    const id = asPositiveInt(row['id'])
    const title = row['title']
    if (id === null || ids.has(id) || typeof title !== 'string' || title.trim() === '' || title.length > 200) {
      return invalid('INVALID_DATA', `todos[${index}] 字段不合法`)
    }
    if (typeof row['completed'] !== 'boolean' || typeof row['archived'] !== 'boolean') {
      return invalid('INVALID_DATA', `todos[${index}] 状态不合法`)
    }
    ids.add(id)
    result.push({
      id,
      title: title.trim(),
      completed: row['completed'],
      createdAt: asNonNegativeInt(row['createdAt']) ?? 0,
      completedAt: asNullableNonNegativeInt(row['completedAt']),
      sortOrder: typeof row['sortOrder'] === 'number' && Number.isInteger(row['sortOrder']) ? row['sortOrder'] : 0,
      archived: row['archived'],
      archivedAt: asNullableNonNegativeInt(row['archivedAt']),
    })
  }
  return ok(result)
}

function parseNullableRingtone(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null
  }
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: string | null): value is string {
  return typeof value === 'string'
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function asNonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function asNullableNonNegativeInt(value: unknown): number | null {
  return value === null || value === undefined ? null : asNonNegativeInt(value)
}

function asIntInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null
}

function invalid(
  code: ExportError['code'],
  message: string,
): Result<never, ExportError> {
  return err({ code, message })
}
