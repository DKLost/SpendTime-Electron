import { describe, expect, it } from 'vitest'
import type { Action } from '@core/action'
import type { PlanView } from '@core/plan'
import type { ActionRepo, PlanRepo } from '@application/ports'
import { updatePlan } from '@application/use-cases/plans'
import { setPlanAlarm } from '@application/use-cases/plans'

const NOW = 1_700_000_000_000

function planView(overrides: Partial<PlanView> = {}): PlanView {
  return {
    id: 1,
    weekday: 1,
    startMin: 9 * 60,
    endMin: 10 * 60,
    actionId: 1,
    actionName: '深度工作',
    createdAt: NOW,
    alarmEnabled: true,
    ...overrides,
  }
}

function action(overrides: Partial<Action> = {}): Action {
  return {
    id: 1,
    name: '深度工作',
    archived: false,
    createdAt: NOW,
    archivedAt: null,
    timerTargetSec: null,
    startRingtone: null,
    endRingtone: null,
    sortOrder: 1,
    ...overrides,
  }
}

function createActionRepo(actions: readonly Action[]): ActionRepo {
  return {
    list: () => actions,
    findById: (id) => actions.find((item) => item.id === id) ?? null,
    create: (): Action => {
      throw new Error('测试用例不涉及新增行动')
    },
    rename: (): Action => {
      throw new Error('测试用例不涉及重命名行动')
    },
    archive: (): void => {
      throw new Error('测试用例不涉及归档行动')
    },
    restore: (): Action => {
      throw new Error('测试用例不涉及恢复行动')
    },
    remove: (): void => {
      throw new Error('测试用例不涉及删除行动')
    },
    setTimerTarget: (): Action => {
      throw new Error('测试用例不涉及倒计时')
    },
    setRingtone: (): Action => {
      throw new Error('测试用例不涉及铃声')
    },
    reorder: (): readonly Action[] => {
      throw new Error('测试用例不涉及排序')
    },
  }
}

function createPlanRepo(initial: readonly PlanView[], actions: readonly Action[]): PlanRepo {
  const plans = [...initial]

  return {
    listWeek: () => plans,
    listByWeekday: (weekday) => plans.filter((item) => item.weekday === weekday),
    findById: (id) => plans.find((item) => item.id === id) ?? null,
    create: (): PlanView => {
      throw new Error('测试用例不涉及新增计划')
    },
    update: (id, draft) => {
      const index = plans.findIndex((item) => item.id === id)
      const current = plans[index]
      if (current === undefined) {
        throw new Error('计划不存在')
      }
      const actionName = actions.find((item) => item.id === draft.actionId)?.name ?? ''
      const next: PlanView = { ...current, ...draft, actionName }
      plans[index] = next
      return next
    },
    remove: (): void => {
      throw new Error('测试用例不涉及删除计划')
    },
    removeByWeekday: (): void => {
      throw new Error('测试用例不涉及批量删除')
    },
    insertMany: (): void => {
      throw new Error('测试用例不涉及批量写入')
    },
    setAlarmEnabled: (id, enabled) => {
      const index = plans.findIndex((item) => item.id === id)
      const current = plans[index]
      if (current !== undefined) {
        plans[index] = { ...current, alarmEnabled: enabled }
      }
    },
    countByAction: (actionId) => plans.filter((item) => item.actionId === actionId).length,
    removeByAction: (): void => {
      throw new Error('测试用例不涉及按行动删除')
    },
  }
}

describe('updatePlan', () => {
  it('更新行动、时间与星期', () => {
    const actions = [action(), action({ id: 2, name: '阅读' })]
    const repo = createPlanRepo([planView()], actions)

    const result = updatePlan(repo, createActionRepo(actions), {
      planId: 1,
      weekday: 2,
      startMin: 10 * 60,
      endMin: 11 * 60,
      actionId: 2,
      alarmEnabled: true,
    })

    expect(result.ok).toBe(true)
    expect(repo.findById(1)).toMatchObject({
      weekday: 2,
      startMin: 600,
      endMin: 660,
      actionId: 2,
      actionName: '阅读',
    })
  })

  it('计划不存在时返回 NOT_FOUND', () => {
    const repo = createPlanRepo([], [action()])
    const result = updatePlan(repo, createActionRepo([action()]), {
      planId: 9,
      weekday: 1,
      startMin: 540,
      endMin: 600,
      actionId: 1,
      alarmEnabled: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('行动不存在或已归档时拒绝更新', () => {
    const actions = [action(), action({ id: 2, name: '旧行动', archived: true })]
    const repo = createPlanRepo([planView()], actions)

    const unknown = updatePlan(repo, createActionRepo(actions), {
      planId: 1,
      weekday: 1,
      startMin: 540,
      endMin: 600,
      actionId: 99,
      alarmEnabled: true,
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.error.code).toBe('UNKNOWN_ACTION')
    }

    const archived = updatePlan(repo, createActionRepo(actions), {
      planId: 1,
      weekday: 1,
      startMin: 540,
      endMin: 600,
      actionId: 2,
      alarmEnabled: true,
    })
    expect(archived.ok).toBe(false)
    if (!archived.ok) {
      expect(archived.error.code).toBe('ARCHIVED_ACTION')
    }
  })

  it('原时间段原样保存不会和自己重叠', () => {
    const actions = [action()]
    const repo = createPlanRepo([planView()], actions)

    const result = updatePlan(repo, createActionRepo(actions), {
      planId: 1,
      weekday: 1,
      startMin: 9 * 60,
      endMin: 10 * 60,
      actionId: 1,
      alarmEnabled: true,
    })

    expect(result.ok).toBe(true)
  })

  it('与同一天其它计划重叠时拒绝', () => {
    const actions = [action()]
    const repo = createPlanRepo(
      [planView(), planView({ id: 2, startMin: 10 * 60, endMin: 11 * 60 })],
      actions,
    )

    const result = updatePlan(repo, createActionRepo(actions), {
      planId: 1,
      weekday: 1,
      startMin: 9 * 60 + 30,
      endMin: 10 * 60 + 30,
      actionId: 1,
      alarmEnabled: true,
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('OVERLAP')
  })
})

describe('setPlanAlarm', () => {
  it('只切换提醒标记，不动时间与行动', () => {
    const repo = createPlanRepo([planView()], [action()])
    const result = setPlanAlarm(repo, 1, false)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toMatchObject({
      alarmEnabled: false,
      weekday: 1,
      startMin: 9 * 60,
      endMin: 10 * 60,
      actionId: 1,
    })
  })

  it('计划不存在时返回 NOT_FOUND', () => {
    const repo = createPlanRepo([], [action()])
    const result = setPlanAlarm(repo, 9, false)

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('NOT_FOUND')
  })
})
