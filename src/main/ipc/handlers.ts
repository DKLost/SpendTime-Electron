import type {
  ActionRepo,
  BackupService,
  Clock,
  CustomRingtoneRepo,
  DataPort,
  DataTransferPort,
  Logger,
  PlanRepo,
  RecordRepo,
  RingtoneFilePort,
  SessionStore,
  SettingsEffects,
  SettingsRepo,
  TodoRepo,
  UnitOfWork,
} from '@application/ports'
import {
  archiveAction,
  createAction,
  deleteAction,
  renameAction,
  reorderAction,
  restoreAction,
  setActionTimerTarget,
} from '@application/use-cases/actions'
import {
  copyWeekday,
  createPlan,
  listWeek,
  removePlan,
  setPlanAlarm,
  updatePlan,
} from '@application/use-cases/plans'
import { removeRecord, updateRecord } from '@application/use-cases/records'
import { getRingtoneConfig, setActionRingtone, setDefaultRingtone } from '@application/use-cases/ringtones'
import {
  cancelCustomRingtone,
  commitCustomRingtone,
  listCustomRingtones,
  pickCustomRingtone,
  removeCustomRingtone,
  renameCustomRingtone,
  updateCustomRingtoneClip,
} from '@application/use-cases/custom-ringtones'
import { loadSettings, updateSettings } from '@application/use-cases/settings'
import {
  exportData,
  exportRecordsCsv,
  importData,
  inspectImport,
} from '@application/use-cases/data-transfer'
import {
  archiveTodo,
  createTodo,
  deleteTodo,
  listArchivedTodos,
  reorderTodo,
  restoreTodo,
  toggleTodo,
  updateTodo,
} from '@application/use-cases/todos'
import { buildStats } from '@core/stats'
import type { Weekday } from '@core/types'
import {
  type CommandChannel,
  type CommandRequest,
  type CommandResponse,
  type AlarmFireDto,
  type SettingsDto,
} from '@shared/contracts'
import type { TimerRuntime } from '../runtime/timer-runtime'
import { createErrorReporter } from '../runtime/error-report'
import { fromResult } from './result-mapping'

export type AppInfo = {
  readonly version: string
  readonly dataDir: string
  readonly logDir: string
  readonly isDev: boolean
}

export type DataScope = 'actions' | 'records' | 'plans' | 'todos'

export type HandlerDeps = {
  readonly runtime: TimerRuntime
  readonly actions: ActionRepo
  readonly plans: PlanRepo
  readonly todos: TodoRepo
  readonly records: RecordRepo
  readonly sessions: SessionStore
  readonly settings: SettingsRepo
  readonly settingsEffects: SettingsEffects
  readonly customRingtones: CustomRingtoneRepo
  readonly ringtoneFiles: RingtoneFilePort
  readonly dataPort: DataPort
  readonly dataTransfer: DataTransferPort
  readonly backupService: BackupService
  readonly backupDir: string
  readonly unitOfWork: UnitOfWork
  readonly clock: Clock
  readonly logger: Logger
  readonly appInfo: AppInfo
  // 数据变更通知由外壳注入，handlers 不直接依赖 Electron
  readonly publishDataChanged: (scope: DataScope) => void
  readonly publishSettingsChanged: (settings: SettingsDto) => void
  // 取出渲染层尚未收到的提醒，避免启动瞬间的补发事件因页面未就绪而丢失
  readonly takePendingAlarms: () => readonly AlarmFireDto[]
  readonly openPath: (path: string) => boolean
  readonly exportDiagnostics: () => string | null
  readonly crashDir: string
}

// 每个通道一个处理函数，签名由契约推导，缺通道会在这里报错
// 只有文件选择通道是异步的，其余保持同步，测试与调用方不必全量 await
type AsyncChannel = 'ringtones.import' | 'data.export' | 'data.inspectImport' | 'stats.exportCsv'

type HandlerResult<C extends CommandChannel> = C extends AsyncChannel
  ? Promise<CommandResponse<C>>
  : CommandResponse<C>

export type CommandHandlers = {
  [C in CommandChannel]: (request: CommandRequest<C>) => HandlerResult<C>
}

