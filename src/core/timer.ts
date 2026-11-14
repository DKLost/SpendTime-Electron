import type { NewTimeRecord } from './record'
import { err, ok, type Result } from './result'
import { splitByLocalDay, toLocalDate } from './time'
import type { ActionId, DurationSec, EpochMs, OffsetMinutes } from './types'

export type TimerSession = {
  readonly id: string
  readonly actionId: ActionId
  readonly startedAt: EpochMs
  readonly targetSec: DurationSec | null
}

export type TimerState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly session: TimerSession }

export type TimerPolicy = {
  // 默认 0：不足 60 秒也落库（口径统一，短会话不丢）
  readonly minRecordSec: DurationSec
  // 默认 true：跨零点按自然日切分成多条记录
  readonly splitAcrossMidnight: boolean
}

export const DEFAULT_TIMER_POLICY: TimerPolicy = {
  minRecordSec: 0,
  splitAcrossMidnight: true,
}

export type TimerEvent =
  | { readonly type: 'start'; readonly session: TimerSession }
  | { readonly type: 'tick'; readonly now: EpochMs }
  | { readonly type: 'stop'; readonly now: EpochMs }
  | { readonly type: 'restore'; readonly session: TimerSession; readonly now: EpochMs }

export type TimerEffect =
  | { readonly type: 'session.save'; readonly session: TimerSession }
  | { readonly type: 'session.clear'; readonly sessionId: string }
  | { readonly type: 'record.insert'; readonly records: readonly NewTimeRecord[] }
  | {
      readonly type: 'timer.finished'
      readonly actionId: ActionId
      readonly durationSec: DurationSec
      // completed 为倒计时自然到点，stopped 为用户手动结束；渲染层只给前者播结束铃声
      readonly reason: TimerFinishedReason
    }

export type TimerFinishedReason = 'completed' | 'stopped'

export type TimerDecision = {
  readonly state: TimerState
  readonly effects: readonly TimerEffect[]
}

export type TimerErrorCode = 'ALREADY_RUNNING' | 'NOT_RUNNING'

export type TimerError = {
  readonly code: TimerErrorCode
  readonly message: string
}

export type TimerContext = {
  readonly now: EpochMs
  readonly offsetMinutes: OffsetMinutes
  readonly policy: TimerPolicy
}

export function elapsedSecOf(session: TimerSession, now: EpochMs): DurationSec {
  return Math.max(0, Math.floor((now - session.startedAt) / 1000))
}

export function remainingSecOf(session: TimerSession, now: EpochMs): DurationSec | null {
  if (session.targetSec === null) {
    return null
  }
  return session.targetSec - elapsedSecOf(session, now)
}

export function targetEndAt(session: TimerSession): EpochMs | null {
  if (session.targetSec === null) {
    return null
  }
  return session.startedAt + session.targetSec * 1000
}

// 倒计时到点用目标时刻结算，而不是「发现到点」的时刻，避免定时器延迟污染记录
function isTargetReached(session: TimerSession, now: EpochMs): boolean {
  const endAt = targetEndAt(session)
  return endAt !== null && now >= endAt
}

function buildRecords(session: TimerSession, endAt: EpochMs, ctx: TimerContext): readonly NewTimeRecord[] {
  const spans = ctx.policy.splitAcrossMidnight
    ? splitByLocalDay(session.startedAt, endAt, ctx.offsetMinutes)
    : [
        {
          startAt: session.startedAt,
          endAt,
          localDate: toLocalDate(session.startedAt, ctx.offsetMinutes),
        },
      ]

  return spans.map((row, seq) => ({
    actionId: session.actionId,
    sessionId: session.id,
    sessionSeq: seq,
    startAt: row.startAt,
    endAt: row.endAt,
    durationSec: Math.floor((row.endAt - row.startAt) / 1000),
    localDate: row.localDate,
    source: 'timer' as const,
  }))
}

function finalize(
  session: TimerSession,
  endAt: EpochMs,
  ctx: TimerContext,
  reason: TimerFinishedReason,
): TimerDecision {
  const durationSec = Math.max(0, Math.floor((endAt - session.startedAt) / 1000))
  const effects: TimerEffect[] = []
  if (durationSec > 0 && durationSec >= ctx.policy.minRecordSec) {
    effects.push({ type: 'record.insert', records: buildRecords(session, endAt, ctx) })
  }
  effects.push({ type: 'session.clear', sessionId: session.id })
  effects.push({ type: 'timer.finished', actionId: session.actionId, durationSec, reason })
  return { state: { status: 'idle' }, effects }
}

export function reduceTimer(
  state: TimerState,
  event: TimerEvent,
  ctx: TimerContext,
): Result<TimerDecision, TimerError> {
  switch (event.type) {
    case 'start': {
      if (state.status === 'running') {
        return err({ code: 'ALREADY_RUNNING', message: '已有正在进行的计时' })
      }
      const session = event.session
      return ok({
        state: { status: 'running', session },
        effects: [{ type: 'session.save', session }],
      })
    }

    case 'tick': {
      if (state.status === 'idle') {
        return ok({ state, effects: [] })
      }
      if (!isTargetReached(state.session, event.now)) {
        return ok({ state, effects: [] })
      }
      return ok(finalize(state.session, targetEndAt(state.session) ?? event.now, ctx, 'completed'))
    }

    case 'stop': {
      if (state.status === 'idle') {
        return err({ code: 'NOT_RUNNING', message: '当前没有正在进行的计时' })
      }
      return ok(finalize(state.session, event.now, ctx, 'stopped'))
    }

    case 'restore': {
      if (isTargetReached(event.session, event.now)) {
        return ok(finalize(event.session, targetEndAt(event.session) ?? event.now, ctx, 'completed'))
      }
      return ok({
        state: { status: 'running', session: event.session },
        effects: [],
      })
    }
  }
}
