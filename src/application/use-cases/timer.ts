import { err, type Result } from '@core/result'
import {
  elapsedSecOf,
  reduceTimer,
  remainingSecOf,
  type TimerDecision,
  type TimerContext,
  type TimerPolicy,
  type TimerSession,
  type TimerState,
} from '@core/timer'
import type { ActionId, DurationSec, EpochMs } from '@core/types'
import type { ActionRepo, Clock, IdGen } from '../ports'

export type TimerCommandErrorCode =
  | 'ALREADY_RUNNING'
  | 'NOT_RUNNING'
  | 'UNKNOWN_ACTION'
  | 'ARCHIVED_ACTION'

export type TimerCommandError = {
  readonly code: TimerCommandErrorCode
  readonly message: string
}

export type TimerDeps = {
  readonly clock: Clock
  readonly ids: IdGen
  readonly actions: ActionRepo
  readonly policy: TimerPolicy
}

export type StartTimerInput = {
  readonly actionId: ActionId
  readonly targetSec: DurationSec | null
}

export type TimerSnapshot = {
  readonly status: 'idle' | 'running'
  readonly actionId: number | null
  readonly startedAt: number | null
  readonly targetSec: number | null
  readonly elapsedSec: number
  readonly remainingSec: number | null
}

export function startTimer(
  state: TimerState,
  input: StartTimerInput,
  deps: TimerDeps,
): Result<TimerDecision, TimerCommandError> {
  const action = deps.actions.findById(input.actionId)
  if (action === null) {
    return err({ code: 'UNKNOWN_ACTION', message: '所选行动不存在' })
  }
  if (action.archived) {
    return err({ code: 'ARCHIVED_ACTION', message: '所选行动已归档' })
  }

  const now = deps.clock.now()
  const session: TimerSession = {
    id: deps.ids.next(),
    actionId: input.actionId,
    startedAt: now,
    targetSec: input.targetSec,
  }
  return reduceTimer(state, { type: 'start', session }, timerContext(deps, now))
}

export function stopTimer(
  state: TimerState,
  deps: TimerDeps,
): Result<TimerDecision, TimerCommandError> {
  const now = deps.clock.now()
  return reduceTimer(state, { type: 'stop', now }, timerContext(deps, now))
}

export function tickTimer(
  state: TimerState,
  deps: TimerDeps,
): Result<TimerDecision, TimerCommandError> {
  const now = deps.clock.now()
  return reduceTimer(state, { type: 'tick', now }, timerContext(deps, now))
}

export function restoreTimer(
  session: TimerSession,
  deps: TimerDeps,
): Result<TimerDecision, TimerCommandError> {
  const now = deps.clock.now()
  const state: TimerState = { status: 'running', session }
  return reduceTimer(state, { type: 'restore', session, now }, timerContext(deps, now))
}

export function toTimerSnapshot(state: TimerState, now: EpochMs): TimerSnapshot {
  if (state.status === 'idle') {
    return {
      status: 'idle',
      actionId: null,
      startedAt: null,
      targetSec: null,
      elapsedSec: 0,
      remainingSec: null,
    }
  }
  return {
    status: 'running',
    actionId: state.session.actionId,
    startedAt: state.session.startedAt,
    targetSec: state.session.targetSec,
    elapsedSec: elapsedSecOf(state.session, now),
    remainingSec: remainingSecOf(state.session, now),
  }
}

function timerContext(deps: TimerDeps, now: EpochMs): TimerContext {
  return { now, offsetMinutes: deps.clock.offsetMinutes(), policy: deps.policy }
}

export function idleState(): TimerState {
  return { status: 'idle' }
}
