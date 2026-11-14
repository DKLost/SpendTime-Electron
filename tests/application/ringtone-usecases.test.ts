import { describe, expect, it } from 'vitest'
import type { ActionRepo, SettingsRepo } from '@application/ports'
import {
  getRingtoneConfig,
  setActionRingtone,
  setDefaultRingtone,
} from '@application/use-cases/ringtones'
import type { Action, RingtoneValue } from '@core/action'

const NOW = 1_700_000_000_000

function action(overrides: Partial<Action> = {}): Action {
  return {
    id: 1,
    name: '写作',
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

function createSettings(initial: readonly (readonly [string, string])[] = []): SettingsRepo {
  const rows = new Map<string, string>(initial)
  return {
    get: (key) => rows.get(key) ?? null,
    set: (key, value) => {
      rows.set(key, value)
    },
    getAll: () => Object.fromEntries(rows),
    setMany: (values) => {
      for (const [key, value] of Object.entries(values)) {
        rows.set(key, value)
      }
    },
  }
}

function createActionRepo(initial: readonly Action[]): ActionRepo {
  const rows = [...initial]
  return {
    list: (includeArchived) => (includeArchived ? rows : rows.filter((item) => !item.archived)),
    findById: (id) => rows.find((item) => item.id === id) ?? null,
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
    reorder: (): readonly Action[] => {
      throw new Error('测试用例不涉及排序')
    },
    setRingtone: (id, kind, value) => {
      const index = rows.findIndex((item) => item.id === id)
      const current = rows[index]
      if (current === undefined) {
        throw new Error('行动不存在')
      }
      const next: Action = {
        ...current,
        ...(kind === 'start' ? { startRingtone: value } : { endRingtone: value }),
      }
      rows[index] = next
      return next
    },
  }
}

describe('默认铃声', () => {
  it('未设置时回落到清铃', () => {
    expect(getRingtoneConfig(createSettings())).toEqual({
      defaultStart: 'chime',
      defaultEnd: 'chime',
    })
  })

  it('分别保存开始与结束铃声，并忽略库里的非法值', () => {
    const settings = createSettings([['ringtone.defaultStart', 'unknown']])
    const started = setDefaultRingtone(settings, 'start', 'bell')
    expect(started.ok).toBe(true)
    const ended = setDefaultRingtone(settings, 'end', 'none')
    expect(ended.ok).toBe(true)
    expect(getRingtoneConfig(settings)).toEqual({ defaultStart: 'bell', defaultEnd: 'none' })
  })
})

describe('行动铃声覆盖', () => {
  it('inherit 写回 null，none 与内置铃声原样保存', () => {
    const repo = createActionRepo([action({ startRingtone: 'bell' })])

    const inherited = setActionRingtone(repo, 1, 'start', 'inherit')
    expect(inherited.ok).toBe(true)
    expect(repo.findById(1)?.startRingtone).toBeNull()

    const muted = setActionRingtone(repo, 1, 'end', 'none')
    expect(muted.ok).toBe(true)
    expect(repo.findById(1)?.endRingtone).toBe('none')

    const builtin = setActionRingtone(repo, 1, 'start', 'pulse' satisfies RingtoneValue)
    expect(builtin.ok).toBe(true)
    expect(repo.findById(1)?.startRingtone).toBe('pulse')
  })

  it('拒绝不存在的铃声与行动', () => {
    const repo = createActionRepo([action()])
    const invalid = setActionRingtone(repo, 1, 'start', 'bell.wav')
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) {
      expect(invalid.error.code).toBe('INVALID_RINGTONE')
    }

    const missing = setActionRingtone(repo, 9, 'start', 'bell')
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error.code).toBe('NOT_FOUND')
    }
  })
})
