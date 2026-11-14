import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from 'react'
import type { ActionDto, PlanViewDto } from '@shared/contracts'
import { computeFreeSlots, formatMinute } from '@core/plan'
import { weekdayOfLocalDate } from '@core/time'
import type { LocalDate, Weekday } from '@core/types'
import { parseClockText } from './plan-input'
import type { WeekPlansState } from '../../state/use-week-plans'
import { timeSlotOf } from '../../time-slot'
import { t } from '../../translation'

type PlanPanelProps = {
  readonly actions: readonly ActionDto[]
  readonly state: WeekPlansState
  readonly nextPlanId: number | null
  readonly today: LocalDate
}

type WeekdayOption = {
  readonly value: Weekday
  readonly labelKey: 'weekday.1' | 'weekday.2' | 'weekday.3' | 'weekday.4' | 'weekday.5' | 'weekday.6' | 'weekday.7'
}

const WEEKDAYS: readonly WeekdayOption[] = [
  { value: 1, labelKey: 'weekday.1' },
  { value: 2, labelKey: 'weekday.2' },
  { value: 3, labelKey: 'weekday.3' },
  { value: 4, labelKey: 'weekday.4' },
  { value: 5, labelKey: 'weekday.5' },
  { value: 6, labelKey: 'weekday.6' },
  { value: 7, labelKey: 'weekday.7' },
]

const HIDE_NO_ALARM_KEY = 'spendtime.plans.hideNoAlarm'

function loadHideNoAlarm(): boolean {
  return window.localStorage.getItem(HIDE_NO_ALARM_KEY) === '1'
}

