import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const themeDir = join(process.cwd(), 'src/renderer/src/theme')

const THEMES = [
  'celadon',
  'github',
  'steam',
  'nvidia-light',
  'nvidia-dark',
  'playstation-light',
  'playstation-dark',
] as const

const SLOTS = ['night', 'dawn', 'morning', 'noon', 'afternoon', 'evening', 'late-night'] as const

type Rgba = readonly [number, number, number, number]

function readTheme(theme: string): string {
  return readFileSync(join(themeDir, `${theme}.css`), 'utf8')
}

function hexToken(css: string, token: string): readonly [number, number, number] {
  const match = new RegExp(`--${token}:\\s*#([0-9a-fA-F]{6})`).exec(css)
  if (match === null) {
    throw new Error(`主题缺少 --${token}`)
  }
  const value = match[1]
  if (value === undefined) {
    throw new Error(`主题缺少 --${token}`)
  }
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

// 未配置是合法状态：返回 null，由调用方按“该档中性”处理
function slotTint(css: string, slot: string): Rgba | null {
  const match = new RegExp(`--slot-${slot}-bg:\\s*rgba\\(([^)]+)\\)`).exec(css)
  if (match === null) {
    return null
  }
  const body = match[1]
  if (body === undefined) {
    throw new Error(`--slot-${slot}-bg 不是合法的 rgba`)
  }
  const parts = body.split(',').map((part) => Number(part.trim()))
  const [red, green, blue, alpha] = parts
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
    throw new Error(`--slot-${slot}-bg 不是合法的 rgba`)
  }
  return [red, green, blue, alpha]
}

function channelLuminance(value: number): number {
  const channel = value / 255
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: readonly [number, number, number]): number {
  return (
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2])
  )
}

function composite(tint: Rgba, surface: readonly [number, number, number]): readonly [number, number, number] {
  return [
    Math.round(tint[0] * tint[3] + surface[0] * (1 - tint[3])),
    Math.round(tint[1] * tint[3] + surface[1] * (1 - tint[3])),
    Math.round(tint[2] * tint[3] + surface[2] * (1 - tint[3])),
  ]
}

function contrast(
  foreground: readonly [number, number, number],
  background: readonly [number, number, number],
): number {
  const front = luminance(foreground)
  const back = luminance(background)
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05)
}

describe('时段底色令牌', () => {
  it('共享层不保留具体色值', () => {
    expect(readFileSync(join(themeDir, 'index.css'), 'utf8')).not.toContain('--slot-')
  })

  it.each(THEMES)('%s 主题关闭或未配置时仍保持中性可读，已配置时段达标', (theme) => {
    const css = readTheme(theme)
    const surface = hexToken(css, 'color-surface-raised')
    const timeColor = hexToken(css, 'color-accent-deep')

    // 开关关闭或某档没有配置时，时间格回到表面色，文字仍需达到 AA
    expect(contrast(timeColor, surface), `${theme} / 中性底`).toBeGreaterThanOrEqual(4.5)

    for (const slot of SLOTS) {
      const tint = slotTint(css, slot)
      if (tint === null) {
        continue
      }
      const background = composite(tint, surface)
      const ratio = contrast(timeColor, background)
      expect(ratio, `${theme} / ${slot}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
