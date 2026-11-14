import { describe, expect, it } from 'vitest'
import type { ActionRepo, PlanRepo, RecordRepo, SessionStore, UnitOfWork } from '@application/ports'
import {
  archiveAction,
  createAction,
  deleteAction,
  renameAction,
  restoreAction,
  setActionTimerTarget,
} from '@application/use-cases/actions'
import type { Action } from '@core/action'

const NOW = 1_700_000_000_000

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

function createActionRepo(initial: readonly Action[]): ActionRepo {
  const rows = initial.map((item) => ({ ...item }))

  return {
    list: (includeArchived) => (includeArchived ? rows : rows.filter((item) => !item.archived)),
    findById: (id) => rows.find((item) => item.id === id) ?? null,
    create: (name, now) => {
      const created: Action = {
        id: rows.length + 1,
        name,
        archived: false,
        createdAt: now,
        archivedAt: null,
        timerTargetSec: null,
        startRingtone: null,
        endRingtone: null,
        sortOrder: rows.length + 1,
      }
      rows.push(created)
      return created
    },
    rename: (id, name) => {
      const index = rows.findIndex((item) => item.id === id)
      const current = rows[index]
      if (current === undefined) {
        throw new Error('行动不存在')
      }
      const next: Action = { ...current, name }
      rows[index] = next
      return next
    },
    archive: (id, now) => {
      const index = rows.findIndex((item) => item.id === id)
      const current = rows[index]
      if (current !== undefined) {
        rows[index] = { ...current, archived: true, archivedAt: now }
      }
    },
    restore: (id) => {
      const index = rows.findIndex((item) => item.id === id)
      const current = rows[index]
      if (current === undefined) {
        throw new Error('行动不存在')
      }
      const next: Action = { ...current, archived: false, archivedAt: null }
      rows[index] = next
      return next
    },
    remove: (id) => {
      const index = rows.findIndex((item) => item.id === id)
      if (index >= 0) {
        rows.splice(index, 1)
      }
    },
    setTimerTarget: (id, targetSec) => {
      const index = rows.findIndex((item) => item.id === id)
      const current = rows[index]
      if (current === undefined) {
        throw new Error('行动不存在')
      }
      const next: Action = { ...current, timerTargetSec: targetSec }
      rows[index] = next
      return next
    },
    setRingtone: () => {
      throw new Error('测试用例不涉及铃声')
    },
    reorder: (id, direction) => {
      const peers = rows.filter((item) => !item.archived)
      const index = peers.findIndex((item) => item.id === id)
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      const other = peers[swapIndex]
      const target = peers[index]
      if (other !== undefined && target !== undefined) {
        const targetOrder = target.sortOrder
        const otherOrder = other.sortOrder
        Object.assign(target, { sortOrder: otherOrder })
        Object.assign(other, { sortOrder: targetOrder })
      }
      return rows.filter((item) => !item.archived)
    },
  }
}

function createPlanRepo(planCount: number): PlanRepo {
  return { countByAction: () => planCount } as unknown as PlanRepo
}

function createRecordRepo(recordCount: number): RecordRepo {
  return { countByAction: () => recordCount } as unknown as RecordRepo
}

describe('renameAction', () => {
  it('规范化空白并允许保留自己的名字', () => {
    const repo = createActionRepo([action()])
    const result = renameAction(repo, 1, '  深度   工作  ')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.name).toBe('深度 工作')
    expect(repo.findById(1)?.name).toBe('深度 工作')
  })

  it('拒绝空名称与超长名称', () => {
    const repo = createActionRepo([action()])
    const empty = renameAction(repo, 1, '   ')
    expect(empty.ok).toBe(false)
    if (!empty.ok) {
      expect(empty.error.code).toBe('EMPTY_NAME')
    }

    const tooLong = renameAction(repo, 1, 'x'.repeat(41))
    expect(tooLong.ok).toBe(false)
  })

  it('拒绝与其它行动重名', () => {
    const repo = createActionRepo([action(), action({ id: 2, name: '阅读' })])
    const result = renameAction(repo, 1, '阅读')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('DUPLICATE_NAME')
    }
  })

  it('行动不存在时返回 NOT_FOUND', () => {
    const repo = createActionRepo([action()])
    const result = renameAction(repo, 99, '新名字')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
  })
})

