import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { formatDuration } from '@core/summary'
import type { AppSettings } from '@core/settings'
import type { Logger } from '@application/ports'

export type TraySnapshot = {
  readonly running: boolean
  readonly todayTotalSec: number
  readonly actionName: string | null
  readonly elapsedSec: number
}

export type TrayActionItem = {
  readonly id: number
  readonly name: string
}

export type TrayActions = {
  showWindow(): void
  toggleTimer(): void
  startAction(actionId: number): void
  openSettings(): void
  openDataDir(): void
  toggleSound(): void
  toggleStartAtLogin(): void
  quit(): void
}

export type TrayRuntime = {
  refresh(): void
  dispose(): void
}

export type TrayDeps = {
  readonly appName: string
  readonly actions: TrayActions
  readonly getSnapshot: () => TraySnapshot
  readonly getActions: () => readonly TrayActionItem[]
  readonly getSettings: () => AppSettings
  readonly logger: Logger
}

const REFRESH_INTERVAL_MS = 5_000

export function createTrayRuntime(deps: TrayDeps): TrayRuntime | null {
  try {
    const tray = new Tray(createTrayIcon(false))
    tray.on('click', deps.actions.showWindow)
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu(deps)))

    function refresh(): void {
      const snapshot = deps.getSnapshot()
      tray.setImage(createTrayIcon(snapshot.running))
      tray.setToolTip(buildTooltip(deps.appName, snapshot))
    }

    refresh()
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)

    return {
      refresh,
      dispose: function dispose(): void {
        clearInterval(timer)
        tray.destroy()
      },
    }
  } catch (error) {
    deps.logger.error('托盘初始化失败', error)
    return null
  }
}

// 每次右键现取快照，菜单里的状态与累计始终是最新的
function buildMenu(deps: TrayDeps): Menu {
  const snapshot = deps.getSnapshot()
  const settings = deps.getSettings()
  const actions = deps.getActions().slice(0, 8)
  const template: MenuItemConstructorOptions[] = [
    { label: '显示主窗口', click: deps.actions.showWindow },
    {
      label: '开始计时',
      enabled: !snapshot.running && actions.length > 0,
      submenu: actions.map((action) => ({
        label: action.name,
        click: () => deps.actions.startAction(action.id),
      })),
    },
    {
      label: '结束计时',
      enabled: snapshot.running,
      click: deps.actions.toggleTimer,
    },
    { label: `今日累计 ${formatDuration(snapshot.todayTotalSec)}`, enabled: false },
    { type: 'separator' },
    { label: '打开设置', click: deps.actions.openSettings },
    {
      label: '提醒声音',
      type: 'checkbox',
      checked: settings.soundEnabled,
      click: deps.actions.toggleSound,
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: deps.actions.toggleStartAtLogin,
    },
    { label: '打开数据目录', click: deps.actions.openDataDir },
    { type: 'separator' },
    { label: `退出 ${deps.appName}`, click: deps.actions.quit },
  ]
  return Menu.buildFromTemplate(template)
}

function buildTooltip(appName: string, snapshot: TraySnapshot): string {
  if (!snapshot.running) {
    return `${appName} · 今日 ${formatDuration(snapshot.todayTotalSec)}`
  }
  const name = snapshot.actionName ?? '计时中'
  return `${appName} · 计时中 · ${name} · ${formatDuration(snapshot.elapsedSec)}`
}

// 用原始位图绘制 16×16 表盘，空闲为青蓝描边，计时中为品牌蓝实心点
function createTrayIcon(running: boolean): NativeImage {
  const size = 16
  const buffer = Buffer.alloc(size * size * 4)
  const color = running ? { r: 26, g: 159, b: 253 } : { r: 63, g: 127, b: 161 }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - 7.5
      const dy = y - 7.5
      const distance = Math.hypot(dx, dy)
      const inRing = distance <= 6.6 && distance >= 5.2
      const inDot = running && distance <= 3.2
      if (!inRing && !inDot) {
        continue
      }
      const index = (y * size + x) * 4
      // BGRA（Electron createFromBitmap 在 Windows 上按 BGRA 解释）
      buffer[index] = color.b
      buffer[index + 1] = color.g
      buffer[index + 2] = color.r
      buffer[index + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size })
}
