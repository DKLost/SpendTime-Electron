import { z } from 'zod'
import type { RingtoneValue } from './ringtones'

export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const WeekdaySchema = z.number().int().min(1).max(7)
export const MinuteOfDaySchema = z.number().int().min(0).max(1440)

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
})

// 每个通道统一用 Result 信封，预期错误不抛异常
export function commandResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: ApiErrorSchema }),
  ])
}

const RINGTONE_VALUE_PATTERN =
  /^(chime|bell|pulse|none|custom:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

// 用 z.custom 保住字面量联合类型，避免 DTO 退化成 string
export const RingtoneValueSchema = z.custom<RingtoneValue>(
  (value) => typeof value === 'string' && RINGTONE_VALUE_PATTERN.test(value),
  { message: '铃声不存在' },
)
export const RingtoneChoiceSchema = z.union([z.literal('inherit'), RingtoneValueSchema])

export const ActionSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  archived: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  // 归档时间；旧归档数据可能为 null
  archivedAt: z.number().int().nonnegative().nullable(),
  // 该行动记住的倒计时秒数；null 表示正计时
  timerTargetSec: z.number().int().positive().nullable(),
  // null 表示跟随全局默认铃声；'none' 表示该行动不播放
  startRingtone: RingtoneValueSchema.nullable(),
  endRingtone: RingtoneValueSchema.nullable(),
  // 行动随手排序，旧数据按 id 回填
  sortOrder: z.number().int().nonnegative(),
})

export const RingtoneConfigSchema = z.object({
  defaultStart: RingtoneValueSchema,
  defaultEnd: RingtoneValueSchema,
})

export const CustomRingtoneIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

export const CustomRingtoneUsageSchema = z.object({
  actionId: z.number().int().positive(),
  actionName: z.string(),
  kind: z.enum(['start', 'end']),
})

export const CustomRingtoneSchema = z.object({
  id: CustomRingtoneIdSchema,
  name: z.string(),
  fileName: z.string(),
  // 源文件完整时长；界面展示的截取长度由区间推导
  durationSec: z.number().int().positive(),
  clipStartSec: z.number().nonnegative(),
  // null 表示到文件末尾，旧数据迁移后即为此值
  clipEndSec: z.number().positive().nullable(),
  sizeBytes: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  usedBy: z.array(CustomRingtoneUsageSchema),
  usedByDefault: z.array(z.enum(['start', 'end'])),
})

// 导入分两步：先暂存并返回可试听的临时地址，用户选好区间后再提交
export const StagedRingtoneSchema = z.object({
  token: CustomRingtoneIdSchema,
  pendingFileName: z.string(),
  suggestedName: z.string(),
  durationSec: z.number().positive(),
  sizeBytes: z.number().int().positive(),
})

export const RingtoneListSchema = z.object({
  custom: z.array(CustomRingtoneSchema),
  defaultStart: RingtoneValueSchema,
  defaultEnd: RingtoneValueSchema,
})

export const SettingsSchema = z.object({
  closeBehavior: z.enum(['hide-to-tray', 'quit']),
  startAtLogin: z.boolean(),
  shortcut: z.string().max(64).nullable(),
  locale: z.enum(['zh', 'en', 'ja']),
  density: z.enum(['compact', 'comfortable']),
  slotTintEnabled: z.boolean(),
  soundEnabled: z.boolean(),
  alarmLoopMaxSec: z.number().int().min(30).max(120),
  backupRetain: z.number().int().min(3).max(30),
  defaultStartRingtone: RingtoneValueSchema,
  defaultEndRingtone: RingtoneValueSchema,
})

export const SettingsPatchSchema = SettingsSchema.partial()

export const SettingsSnapshotSchema = z.object({
  settings: SettingsSchema,
  dataDir: z.string(),
  logDir: z.string(),
  appVersion: z.string(),
})

export const TimerSnapshotSchema = z.object({
  status: z.enum(['idle', 'running']),
  actionId: z.number().int().positive().nullable(),
  startedAt: z.number().int().nonnegative().nullable(),
  targetSec: z.number().int().positive().nullable(),
  elapsedSec: z.number().int().nonnegative(),
  remainingSec: z.number().int().nullable(),
})

