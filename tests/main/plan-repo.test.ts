﻿﻿﻿﻿﻿import { describe, expect, it } from 'vitest'
import { openDatabase, LATEST_SCHEMA_VERSION } from '../../src/main/adapters/sqlite/database'
import { createActionRepo, createPlanRepo } from '../../src/main/adapters/sqlite/repositories'

const NOW = 1_700_000_000_000

const logger = {
  info: (_message: string): void => undefined,
  error: (_message: string): void => undefined,
}

describe('plans SQLite 仓储', () => {
  it('支持按 id 查询与更新，并带上行动名与提醒开关', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const plans = createPlanRepo(db)

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)

    const deepWork = actions.create('深度工作', NOW)
    const reading = actions.create('阅读', NOW)
    const created = plans.create(
      { weekday: 1, startMin: 9 * 60, endMin: 10 * 60, actionId: deepWork.id, alarmEnabled: true },
      NOW,
    )

    expect(plans.findById(created.id)).toMatchObject({ actionName: '深度工作', alarmEnabled: true })

    const updated = plans.update(created.id, {
      weekday: 3,
      startMin: 10 * 60,
      endMin: 11 * 60,
      actionId: reading.id,
      alarmEnabled: false,
    })

    expect(updated).toMatchObject({
      id: created.id,
      weekday: 3,
      startMin: 600,
      endMin: 660,
      actionId: reading.id,
      actionName: '阅读',
      alarmEnabled: false,
    })
    expect(plans.findById(created.id)).toEqual(updated)
    expect(plans.findById(9999)).toBeNull()

    db.close()
  })

  it('可单独切换提醒开关', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const plans = createPlanRepo(db)

    const action = actions.create('写作', NOW)
    const plan = plans.create(
      { weekday: 5, startMin: 540, endMin: 600, actionId: action.id, alarmEnabled: true },
      NOW,
    )

    plans.setAlarmEnabled(plan.id, false)
    expect(plans.findById(plan.id)).toMatchObject({ alarmEnabled: false })

    plans.setAlarmEnabled(plan.id, true)
    expect(plans.findById(plan.id)).toMatchObject({ alarmEnabled: true })

    db.close()
  })
})
