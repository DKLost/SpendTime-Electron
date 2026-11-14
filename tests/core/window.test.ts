import { describe, expect, it } from 'vitest'
import { clampWindowBounds, parseWindowBounds, type WorkArea } from '@core/window'

const PRIMARY: WorkArea = { x: 0, y: 0, width: 1920, height: 1040 }
const SECONDARY: WorkArea = { x: 1920, y: 0, width: 1280, height: 984 }
const FALLBACK = { x: 320, y: 90, width: 1280, height: 860 }

describe('clampWindowBounds', () => {
  it('窗口完整可见时保持位置', () => {
    const result = clampWindowBounds({ x: 100, y: 80, width: 1200, height: 800 }, [PRIMARY, SECONDARY], FALLBACK)
    expect(result).toEqual({ x: 100, y: 80, width: 1200, height: 800 })
  })

  it('窗口移出屏幕后回到主屏居中', () => {
    const result = clampWindowBounds({ x: 9000, y: 9000, width: 1200, height: 800 }, [PRIMARY], FALLBACK)
    expect(result).toEqual({ x: 320, y: 90, width: 1280, height: 860 })
  })

  it('只剩很窄一条可见时也回到主屏', () => {
    const result = clampWindowBounds({ x: 1900, y: 0, width: 800, height: 600 }, [PRIMARY], FALLBACK)
    expect(result).toEqual(FALLBACK)
  })

  it('窗口比工作区更大时限制到工作区并平移', () => {
    const result = clampWindowBounds({ x: 1800, y: 900, width: 2400, height: 1400 }, [PRIMARY], FALLBACK)
    expect(result.width).toBeLessThanOrEqual(PRIMARY.width)
    expect(result.height).toBeLessThanOrEqual(PRIMARY.height)
    expect(result.x + result.width).toBeLessThanOrEqual(PRIMARY.width)
    expect(result.y + result.height).toBeLessThanOrEqual(PRIMARY.height)
  })
})

describe('parseWindowBounds', () => {
  it('损坏 JSON 回落到主屏居中', () => {
    expect(parseWindowBounds('{oops', [PRIMARY])).toEqual({ x: 320, y: 90, width: 1280, height: 860 })
  })

  it('非法字段被拒绝', () => {
    expect(parseWindowBounds('{"x":"a","y":0,"width":1200,"height":800}', [PRIMARY])).toEqual({
      x: 320,
      y: 90,
      width: 1280,
      height: 860,
    })
  })
})
