import { randomUUID } from 'node:crypto'
import type {
  ActionRepo,
  BackupService,
  Clock,
  CustomRingtoneRepo,
  DataTransferPort,
  IdGen,
  Logger,
  RecordRepo,
  RingtoneFilePort,
  StagedRingtoneFile,
} from '@application/ports'
import { ok } from '@core/result'
import { createDataPort } from '../../src/main/adapters/data-port'
import type { TimerSnapshot } from '@application/use-cases/timer'
import { DEFAULT_TIMER_POLICY } from '@core/timer'
import { openDatabase, type Db } from '../../src/main/adapters/sqlite/database'
import {
  createActionRepo,
  createCustomRingtoneRepo,
  createPlanRepo,
  createRecordRepo,
  createSessionStore,
  createSettingsRepo,
  createTodoRepo,
  createUnitOfWork,
} from '../../src/main/adapters/sqlite/repositories'
import {
  createCommandHandlers,
  type CommandHandlers,
  type DataScope,
  type HandlerDeps,
} from '../../src/main/ipc/handlers'
import { createTimerRuntime, type TimerRuntime } from '../../src/main/runtime/timer-runtime'
import type { AlarmFireDto } from '../../src/shared/contracts'

export const TEST_OFFSET_MINUTES = 480
export const TEST_NOW = Date.UTC(2026, 10, 13, 2, 0)

const silentLogger: Logger = {
  info: (): void => undefined,
  error: (): void => undefined,
}

export type HandlerHarness = {
  readonly db: Db
  readonly handlers: CommandHandlers
  readonly actions: ActionRepo
  readonly records: RecordRepo
  readonly customRingtones: CustomRingtoneRepo
  readonly runtime: TimerRuntime
  readonly clock: Clock & { setNow(next: number): void }
  readonly published: DataScope[]
  readonly logs: { readonly level: 'info' | 'error'; readonly message: string; readonly details?: unknown }[]
  dispose(): void
}

// handlers 测试用内存 SQLite：不依赖 Electron，同时覆盖真实仓储行为
export function createHandlerHarness(): HandlerHarness {
  const db = openDatabase(':memory:', silentLogger)
  const clock = createMutableClock(TEST_NOW)
  const logs: HandlerHarness['logs'][number][] = []
  const logger: Logger = {
    info: (message, details) => {
      logs.push({ level: 'info', message, details })
    },
    error: (message, details) => {
      logs.push({ level: 'error', message, details })
    },
  }

  const actions = createActionRepo(db)
  const plans = createPlanRepo(db)
  const todos = createTodoRepo(db)
  const records = createRecordRepo(db)
  const unitOfWork = createUnitOfWork(db)
  const sessions = createSessionStore(db)
  const settings = createSettingsRepo(db)
  const customRingtones = createCustomRingtoneRepo(db)
  const published: DataScope[] = []
  const staged = new Map<string, StagedRingtoneFile>()
  const ringtoneFiles: RingtoneFilePort = {
    pickFile: async () => null,
    createToken: () => randomUUID(),
    createId: () => randomUUID(),
    stage: async (source, token) => {
      const file: StagedRingtoneFile = {
        token,
        pendingFileName: `pending-${token}.mp3`,
        suggestedName: source.split(/[\\/]/).pop() ?? '自定义铃声',
        durationSec: 5,
        sizeBytes: 1024,
      }
      staged.set(token, file)
      return ok(file)
    },
    findStaged: (token) => staged.get(token) ?? null,
    commit: (token, id) => {
      staged.delete(token)
      return ok({ fileName: `${id}.mp3`, sizeBytes: 1024 })
    },
    discard: (token) => {
      staged.delete(token)
    },
    removeFile: (): void => undefined,
    ensureBuiltins: (): void => undefined,
  }
  const dataPort = createDataPort(db)
  const dataTransfer: DataTransferPort = {
    saveText: async () => 'memory/export.json',
    pickImportFile: async () => null,
    readImportFile: () => null,
  }
  const backupService: BackupService = {
    list: () => [],
    create: () => null,
    openDir: () => true,
    restore: () => ok({ restarting: true }),
  }

  const runtime = createTimerRuntime({
    timer: { clock, ids: createIds(), actions, policy: DEFAULT_TIMER_POLICY },
    effects: {
      sessions,
      records,
      unitOfWork,
      logger: silentLogger,
      notifier: { finished: (): void => undefined },
    },
    publish: (_snapshot: TimerSnapshot): void => undefined,
  })

  const deps: HandlerDeps = {
    runtime,
    actions,
    plans,
    todos,
    records,
    sessions,
    settings,
    settingsEffects: { apply: () => ({ ok: true, value: undefined }) },
    customRingtones,
    ringtoneFiles,
    dataPort,
    dataTransfer,
    backupService,
    backupDir: 'test-backups',
    unitOfWork,
    clock,
    logger,
    appInfo: { version: '0.0.0-test', dataDir: 'test-data', logDir: 'test-logs', isDev: true },
    publishDataChanged: (scope) => {
      published.push(scope)
    },
    publishSettingsChanged: (): void => undefined,
    takePendingAlarms: (): readonly AlarmFireDto[] => [],
    openPath: (): boolean => true,
    exportDiagnostics: (): string | null => null,
    crashDir: 'test-crashes',
  }

  return {
    db,
    handlers: createCommandHandlers(deps),
    actions,
    records,
    customRingtones,
    runtime,
    clock,
    published,
    logs,
    dispose: () => {
      runtime.dispose()
      db.close()
    },
  }
}

function createIds(): IdGen {
  let counter = 0
  return {
    next: () => {
      counter += 1
      return `session-${counter}`
    },
  }
}

function createMutableClock(initial: number): Clock & { setNow(next: number): void } {
  let current = initial
  return {
    now: () => current,
    offsetMinutes: () => TEST_OFFSET_MINUTES,
    setNow: (next) => {
      current = next
    },
  }
}
