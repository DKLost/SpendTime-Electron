import type {
  ActionDto,
  CommandChannel,
  CustomRingtoneDto,
  CommandRequest,
  CommandResponse,
  EventChannel,
  EventPayload,
  PlanViewDto,
  RecordDto,
  SettingsDto,
  SpendTimeApi,
  StagedRingtoneDto,
  StatsOverviewDto,
  TimerSnapshotDto,
  TodoDto,
} from '@shared/contracts'

type HandlerMap = {
  [C in CommandChannel]: (request: CommandRequest<C>) => CommandResponse<C>
}

type MockState = {
  nextId: number
  readonly actions: ActionDto[]
  readonly plans: PlanViewDto[]
  readonly todos: TodoDto[]
  readonly records: RecordDto[]
  timer: TimerSnapshotDto
  ringtones: RingtoneConfig
  customRingtones: CustomRingtoneDto[]
  settings: SettingsDto
}

type RingtoneId = 'chime' | 'bell' | 'pulse' | 'none' | `custom:${string}`

type RingtoneConfig = {
  defaultStart: RingtoneId
  defaultEnd: RingtoneId
}

const IDLE_SNAPSHOT: TimerSnapshotDto = {
  status: 'idle',
  actionId: null,
  startedAt: null,
  targetSec: null,
  elapsedSec: 0,
  remainingSec: null,
}

// harness 的假 API：与 contracts 同形，内存态足够支撑界面流程
function removeByAction(items: { actionId: number }[], actionId: number): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.actionId === actionId) {
      items.splice(index, 1)
    }
  }
}

