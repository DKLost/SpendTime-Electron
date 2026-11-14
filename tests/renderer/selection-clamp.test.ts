import { describe, expect, it } from 'vitest'
import {
  clampSelectionEnd,
  clampSelectionMove,
  clampSelectionStart,
  keepSelectionVisibleAtEnd,
  normalizeSelection,
} from '../../src/renderer/src/audio/selection-clamp'

const MIN = 0.1
const MAX = 60

describe('clampSelectionStart', () => {
  it('只夹紧起点，返回的仍是起点坐标', () => {
    expect(clampSelectionStart(-10, 60, MIN, MAX)).toBe(0)
    expect(clampSelectionStart(20, 60, MIN, MAX)).toBe(20)
    expect(clampSelectionStart(80, 60, MIN, MAX)).toBe(59.9)
  })

  it('与终点组成的区间永不超过上限，且不推动终点', () => {
    // 终点在 120 秒时，起点最左只能到 60 秒：60 秒窗口贴着终点
    expect(clampSelectionStart(0, 120, MIN, MAX)).toBe(60)
    expect(clampSelectionStart(30, 120, MIN, MAX)).toBe(60)
    expect(clampSelectionStart(90, 120, MIN, MAX)).toBe(90)
  })
})

describe('clampSelectionEnd', () => {
  it('终点落在 [起点+最小值, 起点+上限] 内', () => {
    expect(clampSelectionEnd(-5, 0, 186, MIN, MAX)).toBe(0.1)
    expect(clampSelectionEnd(30, 0, 186, MIN, MAX)).toBe(30)
    expect(clampSelectionEnd(100, 0, 186, MIN, MAX)).toBe(60)
  })

  it('正好 60 秒属于合法区间', () => {
    expect(clampSelectionEnd(60, 0, 186, MIN, MAX)).toBe(60)
  })

  it('终点不超过文件时长', () => {
    expect(clampSelectionEnd(500, 0, 30, MIN, MAX)).toBe(30)
    expect(clampSelectionEnd(20, 10, 12, MIN, MAX)).toBe(12)
  })

  it('音频短于上限时以文件末尾为界', () => {
    expect(clampSelectionEnd(50, 0, 12, MIN, MAX)).toBe(12)
    expect(clampSelectionEnd(0, 0, 12, MIN, MAX)).toBe(0.1)
  })

  it('时长未知时退回起点+上限，不能无限延长', () => {
    expect(clampSelectionEnd(500, 10, 0, MIN, MAX)).toBe(70)
  })
})

describe('clampSelectionMove', () => {
  it('平移只夹紧起点，可移动范围是文件长度减去选区长度', () => {
    expect(clampSelectionMove(-30, 60, 186)).toBe(0)
    expect(clampSelectionMove(40, 60, 186)).toBe(40)
    expect(clampSelectionMove(200, 60, 186)).toBe(126)
    expect(clampSelectionMove(126, 60, 186)).toBe(126)
  })

  it('短音频里整段选区无法平移，起点固定在 0', () => {
    expect(clampSelectionMove(5, 12, 12)).toBe(0)
    expect(clampSelectionMove(-5, 12, 12)).toBe(0)
  })

  it('短音频里较小的选区可在文件内平移', () => {
    expect(clampSelectionMove(-1, 6, 12)).toBe(0)
    expect(clampSelectionMove(4, 6, 12)).toBe(4)
    expect(clampSelectionMove(9, 6, 12)).toBe(6)
  })

  it('重复夹紧幂等，且不会反向推动选区', () => {
    const start = clampSelectionMove(500, 60, 186)
    expect(start).toBe(126)
    expect(clampSelectionMove(start, 60, 186)).toBe(start)
    expect(clampSelectionMove(clampSelectionMove(-500, 60, 186), 60, 186)).toBe(0)
  })

  it('时长未知时只保证起点非负', () => {
    expect(clampSelectionMove(-3, 60, 0)).toBe(0)
    expect(clampSelectionMove(42, 60, 0)).toBe(42)
  })
})

