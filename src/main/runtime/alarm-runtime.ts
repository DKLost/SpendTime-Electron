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
  dispose(): void
}

// 计划精确到分钟，30 秒轮询足够及时；错过的场景由 core 的宽限窗口补发
const CHECK_INTERVAL_MS = 30_000

export function createAlarmRuntime(deps: AlarmRuntimeDeps): AlarmRuntime {
  let timer: ReturnType<typeof setInterval> | null = null

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

  function start(): void {
    if (timer !== null) {
      return
    }
    check()
    timer = setInterval(check, CHECK_INTERVAL_MS)
  }

  function dispose(): void {
    if (timer === null) {
      return
    }
    clearInterval(timer)
    timer = null
  }

  return { start, check, dispose }
}
