import { useEffect, useState } from 'react'
import type {
  EventPayload,
  SettingsDto,
  SettingsPatchDto,
  SettingsSnapshotDto,
} from '@shared/contracts'
import { invokeCommand, subscribeEvent } from '../api'
import { apiErrorText, DEFAULT_LOCALE, localeTag } from '../translation'

export type SettingsState = {
  readonly snapshot: SettingsSnapshotDto | null
  readonly loading: boolean
  update(patch: SettingsPatchDto): Promise<string | null>
  refresh(): Promise<void>
}

export function useSettings(): SettingsState {
  const [snapshot, setSnapshot] = useState<SettingsSnapshotDto | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(function subscribeSettingsChanges() {
    function handleChanged(payload: EventPayload<'settings.changed'>): void {
      setSnapshot((current) => (current === null ? current : { ...current, settings: payload }))
    }
    return subscribeEvent('settings.changed', handleChanged)
  }, [])

  useEffect(function loadInitialSettings() {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const response = await invokeCommand('settings.get', {})
    setLoading(false)
    if (response.ok) {
      setSnapshot(response.value)
    }
  }

  async function update(patch: SettingsPatchDto): Promise<string | null> {
    const response = await invokeCommand('settings.update', { patch })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setSnapshot((current) => (current === null ? current : { ...current, settings: response.value }))
    return null
  }

  return { snapshot, loading, update, refresh }
}

export function applyDensity(settings: SettingsDto | undefined): void {
  if (settings === undefined) {
    return
  }
  document.documentElement.dataset['density'] = settings.density
}

export function applySlotTint(settings: SettingsDto | undefined): void {
  if (settings === undefined) {
    return
  }
  document.documentElement.dataset['slotTint'] = settings.slotTintEnabled ? 'on' : 'off'
}

// 语言同时写到文档根节点，便于样式与系统控件（如日期框）按语言调整
export function applyDocumentLocale(settings: SettingsDto | undefined): void {
  const locale = settings?.locale ?? DEFAULT_LOCALE
  document.documentElement.lang = localeTag(locale)
  document.documentElement.dataset['locale'] = locale
}