describe('archiveAction', () => {
  it('返回计划与记录关联数并标记归档', () => {
    const repo = createActionRepo([action()])
    const result = archiveAction(repo, createPlanRepo(2), createRecordRepo(5), 1, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toEqual({ actionId: 1, planCount: 2, recordCount: 5 })
    expect(repo.findById(1)?.archived).toBe(true)
    expect(repo.findById(1)?.archivedAt).toBe(NOW)
    expect(repo.list(false)).toHaveLength(0)
  })

  it('归档不存在的行动返回 NOT_FOUND', () => {
    const repo = createActionRepo([action()])
    const result = archiveAction(repo, createPlanRepo(0), createRecordRepo(0), 9, NOW)
    expect(result.ok).toBe(false)
  })
})

describe('restoreAction', () => {
  it('恢复后重新出现在可选行动中', () => {
    const repo = createActionRepo([action({ archived: true })])
    const result = restoreAction(repo, 1)
    expect(result.ok).toBe(true)
    expect(repo.findById(1)?.archived).toBe(false)
    expect(repo.list(false)).toHaveLength(1)
  })
})

describe('createAction', () => {
  it('继续复用同一套名称校验', () => {
    const repo = createActionRepo([action()])
    expect(createAction(repo, '深度工作', NOW).ok).toBe(false)
    expect(createAction(repo, '阅读', NOW).ok).toBe(true)
  })
})

describe('deleteAction', () => {
  it('删除行动并清理关联计划、记录与会话', () => {
    const repo = createActionRepo([action()])
    const plans = {
      countByAction: () => 3,
      removeByAction: () => undefined,
    } as unknown as PlanRepo
    const records = {
      countByAction: () => 7,
      removeByAction: () => undefined,
    } as unknown as RecordRepo
    const cleared: number[] = []
    const sessions = { clearByAction: (actionId: number) => cleared.push(actionId) } as unknown as SessionStore
    const unitOfWork: UnitOfWork = { run: (work) => work() }

    const result = deleteAction(repo, plans, records, sessions, unitOfWork, 1, null)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toEqual({ actionId: 1, planCount: 3, recordCount: 7 })
    expect(cleared).toEqual([1])
    expect(repo.findById(1)).toBeNull()
  })

  it('计时中的行动拒绝删除', () => {
    const repo = createActionRepo([action()])
    const plans = { countByAction: () => 0, removeByAction: () => undefined } as unknown as PlanRepo
    const records = { countByAction: () => 0, removeByAction: () => undefined } as unknown as RecordRepo
    const sessions = { clearByAction: () => undefined } as unknown as SessionStore
    const result = deleteAction(repo, plans, records, sessions, { run: (work) => work() }, 1, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('ACTION_RUNNING')
    }
  })
})

describe('setActionTimerTarget', () => {
  it('按行动记忆倒计时并可清除', () => {
    const repo = createActionRepo([action()])
    const saved = setActionTimerTarget(repo, 1, 25 * 60)
    expect(saved.ok).toBe(true)
    expect(repo.findById(1)?.timerTargetSec).toBe(1500)

    expect(setActionTimerTarget(repo, 1, null).ok).toBe(true)
    expect(repo.findById(1)?.timerTargetSec).toBeNull()
  })

  it('拒绝越界值与不存在的行动', () => {
    const repo = createActionRepo([action()])
    expect(setActionTimerTarget(repo, 1, 0).ok).toBe(false)
    expect(setActionTimerTarget(repo, 1, 86_401).ok).toBe(false)
    expect(setActionTimerTarget(repo, 9, 60).ok).toBe(false)
  })
})
