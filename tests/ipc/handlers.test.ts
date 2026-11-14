import { afterEach, describe, expect, it } from 'vitest'
import { createHandlerHarness, type HandlerHarness } from '../helpers/handler-harness'

let harness: HandlerHarness | null = null

function setup(): HandlerHarness {
  harness = createHandlerHarness()
  return harness
}

afterEach(() => {
  harness?.dispose()
  harness = null
})

describe('app 通道', () => {
  it('bootstrap 返回版本、数据目录与行动列表', () => {
    const { handlers } = setup()
    const result = handlers['app.bootstrap']({})
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.appVersion).toBe('0.0.0-test')
    expect(result.value.dataDir).toBe('test-data')
    expect(result.value.timer.status).toBe('idle')
    expect(result.value.actions).toEqual([])
  })

  it('相同错误消息一分钟内只记录一次，之后重新记录', () => {
    const { handlers, logs, clock } = setup()
    const first = handlers['app.reportError']({ message: '渲染失败', stack: 'at foo', source: 'error' })
    const second = handlers['app.reportError']({ message: '渲染失败', stack: 'at foo', source: 'error' })

    expect(first).toEqual({ ok: true, value: { reported: true, throttled: false } })
    expect(second).toEqual({ ok: true, value: { reported: false, throttled: true } })
    expect(logs.filter((entry) => entry.level === 'error')).toHaveLength(1)

    clock.setNow(clock.now() + 60_001)
    const third = handlers['app.reportError']({ message: '渲染失败', source: 'unhandledrejection' })
    expect(third).toEqual({ ok: true, value: { reported: true, throttled: false } })
  })
})

describe('actions 通道', () => {
  it('创建、重命名、归档、恢复并广播变更', () => {
    const { handlers, published } = setup()
    const created = handlers['actions.create']({ name: '深度工作' })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }

    const renamed = handlers['actions.rename']({ actionId: created.value.id, name: '专注工作' })
    expect(renamed.ok && renamed.value.name).toBe('专注工作')

    const archived = handlers['actions.archive']({ actionId: created.value.id })
    expect(archived).toEqual({
      ok: true,
      value: { actionId: created.value.id, planCount: 0, recordCount: 0 },
    })
    const activeAfterArchive = handlers['actions.list']({})
    expect(activeAfterArchive.ok && activeAfterArchive.value).toHaveLength(0)

    const restored = handlers['actions.restore']({ actionId: created.value.id })
    expect(restored.ok).toBe(true)
    expect(published).toEqual(['actions', 'actions', 'actions', 'actions'])
  })

  it('空名、重名、缺失行动返回业务错误且不广播', () => {
    const { handlers, published } = setup()
    const first = handlers['actions.create']({ name: '阅读' })
    expect(first.ok).toBe(true)
    expect(handlers['actions.create']({ name: '阅读' })).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_NAME' },
    })
    expect(handlers['actions.create']({ name: '   ' })).toMatchObject({
      ok: false,
      error: { code: 'EMPTY_NAME' },
    })
    expect(handlers['actions.rename']({ actionId: 999, name: '新名' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
    expect(published).toEqual(['actions'])
  })
})

describe('actions.reorder 通道', () => {
  it('同一列表内上下移动并返回新顺序', () => {
    const { handlers, published } = setup()
    const first = handlers['actions.create']({ name: '第一' })
    const second = handlers['actions.create']({ name: '第二' })
    if (!first.ok || !second.ok) {
      return
    }

    const moved = handlers['actions.reorder']({ actionId: second.value.id, direction: 'up' })
    expect(moved.ok && moved.value.map((action) => action.name)).toEqual(['第二', '第一'])

    const restoredOrder = handlers['actions.reorder']({ actionId: first.value.id, direction: 'up' })
    expect(restoredOrder.ok && restoredOrder.value.map((action) => action.name)).toEqual(['第一', '第二'])
    expect(published).toEqual(['actions', 'actions', 'actions', 'actions'])
  })
})

