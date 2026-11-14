import { executeTimerEffects, type TimerEffectDeps } from '@application/effects'
import {
  restoreTimer,
  startTimer,
  stopTimer,
  tickTimer,
  toTimerSnapshot,
  type StartTimerInput,
  type TimerCommandError,
  type TimerDeps,
  type TimerSnapshot,
} from '@application/use-cases/timer'
import { err, ok, type Result } from '@core/result'
import type { TimerDecision, TimerState } from '@core/timer'

const TICK_INTERVAL_MS = 1000

export type TimerRuntime = {
  start(input: StartTimerInput): Result<TimerSnapshot, TimerCommandError>
  stop(): Result<TimerSnapshot, TimerCommandError>
  snapshot(): TimerSnapshot
  restore(): void
  dispose(): void
}

export type TimerRuntimeDeps = {
  readonly timer: TimerDeps
  readonly effects: TimerEffectDeps
  readonly publish: (snapshot: TimerSnapshot) => void
}

export function createTimerRuntime(deps: TimerRuntimeDeps): TimerRuntime {
  let state: TimerState = { status: 'idle' }
  const interval = setInterval(runTick, TICK_INTERVAL_MS)

  // 所有命令都是同步执行的，Node 单线程保证命令与 tick 不会交错，因此不需要额外队列
  function applyDecision(decision: TimerDecision): void {
    state = decision.state
    executeTimerEffects(decision.effects, deps.effects)
  }

  function currentSnapshot(): TimerSnapshot {
    return toTimerSnapshot(state, deps.timer.clock.now())
  }

  function runTick(): void {
    if (state.status !== 'running') {
      return
    }
    const result = tickTimer(state, deps.timer)
    if (!result.ok) {
      deps.effects.logger.error('计时 tick 失败', result.error)
      return
    }
    applyDecision(result.value)
    deps.publish(currentSnapshot())
  }

  function start(input: StartTimerInput): Result<TimerSnapshot, TimerCommandError> {
    const result = startTimer(state, input, deps.timer)
    if (!result.ok) {
      return err(result.error)
    }
    applyDecision(result.value)
    const snapshot = currentSnapshot()
    deps.publish(snapshot)
    return ok(snapshot)
  }

  function stop(): Result<TimerSnapshot, TimerCommandError> {
    const result = stopTimer(state, deps.timer)
    if (!result.ok) {
      return err(result.error)
    }
    applyDecision(result.value)
    const snapshot = currentSnapshot()
    deps.publish(snapshot)
    return ok(snapshot)
  }

  function restore(): void {
    const saved = deps.effects.sessions.load()
    if (saved === null) {
      return
    }
    const result = restoreTimer(saved, deps.timer)
    if (!result.ok) {
      deps.effects.logger.error('恢复计时会话失败', result.error)
      return
    }
    applyDecision(result.value)
    deps.publish(currentSnapshot())
  }

  function dispose(): void {
    clearInterval(interval)
  }

  return { start, stop, snapshot: currentSnapshot, restore, dispose }
}
