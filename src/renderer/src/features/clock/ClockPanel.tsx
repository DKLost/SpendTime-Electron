import { formatMinute } from '@core/plan'
import type { NextPlan } from '@core/next-plan'
import { formatDuration } from '@core/summary'
import { formatClockDate, formatWeekdayDate } from '../../format-date'
import { t } from '../../translation'

type ClockPanelProps = {
  readonly nowMs: number
  readonly next: NextPlan | null
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatCountdown(remainingMs: number): string {
  return formatDuration(Math.max(0, Math.ceil(remainingMs / 1_000)))
}

export function ClockPanel(props: ClockPanelProps) {
  const { nowMs, next } = props
  const remainingMs = next === null ? 0 : Math.max(0, next.startAt - nowMs)

  return (
    <section className="panel clock-panel" aria-label={t('clock.title')}>
      <div className="clock-now">
        <span className="label">{t('clock.title')}</span>
        <span className="clock-time-row">
          <strong className="mono clock-time">{formatClock(nowMs)}</strong>
          <span className="clock-date">{formatClockDate(nowMs)}</span>
        </span>
      </div>
      <div className="clock-next">
        <span className="label">{t('clock.next')}</span>
        {next === null ? (
          <span className="hint">{t('clock.none')}</span>
        ) : (
          <>
            <span className="clock-next-meta">
              {formatWeekdayDate(next.weekday, next.startDate)}{' '}
              {formatMinute(next.plan.startMin)} · {next.plan.actionName}
            </span>
            <span className="clock-countdown-row">
              <span className="hint">{t('clock.remaining')}</span>
              <span className="clock-countdown mono">{formatCountdown(remainingMs)}</span>
            </span>
          </>
        )}
      </div>
    </section>
  )
}
