﻿﻿﻿﻿﻿import { describe, expect, it } from 'vitest'
import type { AlarmFire } from '@core/alarm'
import { openDatabase, LATEST_SCHEMA_VERSION } from '../../src/main/adapters/sqlite/database'
import {
  createActionRepo,
  createAlarmEventRepo,
  createPlanRepo,
} from '../../src/main/adapters/sqlite/repositories'

const NOW = 1_700_000_000_000

const logger = {
  info: (_message: string): void => undefined,
  error: (_message: string): void => undefined,
}

function createFire(planId: number, actionId: number): AlarmFire {
  return {
    planId,
    actionId,
    actionName: '写作',
    startMin: 540,
    fireDate: '2026-11-13',
    targetSec: (630 - 540) * 60,
  }
}

describe('alarm_events SQLite 仓储', () => {
  it('迁移到当前版本，重复写入被 UNIQUE 忽略', () => {
    const db = openDatabase(':memory:', logger)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)

    const action = createActionRepo(db).create('写作', NOW)
    const plan = createPlanRepo(db).create(
      { weekday: 5, startMin: 540, endMin: 630, actionId: action.id, alarmEnabled: true },
      NOW,
    )
    const repo = createAlarmEventRepo(db)
    const fire = createFire(plan.id, action.id)

    repo.record(fire, NOW)
    repo.record(fire, NOW + 1000)

    expect(repo.listKeysByDate('2026-11-13')).toEqual([`${plan.id}:2026-11-13`])
    expect(repo.listKeysByDate('2026-11-12')).toEqual([])

    db.close()
  })

  it('删除计划时级联清理当天事件', () => {
    const db = openDatabase(':memory:', logger)
    const action = createActionRepo(db).create('阅读', NOW)
    const plans = createPlanRepo(db)
    const plan = plans.create(
      { weekday: 5, startMin: 600, endMin: 660, actionId: action.id, alarmEnabled: true },
      NOW,
    )
    const repo = createAlarmEventRepo(db)
    repo.record(createFire(plan.id, action.id), NOW)

    plans.remove(plan.id)

    expect(repo.listKeysByDate('2026-11-13')).toEqual([])
    db.close()
  })
})
