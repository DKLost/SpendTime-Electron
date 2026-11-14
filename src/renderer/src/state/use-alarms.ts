import { useEffect, useRef, useState } from 'react'
import type { AlarmFireDto, EventPayload } from '@shared/contracts'
import { subscribeEvent } from '../api'

export type AlarmState = {
  readonly alarms: readonly AlarmFireDto[]
  dismiss(planId: number): void
  dismissAll(): void
}

export type AlarmOptions = {
  // 主进程只在计划开启提醒时下发 fires，因此这里响铃即与提醒语义一致
  readonly playStart?: (actionId: number) => void
  // 确认或全部关闭提醒时停止循环铃声
  readonly stopStart?: () => void
}

export function useAlarms(options: AlarmOptions = {}): AlarmState {
  const [alarms, setAlarms] = useState<readonly AlarmFireDto[]>([])
  const playStartRef = useRef(options.playStart)
  const stopStartRef = useRef(options.stopStart)

  useEffect(
    function keepCallbacksCurrent() {
      playStartRef.current = options.playStart
      stopStartRef.current = options.stopStart
    },
    [options.playStart, options.stopStart],
  )

  useEffect(function subscribeAlarmFires() {
    function handleFired(payload: EventPayload<'alarm.fire'>): void {
      if (payload.fires.length === 0) {
        return
      }
      // 一次到点可能有多条计划，只播第一条的铃声，避免多个音频互相打断
      const first = payload.fires[0]
      if (first !== undefined) {
        playStartRef.current?.(first.actionId)
      }
      setAlarms((current) => mergeAlarms(current, payload.fires))
    }
    return subscribeEvent('alarm.fire', handleFired)
  }, [])

  function dismiss(planId: number): void {
    stopStartRef.current?.()
    setAlarms((current) => current.filter((alarm) => alarm.planId !== planId))
  }

  function dismissAll(): void {
    stopStartRef.current?.()
    setAlarms([])
  }

  return { alarms, dismiss, dismissAll }
}

// 同一计划同一天只保留一条，防止主进程补发时出现重复卡片
function mergeAlarms(
  current: readonly AlarmFireDto[],
  incoming: readonly AlarmFireDto[],
): readonly AlarmFireDto[] {
  const known = new Set(current.map(alarmKey))
  const fresh = incoming.filter((alarm) => !known.has(alarmKey(alarm)))
  return fresh.length === 0 ? current : [...current, ...fresh]
}

function alarmKey(alarm: AlarmFireDto): string {
  return `${alarm.planId}:${alarm.fireDate}`
}