export const RecordSchema = z.object({
  id: z.number().int().positive(),
  actionId: z.number().int().positive(),
  actionName: z.string(),
  startAt: z.number().int(),
  endAt: z.number().int(),
  durationSec: z.number().int().nonnegative(),
  localDate: LocalDateSchema,
  source: z.enum(['timer', 'plan', 'manual', 'import']),
})

export const PlanSchema = z.object({
  id: z.number().int().positive(),
  weekday: WeekdaySchema,
  startMin: MinuteOfDaySchema,
  endMin: MinuteOfDaySchema,
  actionId: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  alarmEnabled: z.boolean(),
})

export const PlanViewSchema = PlanSchema.extend({ actionName: z.string() })

export const SlotSchema = z.object({
  startMin: MinuteOfDaySchema,
  endMin: MinuteOfDaySchema,
})

export const TodoSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  completed: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  archivedAt: z.number().int().nonnegative().nullable(),
})

export const ActionStatSchema = z.object({
  actionId: z.number().int().positive(),
  actionName: z.string(),
  durationSec: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
})

export const ExportCountsSchema = z.object({
  actions: z.number().int().nonnegative(),
  plans: z.number().int().nonnegative(),
  records: z.number().int().nonnegative(),
  todos: z.number().int().nonnegative(),
})

export const BackupEntrySchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
})

export const StatsOverviewSchema = z.object({
  byAction: z.array(ActionStatSchema),
})

export const AlarmFireSchema = z.object({
  planId: z.number().int().positive(),
  actionId: z.number().int().positive(),
  actionName: z.string(),
  startMin: z.number().int().min(0).max(1440),
  fireDate: z.string(),
  targetSec: z.number().int().positive(),
})

export const BootstrapSchema = z.object({
  appVersion: z.string(),
  dataDir: z.string(),
  isDev: z.boolean(),
  timer: TimerSnapshotSchema,
  actions: z.array(ActionSchema),
})

