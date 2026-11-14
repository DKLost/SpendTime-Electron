import type { NewTimeRecord } from '@core/record'
import type { TimerEffect, TimerFinishedReason } from '@core/timer'
import type { ActionId, DurationSec } from '@core/types'
import type { Logger, RecordRepo, SessionStore, UnitOfWork } from './ports'

export type TimerNotifier = {
  finished(input: {
    readonly actionId: ActionId
    readonly durationSec: DurationSec
    readonly reason: TimerFinishedReason
  }): void
}

export type TimerEffectDeps = {
  readonly sessions: SessionStore
  readonly records: RecordRepo
  readonly unitOfWork: UnitOfWork
  readonly notifier: TimerNotifier
  readonly logger: Logger
}

export type EffectFailure = {
  readonly effect: TimerEffect['type']
  readonly message: string
}

type PersistBatch = {
  readonly records: NewTimeRecord[]
  readonly sessionIdsToClear: string[]
  readonly finished: {
    readonly actionId: ActionId
    readonly durationSec: DurationSec
    readonly reason: TimerFinishedReason
  }[]
}

// 先持久化再通知：DB 写失败时不得发出「计时已结束」，避免提醒了却没记上
export function executeTimerEffects(
  effects: readonly TimerEffect[],
  deps: TimerEffectDeps,
): readonly EffectFailure[] {
  const failures: EffectFailure[] = []
  const batch = collectPersistBatch(effects)

  for (const effect of effects) {
    if (effect.type !== 'session.save') {
      continue
    }
    try {
      deps.sessions.save(effect.session)
    } catch (error) {
      failures.push({ effect: effect.type, message: describeError(error) })
    }
  }

  if (batch.records.length > 0 || batch.sessionIdsToClear.length > 0) {
    try {
      deps.unitOfWork.run(() => {
        if (batch.records.length > 0) {
          deps.records.insertMany(batch.records)
        }
        for (const sessionId of batch.sessionIdsToClear) {
          deps.sessions.clear(sessionId)
        }
      })
    } catch (error) {
      const message = describeError(error)
      deps.logger.error('计时结算写入失败，已跳过通知', { message })
      failures.push({ effect: 'record.insert', message })
      return failures
    }
  }

  for (const finished of batch.finished) {
    deps.notifier.finished(finished)
  }
  return failures
}

function collectPersistBatch(effects: readonly TimerEffect[]): PersistBatch {
  const batch: PersistBatch = { records: [], sessionIdsToClear: [], finished: [] }
  for (const effect of effects) {
    switch (effect.type) {
      case 'record.insert':
        batch.records.push(...effect.records)
        break
      case 'session.clear':
        batch.sessionIdsToClear.push(effect.sessionId)
        break
      case 'timer.finished':
        batch.finished.push({
          actionId: effect.actionId,
          durationSec: effect.durationSec,
          reason: effect.reason,
        })
        break
      case 'session.save':
        break
    }
  }
  return batch
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
