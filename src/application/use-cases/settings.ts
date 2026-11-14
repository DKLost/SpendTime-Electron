import { err, ok, type Result } from '@core/result'
import {
  mergeSettings,
  parseSettings,
  serializeSettings,
  type AppSettings,
  type SettingsError,
  type SettingsPatch,
} from '@core/settings'
import type { SettingsEffects, SettingsRepo } from '../ports'

export function loadSettings(repo: SettingsRepo): AppSettings {
  return parseSettings(repo.getAll())
}

// 先应用桌面副作用（快捷键/自启），成功后才落库；失败时调用方保留旧值
export function updateSettings(
  repo: SettingsRepo,
  effects: SettingsEffects,
  patch: SettingsPatch,
): Result<AppSettings, SettingsError> {
  const current = loadSettings(repo)
  const merged = mergeSettings(current, patch)
  if (!merged.ok) {
    return merged
  }
  const applied = effects.apply(merged.value, current)
  if (!applied.ok) {
    return err({ code: 'INVALID_SETTING', message: applied.error.message })
  }
  repo.setMany(serializeSettings(merged.value))
  return ok(merged.value)
}