describe('normalizeSelection', () => {
  it('加载已保存区间时保持原样', () => {
    expect(normalizeSelection({ start: 20, end: 60 }, 186, MIN, MAX)).toEqual({
      start: 20,
      end: 60,
    })
  })

  it('优先保留起点，把超长或越界的终点收回边界内', () => {
    expect(normalizeSelection({ start: 0, end: 200 }, 186, MIN, MAX)).toEqual({
      start: 0,
      end: 60,
    })
    expect(normalizeSelection({ start: 160, end: 220 }, 186, MIN, MAX)).toEqual({
      start: 160,
      end: 186,
    })
    expect(normalizeSelection({ start: -8, end: 30 }, 186, MIN, MAX)).toEqual({
      start: 0,
      end: 30,
    })
  })

  it('音频短于上限时整段落在文件内', () => {
    expect(normalizeSelection({ start: 0, end: 60 }, 12, MIN, MAX)).toEqual({
      start: 0,
      end: 12,
    })
  })
})

describe('keepSelectionVisibleAtEnd', () => {
  it('贴住文件末尾且窄于一像素时把起点往回让出可见宽度', () => {
    expect(keepSelectionVisibleAtEnd({ start: 185.9, end: 186 }, 186, 0.4)).toEqual({
      start: 186 - 0.4,
      end: 186,
    })
  })

  it('末尾选区足够宽时保持原样', () => {
    expect(keepSelectionVisibleAtEnd({ start: 180, end: 186 }, 186, 0.4)).toEqual({
      start: 180,
      end: 186,
    })
  })

  it('不贴住文件末尾时不受影响', () => {
    expect(keepSelectionVisibleAtEnd({ start: 30, end: 30.1 }, 186, 0.4)).toEqual({
      start: 30,
      end: 30.1,
    })
  })
})

// 典型缺陷场景：一端被夹紧时把另一端推走，形成互相钳制的反馈环
describe('单端夹紧不产生反馈环', () => {
  it('拖动起点时终点完全不动', () => {
    const end = 80
    let start = 20
    // 起点向左越界后停在 60 秒窗口的左边界，而不是把终点拽回 60
    for (const proposed of [19, 10, 0, -5, -20]) {
      start = clampSelectionStart(proposed, end, MIN, MAX)
      expect(end).toBe(80)
    }
    expect(start).toBe(20)
  })

  it('拖动终点时起点完全不动', () => {
    const start = 20
    let end = 60
    for (const proposed of [70, 100, 140, 200]) {
      end = clampSelectionEnd(proposed, start, 186, MIN, MAX)
      expect(start).toBe(20)
    }
    expect(end).toBe(80)
  })

  it('快速来回抖动后区间始终合法，不出现累积漂移', () => {
    let start = 0
    let end = 60
    for (let index = 0; index < 40; index += 1) {
      if (index % 2 === 0) {
        end = clampSelectionEnd(index % 4 === 0 ? 200 : -50, start, 186, MIN, MAX)
      } else {
        start = clampSelectionStart(index % 4 === 1 ? -50 : 200, end, MIN, MAX)
      }
      expect(end - start).toBeGreaterThanOrEqual(MIN - 1e-9)
      expect(end - start).toBeLessThanOrEqual(MAX + 1e-9)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeLessThanOrEqual(186)
    }
  })

  it('夹紧是幂等的，重复应用不会改变结果', () => {
    const start = clampSelectionStart(-30, 60, MIN, MAX)
    expect(clampSelectionStart(start, 60, MIN, MAX)).toBe(start)

    const end = clampSelectionEnd(200, 30, 186, MIN, MAX)
    expect(clampSelectionEnd(end, 30, 186, MIN, MAX)).toBe(end)
  })
})