describe('settings 通道', () => {
  it('返回快照并持久化合法设置', () => {
    const { handlers } = setup()
    const snapshot = handlers['settings.get']({})
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) {
      return
    }
    expect(snapshot.value.dataDir).toBe('test-data')
    expect(snapshot.value.logDir).toBe('test-logs')
    expect(snapshot.value.settings.soundEnabled).toBe(true)

    const updated = handlers['settings.update']({ patch: { soundEnabled: false, density: 'comfortable' } })
    expect(updated.ok && updated.value.soundEnabled).toBe(false)
    expect(updated.ok && updated.value.density).toBe('comfortable')

    const reloaded = handlers['settings.get']({})
    expect(reloaded.ok && reloaded.value.settings.soundEnabled).toBe(false)
  })

  it('越界循环上限返回业务错误且不落库', () => {
    const { handlers } = setup()
    expect(handlers['settings.update']({ patch: { alarmLoopMaxSec: 10 } })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SETTING' },
    })
    const snapshot = handlers['settings.get']({})
    expect(snapshot.ok && snapshot.value.settings.alarmLoopMaxSec).toBe(120)
  })
})

describe('ringtones 通道', () => {
  it('默认铃声可改，行动覆盖包含多种取值并广播变更', () => {
    const { handlers, published } = setup()
    expect(handlers['ringtones.get']({})).toEqual({
      ok: true,
      value: { defaultStart: 'chime', defaultEnd: 'chime' },
    })

    const updated = handlers['ringtones.setDefault']({ kind: 'start', value: 'bell' })
    expect(updated).toEqual({ ok: true, value: { defaultStart: 'bell', defaultEnd: 'chime' } })

    const action = handlers['actions.create']({ name: '写作' })
    if (!action.ok) {
      return
    }

    const customized = handlers['ringtones.setAction']({
      actionId: action.value.id,
      kind: 'start',
      value: 'pulse',
    })
    expect(customized.ok && customized.value.startRingtone).toBe('pulse')

    const muted = handlers['ringtones.setAction']({
      actionId: action.value.id,
      kind: 'end',
      value: 'none',
    })
    expect(muted.ok && muted.value.endRingtone).toBe('none')

    const inherited = handlers['ringtones.setAction']({
      actionId: action.value.id,
      kind: 'start',
      value: 'inherit',
    })
    expect(inherited.ok && inherited.value.startRingtone).toBeNull()

    expect(
      handlers['ringtones.setAction']({ actionId: 999, kind: 'start', value: 'bell' }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(published).toEqual(['actions', 'actions', 'actions', 'actions'])
  })
})

describe('timer 通道', () => {
  it('未知或已归档行动不能开始计时', () => {
    const { handlers } = setup()
    expect(handlers['timer.start']({ actionId: 999, targetSec: null })).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_ACTION' },
    })

    const created = handlers['actions.create']({ name: '归档项' })
    if (!created.ok) {
      return
    }
    handlers['actions.archive']({ actionId: created.value.id })
    expect(handlers['timer.start']({ actionId: created.value.id, targetSec: null })).toMatchObject({
      ok: false,
      error: { code: 'ARCHIVED_ACTION' },
    })
  })

  it('开始后状态为运行中，结束生成当天记录', () => {
    const { handlers, clock } = setup()
    const created = handlers['actions.create']({ name: '写作' })
    if (!created.ok) {
      return
    }

    const started = handlers['timer.start']({ actionId: created.value.id, targetSec: null })
    expect(started.ok && started.value.status).toBe('running')
    expect(handlers['timer.start']({ actionId: created.value.id, targetSec: null })).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_RUNNING' },
    })

    clock.setNow(clock.now() + 30 * 60_000)
    const stopped = handlers['timer.stop']({})
    expect(stopped.ok && stopped.value.status).toBe('idle')

    const records = handlers['records.listByDate']({ date: '2026-11-13' })
    expect(records.ok && records.value).toHaveLength(1)
    expect(records.ok && records.value[0]?.durationSec).toBe(30 * 60)
  })
})

describe('plans 通道', () => {
  it('创建、切换提醒、复制与重叠校验', () => {
    const { handlers } = setup()
    const action = handlers['actions.create']({ name: '晨间' })
    if (!action.ok) {
      return
    }

    const created = handlers['plans.create']({
      weekday: 1,
      startMin: 540,
      endMin: 600,
      actionId: action.value.id,
    })
    expect(created.ok && created.value.alarmEnabled).toBe(true)

    expect(
      handlers['plans.create']({
        weekday: 1,
        startMin: 570,
        endMin: 630,
        actionId: action.value.id,
      }),
    ).toMatchObject({ ok: false, error: { code: 'OVERLAP' } })

    if (!created.ok) {
      return
    }
    const toggled = handlers['plans.setAlarm']({ planId: created.value.id, enabled: false })
    expect(toggled.ok && toggled.value.alarmEnabled).toBe(false)

    const copied = handlers['plans.copyWeekday']({ from: 1, to: 2 })
    expect(copied).toEqual({ ok: true, value: { copied: 1 } })
    const weekPlans = handlers['plans.listWeek']({})
    expect(weekPlans.ok && weekPlans.value).toHaveLength(2)
  })
})

