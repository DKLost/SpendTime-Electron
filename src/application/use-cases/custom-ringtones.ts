import { err, ok, type Result } from '@core/result'
import { customRingtoneValue } from '@core/ringtone'
import { SETTINGS_KEYS, type AppSettings } from '@core/settings'
import type { EpochMs } from '@core/types'
import type {
  ActionRepo,
  Clock,
  CustomRingtoneRecord,
  CustomRingtoneRepo,
  RingtoneFileError,
  RingtoneFilePort,
  SettingsRepo,
  StagedRingtoneFile,
} from '../ports'
import { loadSettings } from './settings'

export type CustomRingtoneError = {
  readonly code:
    | 'INVALID_NAME'
    | 'NOT_FOUND'
    | 'CANCELLED'
    | 'CLIP_TOO_SHORT'
    | 'CLIP_TOO_LONG'
    | 'CLIP_OUT_OF_RANGE'
    | RingtoneFileError['code']
  readonly message: string
}

export type CustomRingtoneUsage = {
  readonly actionId: number
  readonly actionName: string
  readonly kind: 'start' | 'end'
}

export type CustomRingtoneView = CustomRingtoneRecord & {
  usedBy: CustomRingtoneUsage[]
  usedByDefault: ('start' | 'end')[]
}

export type CommitRingtoneInput = {
  readonly token: string
  readonly startSec: number
  readonly endSec: number
}

const NAME_MAX_LENGTH = 40

// 实际铃声长度允许 (0, 60]；下限取 0.1 秒与界面滑块粒度一致
export const RINGTONE_CLIP_MIN_SEC = 0.1
export const RINGTONE_CLIP_MAX_SEC = 60
// 容器头解析与浏览器解码可能相差几十毫秒，终点校验留一点余量
const CLIP_END_TOLERANCE_SEC = 0.5

export function listCustomRingtones(
  repo: CustomRingtoneRepo,
  actions: ActionRepo,
  settings: SettingsRepo,
): CustomRingtoneView[] {
  const allActions = actions.list(true)
  const current = loadSettings(settings)
  return repo.list().map((record) => toView(record, allActions, current))
}

// 第一步：选文件并暂存，界面据此试听、选择截取区间
export async function pickCustomRingtone(
  files: RingtoneFilePort,
): Promise<Result<StagedRingtoneFile | null, CustomRingtoneError>> {
  const sourcePath = await files.pickFile()
  if (sourcePath === null) {
    return ok(null)
  }
  const token = files.createToken()
  const staged = await files.stage(sourcePath, token)
  if (!staged.ok) {
    return err({ code: staged.error.code, message: staged.error.message })
  }
  return ok(staged.value)
}

// 第二步：校验区间、落盘为正式文件并写入元数据
export function commitCustomRingtone(
  repo: CustomRingtoneRepo,
  files: RingtoneFilePort,
  actions: ActionRepo,
  settings: SettingsRepo,
  clock: Clock,
  input: CommitRingtoneInput,
): Result<CustomRingtoneView, CustomRingtoneError> {
  const staged = files.findStaged(input.token)
  if (staged === null) {
    return err({ code: 'NOT_FOUND', message: '导入会话已过期，请重新选择文件' })
  }
  const invalid = validateClip(input.startSec, input.endSec, staged.durationSec)
  if (invalid !== null) {
    return err(invalid)
  }
  const id = files.createId()
  const committed = files.commit(input.token, id)
  if (!committed.ok) {
    return err({ code: committed.error.code, message: committed.error.message })
  }
  const record: CustomRingtoneRecord = {
    id,
    name: staged.suggestedName,
    fileName: committed.value.fileName,
    durationSec: Math.max(1, Math.ceil(staged.durationSec)),
    clipStartSec: input.startSec,
    // 解析出的源时长是估算值，终点不能超过它
    clipEndSec: Math.min(input.endSec, staged.durationSec),
    sizeBytes: committed.value.sizeBytes,
    createdAt: clock.now() as EpochMs,
  }
  try {
    repo.create(record)
  } catch {
    files.removeFile(record.fileName)
    return err({ code: 'UNREADABLE', message: '保存铃声信息失败' })
  }
  return ok(toView(record, actions.list(true), loadSettings(settings)))
}

// 取消导入：删除暂存文件，不产生任何记录
export function cancelCustomRingtone(
  files: RingtoneFilePort,
  token: string,
): { readonly removed: boolean } {
  const existed = files.findStaged(token) !== null
  files.discard(token)
  return { removed: existed }
}

