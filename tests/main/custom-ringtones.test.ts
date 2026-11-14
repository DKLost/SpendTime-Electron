import { describe, expect, it } from 'vitest'
import { err, ok } from '@core/result'
import { SETTINGS_KEYS } from '@core/settings'
import type { RingtoneFilePort, StagedRingtoneFile } from '@application/ports'
import {
  cancelCustomRingtone,
  commitCustomRingtone,
  listCustomRingtones,
  pickCustomRingtone,
  removeCustomRingtone,
  renameCustomRingtone,
  updateCustomRingtoneClip,
} from '@application/use-cases/custom-ringtones'
import { openDatabase } from '../../src/main/adapters/sqlite/database'
import {
  createActionRepo,
  createCustomRingtoneRepo,
  createSettingsRepo,
} from '../../src/main/adapters/sqlite/repositories'

const NOW = 1_700_000_000_000
const UUID = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff'

const logger = {
  info: (_message: string): void => undefined,
  error: (_message: string): void => undefined,
}

const clock = { now: () => NOW, offsetMinutes: () => 0 }

function createFiles(options: {
  readonly staged: StagedRingtoneFile | null
  readonly pick?: string | null
  readonly seed?: boolean
}): {
  readonly files: RingtoneFilePort
  readonly removedFiles: string[]
  readonly discarded: string[]
} {
  const map = new Map<string, StagedRingtoneFile>()
  if (options.staged !== null && options.seed !== false) {
    map.set(options.staged.token, options.staged)
  }
  const removedFiles: string[] = []
  const discarded: string[] = []
  const files: RingtoneFilePort = {
    pickFile: async () => (options.pick === undefined ? 'C:\\Music\\Focus.mp3' : options.pick),
    createToken: () => UUID,
    createId: () => UUID,
    stage: async (_source, token) => {
      if (options.staged === null) {
        return err({ code: 'UNREADABLE', message: '无法读取所选文件' })
      }
      const staged = { ...options.staged, token }
      map.set(token, staged)
      return ok(staged)
    },
    findStaged: (token) => map.get(token) ?? null,
    commit: (token, id) => {
      if (!map.has(token)) {
        return err({ code: 'UNREADABLE', message: '导入会话已过期' })
      }
      map.delete(token)
      return ok({ fileName: `${id}.mp3`, sizeBytes: 2048 })
    },
    discard: (token) => {
      discarded.push(token)
      map.delete(token)
    },
    removeFile: (name) => {
      removedFiles.push(name)
    },
    ensureBuiltins: (): void => undefined,
  }
  return { files, removedFiles, discarded }
}

const LONG_STAGED: StagedRingtoneFile = {
  token: UUID,
  pendingFileName: `pending-${UUID}.mp3`,
  suggestedName: 'Focus',
  // 源文件远超 60 秒，用来证明导入不再受原时长限制
  durationSec: 185.4,
  sizeBytes: 2048,
}

