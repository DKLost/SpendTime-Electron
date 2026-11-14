import { useEffect } from 'react'
import { formatMinute } from '@core/plan'
import type { AlarmFireDto } from '@shared/contracts'
import { t } from '../../translation'

type AlarmBannerProps = {
  readonly alarms: readonly AlarmFireDto[]
  readonly highlightedPlanId: number | null
  onStart(alarm: AlarmFireDto): void
  onDismiss(planId: number): void
  onDismissAll(): void
}

export function AlarmBanner(props: AlarmBannerProps) {
  const { alarms } = props

  useEffect(
    function scrollToHighlighted() {
      if (props.highlightedPlanId === null) {
        return
      }
      const item = document.querySelector(
        `[data-plan-id="${props.highlightedPlanId}"]`,
      )
      item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    },
    [props.highlightedPlanId],
  )

  if (alarms.length === 0) {
    return null
  }

  function renderAlarmItem(alarm: AlarmFireDto) {
    function handleStartClick(): void {
      props.onStart(alarm)
    }

    function handleDismissClick(): void {
      props.onDismiss(alarm.planId)
    }

    const highlighted = props.highlightedPlanId === alarm.planId
    return (
      <li
        key={`${alarm.planId}:${alarm.fireDate}`}
        className={highlighted ? 'alarm-item is-highlighted' : 'alarm-item'}
        data-plan-id={alarm.planId}
      >
        <span className="alarm-time mono">{formatMinute(alarm.startMin)}</span>
        <span className="alarm-action">{alarm.actionName}</span>
        <button type="button" className="primary" onClick={handleStartClick}>
          {t('common.start')}
        </button>
        <button type="button" className="icon" onClick={handleDismissClick}>
          {t('common.dismiss')}
        </button>
      </li>
    )
  }

  return (
    <section className="alarm-banner" role="status" aria-live="polite">
      <div className="alarm-banner-head">
        <span className="alarm-title">{t('alarm.title')}</span>
        <button type="button" className="ghost" onClick={props.onDismissAll}>
          {t('common.dismissAll')}
        </button>
      </div>
      <ul className="alarm-list">{alarms.map(renderAlarmItem)}</ul>
    </section>
  )
}
