import { useEffect, useState } from 'react'
import type { EventPayload, RecordDto } from '@shared/contracts'
import type { LocalDate } from '@core/types'
import { invokeCommand, subscribeEvent } from '../api'
import { apiErrorText } from '../translation'

export type DayRecordsState = {
  readonly records: readonly RecordDto[]
  readonly loading: boolean
  updateRecord(recordId: number, startAt: number, endAt: number): Promise<string | null>
  removeRecord(recordId: number): Promise<string | null>
}

type RecordsSnapshot = {
  readonly date: LocalDate
  readonly records: readonly RecordDto[]
  readonly loading: boolean
}

export function useDayRecords(date: LocalDate): DayRecordsState {
  // 带上日期一起存：切日期的首帧不会把上一天的记录当成新日期展示
  const [snapshot, setSnapshot] = useState<RecordsSnapshot>({
    date,
    records: [],
    loading: true,
  })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(function subscribeRecordChanges() {
    function handleChanged(payload: EventPayload<'data.changed'>): void {
      if (payload.scope === 'records') {
        setRefreshKey((key) => key + 1)
      }
    }
    return subscribeEvent('data.changed', handleChanged)
  }, [])

  useEffect(
    function loadRecords() {
      let cancelled = false
      async function fetchRecords(): Promise<void> {
        const response = await invokeCommand('records.listByDate', { date })
        if (!cancelled && response.ok) {
          setSnapshot({ date, records: response.value, loading: false })
        }
      }
      void fetchRecords()
      return function cancelLoad(): void {
        cancelled = true
      }
    },
    [date, refreshKey],
  )

  async function updateRecord(recordId: number, startAt: number, endAt: number): Promise<string | null> {
    const response = await invokeCommand('records.update', { recordId, startAt, endAt })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    return null
  }

  async function removeRecord(recordId: number): Promise<string | null> {
    const response = await invokeCommand('records.remove', { recordId })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    return null
  }

  const records = snapshot.date === date ? snapshot.records : []
  const loading = snapshot.date !== date || snapshot.loading
  return { records, loading, updateRecord, removeRecord }
}
