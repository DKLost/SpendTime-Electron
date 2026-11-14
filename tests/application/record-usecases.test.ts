import { describe, expect, it } from 'vitest'
import type { RecordRepo } from '@application/ports'
import { removeRecord, updateRecord } from '@application/use-cases/records'
import type { NewTimeRecord, RecordView } from '@core/record'
import type { RecordPatch } from '@core/record-edit'
import type { LocalDate } from '@core/types'

const OFFSET = 480
const at = (hours: number, minutes: number): number => Date.UTC(2026, 10, 13, hours - 8, minutes)

function createFakeRepo(): RecordRepo {
  const records: RecordView[] = [
    {
      id: 1,
      actionId: 10,
      actionName: '写作',
      startAt: at(9, 0),
      endAt: at(10, 0),
      durationSec: 3600,
      localDate: '2026-11-13',
      source: 'timer',
    },
  ]

  function listByDate(date: LocalDate): readonly RecordView[] {
    return records.filter((record) => record.localDate === date)
  }

  return {
    insertMany: (_records: readonly NewTimeRecord[]) => undefined,
    listByDate,
    listRange: (from: LocalDate, to: LocalDate) =>
      records.filter((record) => record.localDate >= from && record.localDate <= to),
    findById: (id: number) => records.find((record) => record.id === id) ?? null,
    countByAction: (actionId: number) => records.filter((record) => record.actionId === actionId).length,
    update: (id: number, patch: RecordPatch) => {
      const target = records.find((record) => record.id === id)
      if (target === undefined) {
        return
      }
      Object.assign(target, patch)
    },
    remove: (id: number) => {
      const index = records.findIndex((record) => record.id === id)
      if (index >= 0) {
        records.splice(index, 1)
      }
    },
    removeByAction: (actionId: number) => {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index]?.actionId === actionId) {
          records.splice(index, 1)
        }
      }
    },
    totalsByAction: () => {
      const totals = new Map<number, number>()
      for (const record of records) {
        totals.set(record.actionId, (totals.get(record.actionId) ?? 0) + record.durationSec)
      }
      return [...totals].map(([actionId, durationSec]) => ({ actionId, durationSec }))
    },
    bounds: () => {
      const dates = records.map((record) => record.localDate).sort()
      return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null }
    },
  }
}

describe('updateRecord', () => {
  it('记录不存在时返回 RECORD_NOT_FOUND', () => {
    const result = updateRecord(createFakeRepo(), 99, { startAt: at(9, 0), endAt: at(10, 0) }, OFFSET)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RECORD_NOT_FOUND')
    }
  })

  it('合法编辑返回更新后的记录', () => {
    const repo = createFakeRepo()
    const result = updateRecord(repo, 1, { startAt: at(8, 30), endAt: at(9, 45) }, OFFSET)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.startAt).toBe(at(8, 30))
      expect(result.value.durationSec).toBe(4500)
    }
    expect(repo.findById(1)?.durationSec).toBe(4500)
  })
})

describe('removeRecord', () => {
  it('删除后仓储中不再有该记录', () => {
    const repo = createFakeRepo()
    const result = removeRecord(repo, 1)
    expect(result.ok).toBe(true)
    expect(repo.findById(1)).toBeNull()
  })

  it('重复删除返回 RECORD_NOT_FOUND', () => {
    const repo = createFakeRepo()
    removeRecord(repo, 1)
    const result = removeRecord(repo, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RECORD_NOT_FOUND')
    }
  })
})
