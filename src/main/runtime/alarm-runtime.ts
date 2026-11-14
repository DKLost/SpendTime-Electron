import type { AlarmEventRepo, Clock, Logger, PlanRepo } from '@application/ports'
import { collectAlarms, markAlarmsFired } from '@application/use-cases/alarms'
import type { AlarmFire } from '@core/alarm'

export type AlarmRuntimeDeps = {
  readonly plans: PlanRepo
  readonly alarmEvents: AlarmEventRepo
  readonly clock: Clock
  readonly logger: Logger
  readonly onFired: (fires: readonly AlarmFire[]) => void
}

export type AlarmRuntime = {
  start(): void
  check(): void
  // 计划增删改后立刻补查，新时段不必等下一个分钟边界
  nudge(): void
  dispose(): void
}

const MINUTE_MS = 60_000

// 计划精确到分钟，检查钉在分钟边界上；相比固定 30 秒轮询，误差从 0-30 秒降到毫秒级
export function delayToNextMinute(nowMs: number): number {
  const remainder = ((nowMs % MINUTE_MS) + MINUTE_MS) % MINUTE_MS
  return remainder === 0 ? MINUTE_MS : MINUTE_MS - remainder
}

export function createAlarmRuntime(deps: AlarmRuntimeDeps): AlarmRuntime {
  let timer: ReturnType<typeof setTimeout> | null = null
  let started = false

  function check(): void {
    try {
      const now = deps.clock.now()
      const fires = collectAlarms(
        deps.plans.listWeek(),
        deps.alarmEvents,
        now,
        deps.clock.offsetMinutes(),
      )
      if (fires.length === 0) {
        return
      }
      markAlarmsFired(deps.alarmEvents, fires, now)
      deps.onFired(fires)
      deps.logger.info(`闹钟触发 ${fires.length} 条`)
    } catch (error) {
      deps.logger.error('闹钟检查失败', error)
    }
  }

  function schedule(): void {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(runScheduledCheck, delayToNextMinute(deps.clock.now()))
  }

  function runScheduledCheck(): void {
    timer = null
    check()
    schedule()
  }

  function start(): void {
    if (started) {
      return
    }
    started = true
    check()
    schedule()
  }

  function nudge(): void {
    if (!started) {
      return
    }
    check()
    schedule()
  }

  function dispose(): void {
    started = false
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = null
  }

  return { start, check, nudge, dispose }
}
