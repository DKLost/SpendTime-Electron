import { collectDueAlarms, type AlarmFire } from '@core/alarm'
import type { PlanView } from '@core/plan'
import { minuteOfLocalDay, toLocalDate, toLocalWeekday } from '@core/time'
import type { EpochMs, OffsetMinutes } from '@core/types'
import type { AlarmEventRepo } from '../ports'

// 把系统时间换算成领域时间后交给纯判定，应用层只负责取数
export function collectAlarms(
  plans: readonly PlanView[],
  alarmEvents: AlarmEventRepo,
  now: EpochMs,
  offsetMinutes: OffsetMinutes,
): readonly AlarmFire[] {
  const fireDate = toLocalDate(now, offsetMinutes)
  const firedKeys = new Set(alarmEvents.listKeysByDate(fireDate))
  return collectDueAlarms(
    plans,
    toLocalWeekday(now, offsetMinutes),
    fireDate,
    minuteOfLocalDay(now, offsetMinutes),
    firedKeys,
  )
}

// 先落库再去通知：即使 UI 或通知失败，同一天也不会重复提醒
export function markAlarmsFired(
  alarmEvents: AlarmEventRepo,
  fires: readonly AlarmFire[],
  now: EpochMs,
): void {
  for (const fire of fires) {
    alarmEvents.record(fire, now)
  }
}
