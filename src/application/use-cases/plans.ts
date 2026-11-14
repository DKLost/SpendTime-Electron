import { validatePlan, validatePlanEdit, type PlanDraft, type PlanErrorCode, type PlanView } from '@core/plan'
import { err, ok, type Result } from '@core/result'
import type { EpochMs, Weekday } from '@core/types'
import type { ActionRepo, PlanRepo, UnitOfWork } from '../ports'

export type PlanCommandErrorCode =
  | PlanErrorCode
  | 'UNKNOWN_ACTION'
  | 'ARCHIVED_ACTION'
  | 'NOT_FOUND'
  | 'SAME_WEEKDAY'

export type PlanCommandError = {
  readonly code: PlanCommandErrorCode
  readonly message: string
}

export type CreatePlanInput = {
  readonly weekday: Weekday
  readonly startMin: number
  readonly endMin: number
  readonly actionId: number
  readonly alarmEnabled: boolean
}

export type UpdatePlanInput = PlanDraft & {
  readonly planId: number
}

export function listWeek(repo: PlanRepo): readonly PlanView[] {
  return repo.listWeek()
}

export function createPlan(
  repo: PlanRepo,
  actions: ActionRepo,
  input: CreatePlanInput,
  now: EpochMs,
): Result<PlanView, PlanCommandError> {
  const action = actions.findById(input.actionId)
  if (action === null) {
    return err({ code: 'UNKNOWN_ACTION', message: '所选行动不存在' })
  }
  if (action.archived) {
    return err({ code: 'ARCHIVED_ACTION', message: '所选行动已归档' })
  }

  const validated = validatePlan(repo.listByWeekday(input.weekday), input)
  if (!validated.ok) {
    return err(validated.error)
  }
  return ok(repo.create(validated.value, now))
}

export function updatePlan(
  repo: PlanRepo,
  actions: ActionRepo,
  input: UpdatePlanInput,
): Result<PlanView, PlanCommandError> {
  if (repo.findById(input.planId) === null) {
    return err({ code: 'NOT_FOUND', message: '计划不存在或已删除' })
  }

  const action = actions.findById(input.actionId)
  if (action === null) {
    return err({ code: 'UNKNOWN_ACTION', message: '所选行动不存在' })
  }
  if (action.archived) {
    return err({ code: 'ARCHIVED_ACTION', message: '所选行动已归档' })
  }

  const validated = validatePlanEdit(repo.listByWeekday(input.weekday), input.planId, input)
  if (!validated.ok) {
    return err(validated.error)
  }
  return ok(repo.update(input.planId, validated.value))
}

export function removePlan(repo: PlanRepo, planId: number): Result<{ planId: number }, PlanCommandError> {
  const exists = repo.listWeek().some((plan) => plan.id === planId)
  if (!exists) {
    return err({ code: 'NOT_FOUND', message: '计划不存在或已删除' })
  }
  repo.remove(planId)
  return ok({ planId })
}

// 行内开关只改提醒标记，不经过时间段校验，避免影响已排好的计划
export function setPlanAlarm(
  repo: PlanRepo,
  planId: number,
  enabled: boolean,
): Result<PlanView, PlanCommandError> {
  if (repo.findById(planId) === null) {
    return err({ code: 'NOT_FOUND', message: '计划不存在或已删除' })
  }
  repo.setAlarmEnabled(planId, enabled)
  const updated = repo.findById(planId)
  if (updated === null) {
    return err({ code: 'NOT_FOUND', message: '计划不存在或已删除' })
  }
  return ok(updated)
}

// 覆盖式复制：先把目标日清空，再整批写入，事务失败时保持目标日原状
export function copyWeekday(
  repo: PlanRepo,
  unitOfWork: UnitOfWork,
  from: Weekday,
  to: Weekday,
  now: EpochMs,
): Result<{ copied: number }, PlanCommandError> {
  if (from === to) {
    return err({ code: 'SAME_WEEKDAY', message: '源与目标不能是同一天' })
  }

  const source = repo.listByWeekday(from)
  const drafts = source.map((plan) => ({
    weekday: to,
    startMin: plan.startMin,
    endMin: plan.endMin,
    actionId: plan.actionId,
    alarmEnabled: plan.alarmEnabled,
  }))

  unitOfWork.run(() => {
    repo.removeByWeekday(to)
    repo.insertMany(drafts, now)
  })
  return ok({ copied: drafts.length })
}
