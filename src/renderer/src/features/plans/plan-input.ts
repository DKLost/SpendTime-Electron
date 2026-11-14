import type { TranslationKey } from '../../translation'

export type ClockParseResult =
  | { readonly ok: true; readonly minute: number }
  | {
      readonly ok: false
      readonly messageKey: Extract<TranslationKey, 'validation.timeFormat' | 'validation.minuteRange' | 'validation.timeMax'>
    }

// 只接受 HH:MM；24:00 合法（表示当天结束），其它越界值给出提示而不是静默修正
export function parseClockText(raw: string): ClockParseResult {
  const trimmed = raw.trim()
  const matched = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (matched === null) {
    return { ok: false, messageKey: 'validation.timeFormat' }
  }

  const hours = Number(matched[1])
  const minutes = Number(matched[2])
  if (minutes >= 60) {
    return { ok: false, messageKey: 'validation.minuteRange' }
  }
  if (hours > 24 || (hours === 24 && minutes > 0)) {
    return { ok: false, messageKey: 'validation.timeMax' }
  }
  return { ok: true, minute: hours * 60 + minutes }
}
