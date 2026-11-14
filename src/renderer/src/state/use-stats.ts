import { useEffect, useState } from 'react'
import {
  endOfMonthLocalDate,
  endOfQuarterLocalDate,
  endOfYearLocalDate,
  shiftLocalDate,
  startOfMonthLocalDate,
  startOfQuarterLocalDate,
  startOfWeekLocalDate,
  startOfYearLocalDate,
} from '@core/time'
import type { EventPayload, StatsOverviewDto } from '@shared/contracts'
import { invokeCommand, subscribeEvent } from '../api'
import { apiErrorText, t } from '../translation'

export type StatsPreset = 'week' | 'lastWeek' | 'month' | 'quarter' | 'year' | 'all' | 'custom'

type RecordBounds = { readonly from: string | null; readonly to: string | null }

export type StatsState = {
  readonly overview: StatsOverviewDto | null
  readonly from: string
  readonly to: string
  readonly preset: StatsPreset
  readonly emptyAll: boolean
  readonly exportMessage: string | null
  setPreset(preset: StatsPreset): void
  setFrom(date: string): void
  setTo(date: string): void
  exportCsv(): Promise<void>
}

function rangeForPreset(
  preset: StatsPreset,
  today: string,
  bounds: RecordBounds | null,
): { from: string; to: string } {
  switch (preset) {
    case 'week': {
      const monday = startOfWeekLocalDate(today)
      return { from: monday, to: shiftLocalDate(monday, 6) }
    }
    case 'lastWeek': {
      const monday = shiftLocalDate(startOfWeekLocalDate(today), -7)
      return { from: monday, to: shiftLocalDate(monday, 6) }
    }
    case 'month':
      return { from: startOfMonthLocalDate(today), to: endOfMonthLocalDate(today) }
    case 'quarter':
      return { from: startOfQuarterLocalDate(today), to: endOfQuarterLocalDate(today) }
    case 'year':
      return { from: startOfYearLocalDate(today), to: endOfYearLocalDate(today) }
    // 全部：起点由最早记录推导，终点截到今天；没有记录时起点回落到今天，界面显示空状态
    case 'all':
      return { from: bounds?.from ?? today, to: today }
    case 'custom':
      return { from: shiftLocalDate(today, -6), to: today }
  }
}

export function useStats(today: string): StatsState {
  const initial = rangeForPreset('week', today, null)
  const [preset, setPresetState] = useState<StatsPreset>('week')
  const [from, setFromState] = useState(initial.from)
  const [to, setToState] = useState(initial.to)
  const [bounds, setBounds] = useState<RecordBounds | null>(null)
  const [overview, setOverview] = useState<StatsOverviewDto | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  // 跨过零点时让预设区间跟随新的「今天」，自定义区间保持不变
  useEffect(
    function followToday() {
      if (preset === 'custom') {
        return
      }
      const next = rangeForPreset(preset, today, bounds)
      setFromState(next.from)
      setToState(next.to)
    },
    [today, preset, bounds],
  )

  useEffect(function subscribeRecordChanges() {
    function handleChanged(payload: EventPayload<'data.changed'>): void {
      if (payload.scope === 'records') {
        setRefreshKey((key) => key + 1)
      }
    }
    return subscribeEvent('data.changed', handleChanged)
  }, [])

  // 记录增删后重新取最早日期，保证「全部」范围跟着数据收敛
  useEffect(
    function loadBounds() {
      let cancelled = false
      async function fetchBounds(): Promise<void> {
        const response = await invokeCommand('stats.bounds', {})
        if (!cancelled && response.ok) {
          setBounds(response.value)
        }
      }
      void fetchBounds()
      return function cancelLoad(): void {
        cancelled = true
      }
    },
    [refreshKey],
  )

  useEffect(
    function loadOverview() {
      let cancelled = false
      async function fetchOverview(): Promise<void> {
        const response = await invokeCommand('stats.overview', { from, to })
        if (!cancelled && response.ok) {
          setOverview(response.value)
        }
      }
      void fetchOverview()
      return function cancelLoad(): void {
        cancelled = true
      }
    },
    [from, to, refreshKey],
  )

  function setPreset(next: StatsPreset): void {
    setPresetState(next)
    setExportMessage(null)
    if (next === 'custom') {
      return
    }
    const range = rangeForPreset(next, today, bounds)
    setFromState(range.from)
    setToState(range.to)
  }

  function setFrom(date: string): void {
    setPresetState('custom')
    setFromState(date)
    setExportMessage(null)
  }

  function setTo(date: string): void {
    setPresetState('custom')
    setToState(date)
    setExportMessage(null)
  }

  async function exportCsv(): Promise<void> {
    const response = await invokeCommand('stats.exportCsv', { from, to })
    if (!response.ok) {
      setExportMessage(apiErrorText(response.error))
      return
    }
    setExportMessage(
      response.value.saved
        ? t('stats.exported', { path: response.value.path ?? '' })
        : t('stats.exportCanceled'),
    )
  }

  return {
    overview,
    from,
    to,
    preset,
    emptyAll: preset === 'all' && bounds !== null && bounds.from === null,
    exportMessage,
    setPreset,
    setFrom,
    setTo,
    exportCsv,
  }
}
