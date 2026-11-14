import { err, ok, type Result } from './result'
import type { ActionId, EpochMs, MinuteOfDay, Weekday } from './types'

export type Plan = {
  readonly id: number
  readonly weekday: Weekday
  readonly startMin: MinuteOfDay
  readonly endMin: MinuteOfDay
  readonly actionId: ActionId
  readonly createdAt: EpochMs
  readonly alarmEnabled: boolean
}

// 读模型：列表展示需要行动名，避免渲染层再拼装
export type PlanView = Plan & { readonly actionName: string }

export type PlanDraft = {
  readonly weekday: Weekday
  readonly startMin: MinuteOfDay
  readonly endMin: MinuteOfDay
  readonly actionId: ActionId
  readonly alarmEnabled: boolean
}

export type Slot = {
  readonly startMin: MinuteOfDay
  readonly endMin: MinuteOfDay
}

export type PlanErrorCode = 'INVALID_WEEKDAY' | 'OUT_OF_RANGE' | 'ZERO_LENGTH' | 'OVERLAP'

export type PlanError = {
  readonly code: PlanErrorCode
  readonly message: string
}

export const DAY_START_MIN = 0
export const DAY_END_MIN = 24 * 60

export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 1 && value <= 7
}

export function isMinuteOfDay(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= DAY_END_MIN
}

// 纯函数：重叠判断只看同 weekday，改动既有计划也能复用
export function validatePlan(
  existing: readonly Plan[],
  candidate: PlanDraft,
): Result<PlanDraft, PlanError> {
  if (!isWeekday(candidate.weekday)) {
    return err({ code: 'INVALID_WEEKDAY', message: '星期必须在 1（周一）到 7（周日）之间' })
  }
  if (!isMinuteOfDay(candidate.startMin) || !isMinuteOfDay(candidate.endMin)) {
    return err({ code: 'OUT_OF_RANGE', message: '时间必须在当天 00:00 到 24:00 之间' })
  }
  if (candidate.startMin >= DAY_END_MIN) {
    return err({ code: 'OUT_OF_RANGE', message: '开始时间不能是 24:00' })
  }
  if (candidate.endMin <= 0) {
    return err({ code: 'OUT_OF_RANGE', message: '结束时间必须大于 00:00' })
  }
  if (candidate.endMin <= candidate.startMin) {
    return err({ code: 'ZERO_LENGTH', message: '结束时间必须晚于开始时间' })
  }

  const overlapped = existing.some(
    (plan) =>
      plan.weekday === candidate.weekday &&
      candidate.startMin < plan.endMin &&
      plan.startMin < candidate.endMin,
  )
  if (overlapped) {
    return err({ code: 'OVERLAP', message: '与同一天已有的计划时间重叠' })
  }
  return ok(candidate)
}

// 编辑时排除自身，其余校验与新建完全一致
export function validatePlanEdit(
  existing: readonly Plan[],
  planId: number,
  candidate: PlanDraft,
): Result<PlanDraft, PlanError> {
  return validatePlan(
    existing.filter((plan) => plan.id !== planId),
    candidate,
  )
}

type NormalizedSlot = {
  readonly startMin: number
  readonly endMin: number
}

// 输出为未安排的连续时段，供界面提示可用空档
export function computeFreeSlots(
  plans: readonly { readonly startMin: number; readonly endMin: number }[],
  dayStart: number = DAY_START_MIN,
  dayEnd: number = DAY_END_MIN,
): readonly Slot[] {
  if (dayEnd <= dayStart) {
    return []
  }

  const occupied = plans
    .map((plan) => clampSlot(plan, dayStart, dayEnd))
    .filter((slot): slot is NormalizedSlot => slot !== null)
    .sort(compareSlot)

  const free: Slot[] = []
  let cursor = dayStart
  for (const slot of occupied) {
    if (slot.startMin > cursor) {
      free.push({ startMin: cursor, endMin: slot.startMin })
    }
    cursor = Math.max(cursor, slot.endMin)
  }
  if (cursor < dayEnd) {
    free.push({ startMin: cursor, endMin: dayEnd })
  }
  return free
}

function clampSlot(
  slot: { readonly startMin: number; readonly endMin: number },
  dayStart: number,
  dayEnd: number,
): NormalizedSlot | null {
  const start = Math.max(dayStart, Math.min(dayEnd, Math.trunc(slot.startMin)))
  const end = Math.max(dayStart, Math.min(dayEnd, Math.trunc(slot.endMin)))
  return end > start ? { startMin: start, endMin: end } : null
}

function compareSlot(left: NormalizedSlot, right: NormalizedSlot): number {
  return left.startMin - right.startMin || left.endMin - right.endMin
}

export function formatMinute(minute: number): string {
  const safe = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, Math.trunc(minute)))
  const hours = Math.floor(safe / 60)
  const minutes = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
