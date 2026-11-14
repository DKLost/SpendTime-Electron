import { app, BrowserWindow, crashReporter, Notification, powerMonitor, screen, session, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AlarmFire } from '@core/alarm'
import { formatMinute } from '@core/plan'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@core/settings'
import { toLocalDate } from '@core/time'
import type { SettingsEffects } from '@application/ports'
import { loadSettings, updateSettings } from '@application/use-cases/settings'
import { createDiagnosticsService } from './adapters/diagnostics'
import { APP_NAME, APP_USER_MODEL_ID, DEV_APP_NAME } from './config/defaults'
import { composeApp, type AppContainer } from './composition'
import { createCommandHandlers, toDispatcher } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { broadcast } from './runtime/broadcast'
import { createAlarmRuntime, type AlarmRuntime } from './runtime/alarm-runtime'
import { registerAudioProtocol, registerAudioScheme } from './runtime/audio-protocol'
import { createShortcutController, type ShortcutController } from './runtime/global-shortcut'
import { createSettingsEffects } from './runtime/settings-effects'
import { createTrayRuntime, type TrayRuntime, type TraySnapshot } from './runtime/tray'
import {
  attachWindowStatePersistence,
  loadWindowState,
  reclampWindow,
} from './runtime/window-state'

// electron-vite dev 会注入 ELECTRON_RENDERER_URL；仅靠 isPackaged 判断在该环境下不可靠
const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined || !app.isPackaged
const appName = isDev ? DEV_APP_NAME : APP_NAME

// 显式接管 userData：先建目录再交给 Electron，避免默认路径无法创建时 Chromium 直接崩溃。
// 开发态落在仓库内的 .devdata，避免测试数据写进用户配置目录；SPENDTIME_DATA_DIR 供 E2E 覆盖。
const dataRoot =
  process.env['SPENDTIME_DATA_DIR'] ??
  (isDev ? join(process.cwd(), '.devdata') : join(app.getPath('appData'), appName))
mkdirSync(dataRoot, { recursive: true })
app.setPath('userData', dataRoot)
app.setName(appName)
app.setAppUserModelId(APP_USER_MODEL_ID)

// 崩溃日志只落本地，不上传；目录固定便于「打开崩溃目录」
const crashDir = join(dataRoot, 'crashes')
mkdirSync(crashDir, { recursive: true })
try {
  app.setPath('crashDumps', crashDir)
  crashReporter.start({ uploadToServer: false, compress: false })
} catch (error) {
  console.error('初始化崩溃日志失败', error)
}

let container: AppContainer | null = null
let mainWindow: BrowserWindow | null = null
let alarmRuntime: AlarmRuntime | null = null
let trayRuntime: TrayRuntime | null = null
let shortcutController: ShortcutController | null = null
let settingsEffectsRef: SettingsEffects | null = null
let disposeWindowState: (() => void) | null = null
let startMaximized = false
let isQuitting = false
// 页面挂载前触发的提醒事件会丢失，先缓存到渲染层首次补拉
let pendingAlarmFires: readonly AlarmFire[] = []
let alarmFiresPulled = false

// 开机自启由托盘写入 --hidden，启动时不抢焦点
const startHidden = process.argv.includes('--hidden')

// 自定义协议必须在 ready 前声明
registerAudioScheme()

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  app.whenReady().then(bootstrap)
  app.on('window-all-closed', quitApp)
  app.on('before-quit', beginQuit)
}

