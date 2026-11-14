import type { Action } from '@core/action'
import { err, ok, type Result } from '@core/result'
import { customRingtoneId, isRingtoneValue, type RingtoneValue } from '@core/ringtone'
import { SETTINGS_KEYS } from '@core/settings'
import type { ActionId } from '@core/types'
import type { ActionRepo, CustomRingtoneRepo, SettingsRepo } from '../ports'
import { loadSettings } from './settings'

export type RingtoneError = {
  readonly code: 'INVALID_RINGTONE' | 'NOT_FOUND'
  readonly message: string
}

export type RingtoneConfig = {
  readonly defaultStart: RingtoneValue
  readonly defaultEnd: RingtoneValue
}

export function getRingtoneConfig(settings: SettingsRepo): RingtoneConfig {
  const current = loadSettings(settings)
  return {
    defaultStart: current.defaultStartRingtone,
    defaultEnd: current.defaultEndRingtone,
  }
}

export function setDefaultRingtone(
  settings: SettingsRepo,
  kind: 'start' | 'end',
  value: RingtoneValue,
  customRingtones?: CustomRingtoneRepo,
): Result<RingtoneConfig, RingtoneError> {
  if (!isRingtoneValue(value) || !customExists(value, customRingtones)) {
    return err({ code: 'INVALID_RINGTONE', message: '铃声不存在' })
  }
  settings.set(
    kind === 'start' ? SETTINGS_KEYS.defaultStartRingtone : SETTINGS_KEYS.defaultEndRingtone,
    value,
  )
  return ok(getRingtoneConfig(settings))
}

// 行动铃声支持 inherit（跟随默认）、none（不播放）与内置/自定义铃声
export function setActionRingtone(
  repo: ActionRepo,
  actionId: ActionId,
  kind: 'start' | 'end',
  value: string,
  customRingtones?: CustomRingtoneRepo,
): Result<Action, RingtoneError> {
  const resolved = value === 'inherit' ? null : value
  if (resolved !== null && (!isRingtoneValue(resolved) || !customExists(resolved, customRingtones))) {
    return err({ code: 'INVALID_RINGTONE', message: '铃声不存在' })
  }
  if (repo.findById(actionId) === null) {
    return err({ code: 'NOT_FOUND', message: '行动不存在或已删除' })
  }
  return ok(repo.setRingtone(actionId, kind, resolved))
}

// 自定义铃声必须仍然存在；内置/静音无需查库
function customExists(value: string, repo: CustomRingtoneRepo | undefined): boolean {
  const id = customRingtoneId(value)
  if (id === null) {
    return true
  }
  return repo === undefined || repo.findById(id) !== null
}