export const commands = {
  'app.bootstrap': {
    request: z.object({}),
    response: commandResult(BootstrapSchema),
  },
  // 渲染层错误上报：message 必填，stack/source 用于定位
  'app.reportError': {
    request: z.object({
      message: z.string().min(1).max(4000),
      stack: z.string().max(8000).optional(),
      source: z.enum(['error', 'unhandledrejection', 'manual']).optional(),
    }),
    response: commandResult(
      z.object({
        reported: z.boolean(),
        throttled: z.boolean(),
      }),
    ),
  },
  'actions.list': {
    request: z.object({ includeArchived: z.boolean().default(false) }),
    response: commandResult(z.array(ActionSchema)),
  },
  'actions.create': {
    request: z.object({ name: z.string() }),
    response: commandResult(ActionSchema),
  },
  'actions.rename': {
    request: z.object({ actionId: z.number().int().positive(), name: z.string() }),
    response: commandResult(ActionSchema),
  },
  'actions.archive': {
    request: z.object({ actionId: z.number().int().positive() }),
    response: commandResult(
      z.object({
        actionId: z.number().int().positive(),
        planCount: z.number().int().nonnegative(),
        recordCount: z.number().int().nonnegative(),
      }),
    ),
  },
  'actions.restore': {
    request: z.object({ actionId: z.number().int().positive() }),
    response: commandResult(ActionSchema),
  },
  'actions.remove': {
    request: z.object({ actionId: z.number().int().positive() }),
    response: commandResult(
      z.object({
        actionId: z.number().int().positive(),
        planCount: z.number().int().nonnegative(),
        recordCount: z.number().int().nonnegative(),
      }),
    ),
  },
  // 每个行动独立记忆倒计时；null 清除并回到正计时
  'actions.setTimerTarget': {
    request: z.object({
      actionId: z.number().int().positive(),
      targetSec: z.number().int().positive().max(86_400).nullable(),
    }),
    response: commandResult(ActionSchema),
  },
  // 行动上下移动，返回同一归档状态下的新顺序
  'actions.reorder': {
    request: z.object({
      actionId: z.number().int().positive(),
      direction: z.enum(['up', 'down']),
    }),
    response: commandResult(z.array(ActionSchema)),
  },
  'settings.get': {
    request: z.object({}),
    response: commandResult(SettingsSnapshotSchema),
  },
  'settings.update': {
    request: z.object({ patch: SettingsPatchSchema }),
    response: commandResult(SettingsSchema),
  },
  'app.openDataDir': {
    request: z.object({}),
    response: commandResult(z.object({ opened: z.boolean() })),
  },
  'app.openLogDir': {
    request: z.object({}),
    response: commandResult(z.object({ opened: z.boolean() })),
  },
  'app.exportDiagnostics': {
    request: z.object({}),
    response: commandResult(z.object({ exported: z.boolean(), path: z.string().nullable() })),
  },
  'app.openCrashDir': {
    request: z.object({}),
    response: commandResult(z.object({ opened: z.boolean() })),
  },
  'ringtones.get': {
    request: z.object({}),
    response: commandResult(RingtoneConfigSchema),
  },
  'ringtones.list': {
    request: z.object({}),
    response: commandResult(RingtoneListSchema),
  },
  // 返回 null 表示用户取消文件选择；非空时文件已暂存，等待 commitImport
  'ringtones.import': {
    request: z.object({}),
    response: commandResult(StagedRingtoneSchema.nullable()),
  },
  'ringtones.commitImport': {
    request: z.object({
      token: CustomRingtoneIdSchema,
      startSec: z.number().nonnegative(),
      endSec: z.number().positive(),
    }),
    response: commandResult(CustomRingtoneSchema),
  },
  'ringtones.cancelImport': {
    request: z.object({ token: CustomRingtoneIdSchema }),
    response: commandResult(z.object({ removed: z.boolean() })),
  },
  'ringtones.rename': {
    request: z.object({ ringtoneId: CustomRingtoneIdSchema, name: z.string().min(1).max(40) }),
    response: commandResult(CustomRingtoneSchema),
  },
  // 重新切片：只更新区间，复用原文件，不产生第二份音频
  'ringtones.updateClip': {
    request: z.object({
      ringtoneId: CustomRingtoneIdSchema,
      startSec: z.number().nonnegative(),
      endSec: z.number().positive(),
    }),
    response: commandResult(CustomRingtoneSchema),
  },
  'ringtones.remove': {
    request: z.object({ ringtoneId: CustomRingtoneIdSchema }),
    response: commandResult(
      z.object({
        ringtoneId: CustomRingtoneIdSchema,
        affectedActions: z.number().int().nonnegative(),
        clearedDefaults: z.number().int().nonnegative(),
      }),
    ),
  },
  'ringtones.setDefault': {
    request: z.object({
      kind: z.enum(['start', 'end']),
      value: RingtoneValueSchema,
    }),
    response: commandResult(RingtoneConfigSchema),
  },
  'ringtones.setAction': {
    request: z.object({
      actionId: z.number().int().positive(),
      kind: z.enum(['start', 'end']),
      value: RingtoneChoiceSchema,
    }),
    response: commandResult(ActionSchema),
  },
  'timer.start': {
    request: z.object({
      actionId: z.number().int().positive(),
      targetSec: z.number().int().positive().max(86_400).nullable().default(null),
    }),
    response: commandResult(TimerSnapshotSchema),
  },
  'timer.stop': {
    request: z.object({}),
    response: commandResult(TimerSnapshotSchema),
  },
  'timer.getState': {
    request: z.object({}),
    response: commandResult(TimerSnapshotSchema),
  },
  'records.listByDate': {
    request: z.object({ date: LocalDateSchema }),
    response: commandResult(z.array(RecordSchema)),
  },
  'records.update': {
    request: z.object({
      recordId: z.number().int().positive(),
      startAt: z.number().int(),
      endAt: z.number().int(),
    }),
    response: commandResult(RecordSchema),
  },
  'records.remove': {
    request: z.object({ recordId: z.number().int().positive() }),
    response: commandResult(z.object({ recordId: z.number().int().positive() })),
  },
  // 每个行动的历史累计实际用时，用于行动栏展示
  'records.totalsByAction': {
    request: z.object({}),
    response: commandResult(
      z.array(
        z.object({
          actionId: z.number().int().positive(),
          durationSec: z.number().int().nonnegative(),
        }),
      ),
    ),
  },
  'stats.overview': {
    request: z.object({ from: LocalDateSchema, to: LocalDateSchema }),
    response: commandResult(StatsOverviewSchema),
  },
  // 「全部」预设的实际记录范围；from/to 为 null 表示还没有任何记录
  'stats.bounds': {
    request: z.object({}),
    response: commandResult(
      z.object({
        from: LocalDateSchema.nullable(),
        to: LocalDateSchema.nullable(),
      }),
    ),
  },
  'stats.exportCsv': {
    request: z.object({ from: LocalDateSchema, to: LocalDateSchema }),
    response: commandResult(z.object({ saved: z.boolean(), path: z.string().nullable() })),
  },
  'data.export': {
    request: z.object({}),
    response: commandResult(
      z.object({
        saved: z.boolean(),
        path: z.string().nullable(),
        counts: ExportCountsSchema,
      }),
    ),
  },
  'data.inspectImport': {
    request: z.object({}),
    response: commandResult(
      z.object({
        canceled: z.boolean(),
        token: z.string().nullable(),
        counts: ExportCountsSchema.nullable(),
        warnings: z.array(z.string()),
      }),
    ),
  },
  'data.import': {
    request: z.object({ token: z.string().min(1) }),
    response: commandResult(z.object({ counts: ExportCountsSchema })),
  },
  'backup.list': {
    request: z.object({}),
    response: commandResult(
      z.object({
        backups: z.array(BackupEntrySchema),
        dir: z.string(),
      }),
    ),
  },
  'backup.create': {
    request: z.object({}),
    response: commandResult(z.object({ created: z.boolean(), entry: BackupEntrySchema.nullable() })),
  },
  'backup.openDir': {
    request: z.object({}),
    response: commandResult(z.object({ opened: z.boolean() })),
  },
  'backup.restore': {
    request: z.object({ name: z.string().min(1) }),
    response: commandResult(z.object({ restarting: z.boolean() })),
  },
  'plans.listWeek': {
    request: z.object({}),
    response: commandResult(z.array(PlanViewSchema)),
  },
  'plans.create': {
    request: z.object({
      weekday: WeekdaySchema,
      startMin: MinuteOfDaySchema,
      endMin: MinuteOfDaySchema,
      actionId: z.number().int().positive(),
      // 缺省开启，新建计划默认参与提醒
      alarmEnabled: z.boolean().default(true),
    }),
    response: commandResult(PlanViewSchema),
  },
  'plans.remove': {
    request: z.object({ planId: z.number().int().positive() }),
    response: commandResult(z.object({ planId: z.number().int().positive() })),
  },
  'plans.update': {
    request: z.object({
      planId: z.number().int().positive(),
      weekday: WeekdaySchema,
      startMin: MinuteOfDaySchema,
      endMin: MinuteOfDaySchema,
      actionId: z.number().int().positive(),
      alarmEnabled: z.boolean().default(true),
    }),
    response: commandResult(PlanViewSchema),
  },
  'plans.setAlarm': {
    request: z.object({ planId: z.number().int().positive(), enabled: z.boolean() }),
    response: commandResult(PlanViewSchema),
  },
  'plans.copyWeekday': {
    request: z.object({ from: WeekdaySchema, to: WeekdaySchema }),
    response: commandResult(z.object({ copied: z.number().int().nonnegative() })),
  },
  'todos.list': {
    request: z.object({}),
    response: commandResult(z.array(TodoSchema)),
  },
  'todos.listArchived': {
    request: z.object({}),
    response: commandResult(z.array(TodoSchema)),
  },
  'todos.create': {
    request: z.object({ title: z.string() }),
    response: commandResult(TodoSchema),
  },
  'todos.toggle': {
    request: z.object({ todoId: z.number().int().positive() }),
    response: commandResult(TodoSchema),
  },
  'todos.update': {
    request: z.object({ todoId: z.number().int().positive(), title: z.string() }),
    response: commandResult(TodoSchema),
  },
  'todos.remove': {
    request: z.object({ todoId: z.number().int().positive() }),
    response: commandResult(z.object({ todoId: z.number().int().positive() })),
  },
  'todos.archive': {
    request: z.object({ todoId: z.number().int().positive() }),
    response: commandResult(TodoSchema),
  },
  'todos.restore': {
    request: z.object({ todoId: z.number().int().positive() }),
    response: commandResult(TodoSchema),
  },
  'todos.reorder': {
    request: z.object({
      todoId: z.number().int().positive(),
      direction: z.enum(['up', 'down']),
    }),
    response: commandResult(z.array(TodoSchema)),
  },
} as const

