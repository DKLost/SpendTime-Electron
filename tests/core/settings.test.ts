import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  parseSettings,
  serializeSettings,
  SETTINGS_KEYS,
} from '@core/settings'

const CUSTOM = 'custom:3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('parseSettings', () => {
  it('空表回落默认值', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('合法值被读取，非法值逐项回落', () => {
    const settings = parseSettings({
      [SETTINGS_KEYS.closeBehavior]: 'quit',
      [SETTINGS_KEYS.startAtLogin]: 'true',
      [SETTINGS_KEYS.shortcut]: '  Ctrl+Shift+S  ',
      [SETTINGS_KEYS.density]: 'comfortable',
      [SETTINGS_KEYS.slotTintEnabled]: 'false',
      [SETTINGS_KEYS.soundEnabled]: 'false',
      [SETTINGS_KEYS.alarmLoopMaxSec]: '60',
      [SETTINGS_KEYS.backupRetain]: '99',
      [SETTINGS_KEYS.defaultStartRingtone]: CUSTOM,
      [SETTINGS_KEYS.defaultEndRingtone]: 'custom:not-a-uuid',
    })

    expect(settings.closeBehavior).toBe('quit')
    expect(settings.startAtLogin).toBe(true)
    expect(settings.shortcut).toBe('Ctrl+Shift+S')
    expect(settings.density).toBe('comfortable')
    expect(settings.slotTintEnabled).toBe(false)
    expect(settings.soundEnabled).toBe(false)
    expect(settings.alarmLoopMaxSec).toBe(60)
    expect(settings.backupRetain).toBe(DEFAULT_SETTINGS.backupRetain)
    expect(settings.defaultStartRingtone).toBe(CUSTOM)
    expect(settings.defaultEndRingtone).toBe('chime')
  })

  it('空快捷键表示禁用', () => {
    expect(parseSettings({ [SETTINGS_KEYS.shortcut]: '   ' }).shortcut).toBeNull()
  })
})

describe('mergeSettings', () => {
  it('拒绝越界循环上限与非法快捷键', () => {
    const tooShort = mergeSettings(DEFAULT_SETTINGS, { alarmLoopMaxSec: 10 })
    expect(tooShort.ok).toBe(false)

    const tooLong = mergeSettings(DEFAULT_SETTINGS, { alarmLoopMaxSec: 121 })
    expect(tooLong.ok).toBe(false)

    const longShortcut = mergeSettings(DEFAULT_SETTINGS, { shortcut: 'x'.repeat(65) })
    expect(longShortcut.ok).toBe(false)
  })

  it('允许禁用快捷键并校验铃声格式', () => {
    const disabled = mergeSettings(DEFAULT_SETTINGS, { shortcut: null })
    expect(disabled.ok).toBe(true)
    if (disabled.ok) {
      expect(disabled.value.shortcut).toBeNull()
    }

    const badRingtone = mergeSettings(DEFAULT_SETTINGS, { defaultStartRingtone: 'custom:nope' as never })
    expect(badRingtone.ok).toBe(false)
  })

  it('时段底色开关与界面语言随设置序列化后保持', () => {
    const next = {
      ...DEFAULT_SETTINGS,
      slotTintEnabled: false,
      soundEnabled: false,
      shortcut: null,
      locale: 'ja' as const,
      density: 'comfortable' as const,
    }
    expect(parseSettings(serializeSettings(next))).toEqual(next)
  })

  it('未选择语言时回落中文，非法语言逐项回落', () => {
    expect(parseSettings({}).locale).toBe('zh')
    expect(parseSettings({ [SETTINGS_KEYS.locale]: 'en' }).locale).toBe('en')
    expect(parseSettings({ [SETTINGS_KEYS.locale]: 'fr' }).locale).toBe('zh')
  })
})
