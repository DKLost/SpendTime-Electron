import type { ActionId, LocalDate, MinuteOfDay, Weekday } from './types'

// 计划开始后仍允许补发的窗口。应用启动、系统唤醒或短暂卡顿后，
// 在这个范围内仍然提醒一次，避免错过刚开始的计划。
export const DEFAULT_ALARM_GRACE_MINUTES = 10

export type AlarmPlan = {
  readonly id: number
  readonly weekday: Weekday
  readonly startMin: MinuteOfDay
  readonly endMin: MinuteOfDay
  readonly actionId: ActionId
  readonly actionName: string
  readonly alarmEnabled: boolean
}

export type AlarmFire = {
  readonly planId: number
  readonly actionId: ActionId
  readonly actionName: string
  readonly startMin: MinuteOfDay
  readonly fireDate: LocalDate
  // 计划提醒沿用分钟口径：目标时长 = 计划结束 - 计划开始
  readonly targetSec: number
}

// 去重键：同一计划在同一天最多提醒一次
export function alarmKey(planId: number, fireDate: LocalDate): string {
  return `${planId}:${fireDate}`
}

// 纯判定：周几、时间窗口、去重全部由入参决定，不读系统时钟
export function collectDueAlarms(
  plans: readonly AlarmPlan[],
  weekday: Weekday,
  fireDate: LocalDate,
  nowMinute: number,
  firedKeys: ReadonlySet<string>,
  graceMinutes: number = DEFAULT_ALARM_GRACE_MINUTES,
): readonly AlarmFire[] {
  const grace = Math.max(0, Math.trunc(graceMinutes))
  return plans
    .filter((plan) => plan.alarmEnabled)
    .filter((plan) => plan.weekday === weekday)
    .filter((plan) => nowMinute >= plan.startMin && nowMinute - plan.startMin <= grace)
    .filter((plan) => !firedKeys.has(alarmKey(plan.id, fireDate)))
    .sort((left, right) => left.startMin - right.startMin || left.id - right.id)
    .map((plan) => ({
      planId: plan.id,
      actionId: plan.actionId,
      actionName: plan.actionName,
      startMin: plan.startMin,
      fireDate,
      targetSec: (plan.endMin - plan.startMin) * 60,
    }))
}
