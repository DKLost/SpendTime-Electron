import { err, ok, type Result } from './result'
import type { RecordView } from './record'
import { toLocalDate } from './time'
import type { EpochMs, LocalDate, OffsetMinutes } from './types'

const MIN_DURATION_MS = 1_000

export type RecordEditInput = {
  readonly startAt: EpochMs
  readonly endAt: EpochMs
}

export type RecordPatch = {
  readonly startAt: EpochMs
  readonly endAt: EpochMs
  readonly durationSec: number
  readonly localDate: LocalDate
}

export type RecordEditErrorCode = 'INVALID_RANGE' | 'TOO_SHORT' | 'CROSS_DAY'

export type RecordEditError = {
  readonly code: RecordEditErrorCode
  readonly message: string
}

// 编辑只允许落在同一自然日：与计时跨零点切分的口径保持一致，避免单条记录横跨两天
export function validateRecordEdit(
  record: RecordView,
  input: RecordEditInput,
  offsetMinutes: OffsetMinutes,
): Result<RecordPatch, RecordEditError> {
  if (input.endAt <= input.startAt) {
    return err({ code: 'INVALID_RANGE', message: '结束时间必须晚于开始时间' })
  }

  if (input.endAt - input.startAt < MIN_DURATION_MS) {
    return err({ code: 'TOO_SHORT', message: '记录时长至少 1 秒' })
  }

  const startDate = toLocalDate(input.startAt, offsetMinutes)
  const endDate = toLocalDate(input.endAt, offsetMinutes)
  if (startDate !== endDate || startDate !== record.localDate) {
    return err({ code: 'CROSS_DAY', message: '只能在同一自然日内调整记录时间' })
  }

  return ok({
    startAt: input.startAt,
    endAt: input.endAt,
    durationSec: Math.floor((input.endAt - input.startAt) / 1_000),
    localDate: startDate,
  })
}
