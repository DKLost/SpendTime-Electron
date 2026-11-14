import { err, ok, type Result } from './result'
import { BUILTIN_RINGTONE_IDS, RINGTONE_NONE, customRingtoneId, type RingtoneValue } from './ringtone'

export type CloseBehavior = 'hide-to-tray' | 'quit'
export type UiDensity = 'compact' | 'comfortable'
export type UiLocale = 'zh' | 'en' | 'ja'

export type AppSettings = {
  readonly closeBehavior: CloseBehavior
  readonly startAtLogin: boolean
  // null 表示禁用全局快捷键
  readonly shortcut: string | null
  readonly locale: UiLocale
  readonly density: UiDensity
  readonly slotTintEnabled: boolean
  readonly soundEnabled: boolean
  readonly alarmLoopMaxSec: number
  readonly backupRetain: number
  readonly defaultStartRingtone: RingtoneValue
  readonly defaultEndRingtone: RingtoneValue
}

export type SettingsPatch = Partial<AppSettings>

export type SettingsError = {
  readonly code: 'INVALID_SETTING'
  readonly message: string
}

export const SETTINGS_KEYS = {
  closeBehavior: 'general.closeBehavior',
  startAtLogin: 'general.startAtLogin',
  shortcut: 'general.shortcut',
  locale: 'general.locale',
  density: 'general.density',
  slotTintEnabled: 'appearance.slotTintEnabled',
  soundEnabled: 'reminder.soundEnabled',
  alarmLoopMaxSec: 'reminder.alarmLoopMaxSec',
  backupRetain: 'data.backupRetain',
  defaultStartRingtone: 'ringtone.defaultStart',
  defaultEndRingtone: 'ringtone.defaultEnd',
  windowBounds: 'window.bounds',
  windowMaximized: 'window.maximized',
} as const

export const DEFAULT_SETTINGS: AppSettings = {
  closeBehavior: 'hide-to-tray',
  startAtLogin: false,
  shortcut: 'Ctrl+Alt+S',
  locale: 'zh',
  density: 'comfortable',
  slotTintEnabled: true,
  soundEnabled: true,
  alarmLoopMaxSec: 120,
  backupRetain: 10,
  defaultStartRingtone: 'chime',
  defaultEndRingtone: 'chime',
}

export const ALARM_LOOP_MIN_SEC = 30
export const ALARM_LOOP_MAX_SEC = 120
export const BACKUP_RETAIN_MIN = 3
export const BACKUP_RETAIN_MAX = 30

const CLOSE_BEHAVIORS: readonly CloseBehavior[] = ['hide-to-tray', 'quit']
const DENSITIES: readonly UiDensity[] = ['compact', 'comfortable']
const UI_LOCALES: readonly UiLocale[] = ['zh', 'en', 'ja']
const SHORTCUT_MAX_LENGTH = 64

// 未知键忽略、非法值回落默认；损坏的数据库不应阻塞启动
export function parseSettings(raw: Readonly<Record<string, string>>): AppSettings {
  return {
    closeBehavior: readEnum(raw[SETTINGS_KEYS.closeBehavior], CLOSE_BEHAVIORS, DEFAULT_SETTINGS.closeBehavior),
    startAtLogin: readBoolean(raw[SETTINGS_KEYS.startAtLogin], DEFAULT_SETTINGS.startAtLogin),
    shortcut: readShortcut(raw[SETTINGS_KEYS.shortcut], DEFAULT_SETTINGS.shortcut),
    locale: readEnum(raw[SETTINGS_KEYS.locale], UI_LOCALES, DEFAULT_SETTINGS.locale),
    density: readEnum(raw[SETTINGS_KEYS.density], DENSITIES, DEFAULT_SETTINGS.density),
    slotTintEnabled: readBoolean(
      raw[SETTINGS_KEYS.slotTintEnabled],
      DEFAULT_SETTINGS.slotTintEnabled,
    ),
    soundEnabled: readBoolean(raw[SETTINGS_KEYS.soundEnabled], DEFAULT_SETTINGS.soundEnabled),
    alarmLoopMaxSec: readInt(
      raw[SETTINGS_KEYS.alarmLoopMaxSec],
      ALARM_LOOP_MIN_SEC,
      ALARM_LOOP_MAX_SEC,
      DEFAULT_SETTINGS.alarmLoopMaxSec,
    ),
    backupRetain: readInt(
      raw[SETTINGS_KEYS.backupRetain],
      BACKUP_RETAIN_MIN,
      BACKUP_RETAIN_MAX,
      DEFAULT_SETTINGS.backupRetain,
    ),
    defaultStartRingtone: readRingtone(
      raw[SETTINGS_KEYS.defaultStartRingtone],
      DEFAULT_SETTINGS.defaultStartRingtone,
    ),
    defaultEndRingtone: readRingtone(
      raw[SETTINGS_KEYS.defaultEndRingtone],
      DEFAULT_SETTINGS.defaultEndRingtone,
    ),
  }
}