function validateClip(
  startSec: number,
  endSec: number,
  sourceDurationSec: number,
): CustomRingtoneError | null {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    return { code: 'CLIP_OUT_OF_RANGE', message: '截取区间不合法' }
  }
  if (startSec < 0 || startSec >= sourceDurationSec) {
    return { code: 'CLIP_OUT_OF_RANGE', message: '起点超出音频范围' }
  }
  if (endSec - startSec < RINGTONE_CLIP_MIN_SEC) {
    return { code: 'CLIP_TOO_SHORT', message: '截取区间需大于 0 秒' }
  }
  if (endSec - startSec > RINGTONE_CLIP_MAX_SEC + 0.001) {
    return { code: 'CLIP_TOO_LONG', message: `截取区间不能超过 ${RINGTONE_CLIP_MAX_SEC} 秒` }
  }
  if (endSec > sourceDurationSec + CLIP_END_TOLERANCE_SEC) {
    return { code: 'CLIP_OUT_OF_RANGE', message: '终点超出音频范围' }
  }
  return null
}

// 重新切片：沿用原文件，只覆盖已保存的区间
export function updateCustomRingtoneClip(
  repo: CustomRingtoneRepo,
  actions: ActionRepo,
  settings: SettingsRepo,
  id: string,
  startSec: number,
  endSec: number,
): Result<CustomRingtoneView, CustomRingtoneError> {
  const record = repo.findById(id)
  if (record === null) {
    return err({ code: 'NOT_FOUND', message: '铃声不存在或已删除' })
  }
  const invalid = validateClip(startSec, endSec, record.durationSec)
  if (invalid !== null) {
    return err(invalid)
  }
  const updated = repo.updateClip(id, startSec, Math.min(endSec, record.durationSec))
  if (updated === null) {
    return err({ code: 'NOT_FOUND', message: '铃声不存在或已删除' })
  }
  return ok(toView(updated, actions.list(true), loadSettings(settings)))
}

export function renameCustomRingtone(
  repo: CustomRingtoneRepo,
  actions: ActionRepo,
  settings: SettingsRepo,
  id: string,
  name: string,
): Result<CustomRingtoneView, CustomRingtoneError> {
  const normalized = normalizeName(name)
  if (normalized === null) {
    return err({ code: 'INVALID_NAME', message: `铃声名称需为 1-${NAME_MAX_LENGTH} 个字符` })
  }
  const renamed = repo.rename(id, normalized)
  if (renamed === null) {
    return err({ code: 'NOT_FOUND', message: '铃声不存在或已删除' })
  }
  return ok(toView(renamed, actions.list(true), loadSettings(settings)))
}

// 删除前清理行动与默认铃声引用，返回受影响数量供界面提示
export function removeCustomRingtone(
  repo: CustomRingtoneRepo,
  files: RingtoneFilePort,
  actions: ActionRepo,
  settings: SettingsRepo,
  id: string,
): Result<{ readonly ringtoneId: string; readonly affectedActions: number; readonly clearedDefaults: number }, CustomRingtoneError> {
  const record = repo.findById(id)
  if (record === null) {
    return err({ code: 'NOT_FOUND', message: '铃声不存在或已删除' })
  }
  const value = customRingtoneValue(record.id)
  let affectedActions = 0
  for (const action of actions.list(true)) {
    if (action.startRingtone === value) {
      actions.setRingtone(action.id, 'start', null)
      affectedActions += 1
    }
    if (action.endRingtone === value) {
      actions.setRingtone(action.id, 'end', null)
      affectedActions += 1
    }
  }

  const current = loadSettings(settings)
  let clearedDefaults = 0
  if (current.defaultStartRingtone === value) {
    settings.set(SETTINGS_KEYS.defaultStartRingtone, 'chime')
    clearedDefaults += 1
  }
  if (current.defaultEndRingtone === value) {
    settings.set(SETTINGS_KEYS.defaultEndRingtone, 'chime')
    clearedDefaults += 1
  }

  files.removeFile(record.fileName)
  repo.remove(record.id)
  return ok({ ringtoneId: record.id, affectedActions, clearedDefaults })
}

function toView(
  record: CustomRingtoneRecord,
  actions: readonly { id: number; name: string; startRingtone: string | null; endRingtone: string | null }[],
  settings: AppSettings,
): CustomRingtoneView {
  const value = customRingtoneValue(record.id)
  const usedBy: CustomRingtoneUsage[] = []
  for (const action of actions) {
    if (action.startRingtone === value) {
      usedBy.push({ actionId: action.id, actionName: action.name, kind: 'start' })
    }
    if (action.endRingtone === value) {
      usedBy.push({ actionId: action.id, actionName: action.name, kind: 'end' })
    }
  }
  const usedByDefault: ('start' | 'end')[] = []
  if (settings.defaultStartRingtone === value) {
    usedByDefault.push('start')
  }
  if (settings.defaultEndRingtone === value) {
    usedByDefault.push('end')
  }
  return { ...record, usedBy, usedByDefault }
}

function normalizeName(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed === '' || trimmed.length > NAME_MAX_LENGTH) {
    return null
  }
  return trimmed
}
