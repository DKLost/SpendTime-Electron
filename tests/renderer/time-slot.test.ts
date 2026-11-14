import { describe, expect, it } from 'vitest'
import { timeSlotOf } from '../../src/renderer/src/time-slot'

describe('timeSlotOf', () => {
  it('按开始时刻落档，分界点归入后一个时段', () => {
    const cases: readonly [number, string][] = [
      [0, 'night'],
      [5 * 60 + 29, 'night'],
      [5 * 60 + 30, 'dawn'],
      [7 * 60 + 59, 'dawn'],
      [8 * 60, 'morning'],
      [11 * 60 + 59, 'morning'],
      [12 * 60, 'noon'],
      [13 * 60 + 59, 'noon'],
      [14 * 60, 'afternoon'],
      [17 * 60 + 59, 'afternoon'],
      [18 * 60, 'evening'],
      [21 * 60 + 29, 'evening'],
      [21 * 60 + 30, 'late-night'],
      [24 * 60 - 1, 'late-night'],
    ]
    for (const [startMin, expected] of cases) {
      expect(timeSlotOf(startMin)).toBe(expected)
    }
  })

  it('越界输入不产生未定义时段', () => {
    expect(timeSlotOf(-1)).toBe('night')
    expect(timeSlotOf(24 * 60)).toBe('late-night')
  })
})
