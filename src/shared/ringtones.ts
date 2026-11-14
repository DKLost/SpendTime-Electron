// 铃声域模型：应用层与契约共用，避免枚举漂移
export const BUILTIN_RINGTONE_IDS = ['chime', 'bell', 'pulse'] as const

export type BuiltinRingtoneId = (typeof BUILTIN_RINGTONE_IDS)[number]

export const RINGTONE_NONE = 'none'
export const CUSTOM_RINGTONE_PREFIX = 'custom:'

export type RingtoneValue = BuiltinRingtoneId | typeof RINGTONE_NONE | `custom:${string}`

const CUSTOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const BUILTIN_RINGTONE_FILES: Readonly<Record<BuiltinRingtoneId, string>> = {
  chime: 'builtin-chime.wav',
  bell: 'builtin-bell.wav',
  pulse: 'builtin-pulse.wav',
}

export function isBuiltinRingtone(value: string): value is BuiltinRingtoneId {
  return (BUILTIN_RINGTONE_IDS as readonly string[]).includes(value)
}

export function customRingtoneId(value: string): string | null {
  if (!value.startsWith(CUSTOM_RINGTONE_PREFIX)) {
    return null
  }
  const id = value.slice(CUSTOM_RINGTONE_PREFIX.length)
  return CUSTOM_ID_PATTERN.test(id) ? id.toLowerCase() : null
}

export function isRingtoneValue(value: string): value is RingtoneValue {
  return value === RINGTONE_NONE || isBuiltinRingtone(value) || customRingtoneId(value) !== null
}

// 行动字段中 null 表示跟随默认，字符串只存 none、内置铃声 id 或 custom:<uuid>
export function isActionRingtoneValue(value: string): value is RingtoneValue {
  return isRingtoneValue(value)
}
