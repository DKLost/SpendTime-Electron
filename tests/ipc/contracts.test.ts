import { describe, expect, it } from 'vitest'
import { commands, type CommandChannel } from '../../src/shared/contracts'

// 通道集合的快照：新增/删除通道必须同步更新这里与 harness 的假 API
const EXPECTED_CHANNELS: readonly CommandChannel[] = [
  'app.bootstrap',
  'app.reportError',
  'actions.list',
  'actions.create',
  'actions.rename',
  'actions.archive',
  'actions.restore',
  'actions.remove',
  'actions.setTimerTarget',
  'actions.reorder',
  'settings.get',
  'settings.update',
  'app.openDataDir',
  'app.openLogDir',
  'app.exportDiagnostics',
  'app.openCrashDir',
  'ringtones.get',
  'ringtones.list',
  'ringtones.import',
  'ringtones.commitImport',
  'ringtones.cancelImport',
  'ringtones.rename',
  'ringtones.updateClip',
  'ringtones.remove',
  'ringtones.setDefault',
  'ringtones.setAction',
  'timer.start',
  'timer.stop',
  'timer.getState',
  'records.listByDate',
  'records.update',
  'records.remove',
  'records.totalsByAction',
  'stats.overview',
  'stats.bounds',
  'stats.exportCsv',
  'data.export',
  'data.inspectImport',
  'data.import',
  'backup.list',
  'backup.create',
  'backup.openDir',
  'backup.restore',
  'alarms.pending',
  'plans.listWeek',
  'plans.create',
  'plans.remove',
  'plans.update',
  'plans.setAlarm',
  'plans.copyWeekday',
  'todos.list',
  'todos.listArchived',
  'todos.create',
  'todos.toggle',
  'todos.update',
  'todos.remove',
  'todos.archive',
  'todos.restore',
  'todos.reorder',
]

