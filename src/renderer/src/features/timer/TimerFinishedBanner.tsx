import { formatDuration } from '@core/summary'
import type { FinishedTimer } from '../../state/use-timer-finished'
import { t } from '../../translation'

type TimerFinishedBannerProps = {
  readonly finished: FinishedTimer | null
  onRestart(finished: FinishedTimer): void
  onDismiss(): void
}

export function TimerFinishedBanner(props: TimerFinishedBannerProps) {
  const { finished } = props
  if (finished === null) {
    return null
  }
  return (
    <section className="finished-banner" role="status" aria-live="polite">
      <span className="finished-title">{t('timer.finishedTitle')}</span>
      <span className="finished-action">{finished.actionName}</span>
      <span className="mono finished-duration">{formatDuration(finished.durationSec)}</span>
      <button type="button" className="primary compact" onClick={() => props.onRestart(finished)}>
        {t('timer.restart')}
      </button>
      <button type="button" className="icon" onClick={props.onDismiss}>
        {t('common.dismiss')}
      </button>
    </section>
  )
}