function bootstrap(): void {
  const builtinRingtoneDir = isDev
    ? join(app.getAppPath(), 'resources/ringtones')
    : join(process.resourcesPath, 'ringtones')
  container = composeApp({
    dataDir: dataRoot,
    isDev,
    builtinRingtoneDir,
    // 恢复备份后先关闭数据库再重启，避免运行中替换文件
    onRestart: () => {
      container?.dispose()
      app.relaunch()
      app.exit(0)
    },
  })
  const appContainer = container
  const initialSettings = loadSettings(appContainer.settings)
  shortcutController = createShortcutController(toggleTimer, appContainer.logger)
  if (!shortcutController.apply(initialSettings.shortcut)) {
    appContainer.logger.error('初始全局快捷键注册失败，可在设置中更换')
  }
  const settingsEffects = createSettingsEffects({ shortcuts: shortcutController })
  settingsEffectsRef = settingsEffects
  const diagnostics = createDiagnosticsService({
    dataDir: dataRoot,
    logDir: appContainer.logDir,
    appVersion: app.getVersion(),
    getSettings: () => loadSettings(appContainer.settings),
    counts: () => appContainer.dataPort.counts(),
    logger: appContainer.logger,
  })

  registerAudioProtocol(appContainer.ringtoneDir, (message, error) =>
    appContainer.logger.error(message, error),
  )
  applyContentSecurityPolicy()
  mainWindow = createMainWindow()

  registerIpcHandlers({
    handlers: toDispatcher(
      createCommandHandlers({
        runtime: appContainer.timer,
        actions: appContainer.actions,
        plans: appContainer.plans,
        todos: appContainer.todos,
        records: appContainer.records,
        sessions: appContainer.sessions,
        settings: appContainer.settings,
        settingsEffects,
        customRingtones: appContainer.customRingtones,
        ringtoneFiles: appContainer.ringtoneFiles,
        dataPort: appContainer.dataPort,
        dataTransfer: appContainer.dataTransfer,
        backupService: appContainer.backupService,
        backupDir: appContainer.backupDir,
        unitOfWork: appContainer.unitOfWork,
        clock: appContainer.clock,
        logger: appContainer.logger,
        appInfo: {
          version: app.getVersion(),
          dataDir: appContainer.dataDir,
          logDir: appContainer.logDir,
          isDev,
        },
        publishDataChanged: publishDataChanged,
        publishSettingsChanged: publishSettingsChanged,
        takePendingAlarms: takePendingAlarmFires,
        openPath: openPath,
        exportDiagnostics: diagnostics.exportNow,
        crashDir: diagnostics.crashDir,
      }),
    ),
    logger: appContainer.logger,
    isTrustedSender: isFromMainWindow,
  })

  alarmRuntime = createAlarmRuntime({
    plans: appContainer.plans,
    alarmEvents: appContainer.alarmEvents,
    clock: appContainer.clock,
    logger: appContainer.logger,
    onFired: publishAlarmFires,
  })
  alarmRuntime.start()
  powerMonitor.on('resume', checkAlarms)

  trayRuntime = createTrayRuntime({
    appName,
    actions: {
      showWindow: focusMainWindow,
      toggleTimer,
      quit: quitFromTray,
      openSettings: openSettings,
      openDataDir: () => openPath(appContainer.dataDir),
      toggleSound: () => setSoundEnabled(!loadSettings(appContainer.settings).soundEnabled),
      toggleStartAtLogin: () => setStartAtLogin(!loadSettings(appContainer.settings).startAtLogin),
      startAction: startActionTimer,
    },
    getSnapshot: readTraySnapshot,
    getActions: () => appContainer.actions.list(false).map((action) => ({ id: action.id, name: action.name })),
    getSettings: () => loadSettings(appContainer.settings),
    logger: appContainer.logger,
  })

  screen.on('display-added', reapplyWindowBounds)
  screen.on('display-removed', reapplyWindowBounds)
  screen.on('display-metrics-changed', reapplyWindowBounds)

  appContainer.timer.restore()
}

function createMainWindow(): BrowserWindow {
  const saved = container === null ? null : loadWindowState(container.settings)
  startMaximized = saved?.maximized ?? false
  const win = new BrowserWindow({
    x: saved?.bounds.x,
    y: saved?.bounds.y,
    width: saved?.bounds.width ?? 1280,
    height: saved?.bounds.height ?? 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#171d25',
    title: isDev ? `${APP_NAME} Dev` : APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // 隐藏到托盘时仍需按秒计时与播放提醒音
      backgroundThrottling: false,
    },
  })

  if (container !== null) {
    disposeWindowState = attachWindowStatePersistence(win, container.settings, container.logger)
  }

  win.once('ready-to-show', handleReadyToShow)
  win.on('close', handleWindowClose)
  win.on('closed', clearWindowRef)
  win.on('focus', handleWindowFocus)
  win.webContents.setWindowOpenHandler(denyWindowOpen)
  win.webContents.on('will-navigate', preventNavigation)
  win.webContents.on('render-process-gone', reportRendererGone)

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl !== undefined) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function showWindow(): void {
  mainWindow?.show()
}

function handleReadyToShow(): void {
  if (startMaximized) {
    mainWindow?.maximize()
  }
  if (!startHidden) {
    showWindow()
  }
}

// 关闭窗口默认收进托盘；设置改为退出时直接放行
function handleWindowClose(event: Electron.Event): void {
  if (isQuitting || readSettings().closeBehavior === 'quit') {
    return
  }
  event.preventDefault()
  mainWindow?.hide()
}

function clearWindowRef(): void {
  disposeWindowState?.()
  disposeWindowState = null
  mainWindow = null
}

function handleWindowFocus(): void {
  mainWindow?.flashFrame(false)
}

function denyWindowOpen(): { action: 'deny' } {
  return { action: 'deny' }
}

function preventNavigation(event: Electron.Event): void {
  event.preventDefault()
}

function reportRendererGone(_event: Electron.Event, details: Electron.RenderProcessGoneDetails): void {
  container?.logger.error('渲染进程已退出', details)
}

