import type { EpochMs, LocalDate, OffsetMinutes, Weekday } from './types'

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000

export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

// 偏移由外壳传入（东八区为 +480），核心层不读系统时区
export function toLocalDate(epochMs: EpochMs, offsetMinutes: OffsetMinutes): LocalDate {
  const shifted = new Date(epochMs + offsetMinutes * MS_PER_MINUTE)
  const year = shifted.getUTCFullYear()
  const month = pad2(shifted.getUTCMonth() + 1)
  const day = pad2(shifted.getUTCDate())
  return `${year}-${month}-${day}`
}

export function startOfLocalDay(epochMs: EpochMs, offsetMinutes: OffsetMinutes): EpochMs {
  const offsetMs = offsetMinutes * MS_PER_MINUTE
  return Math.floor((epochMs + offsetMs) / MS_PER_DAY) * MS_PER_DAY - offsetMs
}

export function nextLocalMidnight(epochMs: EpochMs, offsetMinutes: OffsetMinutes): EpochMs {
  return startOfLocalDay(epochMs, offsetMinutes) + MS_PER_DAY
}

export type DaySegment = {
  readonly startAt: EpochMs
  readonly endAt: EpochMs
  readonly localDate: LocalDate
}

// 跨零点切分成按自然日的多段，日统计因此天然正确
export function splitByLocalDay(
  startAt: EpochMs,
  endAt: EpochMs,
  offsetMinutes: OffsetMinutes,
): readonly DaySegment[] {
  if (endAt <= startAt) {
    return []
  }

  const segments: DaySegment[] = []
  let cursor = startAt
  while (cursor < endAt) {
    const boundary = Math.min(nextLocalMidnight(cursor, offsetMinutes), endAt)
    segments.push({ startAt: cursor, endAt: boundary, localDate: toLocalDate(cursor, offsetMinutes) })
    cursor = boundary
  }
  return segments
}

export function epochMsToSeconds(epochMs: EpochMs): number {
  return Math.floor(epochMs / 1000)
}

// JS 的 getUTCDay 以周日为 0，领域里统一成周一 1、周日 7
export function toLocalWeekday(epochMs: EpochMs, offsetMinutes: OffsetMinutes): Weekday {
  const shifted = new Date(epochMs + offsetMinutes * MS_PER_MINUTE)
  const index = shifted.getUTCDay()
  return (index === 0 ? 7 : index) as Weekday
}

export function minuteOfLocalDay(epochMs: EpochMs, offsetMinutes: OffsetMinutes): number {
  const shifted = new Date(epochMs + offsetMinutes * MS_PER_MINUTE)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

// 某个本地自然日内的分钟数 → 时间戳；只用于把界面输入还原成记录边界
export function epochAtLocalMinute(
  date: LocalDate,
  minute: number,
  offsetMinutes: OffsetMinutes,
): EpochMs {
  const parts = date.split('-')
  const year = Number(parts[0] ?? 0)
  const month = Number(parts[1] ?? 1)
  const day = Number(parts[2] ?? 1)
  const utcMidnight = Date.UTC(year, month - 1, day)
  return utcMidnight - offsetMinutes * MS_PER_MINUTE + minute * MS_PER_MINUTE
}

// 星期只是本地日期字符串的纯投影：周一 1、周日 7，不读系统时钟
export function weekdayOfLocalDate(date: LocalDate): Weekday {
  const index = new Date(localDateToUtc(date)).getUTCDay()
  return (index === 0 ? 7 : index) as Weekday
}

// 日期字符串按 UTC 平移，只用于纯日期运算，不涉及时区偏移
// 周一作为一周开始；只做日期字符串运算，不引入时区
export function startOfWeekLocalDate(date: LocalDate): LocalDate {
  return shiftLocalDate(date, -(weekdayOfLocalDate(date) - 1))
}

export function startOfMonthLocalDate(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`
}

export function startOfQuarterLocalDate(date: LocalDate): LocalDate {
  const [year, month] = date.split('-').map(Number)
  const startMonth = Math.floor(((month ?? 1) - 1) / 3) * 3 + 1
  return `${year ?? 1970}-${pad2(startMonth)}-01`
}

export function endOfQuarterLocalDate(date: LocalDate): LocalDate {
  return endOfMonthLocalDate(addLocalMonths(startOfQuarterLocalDate(date), 2))
}

export function startOfYearLocalDate(date: LocalDate): LocalDate {
  return `${date.slice(0, 4)}-01-01`
}

export function endOfYearLocalDate(date: LocalDate): LocalDate {
  return `${date.slice(0, 4)}-12-31`
}

export function endOfMonthLocalDate(date: LocalDate): LocalDate {
  const [year, month] = date.split('-').map(Number)
  const nextMonth = new Date(Date.UTC(year ?? 1970, month ?? 1, 1))
  return utcToLocalDate(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 0))
}

export function addLocalMonths(date: LocalDate, months: number): LocalDate {
  const [year, month] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + months, 1))
  return utcToLocalDate(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1))
}

function localDateToUtc(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

function utcToLocalDate(millis: number): LocalDate {
  return new Date(millis).toISOString().slice(0, 10)
}

export function shiftLocalDate(date: LocalDate, days: number): LocalDate {
  const parts = date.split('-')
  const year = Number(parts[0] ?? 0)
  const month = Number(parts[1] ?? 1)
  const day = Number(parts[2] ?? 1)
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY)
  const nextYear = shifted.getUTCFullYear()
  const nextMonth = pad2(shifted.getUTCMonth() + 1)
  const nextDay = pad2(shifted.getUTCDate())
  return `${nextYear}-${nextMonth}-${nextDay}`
}
