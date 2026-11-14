﻿﻿﻿﻿﻿import { describe, expect, it } from 'vitest'
import { openDatabase, LATEST_SCHEMA_VERSION } from '../../src/main/adapters/sqlite/database'
import { createTodoRepo, createUnitOfWork } from '../../src/main/adapters/sqlite/repositories'
import {
  archiveTodo,
  createTodo,
  listArchivedTodos,
  reorderTodo,
  restoreTodo,
  toggleTodo,
} from '@application/use-cases/todos'

const NOW = 1_700_000_000_000

const logger = {
  info: (_message: string): void => undefined,
  error: (_message: string): void => undefined,
}

describe('todos SQLite 仓储', () => {
  it('迁移到当前版本并支持新增、完成、重排、归档与恢复', () => {
    const db = openDatabase(':memory:', logger)
    const repo = createTodoRepo(db)
    const unitOfWork = createUnitOfWork(db)

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)

    const first = createTodo(repo, '  第一条  ', NOW)
    const second = createTodo(repo, '第二条', NOW)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(repo.listActive().map((todo) => todo.title)).toEqual(['第一条', '第二条'])

    const toggled = toggleTodo(repo, first.ok ? first.value.id : 0, NOW)
    expect(toggled.ok).toBe(true)
    expect(repo.listActive()[0]).toMatchObject({ completed: true, completedAt: NOW })

    const moved = reorderTodo(repo, unitOfWork, first.ok ? first.value.id : 0, 'down')
    expect(moved.ok).toBe(true)
    expect(repo.listActive().map((todo) => todo.title)).toEqual(['第二条', '第一条'])
    expect(repo.listActive().map((todo) => todo.sortOrder)).toEqual([1, 2])

    if (second.ok) {
      const archived = archiveTodo(repo, second.value.id, NOW + 1000)
      expect(archived.ok).toBe(true)
    }
    expect(repo.listActive().map((todo) => todo.title)).toEqual(['第一条'])
    expect(listArchivedTodos(repo)).toMatchObject([
      { title: '第二条', archived: true, archivedAt: NOW + 1000, sortOrder: 1 },
    ])

    if (second.ok) {
      const restored = restoreTodo(repo, second.value.id)
      expect(restored.ok).toBe(true)
    }
    expect(repo.listArchived()).toHaveLength(0)
    expect(repo.listActive().map((todo) => todo.title)).toEqual(['第二条', '第一条'])

    db.close()
  })

  it('归档列表按归档时间倒序', () => {
    const db = openDatabase(':memory:', logger)
    const repo = createTodoRepo(db)

    const first = createTodo(repo, '先归档', NOW)
    const second = createTodo(repo, '后归档', NOW)
    if (first.ok) {
      archiveTodo(repo, first.value.id, NOW + 1000)
    }
    if (second.ok) {
      archiveTodo(repo, second.value.id, NOW + 2000)
    }

    expect(listArchivedTodos(repo).map((todo) => todo.title)).toEqual(['后归档', '先归档'])

    db.close()
  })
})
