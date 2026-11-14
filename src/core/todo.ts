import { err, ok, type Result } from './result'
import type { EpochMs } from './types'

export type TodoId = number

export type Todo = {
  readonly id: TodoId
  readonly title: string
  readonly completed: boolean
  readonly createdAt: EpochMs
  readonly completedAt: EpochMs | null
  readonly sortOrder: number
  readonly archived: boolean
  readonly archivedAt: EpochMs | null
}

export const MAX_TODO_TITLE_LENGTH = 120

export type TodoErrorCode = 'EMPTY_TITLE' | 'TITLE_TOO_LONG' | 'TODO_NOT_FOUND'

export type TodoError = {
  readonly code: TodoErrorCode
  readonly message: string
}

export type ReorderDirection = 'up' | 'down'

// 标题规范化是领域规则：去首尾空白并把连续空白折叠成单个空格
export function normalizeTodoTitle(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function validateTodoTitle(raw: string): Result<string, TodoError> {
  const title = normalizeTodoTitle(raw)
  if (title.length === 0) {
    return err({ code: 'EMPTY_TITLE', message: '待办内容不能为空' })
  }
  if (title.length > MAX_TODO_TITLE_LENGTH) {
    return err({
      code: 'TITLE_TOO_LONG',
      message: `待办内容不能超过 ${MAX_TODO_TITLE_LENGTH} 个字符`,
    })
  }
  return ok(title)
}

// 新条目追加到末尾，取当前最大序号加一；调用方负责提供完整列表
export function nextSortOrder(todos: readonly Pick<Todo, 'sortOrder'>[]): number {
  return todos.reduce((max, todo) => (todo.sortOrder > max ? todo.sortOrder : max), 0) + 1
}

// 纯投影：完成时间由调用方注入，核心层不读系统时钟
export function applyToggle(todo: Todo, now: EpochMs): Todo {
  if (todo.completed) {
    return { ...todo, completed: false, completedAt: null }
  }
  return { ...todo, completed: true, completedAt: now }
}

export function sortTodos(todos: readonly Todo[]): readonly Todo[] {
  return [...todos].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
  )
}

// 归档是软删除：保留原 sort_order，恢复后回到原位置
export function applyArchive(todo: Todo, now: EpochMs): Todo {
  if (todo.archived) {
    return todo
  }
  return { ...todo, archived: true, archivedAt: now }
}

export function applyRestore(todo: Todo): Todo {
  return { ...todo, archived: false, archivedAt: null }
}

// 归档列表按归档时间倒序，最近归档的排在最前
export function sortArchivedTodos(todos: readonly Todo[]): readonly Todo[] {
  return [...todos].sort(
    (left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0) || right.id - left.id,
  )
}

// 交换相邻项后整体重新编号，返回有序列表供仓储按顺序写回
export function reorderTodos(
  todos: readonly Todo[],
  todoId: TodoId,
  direction: ReorderDirection,
): Result<readonly Todo[], TodoError> {
  const ordered = sortTodos(todos)
  const index = ordered.findIndex((todo) => todo.id === todoId)
  if (index === -1) {
    return err({ code: 'TODO_NOT_FOUND', message: '待办不存在或已删除' })
  }

  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= ordered.length) {
    return ok(ordered)
  }

  const current = ordered[index]
  const neighbor = ordered[targetIndex]
  if (current === undefined || neighbor === undefined) {
    return ok(ordered)
  }

  const swapped = [...ordered]
  swapped[index] = neighbor
  swapped[targetIndex] = current
  return ok(swapped.map((todo, position) => ({ ...todo, sortOrder: position + 1 })))
}
