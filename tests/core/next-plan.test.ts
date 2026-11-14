import { describe, expect, it } from 'vitest'
import type { PlanView } from '@core/plan'
import { findNextPlan } from '@core/next-plan'
import { epochAtLocalMinute } from '@core/time'
import type { Weekday } from '@core/types'

const OFFSET = 480

function plan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    id: 1,
    weekday: 6,
    startMin: 9 * 60,
    endMin: 10 * 60,
    actionId: 1,
    actionName: '写作',
    createdAt: 0,
    alarmEnabled: true,
    ...overrides,
  }
}

function at(minute: number, second = 0): number {
  return epochAtLocalMinute('2026-11-14', minute, OFFSET) + second * 1_000
}

describe('findNextPlan', () => {
  it('没有开启提醒的计划时返回 null', () => {
    expect(findNextPlan([], at(8 * 60), OFFSET)).toBeNull()
    expect(findNextPlan([plan({ alarmEnabled: false })], at(8 * 60), OFFSET)).toBeNull()
  })

  it('返回当天稍后的最近计划', () => {
    const next = findNextPlan([plan()], at(8 * 60), OFFSET)
    expect(next?.plan.actionName).toBe('写作')
    expect(next?.startDate).toBe('2026-11-14')
    expect(next?.startAt).toBe(at(9 * 60))
  })

  it('当天计划已开始则跳到下周同一星期', () => {
    const next = findNextPlan([plan()], at(9 * 60, 30), OFFSET)
    expect(next?.startDate).toBe('2026-11-21')
    expect(next?.weekday).toBe(6)
  })

  it('正在进行中的计划视为已错过，跳到下一次', () => {
    const inProgress = plan({ startMin: 8 * 60, endMin: 10 * 60 })
    const next = findNextPlan([inProgress], at(8 * 60 + 30), OFFSET)
    expect(next?.startDate).toBe('2026-11-21')
  })

  it('跨天取最近的未来计划', () => {
    const monday: Weekday = 1
    const next = findNextPlan([plan({ id: 2, weekday: monday, actionName: '阅读' })], at(8 * 60), OFFSET)
    expect(next?.startDate).toBe('2026-11-16')
    expect(next?.weekday).toBe(1)
    expect(next?.plan.actionName).toBe('阅读')
  })

  it('多个计划按开始时刻取最近，同日同刻按 id 稳定', () => {
    const plans = [
      plan({ id: 3, weekday: 7, actionName: '周日' }),
      plan({ id: 1, weekday: 6, startMin: 10 * 60, endMin: 11 * 60, actionName: '今天晚些' }),
      plan({ id: 2, weekday: 6, startMin: 9 * 60, endMin: 9 * 60 + 30, actionName: '今天最早' }),
    ]
    const next = findNextPlan(plans, at(8 * 60), OFFSET)
    expect(next?.plan.id).toBe(2)
    expect(next?.startAt).toBe(at(9 * 60))
  })
})
