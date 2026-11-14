import { useEffect, useRef } from 'react'
import type { ActionDto, EventPayload, TimerSnapshotDto } from '@shared/contracts'
import { subscribeEvent } from '../api'
import {
  playRingtone,
  type CustomRingtoneFile,
} from '../features/ringtones/play-ringtone'
import { resolveRingtone, type RingtoneValue } from './ringtone-types'

export type RingtoneSettings = {
  readonly defaultStart: RingtoneValue
  readonly defaultEnd: RingtoneValue
  readonly soundEnabled: boolean
  readonly custom: readonly CustomRingtoneFile[]
}

export type RingtoneEvents = {
  // 计划提醒已经响过铃，随后从提醒卡片启动计时时不要重复播放开始铃声
  suppressNextStart(): void
  cancelStartSuppression(): void
}

// 计时开始播开始铃声，倒计时自然到点播结束铃声；手动结束不提示
export function useRingtoneEvents(
  snapshot: TimerSnapshotDto,
  actions: readonly ActionDto[],
  settings: RingtoneSettings,
): RingtoneEvents {
  const suppressedRef = useRef(false)
  const previousRef = useRef<{ status: TimerSnapshotDto['status']; actionId: number | null }>({
    status: snapshot.status,
    actionId: snapshot.actionId,
  })

  useEffect(
    function playStartOnTransition() {
      const previous = previousRef.current
      previousRef.current = { status: snapshot.status, actionId: snapshot.actionId }

      if (snapshot.status !== 'running' || snapshot.actionId === null) {
        return
      }
      if (previous.status === 'running' && previous.actionId === snapshot.actionId) {
        return
      }
      if (suppressedRef.current) {
        suppressedRef.current = false
        return
      }
      playForAction(actions, snapshot.actionId, 'start', settings)
    },
    [snapshot.status, snapshot.actionId, actions, settings],
  )

  useEffect(
    function subscribeTimerFinished() {
      function handleFinished(payload: EventPayload<'timer.finished'>): void {
        if (payload.reason !== 'completed') {
          return
        }
        playForAction(actions, payload.actionId, 'end', settings)
      }
      return subscribeEvent('timer.finished', handleFinished)
    },
    [actions, settings],
  )

  function suppressNextStart(): void {
    suppressedRef.current = true
  }

  function cancelStartSuppression(): void {
    suppressedRef.current = false
  }

  return { suppressNextStart, cancelStartSuppression }
}

function playForAction(
  actions: readonly ActionDto[],
  actionId: number,
  kind: 'start' | 'end',
  settings: RingtoneSettings,
): void {
  if (!settings.soundEnabled) {
    return
  }
  const action = actions.find((item) => item.id === actionId)
  const value = action === undefined ? null : kind === 'start' ? action.startRingtone : action.endRingtone
  const ringtoneId = resolveRingtone(
    value,
    kind === 'start' ? settings.defaultStart : settings.defaultEnd,
  )
  if (ringtoneId !== null) {
    playRingtone(ringtoneId, settings.custom)
  }
}
