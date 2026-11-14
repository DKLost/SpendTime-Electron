// 领域自有的时间/时长类型，避免裸 number 在跨层传递时含义漂移

export type EpochMs = number
export type DurationSec = number
export type ActionId = number

// YYYY-MM-DD，按调用方给出的时区偏移计算，不由核心层自行猜测
export type LocalDate = string

export type MinuteOfDay = number
export type OffsetMinutes = number

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type RecordSource = 'timer' | 'plan' | 'manual' | 'import'
