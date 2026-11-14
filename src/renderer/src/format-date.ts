import type { LocalDate, Weekday } from '@core/types'
import { getLocale, t, type TranslationKey } from './translation'

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function weekdayOfDate(date: Date): Weekday {
  const index = date.getDay()
  return (index === 0 ? 7 : index) as Weekday
}

function weekdayKey(weekday: Weekday): TranslationKey {
  return `weekday.${weekday}`
}

function englishTime(date: Date, withSeconds: boolean): string {
  const hours = date.getHours()
  const suffix = hours < 12 ? 'AM' : 'PM'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  const base = `${hour12}:${pad2(date.getMinutes())}`
  return withSeconds ? `${base}:${pad2(date.getSeconds())} ${suffix}` : `${base} ${suffix}`
}

// 归档等历史时间统一口径：本地时间，年月日 + 时分
// 英文用 12 小时制；日文用斜杠分隔，中文保持既有 YYYY-MM-DD HH:mm
export function formatDateTime(epochMs: number | null): string {
  if (epochMs === null) {
    return ''
  }
  const date = new Date(epochMs)
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  switch (getLocale()) {
    case 'en':
      return `${year}-${month}-${day} ${englishTime(date, false)}`
    case 'ja':
      return `${year}/${month}/${day} ${clock}`
    case 'zh':
      return `${year}-${month}-${day} ${clock}`
  }
}

export function formatDateTimeWithSeconds(epochMs: number): string {
  const date = new Date(epochMs)
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  switch (getLocale()) {
    case 'en':
      return `${year}-${month}-${day} ${englishTime(date, true)}`
    case 'ja':
      return `${year}/${month}/${day} ${clock}`
    case 'zh':
      return `${year}-${month}-${day} ${clock}`
  }
}

// 时钟旁的日期附注：按语言调整顺序与星期写法，主时间仍是 24 小时制
export function formatClockDate(epochMs: number): string {
  const date = new Date(epochMs)
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const weekday = t(weekdayKey(weekdayOfDate(date)))
  switch (getLocale()) {
    case 'en':
      return `${weekday}, ${MONTH_LABELS[date.getMonth()]} ${date.getDate()}, ${year}`
    case 'ja':
      return `${year}-${month}-${day} (${weekday})`
    case 'zh':
      return `${year}-${month}-${day} ${weekday}`
  }
}

// 下一个提醒的日期片段：英文用 Nov 14，中日保持 MM-DD
function formatMonthDay(localDate: LocalDate): string {
  const parts = localDate.split('-')
  const month = Number(parts[1] ?? 1)
  const day = Number(parts[2] ?? 1)
  if (getLocale() === 'en') {
    return `${MONTH_LABELS[month - 1] ?? ''} ${day}`
  }
  return `${pad2(month)}-${pad2(day)}`
}

export function formatWeekdayDate(weekday: Weekday, localDate: LocalDate): string {
  const label = t(weekdayKey(weekday))
  return getLocale() === 'en'
    ? `${label}, ${formatMonthDay(localDate)}`
    : `${label} ${formatMonthDay(localDate)}`
}
