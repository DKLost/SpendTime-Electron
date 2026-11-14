import type { Action } from '@core/action'
import { err, ok, type Result } from '@core/result'
import type { ActionId, EpochMs } from '@core/types'
import type { ActionRepo, PlanRepo, RecordRepo, SessionStore, UnitOfWork } from '../ports'

export type ActionError = {
  readonly code: 'EMPTY_NAME' | 'NAME_TOO_LONG' | 'DUPLICATE_NAME' | 'NOT_FOUND' | 'ACTION_RUNNING' | 'INVALID_TARGET'
  readonly message: string
}

export const MAX_ACTION_NAME_LENGTH = 40
export const MAX_TIMER_TARGET_SEC = 86_400

export type ActionUsage = {
  readonly actionId: number
  readonly planCount: number
  readonly recordCount: number
}

export function listActions(repo: ActionRepo, includeArchived: boolean): readonly Action[] {
  return repo.list(includeArchived)
}

// 名称规范化属于业务规则，放在这里而不是 UI 或 SQL
export function normalizeActionName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function createAction(
  repo: ActionRepo,
  rawName: string,
  now: EpochMs,
): Result<Action, ActionError> {
  const validated = validateActionName(repo, rawName, null)
  if (!validated.ok) {
    return err(validated.error)
  }
  return ok(repo.create(validated.value, now))
}

export function renameAction(
  repo: ActionRepo,
  actionId: ActionId,
  rawName: string,
): Result<Action, ActionError> {
  if (repo.findById(actionId) === null) {
    return err({ code: 'NOT_FOUND', message: '行动不存在或已删除' })
  }

  const validated = validateActionName(repo, rawName, actionId)
  if (!validated.ok) {
    return err(validated.error)
  }
  return ok(repo.rename(actionId, validated.value))
}

// 归档前统计关联，供界面提示计划仍保留、历史记录不受影响
export function archiveAction(
  repo: ActionRepo,
  plans: PlanRepo,
  records: RecordRepo,
  actionId: ActionId,
  now: EpochMs,
): Result<ActionUsage, ActionError> {
  if (repo.findById(actionId) === null) {
    return err({ code: 'NOT_FOUND', message: '行动不存在或已删除' })
  }

  const planCount = plans.countByAction(actionId)
  const recordCount = records.countByAction(actionId)
  repo.archive(actionId, now)
  return ok({ actionId, planCount, recordCount })
}

export function restoreAction(repo: ActionRepo, actionId: ActionId): Result<Action, ActionError> {
  if (repo.findById(actionId) === null) {
    return err({ code: 'NOT_FOUND', message: '行动不存在或已删除' })
  }
  return ok(repo.restore(actionId))
}

// 永久删除：连同该行动的计划、记录与会话一起清理，调用前界面必须明确确认
export function deleteAction(
  repo: ActionRepo,
  plans: PlanRepo,
  records: RecordRepo,
  sessions: SessionStore,
  unitOfWork: UnitOfWork,
  actionId: ActionId,
  runningActionId: ActionId | null,
): Result<ActionUsage, ActionError> {
  if (repo.findById(actionId) === null) {
    return err({ code: 'NOT_FOUND', message: '行动不存在或已删除' })
  }
  if (runningActionId === actionId) {
    return err({ code: 'ACTION_RUNNING', message: '该行动正在计时，请先结束计时' })
  }

  const planCount = plans.countByAction(actionId)
  const recordCount = records.countByAction(actionId)
  unitOfWork.run(() => {
    sessions.clearByAction(actionId)
    records.removeByAction(actionId)
    plans.removeByAction(actionId)
    repo.remove(actionId)
  })
  return ok({ actionId, planCount, recordCount })
}

// 上移/下移只在同一归档状态内交换，返回新顺序供界面直接替换
export function reorderAction(
  repo: ActionRepo,
  actionId: ActionId,
  direction: 'up' | 'down',
): Result<readonly Action[], ActionError> {
  if (repo.findById(actionId) === null) {
    return err({ code: 'NOT_FOUND', message: '行动不存在或已删除' })
  }
  return ok(repo.reorder(actionId, direction))
}

// 倒计时按行动记忆：只影响手动计时，计划提醒触发的单次目标不写回这里
export function setActionTimerTarget(
  repo: ActionRepo,
  actionId: ActionId,
  targetSec: number | null,
): Result<Action, ActionError> {
  if (repo.findById(actionId) === null) {
    return err({ code: 'NOT_FOUND', message: '行动不存在或已删除' })
  }
  if (targetSec !== null && (targetSec <= 0 || targetSec > MAX_TIMER_TARGET_SEC)) {
    return err({ code: 'INVALID_TARGET', message: '倒计时必须在 1 秒到 24 小时之间' })
  }
  return ok(repo.setTimerTarget(actionId, targetSec))
}

// 重命名时排除自身，避免把原名判成重名
function validateActionName(
  repo: ActionRepo,
  rawName: string,
  excludeId: ActionId | null,
): Result<string, ActionError> {
  const name = normalizeActionName(rawName)
  if (name.length === 0) {
    return err({ code: 'EMPTY_NAME', message: '行动名称不能为空' })
  }
  if (name.length > MAX_ACTION_NAME_LENGTH) {
    return err({
      code: 'NAME_TOO_LONG',
      message: `行动名称不能超过 ${MAX_ACTION_NAME_LENGTH} 个字符`,
    })
  }

  const exists = repo
    .list(true)
    .some((action) => action.name === name && action.id !== excludeId)
  if (exists) {
    return err({ code: 'DUPLICATE_NAME', message: '已存在同名行动' })
  }
  return ok(name)
}
