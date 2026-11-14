import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/renderer/src/theme/steam.css', import.meta.url), 'utf8')

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (match?.[1] === undefined) {
    throw new Error(`缺少颜色令牌：${name}`)
  }
  return match[1]
}

function gradientStops(name: string): string[] {
  const match = css.match(new RegExp(`--${name}:\\s*linear-gradient\\([^;]+\\);`))
  if (match === null) {
    throw new Error(`缺少渐变令牌：${name}`)
  }
  return match[0].match(/#[0-9a-fA-F]{6}/g) ?? []
}

function channel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = channel((value >> 16) & 0xff)
  const g = channel((value >> 8) & 0xff)
  const b = channel(value & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const first = luminance(a)
  const second = luminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('Steam 主题对比度（WCAG AA）', () => {
  const bg = token('color-bg')
  const bgDeep = token('color-bg-deep')
  const raised = token('color-surface-raised')
  const text = token('color-text')
  const muted = token('color-muted')
  const accent = token('color-accent')
  const accentDeep = token('color-accent-deep')

  it('正文与次要文字在页面/卡片/深底上均达到 4.5:1', () => {
    for (const surface of [bg, bgDeep, raised]) {
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(muted, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('品牌蓝作为深底文字达到 4.5:1', () => {
    for (const surface of [bg, bgDeep, raised]) {
      expect(contrast(accent, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(accentDeep, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('主按钮白字在渐变两端均达到 4.5:1', () => {
    for (const stop of gradientStops('gradient-primary')) {
      expect(contrast('#ffffff', stop)).toBeGreaterThanOrEqual(4.5)
    }
    for (const stop of gradientStops('gradient-primary-hover')) {
      expect(contrast('#ffffff', stop)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('亮蓝选中态使用深色字达到 4.5:1', () => {
    for (const stop of [accent, accentDeep]) {
      expect(contrast(bgDeep, stop)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('危险色在页面上达到 4.5:1', () => {
    expect(contrast(token('color-danger'), bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('主背景使用 #23272f，深基层使用 #171d25', () => {
    expect(bg.toUpperCase()).toBe('#23272F')
    expect(bgDeep.toUpperCase()).toBe('#171D25')
  })
})
