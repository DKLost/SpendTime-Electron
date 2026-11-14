import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Clock, IdGen, Logger, SessionStore } from '@application/ports'
import { DEFAULT_TIMER_POLICY } from '@core/timer'
import { createTimerRuntime, type TimerRuntime } from '../../src/main/runtime/timer-runtime'
import { openDatabase, type Db } from '../../src/main/adapters/sqlite/database'
import {
  createActionRepo,
  createRecordRepo,
  createSessionStore,
  createUnitOfWork,
} from '../../src/main/adapters/sqlite/repositories'

const OFFSET = 480
const MINUTE = 60_000

// 本地时间转 epoch，固定东八区，避免测试受运行环境时区影响
function localEpoch(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour - OFFSET / 60, minute)
}

const logger: Logger = {
  info: (_message: string): void => undefined,
  error: (_message: string): void => undefined,
}

function createClock(initial: number): Clock & { setNow(next: number): void } {
  let current = initial
  return {
    now: () => current,
    offsetMinutes: () => OFFSET,
    setNow: (next) => {
      current = next
    },
  }
}

function createIds(prefix: string): IdGen {
  let counter = 0
  return {
    next: () => {
      counter += 1
      return `${prefix}-${counter}`
    },
  }
}

type Harness = {
  readonly db: Db
  readonly runtime: TimerRuntime
  readonly records: ReturnType<typeof createRecordRepo>
  readonly sessions: SessionStore
  readonly finished: { actionId: number; durationSec: number; reason: 'completed' | 'stopped' }[]
  readonly clock: Clock & { setNow(next: number): void }
}

function createHarness(dbPath: string, initialNow: number, prefix: string): Harness {
  const db = openDatabase(dbPath, logger)
  const actions = createActionRepo(db)
  const records = createRecordRepo(db)
  const sessions = createSessionStore(db)
  const clock = createClock(initialNow)
  const finished: { actionId: number; durationSec: number; reason: 'completed' | 'stopped' }[] = []

  const runtime = createTimerRuntime({
    timer: { clock, ids: createIds(prefix), actions, policy: DEFAULT_TIMER_POLICY },
    effects: {
      sessions,
      records,
      unitOfWork: createUnitOfWork(db),
      notifier: { finished: (input) => finished.push({ ...input }) },
      logger,
    },
    publish: () => undefined,
  })

  return { db, runtime, records, sessions, finished, clock }
}

function withTempDb(run: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'spendtime-timer-e2e-'))
  try {
    run(join(dir, 'spendtime.db'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function createAction(harness: Harness): number {
  const action = createActionRepo(harness.db).create('深度工作', harness.clock.now())
  return action.id
}

describe('计时恢复 E2E（真实 SQLite + 重启）', () => {
  it('重启后按 startedAt 恢复计时并继续累计', () => {
    withTempDb((dbPath) => {
      const startedAt = localEpoch(2026, 11, 13, 23, 30)
      const first = createHarness(dbPath, startedAt, 'boot-a')
      const actionId = createAction(first)
      expect(first.runtime.start({ actionId, targetSec: null }).ok).toBe(true)
      first.runtime.dispose()
      first.db.close()

      const restarted = createHarness(dbPath, startedAt + 40 * MINUTE, 'boot-b')
      restarted.runtime.restore()
      const snapshot = restarted.runtime.snapshot()
      expect(snapshot.status).toBe('running')
      expect(snapshot.startedAt).toBe(startedAt)
      expect(snapshot.elapsedSec).toBe(40 * 60)

      restarted.runtime.dispose()
      restarted.db.close()
    })
  })

  it('跨零点停止时按自然日拆成两条记录', () => {
    withTempDb((dbPath) => {
      const startedAt = localEpoch(2026, 11, 13, 23, 30)
      const harness = createHarness(dbPath, startedAt, 'boot-c')
      const actionId = createAction(harness)
      harness.runtime.start({ actionId, targetSec: null })

      harness.clock.setNow(localEpoch(2026, 11, 14, 0, 10))
      expect(harness.runtime.stop().ok).toBe(true)

      const firstDay = harness.records.listByDate('2026-11-13')
      const secondDay = harness.records.listByDate('2026-11-14')
      expect(firstDay).toHaveLength(1)
      expect(firstDay[0]?.durationSec).toBe(30 * 60)
      expect(secondDay).toHaveLength(1)
      expect(secondDay[0]?.durationSec).toBe(10 * 60)
      expect(harness.sessions.load()).toBeNull()

      harness.runtime.dispose()
      harness.db.close()
    })
  })

  it('休眠错过结束时刻后按目标时刻补记，不把休眠时长算进去', () => {
    withTempDb((dbPath) => {
      const startedAt = localEpoch(2026, 11, 13, 23, 50)
      const first = createHarness(dbPath, startedAt, 'boot-d')
      const actionId = createAction(first)
      expect(first.runtime.start({ actionId, targetSec: 20 * 60 }).ok).toBe(true)
      first.runtime.dispose()
      first.db.close()

      // 模拟合盖休眠到次日上午，恢复时目标时刻早已过去
      const resumed = createHarness(dbPath, localEpoch(2026, 11, 14, 8, 0), 'boot-e')
      resumed.runtime.restore()

      expect(resumed.runtime.snapshot().status).toBe('idle')
      const firstDay = resumed.records.listByDate('2026-11-13')
      const secondDay = resumed.records.listByDate('2026-11-14')
      const beforeMidnight = firstDay[0]?.durationSec ?? 0
      const afterMidnight = secondDay[0]?.durationSec ?? 0
      expect(beforeMidnight).toBe(10 * 60)
      expect(afterMidnight).toBe(10 * 60)
      expect(beforeMidnight + afterMidnight).toBe(20 * 60)
      expect(resumed.finished).toEqual([
        { actionId, durationSec: 20 * 60, reason: 'completed' },
      ])
      expect(resumed.sessions.load()).toBeNull()

      resumed.runtime.dispose()
      resumed.db.close()
    })
  })
})
