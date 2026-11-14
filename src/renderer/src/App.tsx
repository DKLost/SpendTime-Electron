import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { formatDuration, totalDurationSec } from '@core/summary'
import { findNextPlan } from '@core/next-plan'
import type { AlarmFireDto } from '@shared/contracts'
import type { LocalDate } from '@core/types'
import { ActionPanel } from './features/actions/ActionPanel'
import { AlarmBanner } from './features/alarms/AlarmBanner'
import { RingtoneAudioHost } from './audio/RingtoneAudioHost'
import { ClockPanel } from './features/clock/ClockPanel'
import { PlanPanel } from './features/plans/PlanPanel'
import { RecordList } from './features/records/RecordList'
import { playRingtoneLoop, stopRingtone } from './features/ringtones/play-ringtone'
import { SettingsModal } from './features/settings/SettingsModal'
import { StatsPanel } from './features/stats/StatsPanel'
import { TimerFinishedBanner } from './features/timer/TimerFinishedBanner'
import { TimerPanel } from './features/timer/TimerPanel'
import { TodoPanel } from './features/todos/TodoPanel'
import { subscribeEvent } from './api'
import { useActions } from './state/use-actions'
import { useAlarms } from './state/use-alarms'
import { useClock } from './state/use-clock'
import { useDayRecords } from './state/use-day-records'
import { useRingtoneEvents } from './state/use-ringtone-events'
import { useRingtones } from './state/use-ringtones'
import { resolveRingtone } from './state/ringtone-types'
import { applyDensity, applyDocumentLocale, applySlotTint, useSettings } from './state/use-settings'
import { useStats } from './state/use-stats'
import { useTimerController } from './state/use-timer-controller'
import { useTimerFinished, type FinishedTimer } from './state/use-timer-finished'
import { useTheme } from './state/use-theme'
import { useTodayLocalDate } from './state/use-today'
import { useTodos } from './state/use-todos'
import { useWeekPlans } from './state/use-week-plans'
import { THEMES, type ThemeId, type ThemeOption } from './theme'
import { DEFAULT_LOCALE, setLocale, t } from './translation'

const LEFT_WIDTH_KEY = 'spendtime.layout.leftWidth'
const DEFAULT_LEFT_WIDTH = 360
const MIN_LEFT_WIDTH = 260
const MAX_LEFT_WIDTH = 640

function loadLeftWidth(): number {
  const stored = Number(window.localStorage.getItem(LEFT_WIDTH_KEY))
  if (!Number.isFinite(stored) || stored <= 0) {
    return DEFAULT_LEFT_WIDTH
  }
  return clampLeftWidth(stored)
}

function clampLeftWidth(width: number): number {
  return Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, width))
}

