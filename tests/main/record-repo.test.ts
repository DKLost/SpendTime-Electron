import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/adapters/sqlite/database'
import { createActionRepo, createRecordRepo } from '../../src/main/adapters/sqlite/repositories'
import { removeRecord, updateRecord } from '@application/use-cases/records'
import type { NewTimeRecord } from '@core/record'

const OFFSET = 480
const at = (hours: number, minutes: number): number => Date.UTC(2026, 10, 13, hours - 8, minutes)

const logger = {
  info: (_message: string): void => undefined,
  error: (_message: string): void => undefined,
}

describe('时间记录 SQLite 仓储', () => {
  it('支持按 id 读取、编辑起止时间与删除', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const records = createRecordRepo(db)
    const action = actions.create('写作', at(8, 0))

    const record: NewTimeRecord = {
      actionId: action.id,
      sessionId: 'session-1',
      sessionSeq: 0,
      startAt: at(9, 0),
      endAt: at(10, 0),
      durationSec: 3600,
      localDate: '2026-11-13',
      source: 'timer',
    }
    records.insertMany([record])

    const stored = records.listByDate('2026-11-13')[0]
    expect(stored).toBeDefined()
    const recordId = stored?.id ?? 0

    const updated = updateRecord(records, recordId, { startAt: at(8, 30), endAt: at(9, 45) }, OFFSET)
    expect(updated.ok).toBe(true)
    expect(records.findById(recordId)).toMatchObject({
      startAt: at(8, 30),
      endAt: at(9, 45),
      durationSec: 4500,
    })

    const removed = removeRecord(records, recordId)
    expect(removed.ok).toBe(true)
    expect(records.listByDate('2026-11-13')).toEqual([])

    db.close()
  })
})
