import { describe, expect, it } from 'vitest'
import {
  computeFreeSlots,
  formatMinute,
  validatePlan,
  validatePlanEdit,
  type Plan,
  type PlanDraft,
} from '@core/plan'

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 1,
    weekday: 1,
    startMin: 9 * 60,
    endMin: 10 * 60,
    actionId: 1,
    createdAt: 0,
    alarmEnabled: true,
    ...overrides,
  }
}

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    weekday: 1,
    startMin: 10 * 60,
    endMin: 11 * 60,
    actionId: 1,
    alarmEnabled: true,
    ...overrides,
  }
}

describe('validatePlan', () => {
  it('接受合法计划', () => {
    const result = validatePlan([plan()], draft())
    expect(result).toEqual({ ok: true, value: draft() })
  })

  it('拒绝非法星期', () => {
    const result = validatePlan([], draft({ weekday: 8 as PlanDraft['weekday'] }))
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('INVALID_WEEKDAY')
  })

  it('拒绝越界时间', () => {
    const negative = validatePlan([], draft({ startMin: -1 }))
    const endTooLate = validatePlan([], draft({ endMin: 1441 }))
    expect(negative.ok).toBe(false)
    expect(endTooLate.ok).toBe(false)
    if (negative.ok || endTooLate.ok) {
      return
    }
    expect(negative.error.code).toBe('OUT_OF_RANGE')
    expect(endTooLate.error.code).toBe('OUT_OF_RANGE')
  })

  it('拒绝零长度与倒置区间', () => {
    const equal = validatePlan([], draft({ startMin: 600, endMin: 600 }))
    const reversed = validatePlan([], draft({ startMin: 700, endMin: 600 }))
    expect(equal.ok).toBe(false)
    expect(reversed.ok).toBe(false)
    if (equal.ok || reversed.ok) {
      return
    }
    expect(equal.error.code).toBe('ZERO_LENGTH')
    expect(reversed.error.code).toBe('ZERO_LENGTH')
  })

  it('同一天重叠被拒绝', () => {
    const result = validatePlan([plan()], draft({ startMin: 9 * 60 + 30, endMin: 10 * 60 + 30 }))
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('OVERLAP')
  })

  it('相邻区间与不同星期不冲突', () => {
    expect(validatePlan([plan()], draft({ startMin: 600, endMin: 700 })).ok).toBe(true)
    expect(validatePlan([plan()], draft({ weekday: 2 })).ok).toBe(true)
  })
})

describe('validatePlanEdit', () => {
  it('排除自身后允许原时间段原样保存', () => {
    const result = validatePlanEdit([plan()], 1, draft({ startMin: 540, endMin: 600 }))
    expect(result.ok).toBe(true)
  })

  it('仍会拒绝与其它计划的重叠', () => {
    const other = plan({ id: 2, startMin: 11 * 60, endMin: 12 * 60 })
    const result = validatePlanEdit([plan(), other], 1, draft({ startMin: 10 * 60 + 50, endMin: 11 * 60 + 10 }))
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('OVERLAP')
  })

  it('改星期时只校验目标星期的既有计划', () => {
    const result = validatePlanEdit([plan()], 1, draft({ weekday: 2, startMin: 540, endMin: 600 }))
    expect(result.ok).toBe(true)
  })
})

describe('computeFreeSlots', () => {
  it('空输入返回全天', () => {
    expect(computeFreeSlots([])).toEqual([{ startMin: 0, endMin: 1440 }])
  })

  it('取补集并合并重叠输入', () => {
    const slots = computeFreeSlots([
      plan({ startMin: 600, endMin: 660 }),
      plan({ startMin: 630, endMin: 720 }),
      plan({ startMin: 780, endMin: 800 }),
    ])
    expect(slots).toEqual([
      { startMin: 0, endMin: 600 },
      { startMin: 720, endMin: 780 },
      { startMin: 800, endMin: 1440 },
    ])
  })

  it('输入顺序不影响结果', () => {
    const input = [
      plan({ startMin: 780, endMin: 800 }),
      plan({ startMin: 600, endMin: 660 }),
      plan({ startMin: 630, endMin: 720 }),
    ]
    const reversed = [...input].reverse()
    expect(computeFreeSlots(reversed)).toEqual(computeFreeSlots(input))
  })

  it('满档与非法区间不产生空档', () => {
    expect(computeFreeSlots([plan({ startMin: 0, endMin: 1440 })])).toEqual([])
    expect(computeFreeSlots([plan({ startMin: 700, endMin: 600 })])).toEqual([
      { startMin: 0, endMin: 1440 },
    ])
  })

  it('支持自定义边界', () => {
    expect(computeFreeSlots([plan({ startMin: 540, endMin: 600 })], 480, 660)).toEqual([
      { startMin: 480, endMin: 540 },
      { startMin: 600, endMin: 660 },
    ])
  })
})

describe('formatMinute', () => {
  it('格式化并钳制边界', () => {
    expect(formatMinute(0)).toBe('00:00')
    expect(formatMinute(9 * 60 + 5)).toBe('09:05')
    expect(formatMinute(1440)).toBe('24:00')
    expect(formatMinute(-10)).toBe('00:00')
  })
})
