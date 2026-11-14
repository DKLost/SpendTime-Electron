import { describe, expect, it } from 'vitest'
import {
  applyArchive,
  applyRestore,
  applyToggle,
  MAX_TODO_TITLE_LENGTH,
  nextSortOrder,
  reorderTodos,
  sortArchivedTodos,
  sortTodos,
  validateTodoTitle,
  type Todo,
} from '@core/todo'

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

describe('validateTodoTitle', () => {
  it('去首尾空白并折叠连续空白', () => {
    const result = validateTodoTitle('  写   周报  ')
    expect(result).toEqual({ ok: true, value: '写 周报' })
  })

  it('拒绝空标题', () => {
    const result = validateTodoTitle('   ')
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('EMPTY_TITLE')
  })

  it('拒绝超长标题', () => {
    const result = validateTodoTitle('字'.repeat(MAX_TODO_TITLE_LENGTH + 1))
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('TITLE_TOO_LONG')
  })

  it('接受长度上限', () => {
    expect(validateTodoTitle('字'.repeat(MAX_TODO_TITLE_LENGTH)).ok).toBe(true)
  })
})

describe('nextSortOrder', () => {
  it('空列表从 1 开始', () => {
    expect(nextSortOrder([])).toBe(1)
  })

  it('取当前最大序号加一', () => {
    expect(nextSortOrder([{ sortOrder: 3 }, { sortOrder: 7 }, { sortOrder: 2 }])).toBe(8)
  })
})

describe('applyToggle', () => {
  it('完成时写入完成时间', () => {
    expect(applyToggle(todo(), 1000)).toEqual({
      id: 1,
      title: '写周报',
      completed: true,
      createdAt: 0,
      completedAt: 1000,
      sortOrder: 1,
      archived: false,
      archivedAt: null,
    })
  })

  it('取消完成时清空完成时间', () => {
    const restored = applyToggle(todo({ completed: true, completedAt: 500 }), 1000)
    expect(restored.completed).toBe(false)
    expect(restored.completedAt).toBeNull()
  })
})

describe('sortTodos', () => {
  it('按 sortOrder 升序，相同序号按 id 兜底', () => {
    const sorted = sortTodos([
      todo({ id: 3, sortOrder: 2 }),
      todo({ id: 2, sortOrder: 1 }),
      todo({ id: 1, sortOrder: 1 }),
    ])
    expect(sorted.map((item) => item.id)).toEqual([1, 2, 3])
  })
})

describe('applyArchive / applyRestore', () => {
  it('归档写入归档时间并保留原顺序', () => {
    const archived = applyArchive(todo({ sortOrder: 3 }), 2000)
    expect(archived).toMatchObject({ archived: true, archivedAt: 2000, sortOrder: 3 })
  })

  it('重复归档不改变已有归档时间', () => {
    const archived = applyArchive(todo({ archived: true, archivedAt: 1000 }), 2000)
    expect(archived.archivedAt).toBe(1000)
  })

  it('恢复清空归档字段', () => {
    const restored = applyRestore(todo({ archived: true, archivedAt: 1000 }))
    expect(restored).toMatchObject({ archived: false, archivedAt: null })
  })
})

describe('sortArchivedTodos', () => {
  it('按归档时间倒序，最近归档排在最前', () => {
    const sorted = sortArchivedTodos([
      todo({ id: 1, archived: true, archivedAt: 1000 }),
      todo({ id: 2, archived: true, archivedAt: 3000 }),
      todo({ id: 3, archived: true, archivedAt: 2000 }),
    ])
    expect(sorted.map((item) => item.id)).toEqual([2, 3, 1])
  })

  it('同一时刻按 id 倒序兜底', () => {
    const sorted = sortArchivedTodos([
      todo({ id: 1, archived: true, archivedAt: 1000 }),
      todo({ id: 2, archived: true, archivedAt: 1000 }),
    ])
    expect(sorted.map((item) => item.id)).toEqual([2, 1])
  })
})

describe('reorderTodos', () => {
  const items = [
    todo({ id: 1, sortOrder: 1 }),
    todo({ id: 2, sortOrder: 2 }),
    todo({ id: 3, sortOrder: 3 }),
  ]

  it('上移交换相邻项并重新编号', () => {
    const result = reorderTodos(items, 2, 'up')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.map((item) => item.id)).toEqual([2, 1, 3])
    expect(result.value.map((item) => item.sortOrder)).toEqual([1, 2, 3])
  })

  it('下移交换相邻项并重新编号', () => {
    const result = reorderTodos(items, 2, 'down')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.map((item) => item.id)).toEqual([1, 3, 2])
  })

  it('已在边界时保持原顺序', () => {
    const result = reorderTodos(items, 1, 'up')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.map((item) => item.id)).toEqual([1, 2, 3])
  })

  it('未知 id 返回 TODO_NOT_FOUND', () => {
    const result = reorderTodos(items, 99, 'up')
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('TODO_NOT_FOUND')
  })
})
