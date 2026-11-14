import { useEffect, useState } from 'react'
import type { EventPayload, PlanViewDto } from '@shared/contracts'
import type { Weekday } from '@core/types'
import { invokeCommand, subscribeEvent } from '../api'
import { apiErrorText } from '../translation'

export type CreatePlanRequest = {
  readonly weekday: Weekday
  readonly startMin: number
  readonly endMin: number
  readonly actionId: number
  readonly alarmEnabled: boolean
}

export type UpdatePlanRequest = CreatePlanRequest & {
  readonly planId: number
}

export type WeekPlansState = {
  readonly plans: readonly PlanViewDto[]
  createPlan(input: CreatePlanRequest): Promise<string | null>
  updatePlan(input: UpdatePlanRequest): Promise<string | null>
  setPlanAlarm(planId: number, enabled: boolean): Promise<string | null>
  removePlan(planId: number): Promise<string | null>
  copyWeekday(from: Weekday, to: Weekday): Promise<string | null>
}

export function useWeekPlans(): WeekPlansState {
  const [plans, setPlans] = useState<readonly PlanViewDto[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(function subscribePlanChanges() {
    function handleChanged(payload: EventPayload<'data.changed'>): void {
      if (payload.scope === 'plans') {
        setRefreshKey((key) => key + 1)
      }
    }
    return subscribeEvent('data.changed', handleChanged)
  }, [])

  useEffect(
    function loadPlans() {
      let cancelled = false
      async function fetchPlans(): Promise<void> {
        const response = await invokeCommand('plans.listWeek', {})
        if (cancelled) {
          return
        }
        if (response.ok) {
          setPlans(response.value)
        }
      }
      void fetchPlans()
      return function cancelLoad(): void {
        cancelled = true
      }
    },
    [refreshKey],
  )

  async function createPlan(input: CreatePlanRequest): Promise<string | null> {
    const response = await invokeCommand('plans.create', input)
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function updatePlan(input: UpdatePlanRequest): Promise<string | null> {
    const response = await invokeCommand('plans.update', input)
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function setPlanAlarm(planId: number, enabled: boolean): Promise<string | null> {
    const response = await invokeCommand('plans.setAlarm', { planId, enabled })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function removePlan(planId: number): Promise<string | null> {
    const response = await invokeCommand('plans.remove', { planId })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function copyWeekday(from: Weekday, to: Weekday): Promise<string | null> {
    const response = await invokeCommand('plans.copyWeekday', { from, to })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  return { plans, createPlan, updatePlan, setPlanAlarm, removePlan, copyWeekday }
}
