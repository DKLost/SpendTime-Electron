import { useEffect, useRef } from 'react'
import type { ActionDto, EventPayload, TimerSnapshotDto } from '@shared/contracts'
import { subscribeEvent } from '../api'
import {
  playRingtone,
  stopRingtone,
  type CustomRingtoneFile,
} from '../features/ringtones/play-ringtone'
import { resolveRingtone, type RingtoneValue } from './ringtone-types'

export type RingtoneSettings = {
  readonly defaultStart: RingtoneValue
  readonly defaultEnd: RingtoneValue
  readonly soundEnabled: boolean
  readonly custom: readonly CustomRingtoneFile[]
}

// 铃声只服务提醒场景：计时开始保持静音，倒计时自然到点播结束铃声；手动结束不提示
export function useRingtoneEvents(
  snapshot: TimerSnapshotDto,
  actions: readonly ActionDto[],
  settings: RingtoneSettings,
): void {
  const previousRef = useRef<{ status: TimerSnapshotDto['status']; actionId: number | null }>({
    status: snapshot.status,
    actionId: snapshot.actionId,
  })

  useEffect(
    function stopPreviousOnStart() {
      const previous = previousRef.current
      previousRef.current = { status: snapshot.status, actionId: snapshot.actionId }

      if (snapshot.status !== 'running' || snapshot.actionId === null) {
        return
      }
      if (previous.status === 'running' && previous.actionId === snapshot.actionId) {
        return
      }
      // 手动开始或提醒后自动开始都保持静音，只收掉上一段一次性铃声，
      // 避免倒计时结束的铃声继续播到文件末尾
      stopRingtone()
    },
    [snapshot.status, snapshot.actionId],
  )

  useEffect(
    function subscribeTimerFinished() {
      function handleFinished(payload: EventPayload<'timer.finished'>): void {
        if (payload.reason !== 'completed') {
          return
        }
        playEndForAction(actions, payload.actionId, settings)
      }
      return subscribeEvent('timer.finished', handleFinished)
    },
    [actions, settings],
  )
}

function playEndForAction(
  actions: readonly ActionDto[],
  actionId: number,
  settings: RingtoneSettings,
): void {
  if (!settings.soundEnabled) {
    return
  }
  const action = actions.find((item) => item.id === actionId)
  const value = action === undefined ? null : action.endRingtone
  const ringtoneId = resolveRingtone(value, settings.defaultEnd)
  if (ringtoneId !== null) {
    playRingtone(ringtoneId, settings.custom)
  }
}