function focusMainWindow(): void {
  if (mainWindow === null) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

// 系统从睡眠恢复后立即补一次检查，不依赖轮询的下一个 30 秒
function checkAlarms(): void {
  alarmRuntime?.check()
}

function publishAlarmFires(fires: readonly AlarmFire[]): void {
  if (!alarmFiresPulled) {
    pendingAlarmFires = [...pendingAlarmFires, ...fires]
  }
  broadcast('alarm.fire', { fires: [...fires] })
  showAlarmNotification(fires)
}

// 首次补拉后页面已完成订阅，后续提醒走广播即可，不必继续累积
function takePendingAlarmFires(): readonly AlarmFire[] {
  alarmFiresPulled = true
  const fires = pendingAlarmFires
  pendingAlarmFires = []
  return fires
}

function publishDataChanged(scope: 'actions' | 'records' | 'plans' | 'todos'): void {
  broadcast('data.changed', { scope })
  // 计划增删改后立即补查一次，避免编辑出的新时段要等到下个分钟边界才生效
  if (scope === 'plans') {
    alarmRuntime?.nudge()
  }
}

function publishSettingsChanged(settings: AppSettings): void {
  broadcast('settings.changed', settings)
}

function readSettings(): AppSettings {
  return container === null ? DEFAULT_SETTINGS : loadSettings(container.settings)
}

function openPath(path: string): boolean {
  if (!existsSync(path)) {
    return false
  }
  void shell.openPath(path)
  return true
}

function openSettings(): void {
  focusMainWindow()
  broadcast('ui.openSettings', {})
}

// 托盘修改的设置与设置页走同一条用例，保证副作用与广播一致
function applySettingsPatch(patch: SettingsPatch): void {
  if (container === null || settingsEffectsRef === null) {
    return
  }
  const result = updateSettings(container.settings, settingsEffectsRef, patch)
  if (!result.ok) {
    container.logger.error(`托盘修改设置失败：${result.error.message}`)
    return
  }
  publishSettingsChanged(result.value)
}

function setSoundEnabled(value: boolean): void {
  applySettingsPatch({ soundEnabled: value })
}

function setStartAtLogin(value: boolean): void {
  applySettingsPatch({ startAtLogin: value })
}

function startActionTimer(actionId: number): void {
  if (container === null) {
    return
  }
  const action = container.actions.findById(actionId)
  if (action === null) {
    return
  }
  container.timer.start({ actionId, targetSec: action.timerTargetSec })
}

function reapplyWindowBounds(): void {
  if (mainWindow !== null) {
    reclampWindow(mainWindow)
  }
}

function showAlarmNotification(fires: readonly AlarmFire[]): void {
  if (fires.length === 0 || !Notification.isSupported()) {
    return
  }
  const first = fires[0]
  const title =
    fires.length === 1 && first !== undefined ? `计划开始 · ${first.actionName}` : `${fires.length} 个计划开始`
  const body = fires.map((fire) => `${formatMinute(fire.startMin)} ${fire.actionName}`).join(' · ')
  const notification = new Notification({ title: `SpendTime · ${title}`, body })
  notification.on('click', () => handleNotificationClick(first?.planId ?? null))
  notification.show()
}

// 通知点击后抢焦点，并让渲染层定位到对应提醒卡
function handleNotificationClick(planId: number | null): void {
  focusMainWindow()
  mainWindow?.flashFrame(true)
  if (planId !== null) {
    broadcast('alarm.focus', { planId })
  }
}

function isFromMainWindow(event: Electron.IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents
}

// 生产环境只允许加载本地构建产物，禁止远程脚本与 eval
function applyContentSecurityPolicy(): void {
  if (isDev) {
    return
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    // wavesurfer 的 WebAudio 后端会把取到的音频转成 blob: 再交给播放器，缺了它波形与试听全部被拦
    "media-src 'self' blob: spendtime-audio:",
    "connect-src 'self' blob: spendtime-audio:",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

function quitApp(): void {
  app.quit()
}

// 托盘与快捷键共用：运行中结束计时，空闲时用第一个可用行动开始
function toggleTimer(): void {
  if (container === null) {
    return
  }
  if (container.timer.snapshot().status === 'running') {
    container.timer.stop()
    return
  }
  const action = container.actions.list(false)[0]
  if (action === undefined) {
    container.logger.error('没有可用行动，无法开始计时')
    return
  }
  container.timer.start({ actionId: action.id, targetSec: null })
}

function readTraySnapshot(): TraySnapshot {
  if (container === null) {
    return { running: false, todayTotalSec: 0, actionName: null, elapsedSec: 0 }
  }
  const today = toLocalDate(container.clock.now(), container.clock.offsetMinutes())
  const totalSec = container.records.listByDate(today).reduce(sumDurationSec, 0)
  const snapshot = container.timer.snapshot()
  const action = snapshot.actionId === null ? null : container.actions.findById(snapshot.actionId)
  return {
    running: snapshot.status === 'running',
    todayTotalSec: totalSec,
    actionName: action?.name ?? null,
    elapsedSec: snapshot.elapsedSec,
  }
}

function sumDurationSec(sum: number, record: { readonly durationSec: number }): number {
  return sum + record.durationSec
}

function quitFromTray(): void {
  isQuitting = true
  app.quit()
}

function beginQuit(): void {
  isQuitting = true
  releaseResources()
}

function releaseResources(): void {
  shortcutController?.dispose()
  shortcutController = null
  settingsEffectsRef = null
  disposeWindowState?.()
  disposeWindowState = null
  trayRuntime?.dispose()
  trayRuntime = null
  alarmRuntime?.dispose()
  alarmRuntime = null
  container?.dispose()
  container = null
}
