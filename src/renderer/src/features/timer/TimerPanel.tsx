import { useEffect, useState, type ChangeEvent } from 'react'
import type { ActionDto } from '@shared/contracts'
import { formatDuration } from '@core/summary'
import type { TimerController } from '../../state/use-timer-controller'
import { t } from '../../translation'
import { parseTargetText, formatTargetSeconds } from './target-input'

type TimerPanelProps = {
  readonly actions: readonly ActionDto[]
  readonly controller: TimerController
  rememberTarget(actionId: number, targetSec: number | null): Promise<string | null>
}

export function TimerPanel(props: TimerPanelProps) {
  const { actions, controller, rememberTarget } = props
  const [pickedActionId, setPickedActionId] = useState<number | null>(null)
  const [targetText, setTargetText] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const running = controller.snapshot.status === 'running'
  const actionId = pickedActionId ?? actions[0]?.id ?? null
  const currentAction = actions.find((action) => action.id === controller.snapshot.actionId)
  const pickedAction = actions.find((action) => action.id === actionId)

  // 切换行动时载入它自己的倒计时记忆；计划提醒触发的计时不会写回这里
  useEffect(
    function loadSelectedActionTarget() {
      if (running) {
        return
      }
      const targetSec = pickedAction?.timerTargetSec ?? null
      setTargetText(targetSec === null ? '' : formatTargetSeconds(targetSec))
    },
    [actionId, pickedAction?.timerTargetSec, running],
  )

  function handleActionChange(event: ChangeEvent<HTMLSelectElement>): void {
    setPickedActionId(Number(event.target.value))
  }

  function handleTargetChange(event: ChangeEvent<HTMLInputElement>): void {
    setTargetText(event.target.value)
  }

  function handleStartClick(): void {
    void runStart()
  }

  function handleStopClick(): void {
    void runStop()
  }

  async function runStart(): Promise<void> {
    if (actionId === null) {
      setMessage(t('timer.noAction'))
      return
    }
    const parsed = parseTargetText(targetText)
    if (!parsed.ok) {
      setMessage(t(parsed.messageKey))
      return
    }
    const rememberError = await rememberTarget(actionId, parsed.seconds)
    if (rememberError !== null) {
      setMessage(rememberError)
      return
    }
    setMessage(null)
    setMessage(await controller.start(actionId, parsed.seconds))
  }

  async function runStop(): Promise<void> {
    setMessage(await controller.stop())
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('timer.title')}</h2>
        <span className={running ? 'badge badge-running' : 'badge'}>
          {running ? t('timer.running') : t('timer.idle')}
        </span>
      </div>

      <div className="clock">{formatDuration(controller.snapshot.elapsedSec)}</div>

      {running && controller.snapshot.remainingSec !== null ? (
        <p className="hint">{t('timer.remaining', { duration: formatDuration(controller.snapshot.remainingSec) })}</p>
      ) : (
        <p className="hint">
          {running ? currentAction?.name ?? t('timer.unknownAction') : t('timer.stopwatchHint')}
        </p>
      )}

      <div className="field-row">
        <label className="field">
          <span className="label">{t('timer.action')}</span>
          <select value={actionId ?? ''} onChange={handleActionChange} disabled={running}>
            {actions.length === 0 ? <option value="">{t('plans.noActions')}</option> : null}
            {actions.map(renderActionOption)}
          </select>
        </label>

        <label className="field">
          <span className="label">{t('timer.countdown')}</span>
          <input
            type="text"
            placeholder={t('timer.placeholder')}
            value={targetText}
            onChange={handleTargetChange}
            disabled={running}
          />
        </label>
      </div>

      <div className="actions">
        <button type="button" className="primary" onClick={handleStartClick} disabled={running}>
          {t('timer.start')}
        </button>
        <button type="button" className="ghost" onClick={handleStopClick} disabled={!running}>
          {t('timer.stop')}
        </button>
      </div>

      {message === null ? null : <p className="message">{message}</p>}
    </section>
  )
}

function renderActionOption(action: ActionDto) {
  return (
    <option key={action.id} value={action.id}>
      {action.name}
    </option>
  )
}