export function createMockApi(options: { readonly emptyRecords?: boolean } = {}): SpendTimeApi {
  const seedNow = Date.now()
  const seedDate = localDate(seedNow)
  const state: MockState = {
    nextId: 10,
    actions: [
      {
        id: 1,
        name: '默认',
        archived: false,
        createdAt: Date.now(),
        archivedAt: null,
        timerTargetSec: null,
        startRingtone: null,
        endRingtone: null,
        sortOrder: 1,
      },
      {
        id: 2,
        name: '阅读',
        archived: false,
        createdAt: Date.now(),
        archivedAt: null,
        timerTargetSec: null,
        startRingtone: null,
        endRingtone: null,
        sortOrder: 2,
      },
    ],
    plans: [],
    todos: [],
    // 固定落在不同时段，保证截图与断言覆盖夜/晨/午/下午/深夜五档底色；
    // 另置前一天的两条记录（含 23:30-24:00 的跨零点末段）用于日期回溯
    records: options.emptyRecords
      ? []
      : [
      {
        id: 6,
        actionId: 1,
        actionName: '默认',
        startAt: atLocalDateMinute(seedNow, 0, 0),
        endAt: atLocalDateMinute(seedNow, 0, 40),
        durationSec: 40 * 60,
        localDate: seedDate,
        source: 'manual',
      },
      {
        id: 7,
        actionId: 2,
        actionName: '阅读',
        startAt: atLocalDateMinute(seedNow, -1, 860),
        endAt: atLocalDateMinute(seedNow, -1, 950),
        durationSec: 90 * 60,
        localDate: localDate(atLocalDateMinute(seedNow, -1, 0)),
        source: 'manual',
      },
      {
        id: 8,
        actionId: 1,
        actionName: '默认',
        startAt: atLocalDateMinute(seedNow, -1, 1410),
        endAt: atLocalDateMinute(seedNow, 0, 0),
        durationSec: 30 * 60,
        localDate: localDate(atLocalDateMinute(seedNow, -1, 0)),
        source: 'manual',
      },
      {
        id: 1,
        actionId: 1,
        actionName: '默认',
        startAt: atLocalMinute(seedNow, 130),
        endAt: atLocalMinute(seedNow, 180),
        durationSec: 50 * 60,
        localDate: seedDate,
        source: 'manual',
      },
      {
        id: 2,
        actionId: 2,
        actionName: '阅读',
        startAt: atLocalMinute(seedNow, 380),
        endAt: atLocalMinute(seedNow, 430),
        durationSec: 50 * 60,
        localDate: seedDate,
        source: 'manual',
      },
      {
        id: 3,
        actionId: 1,
        actionName: '默认',
        startAt: atLocalMinute(seedNow, 750),
        endAt: atLocalMinute(seedNow, 795),
        durationSec: 45 * 60,
        localDate: seedDate,
        source: 'manual',
      },
      {
        id: 4,
        actionId: 2,
        actionName: '阅读',
        startAt: atLocalMinute(seedNow, 930),
        endAt: atLocalMinute(seedNow, 980),
        durationSec: 50 * 60,
        localDate: seedDate,
        source: 'manual',
      },
      {
        id: 5,
        actionId: 1,
        actionName: '默认',
        startAt: atLocalMinute(seedNow, 1300),
        endAt: atLocalMinute(seedNow, 1340),
        durationSec: 40 * 60,
        localDate: seedDate,
        source: 'manual',
      },
    ],
    timer: IDLE_SNAPSHOT,
    ringtones: { defaultStart: 'chime', defaultEnd: 'chime' },
    // 预置一条旧格式铃声：没有截取区间，等价于整段播放
    customRingtones: [
      {
        id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
        name: '旧铃声',
        fileName: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff.mp3',
        durationSec: 12,
        clipStartSec: 0,
        clipEndSec: null,
        sizeBytes: 4096,
        createdAt: Date.now() - 86_400_000,
        usedBy: [],
        usedByDefault: [],
      },
    ],
    settings: {
      closeBehavior: 'hide-to-tray',
      startAtLogin: false,
      shortcut: 'Ctrl+Alt+S',
      locale: 'zh',
      density: 'comfortable',
      slotTintEnabled: true,
      soundEnabled: true,
      alarmLoopMaxSec: 120,
      backupRetain: 10,
      defaultStartRingtone: 'chime',
      defaultEndRingtone: 'chime',
    },
  }

  const handlers: HandlerMap = {
    'app.bootstrap': () =>
      ok({
        appVersion: '0.0.0-harness',
        dataDir: 'memory',
        isDev: true,
        timer: snapshot(state),
        actions: state.actions,
      }),

    'app.reportError': () => ok({ reported: true, throttled: false }),

    'actions.list': (request) =>
      ok(state.actions.filter((action) => request.includeArchived === true || !action.archived)),

    'actions.create': (request) => {
      const name = request.name.trim()
      if (name === '') {
        return fail('EMPTY_NAME', '行动名称不能为空')
      }
      const action: ActionDto = {
        id: state.nextId++,
        name,
        archived: false,
        createdAt: Date.now(),
        archivedAt: null,
        timerTargetSec: null,
        startRingtone: null,
        endRingtone: null,
        sortOrder: state.actions.length + 1,
      }
      state.actions.push(action)
      return ok(action)
    },

    'actions.rename': (request) => {
      const action = state.actions.find((item) => item.id === request.actionId)
      if (action === undefined) {
        return fail('NOT_FOUND', '行动不存在或已删除')
      }
      action.name = request.name.trim()
      return ok({ ...action })
    },

    'actions.archive': (request) => {
      const action = state.actions.find((item) => item.id === request.actionId)
      if (action === undefined) {
        return fail('NOT_FOUND', '行动不存在或已删除')
      }
      action.archived = true
      action.archivedAt = Date.now()
      return ok({
        actionId: action.id,
        planCount: state.plans.filter((plan) => plan.actionId === action.id).length,
        recordCount: state.records.filter((record) => record.actionId === action.id).length,
      })
    },

    'actions.restore': (request) => {
      const action = state.actions.find((item) => item.id === request.actionId)
      if (action === undefined) {
        return fail('NOT_FOUND', '行动不存在或已删除')
      }
      action.archived = false
      action.archivedAt = null
      return ok({ ...action })
    },

    'actions.remove': (request) => {
      const index = state.actions.findIndex((item) => item.id === request.actionId)
      if (index === -1) {
        return fail('NOT_FOUND', '行动不存在或已删除')
      }
      const planCount = state.plans.filter((plan) => plan.actionId === request.actionId).length
      const recordCount = state.records.filter((record) => record.actionId === request.actionId).length
      state.actions.splice(index, 1)
      removeByAction(state.plans, request.actionId)
      removeByAction(state.records, request.actionId)
      return ok({ actionId: request.actionId, planCount, recordCount })
    },

    'actions.setTimerTarget': (request) => {
      const action = state.actions.find((item) => item.id === request.actionId)
      if (action === undefined) {
        return fail('NOT_FOUND', '行动不存在或已删除')
      }
      action.timerTargetSec = request.targetSec
      return ok({ ...action })
    },

    'actions.reorder': (request) => {
      const active = state.actions.filter((action) => !action.archived).sort((a, b) => a.sortOrder - b.sortOrder)
      const index = active.findIndex((action) => action.id === request.actionId)
      if (index === -1) {
        return fail('NOT_FOUND', '行动不存在或已删除')
      }
      const target = request.direction === 'up' ? index - 1 : index + 1
      if (target >= 0 && target < active.length) {
        const current = active[index]
        const other = active[target]
        if (current !== undefined && other !== undefined) {
          const order = current.sortOrder
          current.sortOrder = other.sortOrder
          other.sortOrder = order
        }
      }
      return ok(
        state.actions.filter((action) => !action.archived).sort((a, b) => a.sortOrder - b.sortOrder),
      )
    },

    'settings.get': () =>
      ok({
        settings: state.settings,
        dataDir: 'memory',
        logDir: 'memory/logs',
        appVersion: '0.0.0-harness',
      }),

    'settings.update': (request) => {
      state.settings = { ...state.settings, ...request.patch }
      if (request.patch.defaultStartRingtone !== undefined) {
        state.ringtones.defaultStart = request.patch.defaultStartRingtone
      }
      if (request.patch.defaultEndRingtone !== undefined) {
        state.ringtones.defaultEnd = request.patch.defaultEndRingtone
      }
      return ok(state.settings)
    },

    'app.openDataDir': () => ok({ opened: true }),

    'app.openLogDir': () => ok({ opened: true }),

    'app.exportDiagnostics': () => ok({ exported: true, path: 'memory/diagnostics/20260101' }),

    'app.openCrashDir': () => ok({ opened: true }),

    'ringtones.get': () => ok({ ...state.ringtones }),

    'ringtones.list': () =>
      ok({ custom: [...state.customRingtones], ...state.ringtones }),

    'ringtones.import': () => {
      const token = crypto.randomUUID()
      const staged: StagedRingtoneDto = {
        token,
        pendingFileName: `pending-${token}.mp3`,
        suggestedName: 'Focus Session',
        // 源文件超过 60 秒，默认选区只取前 60 秒
        durationSec: 186,
        sizeBytes: 4096,
      }
      return ok(staged)
    },

    'ringtones.commitImport': (request) => {
      const id = crypto.randomUUID()
      const ringtone: CustomRingtoneDto = {
        id,
        name: 'Focus Session',
        fileName: `${id}.mp3`,
        durationSec: 186,
        clipStartSec: request.startSec,
        clipEndSec: request.endSec,
        sizeBytes: 4096,
        createdAt: Date.now(),
        usedBy: [],
        usedByDefault: [],
      }
      state.customRingtones.push(ringtone)
      return ok(ringtone)
    },

    'ringtones.cancelImport': () => ok({ removed: true }),

    'ringtones.rename': (request) => {
      const ringtone = state.customRingtones.find((item) => item.id === request.ringtoneId)
      if (ringtone === undefined) {
        return fail('NOT_FOUND', '铃声不存在或已删除')
      }
      ringtone.name = request.name
      return ok({ ...ringtone })
    },

    'ringtones.updateClip': (request) => {
      const ringtone = state.customRingtones.find((item) => item.id === request.ringtoneId)
      if (ringtone === undefined) {
        return fail('NOT_FOUND', '铃声不存在或已删除')
      }
      ringtone.clipStartSec = request.startSec
      ringtone.clipEndSec = request.endSec
      return ok({ ...ringtone })
    },

    'ringtones.remove': (request) => {
      const index = state.customRingtones.findIndex((item) => item.id === request.ringtoneId)
      if (index === -1) {
        return fail('NOT_FOUND', '铃声不存在或已删除')
      }
      const value = `custom:${request.ringtoneId}`
      let affectedActions = 0
      for (const action of state.actions) {
        if (action.startRingtone === value) {
          action.startRingtone = null
          affectedActions += 1
        }
        if (action.endRingtone === value) {
          action.endRingtone = null
          affectedActions += 1
        }
      }
      let clearedDefaults = 0
      if (state.ringtones.defaultStart === value) {
        state.ringtones.defaultStart = 'chime'
        clearedDefaults += 1
      }
      if (state.ringtones.defaultEnd === value) {
        state.ringtones.defaultEnd = 'chime'
        clearedDefaults += 1
      }
      state.customRingtones.splice(index, 1)
      return ok({ ringtoneId: request.ringtoneId, affectedActions, clearedDefaults })
    },

    'ringtones.setDefault': (request) => {
      if (request.kind === 'start') {
        state.ringtones.defaultStart = request.value
      } else {
        state.ringtones.defaultEnd = request.value
      }
      return ok({ ...state.ringtones })
    },

    'ringtones.setAction': (request) => {
      const action = state.actions.find((item) => item.id === request.actionId)
      if (action === undefined) {
        return fail('NOT_FOUND', '行动不存在或已删除')
      }
      const value = request.value === 'inherit' ? null : request.value
      if (request.kind === 'start') {
        action.startRingtone = value
      } else {
        action.endRingtone = value
      }
      return ok({ ...action })
    },

    'timer.start': (request) => {
      const action = state.actions.find((item) => item.id === request.actionId)
      if (action === undefined) {
        return fail('UNKNOWN_ACTION', '所选行动不存在')
      }
      if (action.archived) {
        return fail('ARCHIVED_ACTION', '所选行动已归档')
      }
      if (state.timer.status === 'running') {
        return fail('ALREADY_RUNNING', '已有计时在进行')
      }
      const targetSec = request.targetSec ?? null
      state.timer = {
        status: 'running',
        actionId: action.id,
        // 固定已运行 90 秒，让界面断言不受真实等待时间影响
        startedAt: Date.now() - 90_000,
        targetSec,
        elapsedSec: 90,
        remainingSec: targetSec === null ? null : Math.max(0, targetSec - 90),
      }
      return ok(state.timer)
    },

    'timer.stop': () => {
      const current = snapshot(state)
      if (current.status !== 'running' || current.actionId === null || current.startedAt === null) {
        return fail('NOT_RUNNING', '当前没有进行中的计时')
      }
      const action = state.actions.find((item) => item.id === current.actionId)
      const endAt = Date.now()
      const durationSec = Math.max(1, Math.floor((endAt - current.startedAt) / 1000))
      state.records.push({
        id: state.nextId++,
        actionId: current.actionId,
        actionName: action?.name ?? '未知行动',
        startAt: current.startedAt,
        endAt,
        durationSec,
        localDate: localDate(current.startedAt),
        source: 'timer',
      })
      state.timer = IDLE_SNAPSHOT
      return ok(state.timer)
    },

    'timer.getState': () => ok(snapshot(state)),

    'records.listByDate': (request) =>
      ok(state.records.filter((record) => record.localDate === request.date)),

    'records.update': (request) => {
      const record = state.records.find((item) => item.id === request.recordId)
      if (record === undefined) {
        return fail('NOT_FOUND', '记录不存在')
      }
      if (request.endAt <= request.startAt) {
        return fail('INVALID_RANGE', '结束时间必须晚于开始时间')
      }
      record.startAt = request.startAt
      record.endAt = request.endAt
      record.durationSec = Math.floor((request.endAt - request.startAt) / 1000)
      return ok({ ...record })
    },

    'records.remove': (request) => {
      const index = state.records.findIndex((item) => item.id === request.recordId)
      if (index === -1) {
        return fail('NOT_FOUND', '记录不存在')
      }
      state.records.splice(index, 1)
      return ok({ recordId: request.recordId })
    },

    'records.totalsByAction': () => {
      const totals = new Map<number, number>()
      for (const record of state.records) {
        totals.set(record.actionId, (totals.get(record.actionId) ?? 0) + record.durationSec)
      }
      return ok([...totals].map(([actionId, durationSec]) => ({ actionId, durationSec })))
    },

    'stats.overview': (request) => ok(buildOverview(state.records, request.from, request.to)),

    'stats.bounds': () => {
      const dates = state.records.map((record) => record.localDate).sort()
      return ok({
        from: dates[0] ?? null,
        to: dates[dates.length - 1] ?? null,
      })
    },

    'stats.exportCsv': () => ok({ saved: true, path: 'memory/records.csv' }),

    'data.export': () =>
      ok({
        saved: true,
        path: 'memory/export.json',
        counts: {
          actions: state.actions.length,
          plans: state.plans.length,
          records: state.records.length,
          todos: state.todos.length,
        },
      }),

    'data.inspectImport': () =>
      ok({ canceled: true, token: null, counts: null, warnings: [] }),

    'data.import': () =>
      ok({
        counts: {
          actions: state.actions.length,
          plans: state.plans.length,
          records: state.records.length,
          todos: state.todos.length,
        },
      }),

    'backup.list': () => ok({ backups: [], dir: 'memory/backups' }),

    'backup.create': () =>
      ok({
        created: true,
        entry: { name: 'spendtime-20260101-000000.db', sizeBytes: 1024, createdAt: Date.now() },
      }),

    'backup.openDir': () => ok({ opened: true }),

    'backup.restore': () => ok({ restarting: true }),

    'plans.listWeek': () => ok([...state.plans]),

    'plans.create': (request) => {
      const action = state.actions.find((item) => item.id === request.actionId)
      if (action === undefined || action.archived) {
        return fail('UNKNOWN_ACTION', '所选行动不存在')
      }
      const plan: PlanViewDto = {
        id: state.nextId++,
        weekday: request.weekday,
        startMin: request.startMin,
        endMin: request.endMin,
        actionId: request.actionId,
        createdAt: Date.now(),
        alarmEnabled: request.alarmEnabled ?? true,
        actionName: action.name,
      }
      state.plans.push(plan)
      return ok(plan)
    },

    'plans.remove': (request) => {
      const index = state.plans.findIndex((item) => item.id === request.planId)
      if (index === -1) {
        return fail('NOT_FOUND', '计划不存在或已删除')
      }
      state.plans.splice(index, 1)
      return ok({ planId: request.planId })
    },

    'plans.update': (request) => {
      const plan = state.plans.find((item) => item.id === request.planId)
      if (plan === undefined) {
        return fail('NOT_FOUND', '计划不存在或已删除')
      }
      const action = state.actions.find((item) => item.id === request.actionId)
      if (action === undefined || action.archived) {
        return fail('UNKNOWN_ACTION', '所选行动不存在')
      }
      plan.weekday = request.weekday
      plan.startMin = request.startMin
      plan.endMin = request.endMin
      plan.actionId = request.actionId
      plan.actionName = action.name
      plan.alarmEnabled = request.alarmEnabled ?? true
      return ok({ ...plan })
    },

    'plans.setAlarm': (request) => {
      const plan = state.plans.find((item) => item.id === request.planId)
      if (plan === undefined) {
        return fail('NOT_FOUND', '计划不存在或已删除')
      }
      plan.alarmEnabled = request.enabled
      return ok({ ...plan })
    },

    'plans.copyWeekday': (request) => {
      const source = state.plans.filter((plan) => plan.weekday === request.from)
      for (const plan of source) {
        state.plans.push({ ...plan, id: state.nextId++, weekday: request.to })
      }
      return ok({ copied: source.length })
    },

    'todos.list': () =>
      ok(state.todos.filter((todo) => !todo.archived).sort((a, b) => a.sortOrder - b.sortOrder)),

    'todos.listArchived': () =>
      ok(
        state.todos
          .filter((todo) => todo.archived)
          .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
      ),

    'todos.create': (request) => {
      const title = request.title.trim()
      if (title === '') {
        return fail('EMPTY_TITLE', '待办内容不能为空')
      }
      const activeTodos = state.todos.filter((todo) => !todo.archived)
      const todo: TodoDto = {
        id: state.nextId++,
        title,
        completed: false,
        createdAt: Date.now(),
        completedAt: null,
        sortOrder: activeTodos.length + 1,
        archived: false,
        archivedAt: null,
      }
      state.todos.push(todo)
      return ok(todo)
    },

    'todos.toggle': (request) => {
      const todo = state.todos.find((item) => item.id === request.todoId)
      if (todo === undefined || todo.archived) {
        return fail('TODO_NOT_FOUND', '待办不存在或已归档')
      }
      todo.completed = !todo.completed
      todo.completedAt = todo.completed ? Date.now() : null
      return ok({ ...todo })
    },

    'todos.update': (request) => {
      const todo = state.todos.find((item) => item.id === request.todoId)
      if (todo === undefined) {
        return fail('TODO_NOT_FOUND', '待办不存在或已删除')
      }
      const title = request.title.trim()
      if (title === '') {
        return fail('EMPTY_TITLE', '待办内容不能为空')
      }
      todo.title = title
      return ok({ ...todo })
    },

    'todos.remove': (request) => {
      const index = state.todos.findIndex((item) => item.id === request.todoId)
      if (index === -1) {
        return fail('TODO_NOT_FOUND', '待办不存在或已删除')
      }
      state.todos.splice(index, 1)
      return ok({ todoId: request.todoId })
    },

    'todos.archive': (request) => {
      const todo = state.todos.find((item) => item.id === request.todoId)
      if (todo === undefined || todo.archived) {
        return fail('TODO_NOT_FOUND', '待办不存在或已归档')
      }
      todo.archived = true
      todo.archivedAt = Date.now()
      return ok({ ...todo })
    },

    'todos.restore': (request) => {
      const todo = state.todos.find((item) => item.id === request.todoId)
      if (todo === undefined || !todo.archived) {
        return fail('TODO_NOT_FOUND', '归档待办不存在')
      }
      todo.archived = false
      todo.archivedAt = null
      return ok({ ...todo })
    },

    'todos.reorder': (request) => {
      const active = state.todos.filter((todo) => !todo.archived).sort((a, b) => a.sortOrder - b.sortOrder)
      const index = active.findIndex((todo) => todo.id === request.todoId)
      if (index === -1) {
        return fail('TODO_NOT_FOUND', '待办不存在或已归档')
      }
      const target = request.direction === 'up' ? index - 1 : index + 1
      if (target >= 0 && target < active.length) {
        const current = active[index]
        const other = active[target]
        if (current !== undefined && other !== undefined) {
          const order = current.sortOrder
          current.sortOrder = other.sortOrder
          other.sortOrder = order
        }
      }
      return ok(active.sort((a, b) => a.sortOrder - b.sortOrder))
    },
  }

  function invoke<C extends CommandChannel>(
    channel: C,
    payload: CommandRequest<C>,
  ): Promise<CommandResponse<C>> {
    const handler = handlers[channel] as (request: CommandRequest<C>) => CommandResponse<C>
    return Promise.resolve(handler(payload))
  }

  // 假 API 不从主进程推送事件；界面自身的刷新逻辑已覆盖这些流程
  function on<E extends EventChannel>(
    _channel: E,
    _listener: (payload: EventPayload<E>) => void,
  ): () => void {
    return function unsubscribe(): void {
      // 无需清理
    }
  }

  return { invoke, on }
}

