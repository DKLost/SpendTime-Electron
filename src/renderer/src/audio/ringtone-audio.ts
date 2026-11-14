import type WaveSurfer from 'wavesurfer.js'

export type RingtoneClipOptions = {
  readonly startSec: number
  // null 表示到文件末尾
  readonly endSec: number | null
  readonly loop: boolean
  // 循环播放的总时长上限，null 表示不限
  readonly maxSec: number | null
  readonly onEnd: (() => void) | null
}

type Session = {
  readonly ws: WaveSurfer
  readonly startSec: number
  readonly endSec: number
  readonly loop: boolean
  // 剩余可播放秒数，每一轮结束后递减；不写 wall-clock 定时器
  remainingSec: number | null
  readonly onEnd: (() => void) | null
}

const RINGTONE_VOLUME = 0.85
const MIN_CLIP_SEC = 0.01

let host: WaveSurfer | null = null
let loadedUrl: string | null = null
let session: Session | null = null
let sequence = 0

// App 挂载的隐藏播放器实例注册到这里，事件回调与试听共用同一套播放能力
export function setRingtoneAudioHost(next: WaveSurfer | null): void {
  host = next
  loadedUrl = null
  session = null
  sequence += 1
  if (next !== null) {
    next.on('finish', handleFinish)
  }
}

export async function playClip(url: string, options: RingtoneClipOptions): Promise<void> {
  const ws = host
  if (ws === null) {
    return
  }
  stopClip()
  const token = sequence
  try {
    await ensureLoaded(ws, url)
  } catch {
    return
  }
  if (token !== sequence || host !== ws) {
    return
  }
  const duration = ws.getDuration()
  if (!Number.isFinite(duration) || duration <= 0) {
    return
  }
  const startSec = clamp(options.startSec, 0, Math.max(0, duration - MIN_CLIP_SEC))
  const endSec = clamp(options.endSec === null ? duration : options.endSec, startSec + MIN_CLIP_SEC, duration)
  ws.setVolume(RINGTONE_VOLUME)
  const active: Session = {
    ws,
    startSec,
    endSec,
    loop: options.loop,
    remainingSec: options.loop ? options.maxSec : null,
    onEnd: options.onEnd,
  }
  session = active
  startCycle(active)
}

export function stopClip(): void {
  sequence += 1
  session = null
  if (host === null) {
    return
  }
  host.pause()
  if (host.getDuration() > 0) {
    host.setTime(0)
  }
}

async function ensureLoaded(ws: WaveSurfer, url: string): Promise<void> {
  if (loadedUrl === url) {
    return
  }
  loadedUrl = null
  try {
    await ws.load(url)
    loadedUrl = url
  } catch (error) {
    loadedUrl = null
    throw error
  }
}

function startCycle(active: Session): void {
  if (session !== active) {
    return
  }
  const length = active.endSec - active.startSec
  if (length <= 0) {
    finishActive(active)
    return
  }
  let playLength = length
  if (active.remainingSec !== null) {
    playLength = Math.min(length, active.remainingSec)
    active.remainingSec -= playLength
  }
  void active.ws.play(active.startSec, active.startSec + playLength).catch(() => finishActive(active))
}

function handleFinish(): void {
  const active = session
  if (active === null) {
    return
  }
  if (active.loop && (active.remainingSec === null || active.remainingSec > 0.05)) {
    startCycle(active)
    return
  }
  finishActive(active)
}

function finishActive(active: Session): void {
  if (session !== active) {
    return
  }
  session = null
  active.ws.pause()
  active.onEnd?.()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