export const events = {
  'timer.tick': TimerSnapshotSchema,
  'timer.finished': z.object({
    actionId: z.number().int().positive(),
    durationSec: z.number().int().nonnegative(),
    // completed 才播放结束铃声；手动结束只记录，不提示
    reason: z.enum(['completed', 'stopped']),
  }),
  'data.changed': z.object({ scope: z.enum(['actions', 'records', 'plans', 'todos']) }),
  'alarm.fire': z.object({ fires: z.array(AlarmFireSchema) }),
  // 通知点击后定位到具体计划，渲染层滚动并高亮提醒卡
  'alarm.focus': z.object({ planId: z.number().int().positive() }),
  // 设置变更由主进程广播（含托盘菜单修改）
  'settings.changed': SettingsSchema,
  // 托盘「打开设置」：渲染层收到后打开模态
  'ui.openSettings': z.object({}),
} as const

export type CommandChannel = keyof typeof commands
export type CommandRequest<C extends CommandChannel> = z.input<(typeof commands)[C]['request']>
export type CommandResponse<C extends CommandChannel> = z.infer<(typeof commands)[C]['response']>
export type EventChannel = keyof typeof events
export type EventPayload<E extends EventChannel> = z.infer<(typeof events)[E]>

export type ApiError = z.infer<typeof ApiErrorSchema>
export type ActionDto = z.infer<typeof ActionSchema>
export type CustomRingtoneDto = z.infer<typeof CustomRingtoneSchema>
export type StagedRingtoneDto = z.infer<typeof StagedRingtoneSchema>
export type ExportCountsDto = z.infer<typeof ExportCountsSchema>
export type BackupEntryDto = z.infer<typeof BackupEntrySchema>
export type SettingsDto = z.infer<typeof SettingsSchema>
export type SettingsPatchDto = z.infer<typeof SettingsPatchSchema>
export type SettingsSnapshotDto = z.infer<typeof SettingsSnapshotSchema>
export type TimerSnapshotDto = z.infer<typeof TimerSnapshotSchema>
export type RecordDto = z.infer<typeof RecordSchema>
export type PlanDto = z.infer<typeof PlanSchema>
export type PlanViewDto = z.infer<typeof PlanViewSchema>
export type TodoDto = z.infer<typeof TodoSchema>
export type AlarmFireDto = z.infer<typeof AlarmFireSchema>
export type ActionStatDto = z.infer<typeof ActionStatSchema>
export type StatsOverviewDto = z.infer<typeof StatsOverviewSchema>
export type SlotDto = z.infer<typeof SlotSchema>
export type BootstrapDto = z.infer<typeof BootstrapSchema>

export type CommandResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError }

// preload 与渲染层共享的唯一 API 形状
export type SpendTimeApi = {
  invoke<C extends CommandChannel>(channel: C, payload: CommandRequest<C>): Promise<CommandResponse<C>>
  on<E extends EventChannel>(channel: E, listener: (payload: EventPayload<E>) => void): () => void
}
