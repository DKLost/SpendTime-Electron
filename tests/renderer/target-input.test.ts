import { describe, expect, it } from 'vitest'
import {
  formatTargetSeconds,
  parseTargetText,
} from '../../src/renderer/src/features/timer/target-input'

describe('parseTargetText', () => {
  it('空输入表示正计时', () => {
    expect(parseTargetText('   ')).toEqual({ ok: true, seconds: null })
  })

  it('纯数字按分钟兼容旧习惯', () => {
    expect(parseTargetText('25')).toEqual({ ok: true, seconds: 1500 })
  })

  it('支持秒级的 分:秒 与 时:分:秒', () => {
    expect(parseTargetText('25:30')).toEqual({ ok: true, seconds: 1530 })
    expect(parseTargetText('0:45')).toEqual({ ok: true, seconds: 45 })
    expect(parseTargetText('1:02:03')).toEqual({ ok: true, seconds: 3723 })
  })

  it('拒绝零、越界与非法格式', () => {
    expect(parseTargetText('0:00')).toEqual({ ok: false, messageKey: 'validation.targetPositive' })
    expect(parseTargetText('10:75')).toEqual({ ok: false, messageKey: 'validation.targetSecondRange' })
    expect(parseTargetText('1:75:00')).toEqual({ ok: false, messageKey: 'validation.targetSecondRange' })
    expect(parseTargetText('abc')).toEqual({ ok: false, messageKey: 'validation.targetFormat' })
    expect(parseTargetText('1440:01')).toEqual({ ok: false, messageKey: 'validation.targetMax' })
  })
})

describe('formatTargetSeconds', () => {
  it('整分钟与含秒都回填为分:秒', () => {
    expect(formatTargetSeconds(1500)).toBe('25:00')
    expect(formatTargetSeconds(1530)).toBe('25:30')
    expect(formatTargetSeconds(30)).toBe('0:30')
  })

  it('超过一小时用 时:分:秒', () => {
    expect(formatTargetSeconds(3723)).toBe('1:02:03')
  })
})