const VALID_REQUESTS: Readonly<Record<CommandChannel, unknown>> = {
  'app.bootstrap': {},
  'app.reportError': { message: '渲染失败', stack: 'at foo', source: 'error' },
  'actions.list': { includeArchived: true },
  'actions.create': { name: '阅读' },
  'actions.rename': { actionId: 1, name: '阅读' },
  'actions.archive': { actionId: 1 },
  'actions.restore': { actionId: 1 },
  'actions.remove': { actionId: 1 },
  'actions.setTimerTarget': { actionId: 1, targetSec: 1500 },
  'actions.reorder': { actionId: 1, direction: 'up' },
  'settings.get': {},
  'settings.update': { patch: { soundEnabled: false, alarmLoopMaxSec: 60 } },
  'app.openDataDir': {},
  'app.openLogDir': {},
  'app.exportDiagnostics': {},
  'app.openCrashDir': {},
  'ringtones.get': {},
  'ringtones.list': {},
  'ringtones.import': {},
  'ringtones.commitImport': {
    token: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
    startSec: 0,
    endSec: 12.5,
  },
  'ringtones.cancelImport': { token: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff' },
  'ringtones.rename': { ringtoneId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', name: '我的铃声' },
  'ringtones.updateClip': {
    ringtoneId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
    startSec: 2,
    endSec: 8.5,
  },
  'ringtones.remove': { ringtoneId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff' },
  'ringtones.setDefault': { kind: 'start', value: 'bell' },
  'ringtones.setAction': { actionId: 1, kind: 'end', value: 'inherit' },
  'timer.start': { actionId: 1, targetSec: 1500 },
  'timer.stop': {},
  'timer.getState': {},
  'records.listByDate': { date: '2026-11-13' },
  'records.update': { recordId: 1, startAt: 1_700_000_000_000, endAt: 1_700_000_600_000 },
  'records.remove': { recordId: 1 },
  'records.totalsByAction': {},
  'stats.overview': { from: '2026-11-01', to: '2026-11-30' },
  'stats.bounds': {},
  'stats.exportCsv': { from: '2026-11-01', to: '2026-11-30' },
  'data.export': {},
  'data.inspectImport': {},
  'data.import': { token: 'import-token-1' },
  'backup.list': {},
  'backup.create': {},
  'backup.openDir': {},
  'backup.restore': { name: 'spendtime-20260101-000000.db' },
  'alarms.pending': {},
  'plans.listWeek': {},
  'plans.create': { weekday: 1, startMin: 540, endMin: 600, actionId: 1, alarmEnabled: true },
  'plans.remove': { planId: 1 },
  'plans.update': { planId: 1, weekday: 2, startMin: 540, endMin: 600, actionId: 1 },
  'plans.setAlarm': { planId: 1, enabled: false },
  'plans.copyWeekday': { from: 1, to: 2 },
  'todos.list': {},
  'todos.listArchived': {},
  'todos.create': { title: '写周报' },
  'todos.toggle': { todoId: 1 },
  'todos.update': { todoId: 1, title: '改过的待办' },
  'todos.remove': { todoId: 1 },
  'todos.archive': { todoId: 1 },
  'todos.restore': { todoId: 1 },
  'todos.reorder': { todoId: 1, direction: 'down' },
}

const INVALID_REQUESTS: readonly { readonly channel: CommandChannel; readonly request: unknown }[] = [
  { channel: 'app.reportError', request: { message: '' } },
  { channel: 'app.reportError', request: { message: 'x', source: 'other' } },
  { channel: 'actions.create', request: { name: 7 } },
  { channel: 'actions.rename', request: { name: '缺少 id' } },
  { channel: 'ringtones.setDefault', request: { kind: 'start', value: 'inherit' } },
  { channel: 'ringtones.setAction', request: { actionId: 1, kind: 'start', value: 'bell.wav' } },
  { channel: 'timer.start', request: { actionId: 0 } },
  { channel: 'timer.start', request: { actionId: 1, targetSec: 0 } },
  { channel: 'records.listByDate', request: { date: '2026/11/13' } },
  { channel: 'stats.overview', request: { from: '2026-11-01' } },
  { channel: 'data.import', request: { token: '' } },
  { channel: 'backup.restore', request: { name: '' } },
  { channel: 'plans.create', request: { weekday: 8, startMin: 540, endMin: 600, actionId: 1 } },
  { channel: 'plans.create', request: { weekday: 1, startMin: -1, endMin: 600, actionId: 1 } },
  { channel: 'todos.reorder', request: { todoId: 1, direction: 'left' } },
  { channel: 'records.remove', request: { recordId: -3 } },
]

describe('IPC 契约', () => {
  it('通道集合与预期一致', () => {
    expect(Object.keys(commands).sort()).toEqual([...EXPECTED_CHANNELS].sort())
  })

  it('每个通道都接受合法请求', () => {
    for (const channel of EXPECTED_CHANNELS) {
      const result = commands[channel].request.safeParse(VALID_REQUESTS[channel])
      expect(result.success, `${channel} 应接受合法请求`).toBe(true)
    }
  })

  it('必填字段缺失或类型不符时拒绝', () => {
    for (const channel of EXPECTED_CHANNELS) {
      const result = commands[channel].request.safeParse(null)
      expect(result.success, `${channel} 应拒绝 null`).toBe(false)
    }
    for (const sample of INVALID_REQUESTS) {
      const result = commands[sample.channel].request.safeParse(sample.request)
      expect(result.success, `${sample.channel} 应拒绝 ${JSON.stringify(sample.request)}`).toBe(false)
    }
  })

  it('请求缺省值符合界面预期', () => {
    const start = commands['timer.start'].request.parse({ actionId: 1 })
    expect(start.targetSec).toBeNull()
    const plan = commands['plans.create'].request.parse({
      weekday: 1,
      startMin: 540,
      endMin: 600,
      actionId: 1,
    })
    expect(plan.alarmEnabled).toBe(true)
    const list = commands['actions.list'].request.parse({})
    expect(list.includeArchived).toBe(false)
  })

  it('错误信封形状固定为 code + message', () => {
    const response = commands['actions.list'].response
    expect(response.safeParse({ ok: true, value: [] }).success).toBe(true)
    expect(
      response.safeParse({ ok: false, error: { code: 'INVALID_REQUEST', message: '参数不合法' } }).success,
    ).toBe(true)
    expect(response.safeParse({ ok: false, error: { code: 'INVALID_REQUEST' } }).success).toBe(false)
    // 未知键被剥离，不视为错误
    expect(
      response.safeParse({ ok: false, error: { code: 'X', message: 'y' }, extra: 1 }).success,
    ).toBe(true)
  })
})