function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value }
}

function fail(
  code: string,
  message: string,
): { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  return { ok: false, error: { code, message } }
}

function snapshot(state: MockState): TimerSnapshotDto {
  if (state.timer.status !== 'running' || state.timer.startedAt === null) {
    return { ...state.timer }
  }
  const elapsedSec = Math.max(0, Math.floor((Date.now() - state.timer.startedAt) / 1000))
  const remainingSec =
    state.timer.targetSec === null ? null : Math.max(0, state.timer.targetSec - elapsedSec)
  return { ...state.timer, elapsedSec, remainingSec }
}

function atLocalMinute(timestamp: number, minute: number): number {
  return atLocalDateMinute(timestamp, 0, minute)
}

function atLocalDateMinute(timestamp: number, dayOffset: number, minute: number): number {
  const date = new Date(timestamp)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
  return date.getTime()
}

function localDate(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function buildOverview(records: readonly RecordDto[], from: string, to: string): StatsOverviewDto {
  const inRange = records.filter((record) => record.localDate >= from && record.localDate <= to)
  const totalSec = inRange.reduce((sum, record) => sum + record.durationSec, 0)

  const byActionMap = new Map<number, { actionName: string; durationSec: number; count: number }>()
  for (const record of inRange) {
    const entry = byActionMap.get(record.actionId) ?? {
      actionName: record.actionName,
      durationSec: 0,
      count: 0,
    }
    entry.durationSec += record.durationSec
    entry.count += 1
    byActionMap.set(record.actionId, entry)
  }

  return {
    byAction: [...byActionMap.entries()]
      .map(([actionId, entry]) => ({ actionId, share: totalSec === 0 ? 0 : entry.durationSec / totalSec, ...entry }))
      .sort((a, b) => b.durationSec - a.durationSec),
  }
}
