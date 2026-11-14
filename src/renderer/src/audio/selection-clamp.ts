export type Selection = {
  readonly start: number
  readonly end: number
}

// 绝对边界：只夹紧被拖动的一端，另一端保持不动
export function clampSelectionStart(
  value: number,
  end: number,
  minLengthSec: number,
  maxLengthSec: number,
): number {
  const upper = Math.max(0, end - minLengthSec)
  const lower = Math.max(0, end - maxLengthSec)
  return Math.min(Math.max(value, lower), upper)
}

export function clampSelectionEnd(
  value: number,
  start: number,
  durationSec: number,
  minLengthSec: number,
  maxLengthSec: number,
): number {
  const limit = durationSec > 0 ? durationSec : start + maxLengthSec
  const upper = Math.min(limit, start + maxLengthSec)
  const lower = Math.min(start + minLengthSec, upper)
  return Math.min(Math.max(value, lower), upper)
}

// 整段平移：长度不变，只夹紧起点。绝对上限是“文件末尾减去长度”，
// 不参考上一次拖动位置，撞到 0 或末尾时直接停住，不会挤压两端。
// 长度在进入平移前已由 normalizeSelection 限制在 <= maxLengthSec，
// 因此 start + length 同时不会越过 60 秒上限。
export function clampSelectionMove(
  start: number,
  lengthSec: number,
  durationSec: number,
): number {
  const length = Math.max(0, lengthSec)
  const upper = durationSec > 0 ? Math.max(0, durationSec - length) : Math.max(0, start)
  return Math.min(Math.max(start, 0), upper)
}

// 加载初始区间或音频时长变化时使用：优先保留起点，把终点收回上限内
export function normalizeSelection(
  selection: Selection,
  durationSec: number,
  minLengthSec: number,
  maxLengthSec: number,
): Selection {
  const limit = durationSec > 0 ? durationSec : Math.max(selection.end, minLengthSec)
  const start = Math.min(Math.max(0, selection.start), Math.max(0, limit - minLengthSec))
  const end = Math.min(
    Math.max(selection.end, start + minLengthSec),
    Math.min(limit, start + maxLengthSec),
  )
  return { start, end }
}

// wavesurfer 会按像素裁剪“看不见”的选区元素：贴住文件末尾且窄于 1px 时，
// 整个选区元素会被摘掉，手柄随之消失。这里保证贴边选区至少占一像素多一点的宽度。
export function keepSelectionVisibleAtEnd(
  selection: Selection,
  durationSec: number,
  minVisibleLengthSec: number,
): Selection {
  if (durationSec <= 0 || selection.end < durationSec - 1e-6) {
    return selection
  }
  const width = Math.max(0, minVisibleLengthSec)
  if (selection.end - selection.start >= width) {
    return selection
  }
  return { start: Math.max(0, selection.end - width), end: selection.end }
}
