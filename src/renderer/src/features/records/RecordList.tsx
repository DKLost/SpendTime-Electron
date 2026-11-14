import { useState, type ChangeEvent } from 'react'
import type { RecordDto } from '@shared/contracts'
import { DAY_END_MIN, formatMinute } from '@core/plan'
import { computeGaps, formatDuration, type MinuteRange } from '@core/summary'
import { epochAtLocalMinute, minuteOfLocalDay, shiftLocalDate, toLocalDate } from '@core/time'
import type { LocalDate } from '@core/types'
import { parseClockText } from '../plans/plan-input'
import { timeSlotOf } from '../../time-slot'
import { t } from '../../translation'

type RecordListProps = {
  readonly date: LocalDate
  readonly today: LocalDate
  readonly records: readonly RecordDto[]
  readonly loading: boolean
  readonly onSelectDate: (date: LocalDate) => void
  readonly onUpdate: (recordId: number, startAt: number, endAt: number) => Promise<string | null>
  readonly onRemove: (recordId: number) => Promise<string | null>
}

type RecordRowProps = {
  readonly record: RecordDto
  readonly onUpdate: RecordListProps['onUpdate']
  readonly onRemove: RecordListProps['onRemove']
}

export function RecordList(props: RecordListProps) {
  const { date, today, records, loading, onSelectDate, onUpdate, onRemove } = props
  const isToday = date === today
  const isFuture = date > today
  const gaps = isFuture || loading ? [] : computeGaps(records.map(recordMinuteRange))

  function renderRecordRow(record: RecordDto) {
    return <RecordRow key={record.id} record={record} onUpdate={onUpdate} onRemove={onRemove} />
  }

  function renderGapChip(gap: MinuteRange) {
    return (
      <span key={`${gap.startMin}-${gap.endMin}`} className="slot-chip">
        {formatMinute(gap.startMin)}-{formatMinute(gap.endMin)}
      </span>
    )
  }

  function handlePrevDay(): void {
    onSelectDate(shiftLocalDate(date, -1))
  }

  function handleNextDay(): void {
    onSelectDate(shiftLocalDate(date, 1))
  }

  function handleToday(): void {
    onSelectDate(today)
  }

  function handleDateChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) {
      event.currentTarget.value = date
      return
    }
    onSelectDate(next)
  }

  return (
    <section className="panel panel-grow">
      <div className="panel-head">
        <h2>{t('records.title')}</h2>
        <span className="badge">
          {loading ? '—' : t('records.count', { count: records.length })}
        </span>
      </div>

      {/* 相邻日期用按钮翻，任意日期用原生日期框跳，回到今天一键复位 */}
      <div className="records-datebar">
        <button
          type="button"
          className="ghost date-step"
          aria-label={t('records.prevDay')}
          title={t('records.prevDay')}
          onClick={handlePrevDay}
        >
          ‹
        </button>
        <input
          className="records-date"
          type="date"
          aria-label={t('records.dateAria')}
          value={date}
          onChange={handleDateChange}
        />
        <button
          type="button"
          className="ghost date-step"
          aria-label={t('records.nextDay')}
          title={t('records.nextDay')}
          onClick={handleNextDay}
        >
          ›
        </button>
        <button type="button" className="ghost compact" onClick={handleToday} disabled={isToday}>
          {t('records.today')}
        </button>
      </div>

      <div className="records-scroll">
        {loading ? (
          <p className="empty">{t('records.loading')}</p>
        ) : isFuture ? (
          <p className="empty">{t('records.futureEmpty')}</p>
        ) : records.length === 0 ? (
          <p className="empty">{t('records.empty')}</p>
        ) : (
          <>
            <table className="time-table record-table">
              <thead>
                <tr>
                  <th className="time-cell">{t('records.period')}</th>
                  <th className="action-cell">{t('records.action')}</th>
                  <th className="numeric duration-cell">{t('records.duration')}</th>
                  <th className="actions-cell">{t('common.operation')}</th>
                </tr>
              </thead>
              <tbody>{records.map(renderRecordRow)}</tbody>
            </table>

            <div className="slot-chips records-gaps">
              <span className="hint">{t('records.gaps')}</span>
              {gaps.length === 0 ? (
                <span className="hint">{t('records.fullDay')}</span>
              ) : (
                gaps.map(renderGapChip)
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function RecordRow(props: RecordRowProps) {
  const { record, onUpdate, onRemove } = props
  const [editing, setEditing] = useState(false)
  const [startText, setStartText] = useState('')
  const [endText, setEndText] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  function handleStartChange(event: ChangeEvent<HTMLInputElement>): void {
    setStartText(event.target.value)
  }

  function handleEndChange(event: ChangeEvent<HTMLInputElement>): void {
    setEndText(event.target.value)
  }

  function beginEdit(): void {
    setStartText(clockTextOf(record.startAt))
    setEndText(clockTextOf(record.endAt))
    setMessage(null)
    setEditing(true)
  }

  function cancelEdit(): void {
    setEditing(false)
    setMessage(null)
  }

  async function saveEdit(): Promise<void> {
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

    const offsetMinutes = currentOffsetMinutes()
    const startAt = epochAtLocalMinute(record.localDate, start.minute, offsetMinutes)
    const endAt = epochAtLocalMinute(record.localDate, end.minute, offsetMinutes)
    const error = await onUpdate(record.id, startAt, endAt)
    if (error !== null) {
      setMessage(error)
      return
    }
    setEditing(false)
    setMessage(null)
  }

  async function handleRemove(): Promise<void> {
    if (!window.confirm(t('records.confirmDelete'))) {
      return
    }
    const error = await onRemove(record.id)
    setMessage(error)
  }

  function handleSaveClick(): void {
    void saveEdit()
  }

  function handleRemoveClick(): void {
    void handleRemove()
  }

  if (editing) {
    const previewSec = previewDurationSec(startText, endText)
    return (
      <tr className="row-editing">
        <td className="row-edit-cell" colSpan={4}>
          <div className="row-edit">
            <span className="action-cell">{record.actionName}</span>
            <span className="time-edit">
              <input
                type="time"
                className="time-input"
                aria-label={t('records.startAria')}
                value={startText}
                onChange={handleStartChange}
              />
              <span>-</span>
              <input
                type="time"
                className="time-input"
                aria-label={t('records.endAria')}
                value={endText}
                onChange={handleEndChange}
              />
            </span>
            <span className="mono row-edit-duration">{formatDuration(previewSec)}</span>
            <button type="button" className="primary" onClick={handleSaveClick}>
              {t('common.save')}
            </button>
            <button type="button" className="ghost" onClick={cancelEdit}>
              {t('common.cancel')}
            </button>
          </div>
          {message === null ? null : <p className="row-error">{message}</p>}
        </td>
      </tr>
    )
  }

  const range = recordMinuteRange(record)

  return (
    <tr data-slot={timeSlotOf(range.startMin)}>
      <td className="time-cell">
        {formatMinute(range.startMin)}-{formatMinute(range.endMin)}
      </td>
      <td className="action-cell">{record.actionName}</td>
      <td className="numeric mono duration-cell">{formatDuration(record.durationSec)}</td>
      <td className="actions-cell">
        <span className="row-actions">
          <button type="button" className="icon" onClick={beginEdit}>
            {t('common.edit')}
          </button>
          <button type="button" className="icon" onClick={handleRemoveClick}>
            {t('common.delete')}
          </button>
        </span>
        {message === null ? null : <span className="row-error">{message}</span>}
      </td>
    </tr>
  )
}

function currentOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

function clockTextOf(epochMs: number): string {
  return formatMinute(minuteOfLocalDay(epochMs, currentOffsetMinutes()))
}

// 跨零点切分出的当天末段，终点正好落在次日 00:00；这里按 24:00 参与展示与空档计算
function recordMinuteRange(record: RecordDto): MinuteRange {
  const offset = currentOffsetMinutes()
  const endMin =
    toLocalDate(record.endAt, offset) === record.localDate
      ? minuteOfLocalDay(record.endAt, offset)
      : DAY_END_MIN
  return { startMin: minuteOfLocalDay(record.startAt, offset), endMin }
}

function previewDurationSec(startText: string, endText: string): number {
  const start = parseClockText(startText)
  const end = parseClockText(endText)
  if (!start.ok || !end.ok) {
    return 0
  }
  return Math.max(0, (end.minute - start.minute) * 60)
}
