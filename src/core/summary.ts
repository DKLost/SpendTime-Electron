export function totalDurationSec(records: readonly { readonly durationSec: number }[]): number {
  return records.reduce((sum, record) => sum + record.durationSec, 0)
}

export type ActionTotal = {
  readonly actionId: number
  readonly durationSec: number
}

export function summarizeByAction(
  records: readonly { readonly actionId: number; readonly durationSec: number }[],
): readonly ActionTotal[] {
  const totals = new Map<number, number>()
  for (const record of records) {
    totals.set(record.actionId, (totals.get(record.actionId) ?? 0) + record.durationSec)
  }
  return [...totals].map(([actionId, durationSec]) => ({ actionId, durationSec }))
}

export type MinuteRange = {
  readonly startMin: number
  readonly endMin: number
}

// 由已记录区间反推空档：先裁到当天并合并重叠/相接的区间，
// 再按时间顺序收集缝隙。跨零点段由调用方把终点换算成 24:00 后传入。
export function computeGaps(
  ranges: readonly MinuteRange[],
  dayStartMin = 0,
  dayEndMin = 24 * 60,
): readonly MinuteRange[] {
  const clamped = ranges
    .map((range) => ({
      startMin: Math.max(dayStartMin, Math.min(dayEndMin, range.startMin)),
      endMin: Math.max(dayStartMin, Math.min(dayEndMin, range.endMin)),
    }))
    .filter((range) => range.endMin > range.startMin)
    .sort((left, right) => left.startMin - right.startMin)

  const gaps: MinuteRange[] = []
  let cursor = dayStartMin
  for (const range of clamped) {
    if (range.startMin > cursor) {
      gaps.push({ startMin: cursor, endMin: range.startMin })
    }
    cursor = Math.max(cursor, range.endMin)
  }
  if (cursor < dayEndMin) {
    gaps.push({ startMin: cursor, endMin: dayEndMin })
  }
  return gaps
}

export function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