describe('todos 通道', () => {
  it('创建、完成、归档、恢复与排序', () => {
    const { handlers } = setup()
    expect(handlers['todos.create']({ title: '   ' })).toMatchObject({
      ok: false,
      error: { code: 'EMPTY_TITLE' },
    })

    const first = handlers['todos.create']({ title: '写周报' })
    const second = handlers['todos.create']({ title: '回顾' })
    if (!first.ok || !second.ok) {
      return
    }
    expect(first.value.title).toBe('写周报')

    const toggled = handlers['todos.toggle']({ todoId: first.value.id })
    expect(toggled.ok && toggled.value.completed).toBe(true)

    const reordered = handlers['todos.reorder']({ todoId: second.value.id, direction: 'up' })
    expect(reordered.ok && reordered.value.map((todo) => todo.id)).toEqual([second.value.id, first.value.id])

    const archived = handlers['todos.archive']({ todoId: first.value.id })
    expect(archived.ok && archived.value.archived).toBe(true)
    const activeTodos = handlers['todos.list']({})
    expect(activeTodos.ok && activeTodos.value).toHaveLength(1)
    const archivedTodos = handlers['todos.listArchived']({})
    expect(archivedTodos.ok && archivedTodos.value).toHaveLength(1)

    const restored = handlers['todos.restore']({ todoId: first.value.id })
    expect(restored.ok && restored.value.archived).toBe(false)
    const activeAfterRestore = handlers['todos.list']({})
    expect(activeAfterRestore.ok && activeAfterRestore.value).toHaveLength(2)
  })
})

describe('records 通道', () => {
  function seedRecord(): { handlers: ReturnType<typeof setup>['handlers']; recordId: number; startAt: number } {
    const { handlers, clock } = setup()
    const action = handlers['actions.create']({ name: '调试' })
    if (!action.ok) {
      throw new Error('创建行动失败')
    }
    const startAt = clock.now()
    handlers['timer.start']({ actionId: action.value.id, targetSec: null })
    clock.setNow(startAt + 10 * 60_000)
    handlers['timer.stop']({})

    const listed = handlers['records.listByDate']({ date: '2026-11-13' })
    if (!listed.ok || listed.value[0] === undefined) {
      throw new Error('记录未生成')
    }
    return { handlers, recordId: listed.value[0].id, startAt }
  }

  it('编辑同一自然日内的记录成功，跨日与倒序返回错误', () => {
    const { handlers, recordId, startAt } = seedRecord()
    const updated = handlers['records.update']({
      recordId,
      startAt: startAt + 60_000,
      endAt: startAt + 20 * 60_000,
    })
    expect(updated.ok && updated.value.durationSec).toBe(19 * 60)

    expect(
      handlers['records.update']({ recordId, startAt, endAt: startAt + 86_400_000 }),
    ).toMatchObject({ ok: false, error: { code: 'CROSS_DAY' } })
    expect(
      handlers['records.update']({ recordId, startAt, endAt: startAt }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_RANGE' } })
  })

  it('删除记录后列表为空', () => {
    const { handlers, recordId } = seedRecord()
    expect(handlers['records.remove']({ recordId })).toEqual({ ok: true, value: { recordId } })
    const listed = handlers['records.listByDate']({ date: '2026-11-13' })
    expect(listed.ok && listed.value).toHaveLength(0)
  })
})

describe('stats 通道', () => {
  it('区间汇总包含各行动时长', () => {
    const { handlers, clock } = setup()
    const action = handlers['actions.create']({ name: '统计' })
    if (!action.ok) {
      return
    }
    handlers['timer.start']({ actionId: action.value.id, targetSec: null })
    clock.setNow(clock.now() + 25 * 60_000)
    handlers['timer.stop']({})

    const stats = handlers['stats.overview']({ from: '2026-11-01', to: '2026-11-30' })
    expect(stats.ok).toBe(true)
    if (!stats.ok) {
      return
    }
    expect(stats.value.byAction[0]?.durationSec).toBe(25 * 60)
    expect(stats.value.byAction[0]?.actionName).toBe('统计')
  })
})
