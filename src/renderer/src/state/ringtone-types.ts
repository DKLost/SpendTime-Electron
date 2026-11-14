import type { BuiltinRingtoneId, RingtoneValue } from '@shared/ringtones'

export type { BuiltinRingtoneId, RingtoneValue }

export type RingtoneId = RingtoneValue
export type RingtoneChoice = 'inherit' | RingtoneValue

export const RINGTONE_IDS: readonly BuiltinRingtoneId[] = ['chime', 'bell', 'pulse']

export function isBuiltinRingtone(value: string | null): value is BuiltinRingtoneId {
  return value === 'chime' || value === 'bell' || value === 'pulse'
}

export function isCustomRingtone(value: string | null): value is `custom:${string}` {
  return value !== null && value.startsWith('custom:')
}

// 行动值 > 默认值；'none' 明确静音。返回 null 表示没有可播放来源
export function resolveRingtone(
  actionValue: string | null,
  defaultId: RingtoneValue,
): RingtoneValue | null {
  if (actionValue === 'none') {
    return null
  }
  if (actionValue !== null && (isBuiltinRingtone(actionValue) || isCustomRingtone(actionValue))) {
    return actionValue
  }
  return defaultId === 'none' ? null : defaultId
}
