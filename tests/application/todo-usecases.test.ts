import { describe, expect, it } from 'vitest'
import type { TodoRepo, UnitOfWork } from '@application/ports'
import {
  archiveTodo,
  createTodo,
  deleteTodo,
  listArchivedTodos,
  listTodos,
  reorderTodo,
  restoreTodo,
  toggleTodo,
  updateTodo,
} from '@application/use-cases/todos'
import type { Todo, TodoId } from '@core/todo'
import type { EpochMs } from '@core/types'

const NOW: EpochMs = 1_700_000_000_000

const unitOfWork: UnitOfWork = {
  run: (work) => work(),
}

function createFakeTodoRepo(initial: readonly Todo[] = []): TodoRepo {
  const rows = [...initial]
  let nextId = rows.reduce((max, todo) => Math.max(max, todo.id), 0) + 1

  function findIndex(id: TodoId): number {
    return rows.findIndex((todo) => todo.id === id)
  }

  function sortActive(items: readonly Todo[]): readonly Todo[] {
    return [...items].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
  }

  return {
    listActive: () => sortActive(rows.filter((todo) => !todo.archived)),
    listArchived: () =>
      [...rows]
        .filter((todo) => todo.archived)
        .sort(
          (left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0) || right.id - left.id,
        ),
    create: (title, sortOrder, now) => {
      const created: Todo = {
        id: nextId,
        title,
        completed: false,
        createdAt: now,
        completedAt: null,
        sortOrder,
        archived: false,
        archivedAt: null,
      }
      nextId += 1
      rows.push(created)
      return created
    },
    setCompleted: (id, completed, completedAt) => {
      const index = findIndex(id)
      const current = index === -1 ? undefined : rows[index]
      if (current !== undefined) {
        rows[index] = { ...current, completed, completedAt }
      }
    },
    setArchived: (id, archivedAt) => {
      const index = findIndex(id)
      const current = index === -1 ? undefined : rows[index]
      if (current !== undefined) {
        rows[index] = { ...current, archived: archivedAt !== null, archivedAt }
      }
    },
    updateTitle: (id, title) => {
      const index = findIndex(id)
      const current = index === -1 ? undefined : rows[index]
      if (current === undefined) {
        throw new Error('待办不存在')
      }
      const next: Todo = { ...current, title }
      rows[index] = next
      return next
    },
    remove: (id) => {
      const index = findIndex(id)
      if (index >= 0) {
        rows.splice(index, 1)
      }
    },
    reorder: (orderedIds) => {
      orderedIds.forEach((id, position) => {
        const index = findIndex(id)
        const current = index === -1 ? undefined : rows[index]
        if (current !== undefined) {
          rows[index] = { ...current, sortOrder: position + 1 }
        }
      })
    },
  }
}

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    title: '写周报',
    completed: false,
    createdAt: 0,
    completedAt: null,
    sortOrder: 1,
    archived: false,
    archivedAt: null,
    ...overrides,
  }
}

describe('createTodo', () => {
  it('规范化标题并追加到末尾', () => {
    const repo = createFakeTodoRepo([todo({ id: 1 }), todo({ id: 2, sortOrder: 2 })])
    const result = createTodo(repo, '  整理   收件箱  ', NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.title).toBe('整理 收件箱')
    expect(result.value.sortOrder).toBe(3)
    expect(listTodos(repo)).toHaveLength(3)
  })

  it('空标题不写库', () => {
    const repo = createFakeTodoRepo()
    const result = createTodo(repo, '   ', NOW)

    expect(result.ok).toBe(false)
    expect(listTodos(repo)).toHaveLength(0)
  })
})

