import {
  applyArchive,
  applyRestore,
  applyToggle,
  nextSortOrder,
  reorderTodos,
  sortArchivedTodos,
  validateTodoTitle,
  type ReorderDirection,
  type Todo,
  type TodoErrorCode,
} from '@core/todo'
import { err, ok, type Result } from '@core/result'
import type { EpochMs } from '@core/types'
import type { TodoRepo, UnitOfWork } from '../ports'

export type TodoCommandErrorCode = TodoErrorCode

export type TodoCommandError = {
  readonly code: TodoCommandErrorCode
  readonly message: string
}

export function listTodos(repo: TodoRepo): readonly Todo[] {
  return repo.listActive()
}

export function listArchivedTodos(repo: TodoRepo): readonly Todo[] {
  return sortArchivedTodos(repo.listArchived())
}

export function createTodo(
  repo: TodoRepo,
  rawTitle: string,
  now: EpochMs,
): Result<Todo, TodoCommandError> {
  const validated = validateTodoTitle(rawTitle)
  if (!validated.ok) {
    return err(validated.error)
  }
  return ok(repo.create(validated.value, nextSortOrder(repo.listActive()), now))
}

export function toggleTodo(
  repo: TodoRepo,
  todoId: number,
  now: EpochMs,
): Result<Todo, TodoCommandError> {
  const todo = repo.listActive().find((item) => item.id === todoId)
  if (todo === undefined) {
    return err({ code: 'TODO_NOT_FOUND', message: '待办不存在或已归档' })
  }

  const next = applyToggle(todo, now)
  repo.setCompleted(next.id, next.completed, next.completedAt)
  return ok(next)
}

// 编辑与新建共用同一套标题校验，避免两处规则漂移
export function updateTodo(
  repo: TodoRepo,
  todoId: number,
  rawTitle: string,
): Result<Todo, TodoCommandError> {
  const todo = [...repo.listActive(), ...repo.listArchived()].find((item) => item.id === todoId)
  if (todo === undefined) {
    return err({ code: 'TODO_NOT_FOUND', message: '待办不存在或已删除' })
  }

  const validated = validateTodoTitle(rawTitle)
  if (!validated.ok) {
    return err(validated.error)
  }
  return ok(repo.updateTitle(todoId, validated.value))
}

// 永久删除与归档区分开：归档可恢复，删除不可撤销
export function deleteTodo(repo: TodoRepo, todoId: number): Result<{ todoId: number }, TodoCommandError> {
  const todo = [...repo.listActive(), ...repo.listArchived()].find((item) => item.id === todoId)
  if (todo === undefined) {
    return err({ code: 'TODO_NOT_FOUND', message: '待办不存在或已删除' })
  }
  repo.remove(todoId)
  return ok({ todoId })
}

// 归档取代硬删除：数据保留，可在归档视图恢复
export function archiveTodo(
  repo: TodoRepo,
  todoId: number,
  now: EpochMs,
): Result<Todo, TodoCommandError> {
  const todo = repo.listActive().find((item) => item.id === todoId)
  if (todo === undefined) {
    return err({ code: 'TODO_NOT_FOUND', message: '待办不存在或已归档' })
  }

  const next = applyArchive(todo, now)
  repo.setArchived(next.id, now)
  return ok(next)
}

export function restoreTodo(
  repo: TodoRepo,
  todoId: number,
): Result<Todo, TodoCommandError> {
  const todo = repo.listArchived().find((item) => item.id === todoId)
  if (todo === undefined) {
    return err({ code: 'TODO_NOT_FOUND', message: '归档待办不存在' })
  }

  const next = applyRestore(todo)
  repo.setArchived(next.id, null)
  return ok(next)
}

// 重排是整表写回，放进事务保证中途失败不留下半套 sort_order
export function reorderTodo(
  repo: TodoRepo,
  unitOfWork: UnitOfWork,
  todoId: number,
  direction: ReorderDirection,
): Result<readonly Todo[], TodoCommandError> {
  const reordered = reorderTodos(repo.listActive(), todoId, direction)
  if (!reordered.ok) {
    return err(reordered.error)
  }

  unitOfWork.run(() => repo.reorder(reordered.value.map((todo) => todo.id)))
  return ok(repo.listActive())
}
