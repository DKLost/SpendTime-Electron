import {
  epochAtLocalMinute,
  minuteOfLocalDay,
  shiftLocalDate,
  toLocalDate,
  toLocalWeekday,
} from './time'
import type { EpochMs, LocalDate, OffsetMinutes, Weekday } from './types'

// 只依赖渲染与计算需要的字段，避免和持久层 DTO 的 weekday 数字类型互相牵制
export type NextPlanCandidate = {
  readonly id: number
  readonly weekday: number
  readonly startMin: number
  readonly actionId: number
  readonly actionName: string
  readonly alarmEnabled: boolean
}

export type NextPlan<T extends NextPlanCandidate = NextPlanCandidate> = {
  readonly plan: T
  readonly startAt: EpochMs
  readonly startDate: LocalDate
  readonly weekday: Weekday
}

const DAYS_IN_WEEK = 7

// 纯函数：当前时间与偏移由外壳传入，不读系统时钟、不碰 IO
// 只考虑开启提醒的计划；已经开始（含正在进行）的计划视为错过，跳到下一次开始
export function findNextPlan<T extends NextPlanCandidate>(
  plans: readonly T[],
  nowMs: EpochMs,
  offsetMinutes: OffsetMinutes,
): NextPlan<T> | null {
  const today = toLocalDate(nowMs, offsetMinutes)
  const nowMinute = minuteOfLocalDay(nowMs, offsetMinutes)
  const candidates = plans.filter((plan) => plan.alarmEnabled)
  if (candidates.length === 0) {
    return null
  }

  let best: NextPlan<T> | null = null
  // 多算一天，覆盖「今天这条已经开始、要等到下周同一星期」的情况
  for (let offset = 0; offset <= DAYS_IN_WEEK; offset += 1) {
    const date = shiftLocalDate(today, offset)
    const weekday = toLocalWeekday(epochAtLocalMinute(date, 0, offsetMinutes), offsetMinutes)
    for (const plan of candidates) {
      if (plan.weekday !== weekday) {
        continue
      }
      if (offset === 0 && plan.startMin <= nowMinute) {
        continue
      }
      const startAt = epochAtLocalMinute(date, plan.startMin, offsetMinutes)
      if (startAt <= nowMs) {
        continue
      }
      if (
        best === null ||
        startAt < best.startAt ||
        (startAt === best.startAt && plan.id < best.plan.id)
      ) {
        best = { plan, startAt, startDate: date, weekday }
      }
    }
  }
  return best
}
