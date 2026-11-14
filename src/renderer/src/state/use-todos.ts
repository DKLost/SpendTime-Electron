import { useEffect, useState } from 'react'
import { MAX_TODO_TITLE_LENGTH } from '@core/todo'
import type { EventPayload, TodoDto } from '@shared/contracts'
import { invokeCommand, subscribeEvent } from '../api'
import { apiErrorText } from '../translation'

export type ReorderDirection = 'up' | 'down'

export type TodosState = {
  readonly todos: readonly TodoDto[]
  readonly archivedTodos: readonly TodoDto[]
  createTodo(title: string): Promise<string | null>
  toggleTodo(todoId: number): Promise<string | null>
  updateTodo(todoId: number, title: string): Promise<string | null>
  removeTodo(todoId: number): Promise<string | null>
  archiveTodo(todoId: number): Promise<string | null>
  restoreTodo(todoId: number): Promise<string | null>
  reorderTodo(todoId: number, direction: ReorderDirection): Promise<string | null>
}

export function useTodos(): TodosState {
  const [todos, setTodos] = useState<readonly TodoDto[]>([])
  const [archivedTodos, setArchivedTodos] = useState<readonly TodoDto[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(function subscribeTodoChanges() {
    function handleChanged(payload: EventPayload<'data.changed'>): void {
      if (payload.scope === 'todos') {
        setRefreshKey((key) => key + 1)
      }
    }
    return subscribeEvent('data.changed', handleChanged)
  }, [])

  useEffect(
    function loadTodos() {
      let cancelled = false
      // 归档列表与活动列表一起取：数据量小，切换视图时不需要额外等待
      async function fetchTodos(): Promise<void> {
        const [active, archived] = await Promise.all([
          invokeCommand('todos.list', {}),
          invokeCommand('todos.listArchived', {}),
        ])
        if (cancelled) {
          return
        }
        if (active.ok) {
          setTodos(active.value)
        }
        if (archived.ok) {
          setArchivedTodos(archived.value)
        }
      }
      void fetchTodos()
      return function cancelLoad(): void {
        cancelled = true
      }
    },
    [refreshKey],
  )

  async function createTodo(title: string): Promise<string | null> {
    const response = await invokeCommand('todos.create', { title })
    if (!response.ok) {
      return apiErrorText(response.error, { max: MAX_TODO_TITLE_LENGTH })
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function toggleTodo(todoId: number): Promise<string | null> {
    const response = await invokeCommand('todos.toggle', { todoId })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function updateTodo(todoId: number, title: string): Promise<string | null> {
    const response = await invokeCommand('todos.update', { todoId, title })
    if (!response.ok) {
      return apiErrorText(response.error, { max: MAX_TODO_TITLE_LENGTH })
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function removeTodo(todoId: number): Promise<string | null> {
    const response = await invokeCommand('todos.remove', { todoId })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function archiveTodo(todoId: number): Promise<string | null> {
    const response = await invokeCommand('todos.archive', { todoId })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function restoreTodo(todoId: number): Promise<string | null> {
    const response = await invokeCommand('todos.restore', { todoId })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  async function reorderTodo(todoId: number, direction: ReorderDirection): Promise<string | null> {
    const response = await invokeCommand('todos.reorder', { todoId, direction })
    if (!response.ok) {
      return apiErrorText(response.error)
    }
    setRefreshKey((key) => key + 1)
    return null
  }

  return {
    todos,
    archivedTodos,
    createTodo,
    toggleTodo,
    updateTodo,
    removeTodo,
    archiveTodo,
    restoreTodo,
    reorderTodo,
  }
}
