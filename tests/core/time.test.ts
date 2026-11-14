import { describe, expect, it } from 'vitest'
import { splitByLocalDay, startOfLocalDay, toLocalDate } from '@core/time'

const SHANGHAI = 480

describe('toLocalDate', () => {
  it('按偏移计算本地日期', () => {
    const epoch = Date.UTC(2026, 10, 12, 17, 0, 0) // 2026-11-13 01:00 +08:00
    expect(toLocalDate(epoch, SHANGHAI)).toBe('2026-11-13')
    expect(toLocalDate(epoch, 0)).toBe('2026-11-12')
  })
})

describe('startOfLocalDay', () => {
  it('返回本地零点的毫秒时间戳', () => {
    const epoch = Date.UTC(2026, 10, 12, 17, 30, 0)
    expect(startOfLocalDay(epoch, SHANGHAI)).toBe(Date.UTC(2026, 10, 12, 16, 0, 0))
  })
})

describe('splitByLocalDay', () => {
  it('跨零点切成两段且各自归属当天', () => {
    const start = Date.UTC(2026, 10, 12, 15, 30, 0) // 2026-11-12 23:30 +08:00
    const end = Date.UTC(2026, 10, 12, 16, 30, 0) // 2026-11-13 00:30 +08:00

    const segments = splitByLocalDay(start, end, SHANGHAI)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({ startAt: start, endAt: Date.UTC(2026, 10, 12, 16, 0, 0), localDate: '2026-11-12' })
    expect(segments[1]).toEqual({ startAt: Date.UTC(2026, 10, 12, 16, 0, 0), endAt: end, localDate: '2026-11-13' })
  })

  it('同日不切分', () => {
    const start = Date.UTC(2026, 10, 12, 1, 0, 0)
    const end = Date.UTC(2026, 10, 12, 2, 0, 0)
    expect(splitByLocalDay(start, end, SHANGHAI)).toHaveLength(1)
  })

  it('零长度区间返回空数组', () => {
    expect(splitByLocalDay(1000, 1000, SHANGHAI)).toEqual([])
  })
})
