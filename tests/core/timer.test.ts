import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_POLICY,
  reduceTimer,
  type TimerContext,
  type TimerSession,
  type TimerState,
} from '@core/timer'

const SHANGHAI = 480
const START_AT = Date.UTC(2026, 10, 13, 1, 0, 0) // 2026-11-13 09:00 +08:00

const session: TimerSession = {
  id: 'session-1',
  actionId: 7,
  startedAt: START_AT,
  targetSec: null,
}

function context(now: number, override: Partial<TimerContext> = {}): TimerContext {
  return {
    now,
    offsetMinutes: SHANGHAI,
    policy: DEFAULT_TIMER_POLICY,
    ...override,
  }
}

const idle: TimerState = { status: 'idle' }
const running: TimerState = { status: 'running', session }

describe('reduceTimer: start', () => {
  it('空闲状态开始计时，产生 session.save', () => {
    const result = reduceTimer(idle, { type: 'start', session }, context(START_AT))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.state).toEqual(running)
    expect(result.value.effects).toEqual([{ type: 'session.save', session }])
  })

  it('重复开始被拒绝', () => {
    const result = reduceTimer(running, { type: 'start', session }, context(START_AT))
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('ALREADY_RUNNING')
  })
})

describe('reduceTimer: tick', () => {
  it('未到目标时间不产生副作用', () => {
    const countdown = { ...session, targetSec: 600 }
    const result = reduceTimer({ status: 'running', session: countdown }, { type: 'tick', now: START_AT + 60_000 }, context(START_AT + 60_000))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.state.status).toBe('running')
    expect(result.value.effects).toEqual([])
  })

  it('倒计时到点按目标时刻结算', () => {
    const countdown = { ...session, targetSec: 600 }
    const now = START_AT + 601_000 // 定时器晚了 1 秒
    const result = reduceTimer({ status: 'running', session: countdown }, { type: 'tick', now }, context(now))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const insert = result.value.effects.find((effect) => effect.type === 'record.insert')
    expect(insert).toBeDefined()
    if (insert === undefined || insert.type !== 'record.insert') {
      return
    }
    expect(insert.records).toHaveLength(1)
    expect(insert.records[0]?.endAt).toBe(START_AT + 600_000)
    expect(insert.records[0]?.durationSec).toBe(600)
    expect(result.value.state).toEqual(idle)
  })
})

describe('reduceTimer: stop', () => {
  it('按真实结束时间结算', () => {
    const now = START_AT + 90_500
    const result = reduceTimer(running, { type: 'stop', now }, context(now))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const insert = result.value.effects.find((effect) => effect.type === 'record.insert')
    expect(insert).toBeDefined()
    if (insert === undefined || insert.type !== 'record.insert') {
      return
    }
    expect(insert.records[0]?.durationSec).toBe(90)
    expect(result.value.effects.map((effect) => effect.type)).toEqual([
      'record.insert',
      'session.clear',
      'timer.finished',
    ])
  })

  it('空闲状态结束被拒绝', () => {
    const result = reduceTimer(idle, { type: 'stop', now: START_AT }, context(START_AT))
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('NOT_RUNNING')
  })

  it('短会话策略生效时仍落库（默认口径）', () => {
    const now = START_AT + 20_000
    const result = reduceTimer(running, { type: 'stop', now }, context(now))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const insert = result.value.effects.find((effect) => effect.type === 'record.insert')
    expect(insert).toBeDefined()
  })

  it('把策略改成 60 秒后可丢弃短会话', () => {
    const now = START_AT + 20_000
    const ctx = context(now, { policy: { minRecordSec: 60, splitAcrossMidnight: true } })
    const result = reduceTimer(running, { type: 'stop', now }, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.effects.some((effect) => effect.type === 'record.insert')).toBe(false)
  })
})

describe('reduceTimer: 跨零点', () => {
  it('默认切分为两条记录并各自归属当天', () => {
    const lateSession: TimerSession = {
      id: 'session-2',
      actionId: 3,
      startedAt: Date.UTC(2026, 10, 12, 15, 30, 0), // 23:30 +08:00
      targetSec: null,
    }
    const now = Date.UTC(2026, 10, 12, 16, 30, 0) // 次日 00:30 +08:00
    const result = reduceTimer({ status: 'running', session: lateSession }, { type: 'stop', now }, context(now))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const insert = result.value.effects.find((effect) => effect.type === 'record.insert')
    if (insert === undefined || insert.type !== 'record.insert') {
      throw new Error('缺少 record.insert')
    }
    expect(insert.records).toHaveLength(2)
    expect(insert.records.map((record) => record.localDate)).toEqual(['2026-11-12', '2026-11-13'])
    expect(insert.records.map((record) => record.sessionSeq)).toEqual([0, 1])
  })
})

describe('reduceTimer: restore', () => {
  it('过期的倒计时立即补记', () => {
    const countdown = { ...session, targetSec: 60 }
    const now = START_AT + 120_000
    const result = reduceTimer(running, { type: 'restore', session: countdown, now }, context(now))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.state).toEqual(idle)
    const insert = result.value.effects.find((effect) => effect.type === 'record.insert')
    expect(insert).toBeDefined()
  })

  it('未过期的会话继续运行', () => {
    const countdown = { ...session, targetSec: 600 }
    const now = START_AT + 60_000
    const result = reduceTimer(running, { type: 'restore', session: countdown, now }, context(now))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.state.status).toBe('running')
    expect(result.value.effects).toEqual([])
  })
})
