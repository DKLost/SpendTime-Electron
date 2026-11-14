import { useEffect, useState } from 'react'
import type { EventPayload, TimerSnapshotDto } from '@shared/contracts'
import { invokeCommand, subscribeEvent } from '../api'
import { apiErrorText } from '../translation'

const IDLE_SNAPSHOT: TimerSnapshotDto = {
  status: 'idle',
  actionId: null,
  startedAt: null,
  targetSec: null,
  elapsedSec: 0,
  remainingSec: null,
}

export type TimerController = {
  readonly snapshot: TimerSnapshotDto
  start(actionId: number, targetSec: number | null): Promise<string | null>
  stop(): Promise<string | null>
}

export function useTimerController(): TimerController {
  const [snapshot, setSnapshot] = useState<TimerSnapshotDto>(IDLE_SNAPSHOT)

  useEffect(function subscribeTicks() {
    function handleTick(payload: EventPayload<'timer.tick'>): void {
      setSnapshot(payload)
    }
    return subscribeEvent('timer.tick', handleTick)
  }, [])

  // 窗口重载或渲染进程重建后，从主进程补一次权威状态
  useEffect(function syncInitialState() {
    let cancelled = false
    async function loadState(): Promise<void> {
      const response = await invokeCommand('timer.getState', {})
      if (!cancelled && response.ok) {
        setSnapshot(response.value)
      }
    }
    void loadState()
    return function cancelLoad(): void {
      cancelled = true
    }
  }, [])

  async function start(actionId: number, targetSec: number | null): Promise<string | null> {
    const response = await invokeCommand('timer.start', { actionId, targetSec })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setSnapshot(response.value)
    return null
  }

  async function stop(): Promise<string | null> {
    const response = await invokeCommand('timer.stop', {})
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setSnapshot(response.value)
    return null
  }

  return { snapshot, start, stop }
}
