import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TimerEffectDeps } from '@application/effects'
import type {
  ActionRepo,
  AlarmEventRepo,
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
  SettingsRepo,
  TodoRepo,
  UnitOfWork,
} from '@application/ports'
import type { TimerDeps, TimerSnapshot } from '@application/use-cases/timer'
import { loadSettings } from '@application/use-cases/settings'
import { createAppLogger } from './adapters/logger'
import { createBackupService } from './adapters/backup-service'
import { createDataPort } from './adapters/data-port'
import { createDataTransferPort } from './adapters/data-transfer'
import { createRingtoneFilePort } from './adapters/ringtone-files'
import { backupDatabaseBeforeOpen } from './adapters/sqlite/backup'
import { openDatabase } from './adapters/sqlite/database'
import {
  createActionRepo,
  createAlarmEventRepo,
  createCustomRingtoneRepo,
  createPlanRepo,
  createRecordRepo,
  createSessionStore,
  createSettingsRepo,
  createTodoRepo,
  createUnitOfWork,
} from './adapters/sqlite/repositories'
import { TIMER_POLICY } from './config/defaults'
import { broadcast } from './runtime/broadcast'
import { createSystemClock, resolveTestClockNow } from './runtime/clock'
import { createUuidGen } from './runtime/id-gen'
import { createTimerRuntime, type TimerRuntime } from './runtime/timer-runtime'

export type AppContainer = {
  readonly actions: ActionRepo
  readonly plans: PlanRepo
  readonly todos: TodoRepo
  readonly alarmEvents: AlarmEventRepo
  readonly records: RecordRepo
  readonly sessions: SessionStore
  readonly settings: SettingsRepo
  readonly customRingtones: CustomRingtoneRepo
  readonly ringtoneFiles: RingtoneFilePort
  readonly ringtoneDir: string
  readonly dataPort: DataPort
  readonly dataTransfer: DataTransferPort
  readonly backupService: BackupService
  readonly backupDir: string
  readonly unitOfWork: UnitOfWork
  readonly clock: Clock
  readonly logger: Logger
  readonly timer: TimerRuntime
  readonly dataDir: string
  readonly logDir: string
  dispose(): void
}

// 唯一的装配点：只有这里知道 SQLite / 系统时钟 / UUID 的存在
export function composeApp(input: {
  dataDir: string
  isDev: boolean
  builtinRingtoneDir: string
  onRestart: () => void
}): AppContainer {
  const logDir = join(input.dataDir, 'logs')
  const logger = createAppLogger({ scope: 'main', logDir, isDev: input.isDev })
  const clock = createSystemClock({ testNowMs: resolveTestClockNow(process.env, input.isDev) })

  const dataDir = join(input.dataDir, 'data')
  mkdirSync(dataDir, { recursive: true })
  const databasePath = join(dataDir, 'spendtime.db')
  // 打开前先拷贝一份，迁移或异常写入时还有上一版可用
  const backupPath = backupDatabaseBeforeOpen(
    { databasePath, backupDir: join(dataDir, 'backups') },
    logger,
  )
  if (backupPath !== null) {
    logger.info(`已创建启动备份：${backupPath}`)
  }
  const db = openDatabase(databasePath, logger)

  const actions = createActionRepo(db)
  const plans = createPlanRepo(db)
  const todos = createTodoRepo(db)
  const alarmEvents = createAlarmEventRepo(db)
  const records = createRecordRepo(db)
  const sessions = createSessionStore(db)
  const settings = createSettingsRepo(db)
  const customRingtones = createCustomRingtoneRepo(db)
  const unitOfWork = createUnitOfWork(db)

  // 内置铃声复制到用户目录后，协议只暴露这一个目录
  const ringtoneDir = join(input.dataDir, 'ringtones')
  const ringtoneFiles = createRingtoneFilePort({
    targetDir: ringtoneDir,
    builtinDir: input.builtinRingtoneDir,
    logger,
  })
  ringtoneFiles.ensureBuiltins()

  const dataPort = createDataPort(db)
  const dataTransfer = createDataTransferPort(logger)
  const backupDir = join(dataDir, 'backups')
  const backupService = createBackupService({
    db,
    databasePath,
    backupDir,
    retain: () => loadSettings(settings).backupRetain,
    logger,
    onRestart: input.onRestart,
  })

  seedDefaultAction(actions, clock, logger)

  const timerDeps: TimerDeps = { clock, ids: createUuidGen(), actions, policy: TIMER_POLICY }
  const effectDeps: TimerEffectDeps = {
    sessions,
    records,
    unitOfWork,
    logger,
    notifier: { finished: publishTimerFinished },
  }

  const timer = createTimerRuntime({
    timer: timerDeps,
    effects: effectDeps,
    publish: publishTimerTick,
  })

  function publishTimerFinished(input: {
    actionId: number
    durationSec: number
    reason: 'completed' | 'stopped'
  }): void {
    broadcast('timer.finished', input)
    broadcast('data.changed', { scope: 'records' })
  }

  function publishTimerTick(snapshot: TimerSnapshot): void {
    broadcast('timer.tick', snapshot)
  }

  function dispose(): void {
    timer.dispose()
    db.close()
    logger.info('数据库已关闭')
  }

  return {
    actions,
    plans,
    todos,
    alarmEvents,
    records,
    sessions,
    settings,
    customRingtones,
    ringtoneFiles,
    ringtoneDir,
    dataPort,
    dataTransfer,
    backupService,
    backupDir,
    unitOfWork,
    clock,
    logger,
    timer,
    dataDir,
    logDir,
    dispose,
  }
}

// 无行动时无法开始计时，首启给一条占位行动，用户可自行新增/归档
function seedDefaultAction(actions: ActionRepo, clock: Clock, logger: Logger): void {
  if (actions.list(true).length > 0) {
    return
  }
  const created = actions.create('默认', clock.now())
  logger.info(`已创建初始行动 #${created.id}`)
}
