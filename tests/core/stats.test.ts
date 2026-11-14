import { describe, expect, it } from 'vitest'
import type { RecordView } from '@core/record'
import { buildStats, toRecordCsv } from '@core/stats'
import { shiftLocalDate } from '@core/time'

function record(overrides: Partial<RecordView> = {}): RecordView {
  return {
    id: 1,
    actionId: 1,
    actionName: '写作',
    startAt: 0,
    endAt: 1800,
    durationSec: 1800,
    localDate: '2026-11-13',
    source: 'timer',
    ...overrides,
  }
}

describe('shiftLocalDate', () => {
  it('跨月与跨年平移', () => {
    expect(shiftLocalDate('2026-11-13', -6)).toBe('2026-11-07')
    expect(shiftLocalDate('2026-01-02', -3)).toBe('2025-12-30')
  })
})

describe('buildStats', () => {
  it('空记录返回空行动列表', () => {
    expect(buildStats([])).toEqual({ byAction: [] })
  })

  it('按行动聚合，并按总时长排序', () => {
    const stats = buildStats([
      record({ id: 1, durationSec: 3600, localDate: '2026-11-12' }),
      record({ id: 2, durationSec: 1800 }),
      record({ id: 3, actionId: 2, actionName: '阅读', durationSec: 1200 }),
    ])

    expect(stats.byAction.map((item) => item.actionName)).toEqual(['写作', '阅读'])
    expect(stats.byAction[0]?.durationSec).toBe(5400)
    expect(stats.byAction[0]?.share).toBeCloseTo(5400 / 6600)
  })

  it('同行动同名多段记录合并计数', () => {
    const stats = buildStats([
      record({ id: 1, durationSec: 600 }),
      record({ id: 2, durationSec: 900 }),
    ])
    expect(stats.byAction).toHaveLength(1)
    expect(stats.byAction[0]?.count).toBe(2)
  })
})

describe('CSV 导出', () => {
  it('带 BOM、表头并转义逗号', () => {
    const csv = toRecordCsv([record({ actionName: '写,作' })])
    expect(csv.startsWith('\uFEFFdate,action')).toBe(true)
    expect(csv).toContain('"写,作"')
  })
})
