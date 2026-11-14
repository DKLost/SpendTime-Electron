import type { ActionId, DurationSec, EpochMs, LocalDate, RecordSource } from './types'

export type TimeRecord = {
  readonly id: number
  readonly actionId: ActionId
  readonly sessionId: string
  readonly sessionSeq: number
  readonly startAt: EpochMs
  readonly endAt: EpochMs
  readonly durationSec: DurationSec
  readonly localDate: LocalDate
  readonly source: RecordSource
}

export type NewTimeRecord = Omit<TimeRecord, 'id'>

// 读模型：列表展示需要行动名，且不必携带会话幂等字段
export type RecordView = {
  readonly id: number
  readonly actionId: ActionId
  readonly actionName: string
  readonly startAt: EpochMs
  readonly endAt: EpochMs
  readonly durationSec: DurationSec
  readonly localDate: LocalDate
  readonly source: RecordSource
}