export function createCommandHandlers(deps: HandlerDeps): CommandHandlers {
  const {
    runtime,
    actions,
    plans,
    todos,
    records,
    sessions,
    settings,
    settingsEffects,
    customRingtones,
    ringtoneFiles,
    dataPort,
    dataTransfer,
    backupService,
    backupDir,
    unitOfWork,
    clock,
    logger,
  } = deps
  const reportRendererError = createErrorReporter({ logger, now: () => clock.now() })

  function publishDataChanged(scope: DataScope): void {
    deps.publishDataChanged(scope)
  }

  return {
    'app.bootstrap': () => ({
      ok: true,
      value: {
        appVersion: deps.appInfo.version,
        dataDir: deps.appInfo.dataDir,
        isDev: deps.appInfo.isDev,
        timer: runtime.snapshot(),
        actions: [...actions.list(true)],
      },
    }),

    'app.reportError': (request) => ({
      ok: true,
      value: reportRendererError({
        message: request.message,
        stack: request.stack,
        source: request.source,
      }),
    }),

    'actions.list': (request) => ({
      ok: true,
      value: [...actions.list(request.includeArchived ?? false)],
    }),

    'actions.create': (request) => {
      const result = createAction(actions, request.name, clock.now())
      if (result.ok) {
        publishDataChanged('actions')
      }
      return fromResult(result)
    },

    'actions.rename': (request) => {
      const result = renameAction(actions, request.actionId, request.name)
      if (result.ok) {
        publishDataChanged('actions')
      }
      return fromResult(result)
    },

    'actions.archive': (request) => {
      const result = archiveAction(actions, plans, records, request.actionId, clock.now())
      if (result.ok) {
        publishDataChanged('actions')
      }
      return fromResult(result)
    },

    'actions.restore': (request) => {
      const result = restoreAction(actions, request.actionId)
      if (result.ok) {
        publishDataChanged('actions')
      }
      return fromResult(result)
    },

    'actions.remove': (request) => {
      const runningActionId = runtime.snapshot().actionId
      const result = deleteAction(
        actions,
        plans,
        records,
        sessions,
        unitOfWork,
        request.actionId,
        runningActionId,
      )
      if (result.ok) {
        publishDataChanged('actions')
        publishDataChanged('plans')
        publishDataChanged('records')
      }
      return fromResult(result)
    },

    'actions.setTimerTarget': (request) => {
      const result = setActionTimerTarget(actions, request.actionId, request.targetSec)
      if (result.ok) {
        publishDataChanged('actions')
      }
      return fromResult(result)
    },

    'actions.reorder': (request) => {
      const result = reorderAction(actions, request.actionId, request.direction)
      if (!result.ok) {
        return fromResult(result)
      }
      publishDataChanged('actions')
      return { ok: true, value: [...result.value] }
    },

    'alarms.pending': () => ({ ok: true, value: { fires: [...deps.takePendingAlarms()] } }),

    'settings.get': () => ({
      ok: true,
      value: {
        settings: loadSettings(settings),
        dataDir: deps.appInfo.dataDir,
        logDir: deps.appInfo.logDir,
        appVersion: deps.appInfo.version,
      },
    }),

    'settings.update': (request) => {
      const result = updateSettings(settings, settingsEffects, request.patch)
      if (result.ok) {
        deps.publishSettingsChanged(result.value)
      }
      return fromResult(result)
    },

    'app.openDataDir': () => ({ ok: true, value: { opened: deps.openPath(deps.appInfo.dataDir) } }),

    'app.openLogDir': () => ({ ok: true, value: { opened: deps.openPath(deps.appInfo.logDir) } }),

    'app.exportDiagnostics': () => {
      const path = deps.exportDiagnostics()
      return { ok: true, value: { exported: path !== null, path } }
    },

    'app.openCrashDir': () => ({ ok: true, value: { opened: deps.openPath(deps.crashDir) } }),

    'ringtones.get': () => ({ ok: true, value: getRingtoneConfig(settings) }),

    'ringtones.list': () => ({
      ok: true,
      value: {
        custom: [...listCustomRingtones(customRingtones, actions, settings)],
        ...getRingtoneConfig(settings),
      },
    }),

    'ringtones.import': async () => {
      const result = await pickCustomRingtone(ringtoneFiles)
      return fromResult(result)
    },

    'ringtones.commitImport': (request) =>
      fromResult(
        commitCustomRingtone(customRingtones, ringtoneFiles, actions, settings, clock, {
          token: request.token,
          startSec: request.startSec,
          endSec: request.endSec,
        }),
      ),

    'ringtones.cancelImport': (request) => ({
      ok: true,
      value: cancelCustomRingtone(ringtoneFiles, request.token),
    }),

    'ringtones.rename': (request) =>
      fromResult(
        renameCustomRingtone(
          customRingtones,
          actions,
          settings,
          request.ringtoneId,
          request.name,
        ),
      ),

    'ringtones.updateClip': (request) =>
      fromResult(
        updateCustomRingtoneClip(
          customRingtones,
          actions,
          settings,
          request.ringtoneId,
          request.startSec,
          request.endSec,
        ),
      ),

    'ringtones.remove': (request) => {
      const result = removeCustomRingtone(
        customRingtones,
        ringtoneFiles,
        actions,
        settings,
        request.ringtoneId,
      )
      if (result.ok) {
        publishDataChanged('actions')
      }
      return fromResult(result)
    },

    'ringtones.setDefault': (request) => {
      const result = setDefaultRingtone(settings, request.kind, request.value, customRingtones)
      if (result.ok) {
        deps.publishSettingsChanged(loadSettings(settings))
      }
      return fromResult(result)
    },

    'ringtones.setAction': (request) => {
      const result = setActionRingtone(
        actions,
        request.actionId,
        request.kind,
        request.value,
        customRingtones,
      )
      if (result.ok) {
        publishDataChanged('actions')
      }
      return fromResult(result)
    },

    'timer.start': (request) =>
      fromResult(runtime.start({ actionId: request.actionId, targetSec: request.targetSec ?? null })),

    'timer.stop': () => fromResult(runtime.stop()),

    'timer.getState': () => ({ ok: true, value: runtime.snapshot() }),

    'records.listByDate': (request) => ({
      ok: true,
      value: [...records.listByDate(request.date)],
    }),

    'records.update': (request) => {
      const result = updateRecord(
        records,
        request.recordId,
        { startAt: request.startAt, endAt: request.endAt },
        clock.offsetMinutes(),
      )
      if (result.ok) {
        publishDataChanged('records')
      }
      return fromResult(result)
    },

    'records.remove': (request) => {
      const result = removeRecord(records, request.recordId)
      if (result.ok) {
        publishDataChanged('records')
      }
      return fromResult(result)
    },

    'records.totalsByAction': () => ({
      ok: true,
      value: records.totalsByAction().map((total) => ({ ...total })),
    }),

    'stats.overview': (request) => {
      const overview = buildStats(records.listRange(request.from, request.to))
      return {
        ok: true,
        value: {
          ...overview,
          byAction: [...overview.byAction],
        },
      }
    },

    'stats.bounds': () => {
      const range = records.bounds()
      return { ok: true, value: { from: range.from, to: range.to } }
    },

    'stats.exportCsv': async (request) =>
      fromResult(
        await exportRecordsCsv(
          records.listRange(request.from, request.to),
          dataTransfer,
          new Date(clock.now()),
        ),
      ),

    'data.export': async () =>
      fromResult(
        await exportData(dataPort, dataTransfer, deps.appInfo.version, clock.now()),
      ),

    'data.inspectImport': async () => {
      const result = await inspectImport(dataTransfer)
      if (!result.ok) {
        return fromResult(result)
      }
      if (result.value.canceled) {
        return { ok: true, value: { canceled: true, token: null, counts: null, warnings: [] } }
      }
      return {
        ok: true,
        value: {
          canceled: false,
          token: result.value.token,
          counts: { ...result.value.counts },
          warnings: [...result.value.warnings],
        },
      }
    },

    'data.import': (request) => {
      const result = importData(dataPort, backupService, dataTransfer, request.token)
      if (result.ok) {
        for (const scope of ['actions', 'records', 'plans', 'todos'] as const) {
          deps.publishDataChanged(scope)
        }
      }
      return fromResult(result)
    },

    'backup.list': () => ({
      ok: true,
      value: { backups: [...backupService.list()], dir: backupDir },
    }),

    'backup.create': () => {
      const entry = backupService.create()
      return { ok: true, value: { created: entry !== null, entry } }
    },

    'backup.openDir': () => ({ ok: true, value: { opened: backupService.openDir() } }),

    'backup.restore': (request) => fromResult(backupService.restore(request.name)),

    'plans.listWeek': () => ({ ok: true, value: [...listWeek(plans)] }),

    'plans.create': (request) => {
      // 请求已由 Zod 限制在 1..7，这里的断言只用于把 number 收窄成领域类型
      const result = createPlan(
        plans,
        actions,
        {
          weekday: request.weekday as Weekday,
          startMin: request.startMin,
          endMin: request.endMin,
          actionId: request.actionId,
          alarmEnabled: request.alarmEnabled ?? true,
        },
        clock.now(),
      )
      if (result.ok) {
        publishDataChanged('plans')
      }
      return fromResult(result)
    },

    'plans.remove': (request) => {
      const result = removePlan(plans, request.planId)
      if (result.ok) {
        publishDataChanged('plans')
      }
      return fromResult(result)
    },

    'plans.update': (request) => {
      const result = updatePlan(plans, actions, {
        planId: request.planId,
        weekday: request.weekday as Weekday,
        startMin: request.startMin,
        endMin: request.endMin,
        actionId: request.actionId,
        alarmEnabled: request.alarmEnabled ?? true,
      })
      if (result.ok) {
        publishDataChanged('plans')
      }
      return fromResult(result)
    },

    'plans.setAlarm': (request) => {
      const result = setPlanAlarm(plans, request.planId, request.enabled)
      if (result.ok) {
        publishDataChanged('plans')
      }
      return fromResult(result)
    },

    'plans.copyWeekday': (request) => {
      const result = copyWeekday(
        plans,
        unitOfWork,
        request.from as Weekday,
        request.to as Weekday,
        clock.now(),
      )
      if (result.ok) {
        publishDataChanged('plans')
      }
      return fromResult(result)
    },

    'todos.list': () => ({ ok: true, value: [...todos.listActive()] }),

    'todos.listArchived': () => ({ ok: true, value: [...listArchivedTodos(todos)] }),

    'todos.create': (request) => {
      const result = createTodo(todos, request.title, clock.now())
      if (result.ok) {
        publishDataChanged('todos')
      }
      return fromResult(result)
    },

    'todos.toggle': (request) => {
      const result = toggleTodo(todos, request.todoId, clock.now())
      if (result.ok) {
        publishDataChanged('todos')
      }
      return fromResult(result)
    },

    'todos.update': (request) => {
      const result = updateTodo(todos, request.todoId, request.title)
      if (result.ok) {
        publishDataChanged('todos')
      }
      return fromResult(result)
    },

    'todos.remove': (request) => {
      const result = deleteTodo(todos, request.todoId)
      if (result.ok) {
        publishDataChanged('todos')
      }
      return fromResult(result)
    },

    'todos.archive': (request) => {
      const result = archiveTodo(todos, request.todoId, clock.now())
      if (result.ok) {
        publishDataChanged('todos')
      }
      return fromResult(result)
    },

    'todos.restore': (request) => {
      const result = restoreTodo(todos, request.todoId)
      if (result.ok) {
        publishDataChanged('todos')
      }
      return fromResult(result)
    },

    'todos.reorder': (request) => {
      const result = reorderTodo(todos, unitOfWork, request.todoId, request.direction)
      if (!result.ok) {
        return fromResult(result)
      }
      publishDataChanged('todos')
      return { ok: true, value: [...result.value] }
    },
  }
}

export type DispatchedHandler = (
  request: unknown,
) => CommandResponse<CommandChannel> | Promise<CommandResponse<CommandChannel>>

// 接线层按通道名调用，不再关心具体泛型
export function toDispatcher(
  handlers: CommandHandlers,
): Readonly<Record<CommandChannel, DispatchedHandler>> {
  return handlers as unknown as Readonly<Record<CommandChannel, DispatchedHandler>>
}
