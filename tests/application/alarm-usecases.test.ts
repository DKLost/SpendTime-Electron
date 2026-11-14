import { describe, expect, it } from 'vitest'
import type { AlarmEventRepo } from '@application/ports'
import { collectAlarms, markAlarmsFired } from '@application/use-cases/alarms'
import { alarmKey, type AlarmFire } from '@core/alarm'
import type { PlanView } from '@core/plan'

const OFFSET = 480
// 2026-11-13 09:05（+08:00），周五
const FRIDAY_0905 = Date.UTC(2026, 10, 13, 1, 5)
const FRIDAY_0920 = Date.UTC(2026, 10, 13, 1, 20)
const THURSDAY_0905 = Date.UTC(2026, 10, 12, 1, 5)

function plan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    id: 1,
    weekday: 5,
    startMin: 540,
    endMin: 630,
    actionId: 10,
    createdAt: 0,
    actionName: '写作',
    alarmEnabled: true,
    ...overrides,
  }
}

function createFakeAlarmRepo(): AlarmEventRepo {
  const keys = new Set<string>()
  return {
    listKeysByDate: () => [...keys],
    record: (fire: AlarmFire) => {
      keys.add(alarmKey(fire.planId, fire.fireDate))
    },
  }
}

describe('collectAlarms', () => {
  it('用系统时间算出日期、星期与分钟并命中计划', () => {
    const fires = collectAlarms([plan()], createFakeAlarmRepo(), FRIDAY_0905, OFFSET)
    expect(fires).toHaveLength(1)
    expect(fires[0]?.fireDate).toBe('2026-11-13')
  })

  it('星期不匹配不命中', () => {
    const fires = collectAlarms([plan()], createFakeAlarmRepo(), THURSDAY_0905, OFFSET)
    expect(fires).toEqual([])
  })

  it('超过宽限窗口不补发', () => {
    const fires = collectAlarms([plan()], createFakeAlarmRepo(), FRIDAY_0920, OFFSET)
    expect(fires).toEqual([])
  })

  it('关闭提醒的计划不会进入提醒列表', () => {
    const fires = collectAlarms(
      [plan({ alarmEnabled: false })],
      createFakeAlarmRepo(),
      FRIDAY_0905,
      OFFSET,
    )
    expect(fires).toEqual([])
  })
})

describe('markAlarmsFired', () => {
  it('落库后同一天不再重复触发', () => {
    const repo = createFakeAlarmRepo()
    const fires = collectAlarms([plan()], repo, FRIDAY_0905, OFFSET)
    markAlarmsFired(repo, fires, FRIDAY_0905)

    expect(repo.listKeysByDate('2026-11-13')).toEqual(['1:2026-11-13'])
    expect(collectAlarms([plan()], repo, FRIDAY_0905, OFFSET)).toEqual([])
  })
})
