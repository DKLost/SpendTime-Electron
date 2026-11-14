// 铃声值域：内置音、静音、以及导入到用户目录的自定义铃声（custom:<uuid>）
export const BUILTIN_RINGTONE_IDS = ['chime', 'bell', 'pulse'] as const

export type BuiltinRingtoneId = (typeof BUILTIN_RINGTONE_IDS)[number]

export const RINGTONE_NONE = 'none'
export const CUSTOM_RINGTONE_PREFIX = 'custom:'

export type RingtoneValue = BuiltinRingtoneId | typeof RINGTONE_NONE | `custom:${string}`

// 自定义铃声 id 由 uuid v4 生成；协议文件名也从这里推导，避免用户输入进入路径
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

export function customRingtoneValue(id: string): RingtoneValue {
  return `${CUSTOM_RINGTONE_PREFIX}${id}`
}

export function isRingtoneValue(value: string): value is RingtoneValue {
  return value === RINGTONE_NONE || isBuiltinRingtone(value) || customRingtoneId(value) !== null
}

// 行动字段中 null 表示跟随默认；这里只校验显式值
export function isActionRingtoneValue(value: string): value is RingtoneValue {
  return isRingtoneValue(value)
}

export type RingtoneSource =
  | { readonly kind: 'builtin'; readonly id: BuiltinRingtoneId }
  | { readonly kind: 'custom'; readonly id: string }

export type CustomRingtoneFile = {
  readonly id: string
  readonly fileName: string
  readonly durationSec: number
}

// value 为显式铃声；返回 null 表示静音或无可用来源
export function resolveRingtoneSource(
  value: string | null,
  customFiles: readonly CustomRingtoneFile[],
): RingtoneSource | null {
  if (value === null || value === RINGTONE_NONE) {
    return null
  }
  if (isBuiltinRingtone(value)) {
    return { kind: 'builtin', id: value }
  }
  const id = customRingtoneId(value)
  if (id === null) {
    return null
  }
  return customFiles.some((file) => file.id === id) ? { kind: 'custom', id } : null
}