export function App() {
  const actionsState = useActions()
  const plansState = useWeekPlans()
  const todosState = useTodos()
  const ringtonesState = useRingtones()
  const settingsState = useSettings()
  const alarmsState = useAlarms({ playStart: playActionStartRingtone, stopStart: stopRingtone })
  const controller = useTimerController()
  const finishedState = useTimerFinished(actionsState.actions)
  const ringtoneSettings = useMemo(
    () => ({
      defaultStart: ringtonesState.defaultStart,
      defaultEnd: ringtonesState.defaultEnd,
      soundEnabled: settingsState.snapshot?.settings.soundEnabled ?? true,
      custom: ringtonesState.custom.map((ringtone) => ({
        id: ringtone.id,
        fileName: ringtone.fileName,
        clipStartSec: ringtone.clipStartSec,
        clipEndSec: ringtone.clipEndSec,
      })),
    }),
    [
      ringtonesState.defaultStart,
      ringtonesState.defaultEnd,
      ringtonesState.custom,
      settingsState.snapshot?.settings.soundEnabled,
    ],
  )
  const ringtoneEvents = useRingtoneEvents(
    controller.snapshot,
    actionsState.actions,
    ringtoneSettings,
  )
  const today = useTodayLocalDate()
  // null 表示跟随今天；翻到其它日期时才记录覆盖值，跨零点后仍能自动回到新的今天
  const [dateOverride, setDateOverride] = useState<LocalDate | null>(null)
  const selectedDate = dateOverride ?? today
  const recordsState = useDayRecords(selectedDate)
  const statsState = useStats(today)
  const now = useClock()
  // 外壳传入当前时间与本机本地偏移，core 只做纯计算
  const nextPlan = findNextPlan(plansState.plans, now, -new Date(now).getTimezoneOffset())
  const themeState = useTheme()
  // 语言源与设置一致；渲染子组件前同步到翻译层，切换后整棵树立即换词
  const locale = settingsState.snapshot?.settings.locale ?? DEFAULT_LOCALE
  setLocale(locale)
  const totalSec = totalDurationSec(recordsState.records)
  const [leftWidth, setLeftWidth] = useState(loadLeftWidth)
  const [resizing, setResizing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [highlightedPlanId, setHighlightedPlanId] = useState<number | null>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(function persistLeftWidth() {
    window.localStorage.setItem(LEFT_WIDTH_KEY, String(leftWidth))
  }, [leftWidth])

  useEffect(
    function applyDensityFromSettings() {
      applyDensity(settingsState.snapshot?.settings)
    },
    [settingsState.snapshot?.settings],
  )

  useEffect(
    function applySlotTintFromSettings() {
      applySlotTint(settingsState.snapshot?.settings)
    },
    [settingsState.snapshot?.settings],
  )

  useEffect(
    function applyLocaleFromSettings() {
      applyDocumentLocale(settingsState.snapshot?.settings)
    },
    [settingsState.snapshot?.settings],
  )

  useEffect(function subscribeOpenSettings() {
    return subscribeEvent('ui.openSettings', function handleOpen(): void {
      setSettingsOpen(true)
    })
  }, [])

  useEffect(function subscribeAlarmFocus() {
    let timer: number | null = null
    const unsubscribe = subscribeEvent('alarm.focus', function handleFocus(payload): void {
      setHighlightedPlanId(payload.planId)
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      timer = window.setTimeout(() => setHighlightedPlanId(null), 2_000)
    })
    return function cleanup(): void {
      unsubscribe()
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [])

  function handleDividerPointerDown(event: PointerEvent<HTMLDivElement>): void {
    dragRef.current = { startX: event.clientX, startWidth: leftWidth }
    setResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleDividerPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (drag === null) {
      return
    }
    setLeftWidth(clampLeftWidth(drag.startWidth + event.clientX - drag.startX))
  }

  function handleDividerPointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (dragRef.current === null) {
      return
    }
    dragRef.current = null
    setResizing(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleDividerKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? -16 : 16
    setLeftWidth((width) => clampLeftWidth(width + delta))
  }

  // 计划提醒到点时循环播放，直到确认提醒卡或达到设置上限；关闭提醒的计划不会进入 fires
  function playActionStartRingtone(actionId: number): void {
    if (settingsState.snapshot?.settings.soundEnabled === false) {
      return
    }
    const action = actionsState.actions.find((item) => item.id === actionId)
    const ringtoneId = resolveRingtone(action?.startRingtone ?? null, ringtonesState.defaultStart)
    if (ringtoneId === null) {
      return
    }
    playRingtoneLoop(
      ringtoneId,
      ringtonesState.custom.map((ringtone) => ({
        id: ringtone.id,
        fileName: ringtone.fileName,
        clipStartSec: ringtone.clipStartSec,
        clipEndSec: ringtone.clipEndSec,
      })),
      settingsState.snapshot?.settings.alarmLoopMaxSec ?? 120,
    )
  }

  function handleRestartFinished(finished: FinishedTimer): void {
    const action = actionsState.actions.find((item) => item.id === finished.actionId)
    void controller.start(finished.actionId, action?.timerTargetSec ?? null).then((error) => {
      if (error === null) {
        finishedState.clear()
      }
    })
  }

  async function handleAlarmStart(alarm: AlarmFireDto): Promise<void> {
    // 提醒本身已经响过开始铃声，这里从卡片启动计时时不重复播放
    ringtoneEvents.suppressNextStart()
    const error = await controller.start(alarm.actionId, alarm.targetSec)
    if (error !== null) {
      ringtoneEvents.cancelStartSuppression()
      return
    }
    alarmsState.dismiss(alarm.planId)
  }

  function handleThemeChange(event: ChangeEvent<HTMLSelectElement>): void {
    themeState.setTheme(event.target.value as ThemeId)
  }

  function handleSelectDate(next: LocalDate): void {
    setDateOverride(next === today ? null : next)
  }

  function renderThemeOption(option: ThemeOption) {
    return (
      <option key={option.id} value={option.id}>
        {t(option.labelKey)}
      </option>
    )
  }

  return (
    <div className={resizing ? 'app is-resizing' : 'app'}>
      <RingtoneAudioHost />
      <header className="app-header">
        <div>
          <h1 className="app-title">SpendTime</h1>
          <p className="app-subtitle">{t('app.subtitle')}</p>
        </div>
        <div className="app-header-right">
          <button type="button" className="ghost settings-trigger" onClick={() => setSettingsOpen(true)}>
            {t('settings.open')}
          </button>
          <label className="theme-picker">
            <span className="label">{t('app.theme')}</span>
            <select value={themeState.theme} onChange={handleThemeChange} aria-label={t('app.theme')}>
              {THEMES.map(renderThemeOption)}
            </select>
          </label>
          <div className="app-total">
            <span className="label">
              {selectedDate === today ? t('app.todayTotal') : t('app.selectedTotal')}
            </span>
            <strong className="mono">{formatDuration(totalSec)}</strong>
          </div>
        </div>
      </header>

      <AlarmBanner
        alarms={alarmsState.alarms}
        highlightedPlanId={highlightedPlanId}
        onStart={handleAlarmStart}
        onDismiss={alarmsState.dismiss}
        onDismissAll={alarmsState.dismissAll}
      />

      <TimerFinishedBanner
        finished={finishedState.finished}
        onRestart={handleRestartFinished}
        onDismiss={finishedState.clear}
      />

      <main className="app-main">
        <div className="column column-scroll" style={{ width: leftWidth }}>
          <TimerPanel
            actions={actionsState.actions}
            controller={controller}
            rememberTarget={actionsState.setTimerTarget}
          />
          <PlanPanel
            actions={actionsState.actions}
            state={plansState}
            nextPlanId={nextPlan?.plan.id ?? null}
            today={today}
          />
          <TodoPanel state={todosState} />
          <ActionPanel state={actionsState} />
        </div>
        <div
          className="column-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('app.resizeColumns')}
          aria-valuemin={MIN_LEFT_WIDTH}
          aria-valuemax={MAX_LEFT_WIDTH}
          aria-valuenow={leftWidth}
          tabIndex={0}
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onPointerCancel={handleDividerPointerUp}
          onKeyDown={handleDividerKeyDown}
        />
        <div className="column column-grow">
          <ClockPanel nowMs={now} next={nextPlan} />
          <StatsPanel state={statsState} />
          <RecordList
            date={selectedDate}
            today={today}
            records={recordsState.records}
            loading={recordsState.loading}
            onSelectDate={handleSelectDate}
            onUpdate={recordsState.updateRecord}
            onRemove={recordsState.removeRecord}
          />
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settingsState}
        actions={actionsState.actions}
        ringtones={ringtonesState}
      />
    </div>
  )
}
