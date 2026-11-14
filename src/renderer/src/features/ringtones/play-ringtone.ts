import { BUILTIN_RINGTONE_FILES, customRingtoneId, type RingtoneValue } from '@shared/ringtones'
import { playClip, stopClip } from '../../audio/ringtone-audio'

export type CustomRingtoneFile = {
  readonly id: string
  readonly fileName: string
  readonly clipStartSec: number
  // null 表示到文件末尾
  readonly clipEndSec: number | null
}

type ClipRange = {
  readonly startSec: number
  readonly endSec: number | null
}

type Source = {
  readonly url: string
  readonly range: ClipRange
}

export function stopRingtone(): void {
  stopClip()
}

// 只生成主进程自定义协议地址，不接触真实文件路径
export function ringtoneUrl(
  value: RingtoneValue | null,
  customFiles: readonly CustomRingtoneFile[] = [],
): string | null {
  if (value === null || value === 'none') {
    return null
  }
  if (value === 'chime' || value === 'bell' || value === 'pulse') {
    return pendingRingtoneUrl(BUILTIN_RINGTONE_FILES[value])
  }
  const id = customRingtoneId(value)
  const file = customFiles.find((item) => item.id === id)
  return file === undefined ? null : pendingRingtoneUrl(file.fileName)
}

// 导入暂存文件与正式铃声共用同一白名单协议
export function pendingRingtoneUrl(fileName: string): string {
  return `spendtime-audio://ringtone/${encodeURIComponent(fileName)}`
}

// 计划提醒循环播放；maxSec 到点强制停止，避免无人值守时一直响
export function playRingtoneLoop(
  value: RingtoneValue | null,
  customFiles: readonly CustomRingtoneFile[],
  maxSec: number,
): void {
  const source = resolveSource(value, customFiles)
  if (source === null) {
    return
  }
  void playClip(source.url, {
    startSec: source.range.startSec,
    endSec: source.range.endSec,
    loop: true,
    maxSec,
    onEnd: null,
  })
}

// 计时结束/行动开始只播一次
export function playRingtone(
  value: RingtoneValue | null,
  customFiles: readonly CustomRingtoneFile[] = [],
): void {
  const source = resolveSource(value, customFiles)
  if (source === null) {
    return
  }
  void playClip(source.url, {
    startSec: source.range.startSec,
    endSec: source.range.endSec,
    loop: false,
    maxSec: null,
    onEnd: null,
  })
}

// 截取界面的区间试听也走同一播放器；结束回调用于复位按钮
export function playRingtoneSelection(
  url: string,
  startSec: number,
  endSec: number,
  onEnd: (() => void) | null = null,
): void {
  void playClip(url, { startSec, endSec, loop: false, maxSec: null, onEnd })
}

function resolveSource(
  value: RingtoneValue | null,
  customFiles: readonly CustomRingtoneFile[],
): Source | null {
  const url = ringtoneUrl(value, customFiles)
  if (url === null || value === null) {
    return null
  }
  const id = customRingtoneId(value)
  const file = id === null ? undefined : customFiles.find((item) => item.id === id)
  if (file === undefined) {
    // 内置铃声与静音走整段播放
    return { url, range: { startSec: 0, endSec: null } }
  }
  return {
    url,
    range: {
      startSec: Math.max(0, file.clipStartSec),
      endSec: file.clipEndSec === null ? null : Math.max(file.clipStartSec, file.clipEndSec),
    },
  }
}
