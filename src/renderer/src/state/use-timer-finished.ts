import { useEffect, useState } from 'react'
import type { ActionDto, EventPayload } from '@shared/contracts'
import { subscribeEvent } from '../api'

export type FinishedTimer = {
  readonly actionId: number
  readonly actionName: string
  readonly durationSec: number
}

export type TimerFinishedState = {
  readonly finished: FinishedTimer | null
  clear(): void
}

const AUTO_DISMISS_MS = 30_000

// 只有倒计时自然到点才展示卡片；手动结束不打扰
export function useTimerFinished(actions: readonly ActionDto[]): TimerFinishedState {
  const [finished, setFinished] = useState<FinishedTimer | null>(null)

  useEffect(function subscribeFinished() {
    function handleFinished(payload: EventPayload<'timer.finished'>): void {
      if (payload.reason !== 'completed') {
        return
      }
      setFinished({
        actionId: payload.actionId,
        actionName: '行动',
        durationSec: payload.durationSec,
      })
    }
    return subscribeEvent('timer.finished', handleFinished)
  }, [])

  useEffect(
    function fillActionName() {
      setFinished((current) => {
        if (current === null) {
          return current
        }
        const action = actions.find((item) => item.id === current.actionId)
        if (action === undefined || action.name === current.actionName) {
          return current
        }
        return { ...current, actionName: action.name }
      })
    },
    [actions],
  )

  useEffect(
    function autoDismiss() {
      if (finished === null) {
        return
      }
      const timer = window.setTimeout(() => setFinished(null), AUTO_DISMISS_MS)
      return function clearTimer(): void {
        window.clearTimeout(timer)
      }
    },
    [finished],
  )

  return {
    finished,
    clear: () => setFinished(null),
  }
}
