import { describe, expect, it } from 'vitest'
import type { ActionRepo, Clock, IdGen } from '@application/ports'
import {
  idleState,
  startTimer,
  stopTimer,
  tickTimer,
  toTimerSnapshot,
  type TimerDeps,
} from '@application/use-cases/timer'
import type { Action } from '@core/action'
import { DEFAULT_TIMER_POLICY } from '@core/timer'

const START_AT = Date.UTC(2026, 10, 13, 1, 0, 0)

function createFakeClock(initial: number): Clock & { setNow(next: number): void } {
  let current = initial
  function now(): number {
    return current
  }
  function offsetMinutes(): number {
    return 480
  }
  function setNow(next: number): void {
    current = next
  }
  return { now, offsetMinutes, setNow }
}

function createFakeIds(): IdGen {
  let counter = 0
  function next(): string {
    counter += 1
    return `id-${counter}`
  }
  return { next }
}

function createFakeActionRepo(initial: readonly Action[]): ActionRepo {
  const rows = [...initial]
  return {
    list: (includeArchived) => (includeArchived ? rows : rows.filter((action) => !action.archived)),
    findById: (id) => rows.find((action) => action.id === id) ?? null,
    create: (name, now) => {
      const created: Action = {
        id: rows.length + 1,
        name,
        archived: false,
        createdAt: now,
        archivedAt: null,
        timerTargetSec: null,
        startRingtone: null,
        endRingtone: null,
        sortOrder: rows.length + 1,
      }
      rows.push(created)
      return created
    },
    rename: (id, name) => {
      const target = rows.find((action) => action.id === id)
      if (target === undefined) {
        throw new Error('行动不存在')
      }
      const next: Action = { ...target, name }
      rows[rows.indexOf(target)] = next
      return next
    },
    archive: (id) => {
      const target = rows.find((action) => action.id === id)
      if (target !== undefined) {
        rows[rows.indexOf(target)] = { ...target, archived: true }
      }
    },
    restore: (id) => {
      const target = rows.find((action) => action.id === id)
      if (target === undefined) {
        throw new Error('行动不存在')
      }
      const next: Action = { ...target, archived: false }
      rows[rows.indexOf(target)] = next
      return next
    },
    remove: (id) => {
      const index = rows.findIndex((action) => action.id === id)
      if (index >= 0) {
        rows.splice(index, 1)
      }
    },
    setTimerTarget: (id, targetSec) => {
      const target = rows.find((action) => action.id === id)
      if (target === undefined) {
        throw new Error('行动不存在')
      }
      const next: Action = { ...target, timerTargetSec: targetSec }
      rows[rows.indexOf(target)] = next
      return next
    },
    setRingtone: () => {
      throw new Error('测试用例不涉及铃声')
    },
    reorder: () => {
      throw new Error('测试用例不涉及排序')
    },
  }
}

function createDeps(overrides: Partial<TimerDeps> = {}): TimerDeps {
  return {
    clock: createFakeClock(START_AT),
    ids: createFakeIds(),
    actions: createFakeActionRepo([
      {
        id: 1,
        name: '写作',
        archived: false,
        createdAt: START_AT,
        archivedAt: null,
        timerTargetSec: null,
        startRingtone: null,
        endRingtone: null,
        sortOrder: 1,
      },
    ]),
    policy: DEFAULT_TIMER_POLICY,
    ...overrides,
  }
}

describe('startTimer', () => {
  it('用注入的时钟与 ID 生成会话', () => {
    const deps = createDeps()
    const result = startTimer(idleState(), { actionId: 1, targetSec: null }, deps)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.state).toEqual({
      status: 'running',
      session: { id: 'id-1', actionId: 1, startedAt: START_AT, targetSec: null },
    })
    expect(result.value.effects).toHaveLength(1)
  })

  it('行动不存在时拒绝', () => {
    const result = startTimer(idleState(), { actionId: 99, targetSec: null }, createDeps())
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('UNKNOWN_ACTION')
  })

  it('行动已归档时拒绝', () => {
    const deps = createDeps({
      actions: createFakeActionRepo([
        {
          id: 1,
          name: '旧行动',
          archived: true,
          createdAt: START_AT,
          archivedAt: START_AT,
          timerTargetSec: null,
          startRingtone: null,
          endRingtone: null,
          sortOrder: 1,
        },
      ]),
    })
    const result = startTimer(idleState(), { actionId: 1, targetSec: null }, deps)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('ARCHIVED_ACTION')
  })
})

describe('stopTimer / tickTimer', () => {
  it('停止后按时长生成记录', () => {
    const clock = createFakeClock(START_AT)
    const deps = createDeps({ clock })
    const started = startTimer(idleState(), { actionId: 1, targetSec: null }, deps)
    if (!started.ok) {
      throw new Error('开始计时失败')
    }

    clock.setNow(START_AT + 42_000)
    const stopped = stopTimer(started.value.state, deps)
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) {
      return
    }
    const insert = stopped.value.effects.find((effect) => effect.type === 'record.insert')
    if (insert === undefined || insert.type !== 'record.insert') {
      throw new Error('缺少 record.insert')
    }
    expect(insert.records[0]?.durationSec).toBe(42)
    expect(insert.records[0]?.localDate).toBe('2026-11-13')
  })

  it('倒计时到点后 tick 触发结算', () => {
    const clock = createFakeClock(START_AT)
    const deps = createDeps({ clock })
    const started = startTimer(idleState(), { actionId: 1, targetSec: 60 }, deps)
    if (!started.ok) {
      throw new Error('开始计时失败')
    }

    clock.setNow(START_AT + 30_000)
    const midway = tickTimer(started.value.state, deps)
    expect(midway.ok).toBe(true)
    if (!midway.ok) {
      return
    }
    expect(midway.value.state.status).toBe('running')

    clock.setNow(START_AT + 61_000)
    const finished = tickTimer(midway.value.state, deps)
    expect(finished.ok).toBe(true)
    if (!finished.ok) {
      return
    }
    expect(finished.value.state.status).toBe('idle')
  })
})

describe('toTimerSnapshot', () => {
  it('空闲快照字段为空', () => {
    expect(toTimerSnapshot(idleState(), START_AT)).toEqual({
      status: 'idle',
      actionId: null,
      startedAt: null,
      targetSec: null,
      elapsedSec: 0,
      remainingSec: null,
    })
  })

  it('运行中快照给出已用与剩余秒数', () => {
    const snapshot = toTimerSnapshot(
      { status: 'running', session: { id: 's', actionId: 2, startedAt: START_AT, targetSec: 300 } },
      START_AT + 120_000,
    )
    expect(snapshot.elapsedSec).toBe(120)
    expect(snapshot.remainingSec).toBe(180)
  })
})