export function PlanPanel(props: PlanPanelProps) {
  const { actions, state, nextPlanId, today } = props
  // 「今天」唯一来源是 App 的 useTodayLocalDate；星期只做纯投影
  const todayWeekday = weekdayOfLocalDate(today)
  const [weekday, setWeekday] = useState<Weekday>(todayWeekday)
  const [startText, setStartText] = useState('')
  const [endText, setEndText] = useState('')
  const [pickedActionId, setPickedActionId] = useState<number | null>(null)
  const [alarmEnabled, setAlarmEnabled] = useState(true)
  const [copyFrom, setCopyFrom] = useState<Weekday>(1)
  const [copyTo, setCopyTo] = useState<Weekday>(2)
  const [message, setMessage] = useState<string | null>(null)
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null)
  const [editWeekday, setEditWeekday] = useState<Weekday>(weekday)
  const [editStartText, setEditStartText] = useState('')
  const [editEndText, setEditEndText] = useState('')
  const [editActionId, setEditActionId] = useState<number | null>(null)
  const [editAlarmEnabled, setEditAlarmEnabled] = useState(true)
  const [editMessage, setEditMessage] = useState<string | null>(null)
  const [hideNoAlarm, setHideNoAlarm] = useState(loadHideNoAlarm)

  const plansOfDay = state.plans.filter((plan) => plan.weekday === weekday)
  const freeSlots = computeFreeSlots(plansOfDay)
  const visiblePlans = hideNoAlarm ? plansOfDay.filter((plan) => plan.alarmEnabled) : plansOfDay
  const actionId = pickedActionId ?? actions[0]?.id ?? null

  useEffect(
    function persistHideNoAlarm() {
      window.localStorage.setItem(HIDE_NO_ALARM_KEY, hideNoAlarm ? '1' : '0')
    },
    [hideNoAlarm],
  )

  // 提醒只做提醒本身：这里不再跟随 nextPlanId 自动切换星期页，
  // 避免到点/点击提醒时把用户正在查看的星期覆盖掉。

  function handleWeekdayClick(event: MouseEvent<HTMLButtonElement>): void {
    setWeekday(Number(event.currentTarget.dataset.weekday) as Weekday)
    setMessage(null)
  }

  function handleBackToToday(): void {
    setWeekday(todayWeekday)
    setMessage(null)
  }

  function handleStartChange(event: ChangeEvent<HTMLInputElement>): void {
    setStartText(event.target.value)
  }

  function handleEndChange(event: ChangeEvent<HTMLInputElement>): void {
    setEndText(event.target.value)
  }

  function handleActionChange(event: ChangeEvent<HTMLSelectElement>): void {
    setPickedActionId(Number(event.target.value))
  }

  function handleAlarmChange(event: ChangeEvent<HTMLInputElement>): void {
    setAlarmEnabled(event.currentTarget.checked)
  }

  // 行内开关直接落库，不进入编辑态
  function handleRowAlarmChange(event: ChangeEvent<HTMLInputElement>): void {
    void state.setPlanAlarm(Number(event.currentTarget.dataset.planId), event.currentTarget.checked)
  }

  function handleHideNoAlarmChange(event: ChangeEvent<HTMLInputElement>): void {
    setHideNoAlarm(event.currentTarget.checked)
  }

  function handleCopyFromChange(event: ChangeEvent<HTMLSelectElement>): void {
    setCopyFrom(Number(event.target.value) as Weekday)
  }

  function handleCopyToChange(event: ChangeEvent<HTMLSelectElement>): void {
    setCopyTo(Number(event.target.value) as Weekday)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void submitPlan()
  }

  function handleRemoveClick(event: MouseEvent<HTMLButtonElement>): void {
    void removePlanById(Number(event.currentTarget.dataset.planId))
  }

  function handleEditClick(event: MouseEvent<HTMLButtonElement>): void {
    const planId = Number(event.currentTarget.dataset.planId)
    const plan = state.plans.find((item) => item.id === planId)
    if (plan === undefined) {
      return
    }
    setEditingPlanId(plan.id)
    setEditWeekday(plan.weekday as Weekday)
    setEditStartText(formatMinute(plan.startMin))
    setEditEndText(formatMinute(plan.endMin))
    setEditActionId(plan.actionId)
    setEditAlarmEnabled(plan.alarmEnabled)
    setEditMessage(null)
    setMessage(null)
  }

  function handleEditWeekdayChange(event: ChangeEvent<HTMLSelectElement>): void {
    setEditWeekday(Number(event.target.value) as Weekday)
  }

  function handleEditStartChange(event: ChangeEvent<HTMLInputElement>): void {
    setEditStartText(event.target.value)
  }

  function handleEditEndChange(event: ChangeEvent<HTMLInputElement>): void {
    setEditEndText(event.target.value)
  }

  function handleEditActionChange(event: ChangeEvent<HTMLSelectElement>): void {
    setEditActionId(Number(event.target.value))
  }

  function handleEditAlarmChange(event: ChangeEvent<HTMLInputElement>): void {
    setEditAlarmEnabled(event.currentTarget.checked)
  }

  function handleSaveEditClick(event: MouseEvent<HTMLButtonElement>): void {
    void savePlanEdit(Number(event.currentTarget.dataset.planId))
  }

  function handleCancelEditClick(): void {
    setEditingPlanId(null)
    setEditMessage(null)
  }

  function handleCopyClick(): void {
    void copyPlans()
  }

  async function submitPlan(): Promise<void> {
    if (actionId === null) {
      setMessage(t('plans.noActionFirst'))
      return
    }
    const start = parseClockText(startText)
    if (!start.ok) {
      setMessage(t(start.messageKey))
      return
    }
    const end = parseClockText(endText)
    if (!end.ok) {
      setMessage(t(end.messageKey))
      return
    }

    const error = await state.createPlan({
      weekday,
      startMin: start.minute,
      endMin: end.minute,
      actionId,
      alarmEnabled,
    })
    if (error !== null) {
      setMessage(error)
      return
    }
    setStartText('')
    setEndText('')
    setMessage(null)
  }

  async function removePlanById(planId: number): Promise<void> {
    const error = await state.removePlan(planId)
    setMessage(error)
  }

  async function savePlanEdit(planId: number): Promise<void> {
    if (editActionId === null) {
      setEditMessage(t('plans.pickAction'))
      return
    }
    const start = parseClockText(editStartText)
    if (!start.ok) {
      setEditMessage(t(start.messageKey))
      return
    }
    const end = parseClockText(editEndText)
    if (!end.ok) {
      setEditMessage(t(end.messageKey))
      return
    }

    const nextWeekday = editWeekday
    const error = await state.updatePlan({
      planId,
      weekday: nextWeekday,
      startMin: start.minute,
      endMin: end.minute,
      actionId: editActionId,
      alarmEnabled: editAlarmEnabled,
    })
    if (error !== null) {
      setEditMessage(error)
      return
    }

    setEditingPlanId(null)
    setEditMessage(null)
    setMessage(null)
    // 改了星期就跟随到目标日，避免保存后条目从当前列表消失
    if (nextWeekday !== weekday) {
      setWeekday(nextWeekday)
    }
  }

  async function copyPlans(): Promise<void> {
    const error = await state.copyWeekday(copyFrom, copyTo)
    setMessage(error)
  }

  function renderWeekdayTab(day: WeekdayOption) {
    const className = day.value === weekday ? 'weekday-tab active' : 'weekday-tab'
    return (
      <button
        key={day.value}
        type="button"
        className={className}
        data-weekday={day.value}
        onClick={handleWeekdayClick}
      >
        {t(day.labelKey)}
      </button>
    )
  }

  function renderEditRow(plan: PlanViewDto, index: number) {
    return (
      <tr key={plan.id} className="row-editing">
        <td className="index-cell">{index + 1}</td>
        <td className="row-edit-cell" colSpan={4}>
          <div className="row-edit">
            <select
              className="plan-edit-weekday"
              value={editWeekday}
              aria-label={t('plans.weekdayAria')}
              onChange={handleEditWeekdayChange}
            >
              {WEEKDAYS.map(renderCopyOption)}
            </select>
            <input
              className="plan-edit-time"
              type="text"
              value={editStartText}
              aria-label={t('plans.startAria')}
              onChange={handleEditStartChange}
            />
            <span className="mono">-</span>
            <input
              className="plan-edit-time"
              type="text"
              value={editEndText}
              aria-label={t('plans.endAria')}
              onChange={handleEditEndChange}
            />
            <select
              className="plan-edit-action"
              value={editActionId ?? ''}
              aria-label={t('plans.actionAria')}
              onChange={handleEditActionChange}
            >
              {renderEditActionOptions(plan)}
            </select>
            <label className="plan-alarm">
              <input type="checkbox" checked={editAlarmEnabled} onChange={handleEditAlarmChange} />
              {t('plans.alarm')}
            </label>
            <button type="button" className="primary" data-plan-id={plan.id} onClick={handleSaveEditClick}>
              {t('common.save')}
            </button>
            <button type="button" className="ghost" onClick={handleCancelEditClick}>
              {t('common.cancel')}
            </button>
          </div>
          {editMessage === null ? null : <p className="row-error">{editMessage}</p>}
        </td>
      </tr>
    )
  }

  function renderPlanRow(plan: PlanViewDto, index: number) {
    if (plan.id === editingPlanId) {
      return renderEditRow(plan, index)
    }
    const isNext = plan.id === nextPlanId

    return (
      <tr
        key={plan.id}
        className={isNext ? 'plan-row is-next' : 'plan-row'}
        data-slot={timeSlotOf(plan.startMin)}
        aria-current={isNext ? 'true' : undefined}
      >
        <td className="index-cell">{index + 1}</td>
        <td className="time-cell">
          {formatMinute(plan.startMin)}-{formatMinute(plan.endMin)}
        </td>
        <td className="action-cell">{plan.actionName}</td>
        <td className="alarm-cell">
          <label
            className={plan.alarmEnabled ? 'plan-alarm is-on' : 'plan-alarm'}
            title={t('plans.alarm')}
          >
            <input
              type="checkbox"
              checked={plan.alarmEnabled}
              data-plan-id={plan.id}
              onChange={handleRowAlarmChange}
              aria-label={plan.alarmEnabled ? t('plans.alarmOnAria') : t('plans.alarmOffAria')}
            />
          </label>
        </td>
        <td className="actions-cell">
          <span className="row-actions">
            <button type="button" className="icon" data-plan-id={plan.id} onClick={handleEditClick}>
              {t('common.edit')}
            </button>
            <button type="button" className="icon" data-plan-id={plan.id} onClick={handleRemoveClick}>
              {t('common.delete')}
            </button>
          </span>
        </td>
      </tr>
    )
  }

  function renderEditActionOptions(plan: PlanViewDto) {
    const hasAction = actions.some((action) => action.id === editActionId)
    return (
      <>
        {hasAction ? null : (
          <option value={plan.actionId} disabled>
            {t('plans.archivedAction', { name: plan.actionName })}
          </option>
        )}
        {actions.map(renderActionOption)}
      </>
    )
  }

  function renderSlotChip(slot: { readonly startMin: number; readonly endMin: number }) {
    return (
      <span key={`${slot.startMin}-${slot.endMin}`} className="slot-chip">
        {t('plans.slot', { start: formatMinute(slot.startMin), end: formatMinute(slot.endMin) })}
      </span>
    )
  }

  function renderActionOption(action: ActionDto) {
    return (
      <option key={action.id} value={action.id}>
        {action.name}
      </option>
    )
  }

  function renderCopyOption(day: WeekdayOption) {
    return (
      <option key={day.value} value={day.value}>
        {t(day.labelKey)}
      </option>
    )
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('plans.title')}</h2>
        <div className="panel-head-actions">
          <span className="badge">{t('plans.count', { count: plansOfDay.length })}</span>
          <label className="plan-hide-toggle">
            <input type="checkbox" checked={hideNoAlarm} onChange={handleHideNoAlarmChange} />
            {t('plans.noAlarmOnly')}
          </label>
        </div>
      </div>

      <div className="weekday-nav">
        <div className="weekday-tabs">{WEEKDAYS.map(renderWeekdayTab)}</div>
        <button
          type="button"
          className="ghost compact weekday-today"
          onClick={handleBackToToday}
          disabled={weekday === todayWeekday}
        >
          {t('plans.today')}
        </button>
      </div>

      {visiblePlans.length === 0 ? (
        <p className="empty">{t('plans.empty')}</p>
      ) : (
        <table className="time-table plan-table">
          <thead>
            <tr>
              <th className="index-cell">#</th>
              <th className="time-cell">{t('plans.period')}</th>
              <th className="action-cell">{t('plans.action')}</th>
              <th className="alarm-cell">{t('plans.alarm')}</th>
              <th className="actions-cell">{t('common.operation')}</th>
            </tr>
          </thead>
          <tbody>{visiblePlans.map(renderPlanRow)}</tbody>
        </table>
      )}

      <div className="slot-chips">
        {freeSlots.length === 0 ? (
          <span className="hint">{t('plans.full')}</span>
        ) : (
          freeSlots.map(renderSlotChip)
        )}
      </div>

      <form className="plan-form" onSubmit={handleSubmit}>
        <div className="field-row">
          <label className="field field-narrow">
            <span className="label">{t('plans.start')}</span>
            <input type="text" placeholder="09:00" value={startText} onChange={handleStartChange} />
          </label>
          <label className="field field-narrow">
            <span className="label">{t('plans.end')}</span>
            <input type="text" placeholder="10:30" value={endText} onChange={handleEndChange} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="label">{t('plans.action')}</span>
            <select value={actionId ?? ''} onChange={handleActionChange}>
              {actions.length === 0 ? <option value="">{t('plans.noActions')}</option> : null}
              {actions.map(renderActionOption)}
            </select>
          </label>
          <label className={alarmEnabled ? 'plan-alarm is-on' : 'plan-alarm'}>
            <input type="checkbox" checked={alarmEnabled} onChange={handleAlarmChange} />
            {t('plans.alarm')}
          </label>
          <button type="submit" className="primary">
            {t('common.add')}
          </button>
        </div>
      </form>

      <div className="plan-copy">
        <select value={copyFrom} onChange={handleCopyFromChange} aria-label={t('plans.weekdayAria')}>
          {WEEKDAYS.map(renderCopyOption)}
        </select>
        <span className="hint">→</span>
        <select value={copyTo} onChange={handleCopyToChange} aria-label={t('plans.weekdayAria')}>
          {WEEKDAYS.map(renderCopyOption)}
        </select>
        <button type="button" className="ghost" onClick={handleCopyClick}>
          {t('plans.copy')}
        </button>
      </div>

      {message === null ? null : <p className="message">{message}</p>}
    </section>
  )
}
