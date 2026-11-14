import { useEffect, useState } from 'react'
import type { EventPayload } from '@shared/contracts'
import type { ActionDto } from '@shared/contracts'
import { invokeCommand, subscribeEvent } from '../api'
import { apiErrorText } from '../translation'

export type ArchiveResult =
  | { readonly ok: true; readonly planCount: number; readonly recordCount: number }
  | { readonly ok: false; readonly message: string }

export type DeleteActionResult =
  | { readonly ok: true; readonly planCount: number; readonly recordCount: number }
  | { readonly ok: false; readonly message: string }

export type ActionTotals = Readonly<Record<number, number>>

export type ActionsState = {
  readonly actions: readonly ActionDto[]
  readonly archived: readonly ActionDto[]
  readonly totals: ActionTotals
  createAction(name: string): Promise<string | null>
  renameAction(actionId: number, name: string): Promise<string | null>
  archiveAction(actionId: number): Promise<ArchiveResult>
  restoreAction(actionId: number): Promise<string | null>
  removeAction(actionId: number): Promise<DeleteActionResult>
  setTimerTarget(actionId: number, targetSec: number | null): Promise<string | null>
  reorderAction(actionId: number, direction: 'up' | 'down'): Promise<string | null>
}

export function useActions(): ActionsState {
  const [actions, setActions] = useState<readonly ActionDto[]>([])
  const [archived, setArchived] = useState<readonly ActionDto[]>([])
  const [totals, setTotals] = useState<ActionTotals>({})
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(function subscribeActionChanges() {
    function handleChanged(payload: EventPayload<'data.changed'>): void {
      if (payload.scope === 'actions') {
        setRefreshKey((key) => key + 1)
      }
    }
    return subscribeEvent('data.changed', handleChanged)
  }, [])

  useEffect(
    function loadActions() {
      let cancelled = false
      async function fetchActions(): Promise<void> {
        const [response, totalResponse] = await Promise.all([
          invokeCommand('actions.list', { includeArchived: true }),
          invokeCommand('records.totalsByAction', {}),
        ])
        if (cancelled) {
          return
        }
        if (response.ok) {
          setActions(response.value.filter((action) => !action.archived))
          setArchived(response.value.filter((action) => action.archived))
        }
        if (totalResponse.ok) {
          setTotals(
            Object.fromEntries(totalResponse.value.map((item) => [item.actionId, item.durationSec])),
          )
        }
      }
      void fetchActions()
      return function cancelLoad(): void {
        cancelled = true
      }
    },
    [refreshKey],
  )

  async function createAction(name: string): Promise<string | null> {
    const response = await invokeCommand('actions.create', { name })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function renameAction(actionId: number, name: string): Promise<string | null> {
    const response = await invokeCommand('actions.rename', { actionId, name })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function archiveAction(actionId: number): Promise<ArchiveResult> {
    const response = await invokeCommand('actions.archive', { actionId })
    if (!response.ok) {
      return { ok: false, message: apiErrorText(response.error) }
    }
    setRefreshKey((key) => key + 1)
    return { ok: true, ...response.value }
  }

  async function restoreAction(actionId: number): Promise<string | null> {
    const response = await invokeCommand('actions.restore', { actionId })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function removeAction(actionId: number): Promise<DeleteActionResult> {
    const response = await invokeCommand('actions.remove', { actionId })
    if (!response.ok) {
      return { ok: false, message: apiErrorText(response.error) }
    }
    setRefreshKey((key) => key + 1)
    return { ok: true, ...response.value }
  }

  async function setTimerTarget(actionId: number, targetSec: number | null): Promise<string | null> {
    const response = await invokeCommand('actions.setTimerTarget', { actionId, targetSec })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function reorderAction(actionId: number, direction: 'up' | 'down'): Promise<string | null> {
    const response = await invokeCommand('actions.reorder', { actionId, direction })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setActions(response.value.filter((action) => !action.archived))
    setArchived(response.value.filter((action) => action.archived))
    return null
  }

  return {
    actions,
    archived,
    totals,
    createAction,
    renameAction,
    archiveAction,
    restoreAction,
    removeAction,
    setTimerTarget,
    reorderAction,
  }
}
