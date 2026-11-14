import { useEffect, useState } from 'react'
import type { CustomRingtoneDto, EventPayload, StagedRingtoneDto } from '@shared/contracts'
import type { RingtoneChoice, RingtoneValue } from './ringtone-types'
import { invokeCommand, subscribeEvent } from '../api'
import { apiErrorText } from '../translation'

export type RemoveRingtoneResult = {
  readonly error: string | null
  readonly affectedActions: number
  readonly clearedDefaults: number
}

export type PickRingtoneResult = {
  readonly error: string | null
  // null 表示用户取消选择
  readonly staged: StagedRingtoneDto | null
}

export type CommitRingtoneResult = {
  readonly error: string | null
  readonly imported: boolean
}

export type RingtonesState = {
  readonly defaultStart: RingtoneValue
  readonly defaultEnd: RingtoneValue
  readonly custom: readonly CustomRingtoneDto[]
  readonly loading: boolean
  setDefault(kind: 'start' | 'end', value: RingtoneValue): Promise<string | null>
  setAction(actionId: number, kind: 'start' | 'end', value: RingtoneChoice): Promise<string | null>
  pickRingtone(): Promise<PickRingtoneResult>
  commitRingtone(token: string, startSec: number, endSec: number): Promise<CommitRingtoneResult>
  cancelRingtone(token: string): Promise<void>
  renameRingtone(id: string, name: string): Promise<string | null>
  updateClip(id: string, startSec: number, endSec: number): Promise<string | null>
  removeRingtone(id: string): Promise<RemoveRingtoneResult>
  refresh(): Promise<void>
}

const FALLBACK: RingtoneValue = 'chime'

export function useRingtones(): RingtonesState {
  const [defaultStart, setDefaultStart] = useState<RingtoneValue>(FALLBACK)
  const [defaultEnd, setDefaultEnd] = useState<RingtoneValue>(FALLBACK)
  const [custom, setCustom] = useState<readonly CustomRingtoneDto[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(function subscribeChanges() {
    function handleDataChanged(payload: EventPayload<'data.changed'>): void {
      if (payload.scope === 'actions') {
        void loadAll()
      }
    }
    function handleSettingsChanged(payload: EventPayload<'settings.changed'>): void {
      setDefaultStart(payload.defaultStartRingtone)
      setDefaultEnd(payload.defaultEndRingtone)
      void loadAll()
    }
    const offData = subscribeEvent('data.changed', handleDataChanged)
    const offSettings = subscribeEvent('settings.changed', handleSettingsChanged)
    return function unsubscribe(): void {
      offData()
      offSettings()
    }
  }, [])

  useEffect(function loadInitialConfig() {
    void loadAll()
  }, [])

  async function loadAll(): Promise<void> {
    const response = await invokeCommand('ringtones.list', {})
    setLoading(false)
    if (!response.ok) {
      return
    }
    setDefaultStart(response.value.defaultStart)
    setDefaultEnd(response.value.defaultEnd)
    setCustom(response.value.custom)
  }

  async function setDefault(kind: 'start' | 'end', value: RingtoneValue): Promise<string | null> {
    const response = await invokeCommand('ringtones.setDefault', { kind, value })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setDefaultStart(response.value.defaultStart)
    setDefaultEnd(response.value.defaultEnd)
    // 默认引用变化会影响自定义铃声的 usedByDefault 提示
    void loadAll()
    return null
  }

  async function setAction(
    actionId: number,
    kind: 'start' | 'end',
    value: RingtoneChoice,
  ): Promise<string | null> {
    const response = await invokeCommand('ringtones.setAction', { actionId, kind, value })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    void loadAll()
    return null
  }

  async function pickRingtone(): Promise<PickRingtoneResult> {
    const response = await invokeCommand('ringtones.import', {})
    if (!response.ok) {
      return { error: apiErrorText(response.error), staged: null }
    }
    return { error: null, staged: response.value }
  }

  async function commitRingtone(
    token: string,
    startSec: number,
    endSec: number,
  ): Promise<CommitRingtoneResult> {
    const response = await invokeCommand('ringtones.commitImport', { token, startSec, endSec })
    if (!response.ok) {
      return { error: apiErrorText(response.error), imported: false }
    }
    await loadAll()
    return { error: null, imported: true }
  }

  async function cancelRingtone(token: string): Promise<void> {
    await invokeCommand('ringtones.cancelImport', { token })
  }

  async function renameRingtone(id: string, name: string): Promise<string | null> {
    const response = await invokeCommand('ringtones.rename', { ringtoneId: id, name })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    await loadAll()
    return null
  }

  // 重新切片：只覆盖区间，音频文件与记录都不新增
  async function updateClip(id: string, startSec: number, endSec: number): Promise<string | null> {
    const response = await invokeCommand('ringtones.updateClip', { ringtoneId: id, startSec, endSec })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    await loadAll()
    return null
  }

  async function removeRingtone(id: string): Promise<RemoveRingtoneResult> {
    const response = await invokeCommand('ringtones.remove', { ringtoneId: id })
    if (!response.ok) {
      return { error: apiErrorText(response.error), affectedActions: 0, clearedDefaults: 0 }
    }
    await loadAll()
    return {
      error: null,
      affectedActions: response.value.affectedActions,
      clearedDefaults: response.value.clearedDefaults,
    }
  }

  return {
    defaultStart,
    defaultEnd,
    custom,
    loading,
    setDefault,
    setAction,
    pickRingtone,
    commitRingtone,
    cancelRingtone,
    renameRingtone,
    updateClip,
    removeRingtone,
    refresh: loadAll,
  }
}
