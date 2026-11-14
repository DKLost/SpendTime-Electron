export type TargetParseResult =
  | { readonly ok: true; readonly seconds: number | null }
  | {
      readonly ok: false
      readonly messageKey:
        | 'validation.targetFormat'
        | 'validation.targetSecondRange'
        | 'validation.targetPositive'
        | 'validation.targetMax'
    }

// 支持三种写法：分:秒、时:分:秒、纯数字（分钟，兼容旧习惯）；空输入代表正计时
export function parseTargetText(raw: string): TargetParseResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: true, seconds: null }
  }

  const colonParts = trimmed.split(':')
  if (colonParts.length === 1) {
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, messageKey: 'validation.targetFormat' }
    }
    const minutes = Number(trimmed)
    if (minutes <= 0) {
      return { ok: false, messageKey: 'validation.targetPositive' }
    }
    if (minutes * 60 > 86_400) {
      return { ok: false, messageKey: 'validation.targetMax' }
    }
    return { ok: true, seconds: minutes * 60 }
  }

  if (colonParts.length !== 2 && colonParts.length !== 3) {
    return { ok: false, messageKey: 'validation.targetFormat' }
  }
  if (!colonParts.every((part) => /^\d+$/.test(part))) {
    return { ok: false, messageKey: 'validation.targetFormat' }
  }

  const numbers = colonParts.map(Number)
  const secondsPart = numbers[numbers.length - 1] ?? 0
  const minutesPart = numbers[numbers.length - 2] ?? 0
  const hoursPart = numbers.length === 3 ? numbers[0] ?? 0 : 0
  if (secondsPart >= 60 || (numbers.length === 3 && minutesPart >= 60)) {
    return { ok: false, messageKey: 'validation.targetSecondRange' }
  }

  const total = hoursPart * 3600 + minutesPart * 60 + secondsPart
  if (total <= 0) {
    return { ok: false, messageKey: 'validation.targetPositive' }
  }
  if (total > 86_400) {
    return { ok: false, messageKey: 'validation.targetMax' }
  }
  return { ok: true, seconds: total }
}

// 回填到输入框：整分钟仍显示 mm:ss，便于直接看到秒级精度
export function formatTargetSeconds(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}
