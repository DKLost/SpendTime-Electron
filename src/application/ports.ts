import type { Action, RingtoneValue } from '@core/action'
import type { AlarmFire } from '@core/alarm'
import type { ExportCounts, ExportData } from '@core/export'
import type { PlanDraft, PlanView } from '@core/plan'
import type { NewTimeRecord, RecordView } from '@core/record'
import type { RecordPatch } from '@core/record-edit'
import type { AppSettings } from '@core/settings'
import type { TimerSession } from '@core/timer'
import type { Todo, TodoId } from '@core/todo'
import type { ActionId, EpochMs, LocalDate, OffsetMinutes, Weekday } from '@core/types'
import type { Result } from '@core/result'

// 端口只声明业务需要，不出现任何驱动/框架类型
export interface Clock {
  now(): EpochMs
  offsetMinutes(): OffsetMinutes
}

export interface IdGen {
  next(): string
}

export interface SessionStore {
  load(): TimerSession | null
  save(session: TimerSession): void
  clear(sessionId: string): void
  clearByAction(actionId: ActionId): void
}

export type ActionDurationTotal = {
  readonly actionId: ActionId
  readonly durationSec: number
}

export interface RecordRepo {
  insertMany(records: readonly NewTimeRecord[]): void
  listByDate(date: LocalDate): readonly RecordView[]
  listRange(from: LocalDate, to: LocalDate): readonly RecordView[]
  findById(id: number): RecordView | null
  update(id: number, patch: RecordPatch): void
  remove(id: number): void
  countByAction(actionId: ActionId): number
  removeByAction(actionId: ActionId): void
  totalsByAction(): readonly ActionDurationTotal[]
  // 「全部」统计范围：最早/最晚记录日期；没有任何记录时均为 null
  bounds(): { readonly from: LocalDate | null; readonly to: LocalDate | null }
}

export interface ActionRepo {
  list(includeArchived: boolean): readonly Action[]
  findById(id: ActionId): Action | null
  create(name: string, now: EpochMs): Action
  rename(id: ActionId, name: string): Action
  archive(id: ActionId, now: EpochMs): void
  restore(id: ActionId): Action
  remove(id: ActionId): void
  setTimerTarget(id: ActionId, targetSec: number | null): Action
  setRingtone(id: ActionId, kind: 'start' | 'end', value: RingtoneValue | null): Action
  reorder(id: ActionId, direction: 'up' | 'down'): readonly Action[]
}

export interface SettingsRepo {
  get(key: string): string | null
  set(key: string, value: string): void
  getAll(): Record<string, string>
  setMany(values: Readonly<Record<string, string>>): void
}

// 设置生效依赖桌面能力（自启、全局快捷键）；失败时不落库，页面保留旧值
export interface SettingsEffects {
  apply(next: AppSettings, previous: AppSettings): Result<void, { code: string; message: string }>
}

export type CustomRingtoneRecord = {
  readonly id: string
  readonly name: string
  readonly fileName: string
  // 源文件完整时长；截取区间只在其中生效
  readonly durationSec: number
  readonly clipStartSec: number
  // null 表示到文件末尾（旧数据与整段使用）
  readonly clipEndSec: number | null
  readonly sizeBytes: number
  readonly createdAt: EpochMs
}

export interface CustomRingtoneRepo {
  list(): readonly CustomRingtoneRecord[]
  findById(id: string): CustomRingtoneRecord | null
  create(record: CustomRingtoneRecord): CustomRingtoneRecord
  rename(id: string, name: string): CustomRingtoneRecord | null
  updateClip(id: string, clipStartSec: number, clipEndSec: number | null): CustomRingtoneRecord | null
  remove(id: string): void
}

export type RingtoneFileError = {
  readonly code: 'UNSUPPORTED_FORMAT' | 'AUDIO_TOO_SHORT' | 'UNREADABLE'
  readonly message: string
}

// 用户选中的文件先落到 pending-<token>.<ext>，界面据此试听并选区间
export type StagedRingtoneFile = {
  readonly token: string
  readonly pendingFileName: string
  readonly suggestedName: string
  readonly durationSec: number
  readonly sizeBytes: number
}

export type CommittedRingtoneFile = {
  readonly fileName: string
  readonly sizeBytes: number
}

// 文件选择、校验与落盘留在 main 层；application 只关心结果
export interface RingtoneFilePort {
  pickFile(): Promise<string | null>
  createToken(): string
  createId(): string
  stage(sourcePath: string, token: string): Promise<Result<StagedRingtoneFile, RingtoneFileError>>
  findStaged(token: string): StagedRingtoneFile | null
  commit(token: string, id: string): Result<CommittedRingtoneFile, RingtoneFileError>
  discard(token: string): void
  removeFile(fileName: string): void
  ensureBuiltins(): void
}

export interface DataPort {
  snapshotAll(): ExportData
  replaceAll(data: ExportData): void
  counts(): ExportCounts
}

export type BackupEntry = {
  readonly name: string
  readonly sizeBytes: number
  readonly createdAt: EpochMs
}

export interface BackupService {
  list(): readonly BackupEntry[]
  create(): BackupEntry | null
  openDir(): boolean
  // 恢复后由 main 重启应用，避免在运行中替换数据库
  restore(name: string): Result<{ restarting: boolean }, { code: string; message: string }>
}

export interface DataTransferPort {
  saveText(defaultName: string, content: string): Promise<string | null>
  pickImportFile(): Promise<{ token: string } | null>
  readImportFile(token: string): string | null
}

export interface PlanRepo {
  listWeek(): readonly PlanView[]
  listByWeekday(weekday: Weekday): readonly PlanView[]
  findById(id: number): PlanView | null
  create(draft: PlanDraft, now: EpochMs): PlanView
  update(id: number, draft: PlanDraft): PlanView
  remove(id: number): void
  removeByWeekday(weekday: Weekday): void
  insertMany(drafts: readonly PlanDraft[], now: EpochMs): void
  setAlarmEnabled(id: number, enabled: boolean): void
  countByAction(actionId: ActionId): number
  removeByAction(actionId: ActionId): void
}

export interface TodoRepo {
  listActive(): readonly Todo[]
  listArchived(): readonly Todo[]
  create(title: string, sortOrder: number, now: EpochMs): Todo
  setCompleted(id: TodoId, completed: boolean, completedAt: EpochMs | null): void
  setArchived(id: TodoId, archivedAt: EpochMs | null): void
  updateTitle(id: TodoId, title: string): Todo
  remove(id: TodoId): void
  // 按给定顺序整体重写 sort_order，调用方保证 id 集合完整
  reorder(orderedIds: readonly TodoId[]): void
}

// 闹钟事件只保留去重键与触发信息，是否补发由 core 判定
export interface AlarmEventRepo {
  listKeysByDate(date: LocalDate): readonly string[]
  record(fire: AlarmFire, firedAt: EpochMs): void
}

// 事务边界由外壳提供，用例不关心底层是 SQLite 还是内存实现
export interface UnitOfWork {
  run<T>(work: () => T): T
}

export interface Logger {
  info(message: string, details?: unknown): void
  error(message: string, details?: unknown): void
}