export function mergeSettings(
  current: AppSettings,
  patch: SettingsPatch,
): Result<AppSettings, SettingsError> {
  const merged: AppSettings = { ...current }
  if (patch.closeBehavior !== undefined) {
    if (!CLOSE_BEHAVIORS.includes(patch.closeBehavior)) {
      return invalid('关闭行为取值不合法')
    }
    mergedValue(merged, 'closeBehavior', patch.closeBehavior)
  }
  if (patch.startAtLogin !== undefined) {
    if (typeof patch.startAtLogin !== 'boolean') {
      return invalid('开机自启必须为布尔值')
    }
    mergedValue(merged, 'startAtLogin', patch.startAtLogin)
  }
  if (patch.shortcut !== undefined) {
    const shortcut = normalizeShortcut(patch.shortcut)
    if (shortcut === undefined) {
      return invalid('快捷键格式不合法')
    }
    mergedValue(merged, 'shortcut', shortcut)
  }
  if (patch.locale !== undefined) {
    if (!UI_LOCALES.includes(patch.locale)) {
      return invalid('界面语言取值不合法')
    }
    mergedValue(merged, 'locale', patch.locale)
  }
  if (patch.density !== undefined) {
    if (!DENSITIES.includes(patch.density)) {
      return invalid('界面密度取值不合法')
    }
    mergedValue(merged, 'density', patch.density)
  }
  if (patch.slotTintEnabled !== undefined) {
    if (typeof patch.slotTintEnabled !== 'boolean') {
      return invalid('时段底色开关必须为布尔值')
    }
    mergedValue(merged, 'slotTintEnabled', patch.slotTintEnabled)
  }
  if (patch.soundEnabled !== undefined) {
    if (typeof patch.soundEnabled !== 'boolean') {
      return invalid('提醒声音开关必须为布尔值')
    }
    mergedValue(merged, 'soundEnabled', patch.soundEnabled)
  }
  if (patch.alarmLoopMaxSec !== undefined) {
    if (!isIntInRange(patch.alarmLoopMaxSec, ALARM_LOOP_MIN_SEC, ALARM_LOOP_MAX_SEC)) {
      return invalid(`提醒循环上限应在 ${ALARM_LOOP_MIN_SEC}-${ALARM_LOOP_MAX_SEC} 秒之间`)
    }
    mergedValue(merged, 'alarmLoopMaxSec', patch.alarmLoopMaxSec)
  }
  if (patch.backupRetain !== undefined) {
    if (!isIntInRange(patch.backupRetain, BACKUP_RETAIN_MIN, BACKUP_RETAIN_MAX)) {
      return invalid(`备份保留份数应在 ${BACKUP_RETAIN_MIN}-${BACKUP_RETAIN_MAX} 之间`)
    }
    mergedValue(merged, 'backupRetain', patch.backupRetain)
  }
  if (patch.defaultStartRingtone !== undefined) {
    if (!isRingtoneChoice(patch.defaultStartRingtone)) {
      return invalid('默认开始铃声不存在')
    }
    mergedValue(merged, 'defaultStartRingtone', patch.defaultStartRingtone)
  }
  if (patch.defaultEndRingtone !== undefined) {
    if (!isRingtoneChoice(patch.defaultEndRingtone)) {
      return invalid('默认结束铃声不存在')
    }
    mergedValue(merged, 'defaultEndRingtone', patch.defaultEndRingtone)
  }
  return ok(merged)
}

export function serializeSettings(settings: AppSettings): Record<string, string> {
  return {
    [SETTINGS_KEYS.closeBehavior]: settings.closeBehavior,
    [SETTINGS_KEYS.startAtLogin]: settings.startAtLogin ? 'true' : 'false',
    [SETTINGS_KEYS.shortcut]: settings.shortcut ?? '',
    [SETTINGS_KEYS.locale]: settings.locale,
    [SETTINGS_KEYS.density]: settings.density,
    [SETTINGS_KEYS.slotTintEnabled]: settings.slotTintEnabled ? 'true' : 'false',
    [SETTINGS_KEYS.soundEnabled]: settings.soundEnabled ? 'true' : 'false',
    [SETTINGS_KEYS.alarmLoopMaxSec]: String(settings.alarmLoopMaxSec),
    [SETTINGS_KEYS.backupRetain]: String(settings.backupRetain),
    [SETTINGS_KEYS.defaultStartRingtone]: settings.defaultStartRingtone,
    [SETTINGS_KEYS.defaultEndRingtone]: settings.defaultEndRingtone,
  }
}

function mergedValue<K extends keyof AppSettings>(
  target: { -readonly [P in keyof AppSettings]: AppSettings[P] },
  key: K,
  value: AppSettings[K],
): void {
  target[key] = value
}

function invalid(message: string): Result<never, SettingsError> {
  return err({ code: 'INVALID_SETTING', message })
}

function readEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback
  }
  if (value === 'true' || value === '1') {
    return true
  }
  if (value === 'false' || value === '0') {
    return false
  }
  return fallback
}

function readShortcut(value: string | undefined, fallback: string | null): string | null {
  if (value === undefined) {
    return fallback
  }
  const normalized = normalizeShortcut(value)
  return normalized === undefined ? fallback : normalized
}

function normalizeShortcut(value: string | null): string | null | undefined {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  return trimmed.length <= SHORTCUT_MAX_LENGTH ? trimmed : undefined
}

function readInt(value: string | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  const parsed = Number(value)
  return isIntInRange(parsed, min, max) ? parsed : fallback
}

function isIntInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

function readRingtone(value: string | undefined, fallback: RingtoneValue): RingtoneValue {
  if (value === undefined) {
    return fallback
  }
  if (value === RINGTONE_NONE || (BUILTIN_RINGTONE_IDS as readonly string[]).includes(value)) {
    return value as RingtoneValue
  }
  return customRingtoneId(value) === null ? fallback : (value as RingtoneValue)
}

function isRingtoneChoice(value: string): boolean {
  return readRingtone(value, DEFAULT_SETTINGS.defaultStartRingtone) === value
}
