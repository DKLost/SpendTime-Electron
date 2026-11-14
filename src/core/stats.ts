import type { RecordView } from './record'
import type { ActionId, DurationSec } from './types'

export type ActionStat = {
  readonly actionId: ActionId
  readonly actionName: string
  readonly durationSec: DurationSec
  readonly count: number
  readonly share: number
}

export type StatsOverview = {
  readonly byAction: readonly ActionStat[]
}

// 纯聚合：只按行动汇总时长，区间由调用方查询后传入
export function buildStats(records: readonly RecordView[]): StatsOverview {
  const totalSec = records.reduce((sum, record) => sum + record.durationSec, 0)
  const byActionMap = new Map<ActionId, { name: string; durationSec: number; count: number }>()

  for (const record of records) {
    const action = byActionMap.get(record.actionId) ?? {
      name: record.actionName,
      durationSec: 0,
      count: 0,
    }
    action.durationSec += record.durationSec
    action.count += 1
    byActionMap.set(record.actionId, action)
  }

  const byAction = [...byActionMap.entries()]
    .map(([actionId, value]) => ({
      actionId,
      actionName: value.name,
      durationSec: value.durationSec,
      count: value.count,
      share: totalSec === 0 ? 0 : value.durationSec / totalSec,
    }))
    .sort((left, right) => right.durationSec - left.durationSec || left.actionId - right.actionId)

  return { byAction }
}

export function toRecordCsv(records: readonly RecordView[]): string {
  const header = 'date,action,duration_sec,start_at,end_at,source'
  const rows = records.map((record) =>
    [
      record.localDate,
      escapeCsv(record.actionName),
      String(record.durationSec),
      new Date(record.startAt).toISOString(),
      new Date(record.endAt).toISOString(),
      record.source,
    ].join(','),
  )
  // BOM 让 Excel 正确识别中文
  return `\uFEFF${[header, ...rows].join('\r\n')}`
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