describe('toggleTodo', () => {
  it('写入完成时间', () => {
    const repo = createFakeTodoRepo([todo()])
    const result = toggleTodo(repo, 1, NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.completed).toBe(true)
    expect(result.value.completedAt).toBe(NOW)
    expect(repo.listActive()[0]?.completed).toBe(true)
  })

  it('未知 id 返回 TODO_NOT_FOUND', () => {
    const result = toggleTodo(createFakeTodoRepo(), 99, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('TODO_NOT_FOUND')
  })
})

describe('updateTodo', () => {
  it('编辑活动与归档待办的标题', () => {
    const repo = createFakeTodoRepo([todo(), todo({ id: 2, title: '旧标题' })])
    archiveTodo(repo, 2, NOW)

    expect(updateTodo(repo, 1, '  新标题  ').ok).toBe(true)
    expect(updateTodo(repo, 2, '归档后改名').ok).toBe(true)
    expect(repo.listActive()[0]?.title).toBe('新标题')
    expect(repo.listArchived()[0]?.title).toBe('归档后改名')
  })

  it('空标题被拒绝且不写库', () => {
    const repo = createFakeTodoRepo([todo()])
    const result = updateTodo(repo, 1, '   ')
    expect(result.ok).toBe(false)
    expect(repo.listActive()[0]?.title).toBe('写周报')
  })
})

describe('deleteTodo', () => {
  it('永久删除后活动与归档列表都不再包含', () => {
    const repo = createFakeTodoRepo([todo(), todo({ id: 2, title: '归档项' })])
    archiveTodo(repo, 2, NOW)

    expect(deleteTodo(repo, 1).ok).toBe(true)
    expect(deleteTodo(repo, 2).ok).toBe(true)
    expect(repo.listActive()).toHaveLength(0)
    expect(repo.listArchived()).toHaveLength(0)
  })

  it('未知 id 返回 TODO_NOT_FOUND', () => {
    const result = deleteTodo(createFakeTodoRepo(), 99)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TODO_NOT_FOUND')
    }
  })
})

describe('archiveTodo', () => {
  it('归档后从活动列表消失并写入归档时间', () => {
    const repo = createFakeTodoRepo([todo()])
    const result = archiveTodo(repo, 1, NOW)

    expect(result.ok).toBe(true)
    expect(repo.listActive()).toHaveLength(0)
    expect(repo.listArchived()).toMatchObject([{ id: 1, archived: true, archivedAt: NOW }])
  })

  it('已归档的待办不能重复归档', () => {
    const repo = createFakeTodoRepo([todo({ archived: true, archivedAt: 1 })])
    const result = archiveTodo(repo, 1, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('TODO_NOT_FOUND')
  })
})

describe('restoreTodo', () => {
  it('恢复归档待办并保留原顺序', () => {
    const repo = createFakeTodoRepo([todo({ archived: true, archivedAt: NOW, sortOrder: 4 })])
    const result = restoreTodo(repo, 1)

    expect(result.ok).toBe(true)
    expect(repo.listArchived()).toHaveLength(0)
    expect(repo.listActive()).toMatchObject([
      { id: 1, archived: false, archivedAt: null, sortOrder: 4 },
    ])
  })

  it('恢复不存在的待办返回错误', () => {
    const result = restoreTodo(createFakeTodoRepo(), 99)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('TODO_NOT_FOUND')
  })
})

describe('listArchivedTodos', () => {
  it('按归档时间倒序返回', () => {
    const repo = createFakeTodoRepo([
      todo({ id: 1, archived: true, archivedAt: 1000 }),
      todo({ id: 2, archived: true, archivedAt: 3000 }),
      todo({ id: 3 }),
    ])

    expect(listArchivedTodos(repo).map((item) => item.id)).toEqual([2, 1])
  })
})

describe('reorderTodo', () => {
  it('下移后顺序持久化', () => {
    const repo = createFakeTodoRepo([
      todo({ id: 1, sortOrder: 1 }),
      todo({ id: 2, sortOrder: 2 }),
      todo({ id: 3, sortOrder: 3 }),
    ])
    const result = reorderTodo(repo, unitOfWork, 1, 'down')

    expect(result.ok).toBe(true)
    expect(repo.listActive().map((item) => item.id)).toEqual([2, 1, 3])
  })

  it('未知 id 返回 TODO_NOT_FOUND', () => {
    const result = reorderTodo(createFakeTodoRepo(), unitOfWork, 99, 'up')
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('TODO_NOT_FOUND')
  })
})
