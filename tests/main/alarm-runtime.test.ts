import { describe, expect, it } from 'vitest'
import type { AlarmFire } from '@core/alarm'
import { createAlarmRuntime, delayToNextMinute } from '../../src/main/runtime/alarm-runtime'
import { openDatabase } from '../../src/main/adapters/sqlite/database'
import {
  createActionRepo,
  createAlarmEventRepo,
  createPlanRepo,
} from '../../src/main/adapters/sqlite/repositories'

const logger = {
  info: (_message: string): void => undefined,
  error: (_message: string): void => undefined,
}

// 2026-11-13 09:05（+08:00），周五
const FRIDAY_0905 = Date.UTC(2026, 10, 13, 1, 5)
const FRIDAY_0910 = Date.UTC(2026, 10, 13, 1, 10)
const NOW = 1_700_000_000_000

const clockNow = { value: FRIDAY_0905 }

describe('delayToNextMinute', () => {
  it('总是落在下一个整分，整分处向后再推一分钟', () => {
    expect(delayToNextMinute(0)).toBe(60_000)
    expect(delayToNextMinute(1)).toBe(59_999)
    expect(delayToNextMinute(59_999)).toBe(1)
    expect(delayToNextMinute(60_000)).toBe(60_000)
    expect(delayToNextMinute(60_001)).toBe(59_999)
  })
})

describe('alarm runtime', () => {
  it('启动即补查、nudge 补查新时段，同一时段不重复触发', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const plans = createPlanRepo(db)
    const alarms = createAlarmEventRepo(db)
    const fired: AlarmFire[][] = []
    const runtime = createAlarmRuntime({
      plans,
      alarmEvents: alarms,
      clock: { now: () => clockNow.value, offsetMinutes: () => 480 },
      logger,
      onFired: (fires) => fired.push([...fires]),
    })

    const writing = actions.create('写作', NOW)
    const reading = actions.create('阅读', NOW)
    const plan = plans.create(
      { weekday: 5, startMin: 540, endMin: 630, actionId: writing.id, alarmEnabled: true },
      NOW,
    )

    clockNow.value = FRIDAY_0905
    runtime.start()
    expect(fired).toHaveLength(1)
    expect(fired[0]?.[0]?.startMin).toBe(540)
    expect(alarms.listKeysByDate('2026-11-13')).toEqual([`${plan.id}:2026-11-13:540`])

    runtime.nudge()
    expect(fired).toHaveLength(1)

    // 改时段：按新时段重新触发
    plans.update(plan.id, {
      weekday: 5, startMin: 550, endMin: 610, actionId: writing.id, alarmEnabled: true,
    })
    clockNow.value = FRIDAY_0910
    runtime.nudge()
    expect(fired).toHaveLength(2)
    expect(fired[1]?.[0]?.startMin).toBe(550)

    // 同一时段改行动、关开提醒都不应再次触发
    plans.update(plan.id, {
      weekday: 5, startMin: 550, endMin: 610, actionId: reading.id, alarmEnabled: true,
    })
    runtime.nudge()
    plans.update(plan.id, {
      weekday: 5, startMin: 550, endMin: 610, actionId: reading.id, alarmEnabled: false,
    })
    runtime.nudge()
    plans.update(plan.id, {
      weekday: 5, startMin: 550, endMin: 610, actionId: reading.id, alarmEnabled: true,
    })
    runtime.nudge()
    expect(fired).toHaveLength(2)

    runtime.dispose()
    db.close()
  })
})
