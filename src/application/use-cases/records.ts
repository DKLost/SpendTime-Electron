import { err, ok, type Result } from '@core/result'
import { validateRecordEdit, type RecordEditErrorCode, type RecordEditInput } from '@core/record-edit'
import type { RecordView } from '@core/record'
import type { OffsetMinutes } from '@core/types'
import type { RecordRepo } from '../ports'

export type RecordCommandErrorCode = 'RECORD_NOT_FOUND' | RecordEditErrorCode

export type RecordCommandError = {
  readonly code: RecordCommandErrorCode
  readonly message: string
}

export function updateRecord(
  repo: RecordRepo,
  recordId: number,
  input: RecordEditInput,
  offsetMinutes: OffsetMinutes,
): Result<RecordView, RecordCommandError> {
  const record = repo.findById(recordId)
  if (record === null) {
    return err({ code: 'RECORD_NOT_FOUND', message: '记录不存在或已删除' })
  }

  const validated = validateRecordEdit(record, input, offsetMinutes)
  if (!validated.ok) {
    return err(validated.error)
  }

  repo.update(recordId, validated.value)
  const updated = repo.findById(recordId)
  if (updated === null) {
    return err({ code: 'RECORD_NOT_FOUND', message: '记录不存在或已删除' })
  }
  return ok(updated)
}

export function removeRecord(
  repo: RecordRepo,
  recordId: number,
): Result<{ recordId: number }, RecordCommandError> {
  if (repo.findById(recordId) === null) {
    return err({ code: 'RECORD_NOT_FOUND', message: '记录不存在或已删除' })
  }
  repo.remove(recordId)
  return ok({ recordId })
}
