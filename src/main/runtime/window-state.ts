import { screen, type BrowserWindow } from 'electron'
import type { Logger, SettingsRepo } from '@application/ports'
import { SETTINGS_KEYS } from '@core/settings'
import { parseWindowBounds, type WorkArea, type WindowBounds } from '@core/window'

export type SavedWindowState = {
  readonly bounds: WindowBounds
  readonly maximized: boolean
}

export function readWorkAreas(): readonly WorkArea[] {
  return screen.getAllDisplays().map((display) => ({
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height,
  }))
}

export function loadWindowState(settings: SettingsRepo): SavedWindowState {
  const workAreas = readWorkAreas()
  return {
    bounds: parseWindowBounds(settings.get(SETTINGS_KEYS.windowBounds), workAreas),
    maximized: settings.get(SETTINGS_KEYS.windowMaximized) === 'true',
  }
}

// resize/move 事件很密集，500ms 防抖后写入；最大化时仍保存正常 bounds
export function attachWindowStatePersistence(
  win: BrowserWindow,
  settings: SettingsRepo,
  logger: Logger,
): () => void {
  let timer: NodeJS.Timeout | null = null

  function save(): void {
    if (win.isDestroyed()) {
      return
    }
    try {
      const bounds = win.getNormalBounds()
      settings.set(
        SETTINGS_KEYS.windowBounds,
        JSON.stringify({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        }),
      )
      settings.set(SETTINGS_KEYS.windowMaximized, win.isMaximized() ? 'true' : 'false')
    } catch (error) {
      logger.error('保存窗口状态失败', error)
    }
  }

  function schedule(): void {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      save()
    }, 500)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)

  return function dispose(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    save()
  }
}

// 显示器拔插后重新钳制，避免窗口留在已消失的屏幕
export function reclampWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return
  }
  const workAreas = readWorkAreas()
  const current = win.getNormalBounds()
  const next = parseWindowBounds(
    JSON.stringify({ x: current.x, y: current.y, width: current.width, height: current.height }),
    workAreas,
    { width: current.width, height: current.height },
  )
  if (
    next.x !== current.x ||
    next.y !== current.y ||
    next.width !== current.width ||
    next.height !== current.height
  ) {
    win.setBounds(next)
  }
}
