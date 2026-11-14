import { describe, expect, it } from 'vitest'
import type { RecordView } from '@core/record'
import { validateRecordEdit } from '@core/record-edit'

const OFFSET = 480
// 2026-11-13 本地时间
const at = (hours: number, minutes: number): number => Date.UTC(2026, 10, 13, hours - 8, minutes)

const RECORD: RecordView = {
  id: 1,
  actionId: 10,
  actionName: '写作',
  startAt: at(9, 0),
  endAt: at(10, 0),
  durationSec: 3600,
  localDate: '2026-11-13',
  source: 'timer',
}

describe('validateRecordEdit', () => {
  it('同一天内的合法编辑会重算时长', () => {
    const result = validateRecordEdit(
      RECORD,
      { startAt: at(8, 30), endAt: at(10, 15) },
      OFFSET,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.durationSec).toBe(6300)
      expect(result.value.localDate).toBe('2026-11-13')
    }
  })

  it('结束不晚于开始时报 INVALID_RANGE', () => {
    const result = validateRecordEdit(
      RECORD,
      { startAt: at(10, 0), endAt: at(10, 0) },
      OFFSET,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_RANGE')
    }
  })

  it('不足 1 秒时报 TOO_SHORT', () => {
    const result = validateRecordEdit(
      RECORD,
      { startAt: at(9, 0), endAt: at(9, 0) + 500 },
      OFFSET,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TOO_SHORT')
    }
  })

  it('跨零点编辑被拒绝', () => {
    const result = validateRecordEdit(
      RECORD,
      { startAt: at(23, 30), endAt: at(23, 30) + 60 * 60 * 1000 },
      OFFSET,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CROSS_DAY')
    }
  })

  it('改到其它自然日同样被拒绝', () => {
    const result = validateRecordEdit(
      RECORD,
      { startAt: at(9, 0) + 86_400_000, endAt: at(10, 0) + 86_400_000 },
      OFFSET,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CROSS_DAY')
    }
  })
})
