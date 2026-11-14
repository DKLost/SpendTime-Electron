import { describe, expect, it } from 'vitest'
import { alarmKey, collectDueAlarms, DEFAULT_ALARM_GRACE_MINUTES, type AlarmPlan } from '@core/alarm'
import { minuteOfLocalDay, toLocalWeekday } from '@core/time'

const FRIDAY: AlarmPlan = {
  id: 1,
  weekday: 5,
  startMin: 540,
  endMin: 630,
  actionId: 10,
  actionName: '写作',
  alarmEnabled: true,
}

const FRIDAY_LATE: AlarmPlan = {
  id: 2,
  weekday: 5,
  startMin: 545,
  endMin: 630,
  actionId: 11,
  actionName: '阅读',
  alarmEnabled: true,
}

describe('toLocalWeekday / minuteOfLocalDay', () => {
  it('把 2026-11-13 09:05（+08:00）换算为周五与 545 分钟', () => {
    const epochMs = Date.UTC(2026, 10, 13, 1, 5)
    expect(toLocalWeekday(epochMs, 480)).toBe(5)
    expect(minuteOfLocalDay(epochMs, 480)).toBe(545)
  })

  it('周日映射为 7', () => {
    const epochMs = Date.UTC(2026, 10, 15, 1, 0)
    expect(toLocalWeekday(epochMs, 480)).toBe(7)
  })
})

describe('collectDueAlarms', () => {
  it('命中当天、已开始且在宽限窗口内的计划', () => {
    const fires = collectDueAlarms([FRIDAY], 5, '2026-11-13', 545, new Set())
    expect(fires).toEqual([
      {
        planId: 1,
        actionId: 10,
        actionName: '写作',
        startMin: 540,
        fireDate: '2026-11-13',
        targetSec: 5400,
      },
    ])
  })

  it('星期不匹配不触发', () => {
    expect(collectDueAlarms([FRIDAY], 4, '2026-11-12', 545, new Set())).toEqual([])
  })

  it('计划尚未开始不触发', () => {
    expect(collectDueAlarms([FRIDAY], 5, '2026-11-13', 539, new Set())).toEqual([])
  })

  it('宽限窗口边界：等于宽限值仍触发，超过一分钟后不触发', () => {
    const atLimit = 540 + DEFAULT_ALARM_GRACE_MINUTES
    expect(collectDueAlarms([FRIDAY], 5, '2026-11-13', atLimit, new Set())).toHaveLength(1)
    expect(collectDueAlarms([FRIDAY], 5, '2026-11-13', atLimit + 1, new Set())).toHaveLength(0)
  })

  it('已记录的计划不再重复触发', () => {
    const fired = new Set([alarmKey(1, '2026-11-13')])
    expect(collectDueAlarms([FRIDAY], 5, '2026-11-13', 545, fired)).toEqual([])
  })

  it('关闭提醒的计划不参与判定', () => {
    const muted: AlarmPlan = { ...FRIDAY, alarmEnabled: false }
    expect(collectDueAlarms([muted], 5, '2026-11-13', 545, new Set())).toEqual([])
  })

  it('多个计划同时到期时按开始时间聚合排序', () => {
    const fires = collectDueAlarms([FRIDAY_LATE, FRIDAY], 5, '2026-11-13', 546, new Set())
    expect(fires.map((fire) => fire.planId)).toEqual([1, 2])
  })

  it('宽限窗口可显式收紧', () => {
    expect(collectDueAlarms([FRIDAY], 5, '2026-11-13', 541, new Set(), 0)).toEqual([])
  })
})
