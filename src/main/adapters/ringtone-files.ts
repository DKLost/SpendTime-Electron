import { dialog } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { err, ok, type Result } from '@core/result'
import { RINGTONE_FORMATS, isRingtoneFormat, readAudioDuration } from '@core/audio-duration'
import { BUILTIN_RINGTONE_FILES } from '@core/ringtone'
import type {
  CommittedRingtoneFile,
  Logger,
  RingtoneFileError,
  RingtoneFilePort,
  StagedRingtoneFile,
} from '@application/ports'
import { PENDING_NAME_PATTERN, isManagedRingtoneFileName } from './ringtone-names'

const CUSTOM_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp3|wav|ogg|flac|m4a)$/i

// 截取区间以 0.1 秒为粒度，太短的音频无法选出有效区间
const MIN_AUDIO_DURATION_SEC = 0.1

export type RingtoneFileDeps = {
  readonly targetDir: string
  readonly builtinDir: string
  readonly logger: Logger
}

export function createRingtoneFilePort(deps: RingtoneFileDeps): RingtoneFilePort {
  // 暂存元数据只活在本次进程内；残留文件在启动时由 ensureBuiltins 清理
  const stagedFiles = new Map<string, StagedRingtoneFile>()

  function ensureBuiltins(): void {
    mkdirSync(deps.targetDir, { recursive: true })
    for (const fileName of Object.values(BUILTIN_RINGTONE_FILES)) {
      const source = join(deps.builtinDir, fileName.replace('builtin-', ''))
      const target = join(deps.targetDir, fileName)
      try {
        if (!existsSync(source)) {
          deps.logger.error(`内置铃声缺失：${source}`)
          continue
        }
        const sourceSize = statSync(source).size
        if (existsSync(target) && statSync(target).size === sourceSize) {
          continue
        }
        copyFileSync(source, target)
      } catch (error) {
        deps.logger.error(`复制内置铃声失败：${fileName}`, error)
      }
    }
    cleanupStaged()
  }

  // 上次导入在截取途中退出时，pending-* 会留在目录里
  function cleanupStaged(): void {
    stagedFiles.clear()
    let names: string[]
    try {
      names = readdirSync(deps.targetDir)
    } catch (error) {
      deps.logger.error('扫描铃声目录失败', error)
      return
    }
    for (const name of names) {
      if (!PENDING_NAME_PATTERN.test(name)) {
        continue
      }
      try {
        unlinkSync(join(deps.targetDir, name))
      } catch (error) {
        deps.logger.error(`清理暂存铃声失败：${name}`, error)
      }
    }
  }

  async function pickFile(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: '选择铃声文件',
      properties: ['openFile'],
      filters: [{ name: '音频文件', extensions: [...RINGTONE_FORMATS] }],
    })
    if (result.canceled) {
      return null
    }
    return result.filePaths[0] ?? null
  }

  async function stage(
    sourcePath: string,
    token: string,
  ): Promise<Result<StagedRingtoneFile, RingtoneFileError>> {
    const extension = extname(sourcePath).slice(1).toLowerCase()
    if (!isRingtoneFormat(extension)) {
      return err({ code: 'UNSUPPORTED_FORMAT', message: '仅支持 mp3 / wav / ogg / flac / m4a' })
    }
    let size: number
    try {
      const stats = statSync(sourcePath)
      if (!stats.isFile()) {
        return err({ code: 'UNREADABLE', message: '所选路径不是文件' })
      }
      size = stats.size
    } catch {
      return err({ code: 'UNREADABLE', message: '无法读取所选文件' })
    }
    if (size <= 0) {
      return err({ code: 'UNREADABLE', message: '文件为空' })
    }
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(sourcePath))
    } catch {
      return err({ code: 'UNREADABLE', message: '无法读取所选文件' })
    }
    const parsed = readAudioDuration(bytes, extension)
    if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
      return err({ code: 'UNREADABLE', message: '无法解析音频时长，文件可能已损坏' })
    }
    // 不再限制原文件时长，只要求能解出有效长度
    if (parsed < MIN_AUDIO_DURATION_SEC) {
      return err({ code: 'AUDIO_TOO_SHORT', message: '音频过短，无法截取铃声' })
    }
    const fileName = `pending-${token}.${extension}`
    if (!PENDING_NAME_PATTERN.test(fileName)) {
      return err({ code: 'UNREADABLE', message: '铃声标识不合法' })
    }

    mkdirSync(deps.targetDir, { recursive: true })
    const temporary = join(deps.targetDir, `.${token}.tmp`)
    try {
      // 先写临时文件再 rename，避免异常中断留下半个可播放文件
      writeFileSync(temporary, bytes)
      renameSync(temporary, join(deps.targetDir, fileName))
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {
        // 临时文件可能未创建
      }
      deps.logger.error(`暂存铃声失败：${basename(sourcePath)}`, error)
      return err({ code: 'UNREADABLE', message: '写入铃声目录失败' })
    }

    const staged: StagedRingtoneFile = {
      token,
      pendingFileName: fileName,
      suggestedName: defaultName(sourcePath),
      durationSec: Math.round(parsed * 1000) / 1000,
      sizeBytes: size,
    }
    stagedFiles.set(token, staged)
    return ok(staged)
  }

  function findStaged(token: string): StagedRingtoneFile | null {
    return stagedFiles.get(token) ?? null
  }

  function commit(token: string, id: string): Result<CommittedRingtoneFile, RingtoneFileError> {
    const staged = stagedFiles.get(token)
    if (staged === undefined) {
      return err({ code: 'UNREADABLE', message: '导入会话已过期，请重新选择文件' })
    }
    const extension = extname(staged.pendingFileName).slice(1).toLowerCase()
    const fileName = `${id}.${extension}`
    if (!CUSTOM_NAME_PATTERN.test(fileName)) {
      return err({ code: 'UNREADABLE', message: '铃声标识不合法' })
    }
    const source = join(deps.targetDir, staged.pendingFileName)
    try {
      if (!existsSync(source)) {
        stagedFiles.delete(token)
        return err({ code: 'UNREADABLE', message: '暂存的音频已被清理，请重新选择文件' })
      }
      renameSync(source, join(deps.targetDir, fileName))
    } catch (error) {
      deps.logger.error(`保存铃声失败：${fileName}`, error)
      return err({ code: 'UNREADABLE', message: '写入铃声目录失败' })
    }
    stagedFiles.delete(token)
    return ok({ fileName, sizeBytes: staged.sizeBytes })
  }

  function discard(token: string): void {
    const staged = stagedFiles.get(token)
    stagedFiles.delete(token)
    if (staged === undefined) {
      return
    }
    const target = join(deps.targetDir, staged.pendingFileName)
    try {
      if (existsSync(target)) {
        unlinkSync(target)
      }
    } catch (error) {
      deps.logger.error(`删除暂存铃声失败：${staged.pendingFileName}`, error)
    }
  }

  function removeFile(fileName: string): void {
    if (!isManagedRingtoneFileName(fileName) || fileName.startsWith('builtin-')) {
      return
    }
    const target = join(deps.targetDir, fileName)
    try {
      if (existsSync(target)) {
        unlinkSync(target)
      }
    } catch (error) {
      deps.logger.error(`删除铃声文件失败：${fileName}`, error)
    }
  }

  return {
    pickFile,
    createToken: () => randomUUID(),
    createId: () => randomUUID(),
    stage,
    findStaged,
    commit,
    discard,
    removeFile,
    ensureBuiltins,
  }
}

function defaultName(sourcePath: string): string {
  const fileName = sourcePath.split(/[\\/]/).pop() ?? '自定义铃声'
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  const trimmed = withoutExtension.trim().replace(/\s+/g, ' ')
  return trimmed === '' ? '自定义铃声' : trimmed.slice(0, 40)
}
