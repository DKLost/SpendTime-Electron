// 窗口几何只做纯计算：显示器数据由 main 层注入，core 不接触 Electron
export type WindowBounds = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type WorkArea = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 860 } as const
export const MIN_WINDOW_SIZE = { width: 960, height: 640 } as const

const MIN_VISIBLE_WIDTH = 100
const MIN_VISIBLE_HEIGHT = 40

export function clampWindowBounds(
  bounds: WindowBounds | null,
  workAreas: readonly WorkArea[],
  fallback: WindowBounds,
): WindowBounds {
  const target = normalizeBounds(bounds, fallback)
  if (workAreas.length === 0) {
    return target
  }
  if (workAreas.some((area) => visibleEnough(target, area))) {
    return clampIntoArea(target, nearestArea(target, workAreas))
  }
  const primary = workAreas[0] ?? fallback
  return centerInArea(primary, DEFAULT_WINDOW_SIZE)
}

export function centerInArea(area: WorkArea, size: { width: number; height: number }): WindowBounds {
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + (area.height - size.height) / 2),
    width: size.width,
    height: size.height,
  }
}

// 存储的 JSON 可能损坏，解析失败一律回落到主屏居中
export function parseWindowBounds(
  raw: string | null,
  workAreas: readonly WorkArea[],
  size: { width: number; height: number } = DEFAULT_WINDOW_SIZE,
): WindowBounds {
  const fallbackArea = workAreas[0] ?? { x: 0, y: 0, width: 1920, height: 1080 }
  const fallback = centerInArea(fallbackArea, size)
  if (raw === null) {
    return fallback
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isBounds(parsed)) {
      return fallback
    }
    return clampWindowBounds(parsed, workAreas, fallback)
  } catch {
    return fallback
  }
}

function isBounds(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    isFiniteNumber(record['x']) &&
    isFiniteNumber(record['y']) &&
    isFiniteNumber(record['width']) &&
    isFiniteNumber(record['height'])
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeBounds(bounds: WindowBounds | null, fallback: WindowBounds): WindowBounds {
  if (bounds === null) {
    return fallback
  }
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(MIN_WINDOW_SIZE.width, Math.round(bounds.width)),
    height: Math.max(MIN_WINDOW_SIZE.height, Math.round(bounds.height)),
  }
}

function visibleEnough(bounds: WindowBounds, area: WorkArea): boolean {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
  return width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT
}

function nearestArea(bounds: WindowBounds, workAreas: readonly WorkArea[]): WorkArea {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  let best = workAreas[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const area of workAreas) {
    const distance = Math.hypot(centerX - (area.x + area.width / 2), centerY - (area.y + area.height / 2))
    if (distance < bestDistance) {
      best = area
      bestDistance = distance
    }
  }
  return best ?? { x: 0, y: 0, width: 1920, height: 1080 }
}

// 只平移不缩放，避免显示器变小后窗口越开越大
function clampIntoArea(bounds: WindowBounds, area: WorkArea): WindowBounds {
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
  return { x, y, width, height }
}
