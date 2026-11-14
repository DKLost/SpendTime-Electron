import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/adapters/sqlite/database'
import {
  createActionRepo,
  createPlanRepo,
  createRecordRepo,
  createSettingsRepo,
} from '../../src/main/adapters/sqlite/repositories'

const NOW = 1_700_000_000_000

const logger = {
  info: (_message: string): void => undefined,
  error: (_message: string): void => undefined,
}

describe('actions SQLite 仓储', () => {
  it('支持重命名、归档与恢复', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const created = actions.create('深度工作', NOW)

    expect(actions.rename(created.id, '专注工作').name).toBe('专注工作')
    expect(actions.findById(created.id)?.name).toBe('专注工作')

    actions.archive(created.id, NOW + 1000)
    expect(actions.list(false)).toHaveLength(0)
    expect(actions.findById(created.id)?.archived).toBe(true)
    expect(actions.findById(created.id)?.archivedAt).toBe(NOW + 1000)

    const restored = actions.restore(created.id)
    expect(restored.archived).toBe(false)
    expect(restored.archivedAt).toBeNull()
    expect(actions.list(false)).toHaveLength(1)

    db.close()
  })

  it('按行动统计计划与记录关联数', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const plans = createPlanRepo(db)
    const records = createRecordRepo(db)
    const created = actions.create('阅读', NOW)
    const other = actions.create('运动', NOW)

    plans.create(
      { weekday: 1, startMin: 540, endMin: 600, actionId: created.id, alarmEnabled: true },
      NOW,
    )
    plans.create(
      { weekday: 2, startMin: 660, endMin: 720, actionId: created.id, alarmEnabled: true },
      NOW,
    )
    plans.create(
      { weekday: 3, startMin: 780, endMin: 840, actionId: other.id, alarmEnabled: true },
      NOW,
    )

    records.insertMany([
      {
        actionId: created.id,
        sessionId: 's-1',
        sessionSeq: 1,
        startAt: NOW,
        endAt: NOW + 3_600_000,
        durationSec: 3600,
        localDate: '2026-11-13',
        source: 'timer',
      },
    ])

    expect(plans.countByAction(created.id)).toBe(2)
    expect(plans.countByAction(other.id)).toBe(1)
    expect(records.countByAction(created.id)).toBe(1)
    expect(records.countByAction(other.id)).toBe(0)

    db.close()
  })

  it('按行动记忆倒计时并聚合实际用时', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const records = createRecordRepo(db)
    const created = actions.create('写作', NOW)

    expect(actions.findById(created.id)?.timerTargetSec).toBeNull()
    expect(actions.setTimerTarget(created.id, 1500).timerTargetSec).toBe(1500)
    expect(actions.findById(created.id)?.timerTargetSec).toBe(1500)
    expect(actions.setTimerTarget(created.id, null).timerTargetSec).toBeNull()

    records.insertMany([
      {
        actionId: created.id,
        sessionId: 's-1',
        sessionSeq: 1,
        startAt: NOW,
        endAt: NOW + 1_800_000,
        durationSec: 1800,
        localDate: '2026-11-13',
        source: 'timer',
      },
      {
        actionId: created.id,
        sessionId: 's-2',
        sessionSeq: 1,
        startAt: NOW + 3_600_000,
        endAt: NOW + 4_200_000,
        durationSec: 600,
        localDate: '2026-11-13',
        source: 'timer',
      },
    ])
    expect(records.totalsByAction()).toEqual([{ actionId: created.id, durationSec: 2400 }])

    db.close()
  })

  it('保存行动铃声覆盖与全局默认铃声', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const settings = createSettingsRepo(db)
    const created = actions.create('写作', NOW)

    expect(created.startRingtone).toBeNull()
    expect(actions.setRingtone(created.id, 'start', 'bell').startRingtone).toBe('bell')
    expect(actions.setRingtone(created.id, 'end', 'none').endRingtone).toBe('none')
    expect(actions.findById(created.id)?.startRingtone).toBe('bell')
    expect(actions.findById(created.id)?.endRingtone).toBe('none')

    expect(settings.get('ringtone.defaultStart')).toBeNull()
    settings.set('ringtone.defaultStart', 'pulse')
    expect(settings.get('ringtone.defaultStart')).toBe('pulse')
    settings.set('ringtone.defaultStart', 'bell')
    expect(settings.get('ringtone.defaultStart')).toBe('bell')

    db.close()
  })
})