describe('自定义铃声用例', () => {
  it('先暂存再按区间落盘，引用统计、重命名与删除清理', async () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const settings = createSettingsRepo(db)
    const custom = createCustomRingtoneRepo(db)
    const { files, removedFiles } = createFiles({ staged: LONG_STAGED })

    const action = actions.create('写作', NOW)
    const picked = await pickCustomRingtone(files)
    expect(picked.ok && picked.value?.pendingFileName).toBe(`pending-${UUID}.mp3`)
    expect(picked.ok && picked.value?.durationSec).toBe(185.4)

    const committed = commitCustomRingtone(custom, files, actions, settings, clock, {
      token: UUID,
      startSec: 12.5,
      endSec: 30.5,
    })
    expect(committed.ok).toBe(true)
    if (!committed.ok) {
      return
    }
    expect(committed.value.name).toBe('Focus')
    expect(committed.value.durationSec).toBe(186)
    expect(committed.value.clipStartSec).toBe(12.5)
    expect(committed.value.clipEndSec).toBe(30.5)
    expect(committed.value.usedBy).toEqual([])

    actions.setRingtone(action.id, 'start', `custom:${UUID}`)
    settings.set(SETTINGS_KEYS.defaultStartRingtone, `custom:${UUID}`)

    const listed = listCustomRingtones(custom, actions, settings)
    expect(listed[0]?.usedBy).toEqual([{ actionId: action.id, actionName: '写作', kind: 'start' }])
    expect(listed[0]?.usedByDefault).toEqual(['start'])

    const renamed = renameCustomRingtone(custom, actions, settings, UUID, '  深夜专注  ')
    expect(renamed.ok && renamed.value.name).toBe('深夜专注')

    const removed = removeCustomRingtone(custom, files, actions, settings, UUID)
    expect(removed.ok && removed.value).toMatchObject({ affectedActions: 1, clearedDefaults: 1 })
    expect(actions.findById(action.id)?.startRingtone).toBeNull()
    expect(settings.get(SETTINGS_KEYS.defaultStartRingtone)).toBe('chime')
    expect(removedFiles).toEqual([`${UUID}.mp3`])
    expect(custom.list()).toHaveLength(0)
  })

  it('拒绝零长度、超过 60 秒与越界的区间', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const settings = createSettingsRepo(db)
    const custom = createCustomRingtoneRepo(db)

    function attempt(startSec: number, endSec: number) {
      const { files } = createFiles({ staged: LONG_STAGED })
      return commitCustomRingtone(custom, files, actions, settings, clock, {
        token: UUID,
        startSec,
        endSec,
      })
    }

    const zero = attempt(10, 10)
    expect(zero.ok).toBe(false)
    if (!zero.ok) {
      expect(zero.error.code).toBe('CLIP_TOO_SHORT')
    }

    const tooLong = attempt(0, 60.5)
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(tooLong.error.code).toBe('CLIP_TOO_LONG')
    }

    const beyond = attempt(180, 200)
    expect(beyond.ok).toBe(false)
    if (!beyond.ok) {
      expect(beyond.error.code).toBe('CLIP_OUT_OF_RANGE')
    }

    const badStart = attempt(200, 205)
    expect(badStart.ok).toBe(false)
    if (!badStart.ok) {
      expect(badStart.error.code).toBe('CLIP_OUT_OF_RANGE')
    }

    // 区间上限恰好 60 秒合法，下限只要求大于 0
    const twoSeconds = attempt(30, 32)
    expect(twoSeconds.ok).toBe(true)
    if (twoSeconds.ok) {
      expect(twoSeconds.value.clipEndSec).toBe(32)
    }

    expect(custom.list()).toHaveLength(1)
  })

  it('重新切片只覆盖区间，复用原文件', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const settings = createSettingsRepo(db)
    const custom = createCustomRingtoneRepo(db)

    custom.create({
      id: UUID,
      name: 'Focus',
      fileName: `${UUID}.mp3`,
      durationSec: 186,
      clipStartSec: 12.5,
      clipEndSec: 30.5,
      sizeBytes: 2048,
      createdAt: NOW,
    })

    const updated = updateCustomRingtoneClip(custom, actions, settings, UUID, 40, 80)
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.clipStartSec).toBe(40)
      expect(updated.value.clipEndSec).toBe(80)
    }
    expect(custom.list()).toHaveLength(1)
    expect(custom.findById(UUID)?.fileName).toBe(`${UUID}.mp3`)

    // 超过 60 秒的新区间被拒绝，原区间保持不变
    const tooLong = updateCustomRingtoneClip(custom, actions, settings, UUID, 10, 75)
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(tooLong.error.code).toBe('CLIP_TOO_LONG')
    }
    expect(custom.findById(UUID)?.clipEndSec).toBe(80)

    const missing = updateCustomRingtoneClip(custom, actions, settings, 'missing', 0, 5)
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error.code).toBe('NOT_FOUND')
    }
  })

  it('取消选择、过期会话与取消导入', async () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const settings = createSettingsRepo(db)
    const custom = createCustomRingtoneRepo(db)

    const canceled = await pickCustomRingtone(createFiles({ staged: LONG_STAGED, pick: null }).files)
    expect(canceled.ok && canceled.value).toBeNull()

    const expired = commitCustomRingtone(
      custom,
      createFiles({ staged: LONG_STAGED, seed: false }).files,
      actions,
      settings,
      clock,
      { token: UUID, startSec: 0, endSec: 5 },
    )
    expect(expired.ok).toBe(false)
    if (!expired.ok) {
      expect(expired.error.code).toBe('NOT_FOUND')
    }

    const { files, discarded } = createFiles({ staged: LONG_STAGED })
    await pickCustomRingtone(files)
    expect(cancelCustomRingtone(files, UUID)).toEqual({ removed: true })
    expect(discarded).toEqual([UUID])
    expect(cancelCustomRingtone(files, UUID)).toEqual({ removed: false })
  })

  it('旧数据没有区间时按整段读取', () => {
    const db = openDatabase(':memory:', logger)
    const actions = createActionRepo(db)
    const settings = createSettingsRepo(db)
    const custom = createCustomRingtoneRepo(db)

    custom.create({
      id: UUID,
      name: '旧铃声',
      fileName: `${UUID}.mp3`,
      durationSec: 8,
      clipStartSec: 0,
      clipEndSec: null,
      sizeBytes: 1024,
      createdAt: NOW,
    })

    const listed = listCustomRingtones(custom, actions, settings)
    expect(listed[0]?.clipStartSec).toBe(0)
    expect(listed[0]?.clipEndSec).toBeNull()
    expect(listed[0]?.durationSec).toBe(8)

    const badName = renameCustomRingtone(custom, actions, settings, UUID, '   ')
    expect(badName.ok).toBe(false)
    if (!badName.ok) {
      expect(badName.error.code).toBe('INVALID_NAME')
    }
  })
})
