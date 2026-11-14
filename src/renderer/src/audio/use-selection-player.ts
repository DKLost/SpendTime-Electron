import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useWavesurfer } from '@wavesurfer/react'
import RegionsPlugin, { type Region, type UpdateSide } from 'wavesurfer.js/dist/plugins/regions.js'
import {
  clampSelectionEnd,
  clampSelectionMove,
  clampSelectionStart,
  keepSelectionVisibleAtEnd,
  normalizeSelection,
  type Selection,
} from './selection-clamp'
import { readWaveformColors, useWaveformColors } from './waveform-theme'

export type { Selection } from './selection-clamp'

export type SelectionEdge = 'start' | 'end'

export type SelectionPlayerApi = {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly isReady: boolean
  readonly isPlaying: boolean
  readonly currentTime: number
  readonly duration: number
  readonly selection: Selection
  // 最近拖动的端点，键盘微调默认作用于它
  readonly activeEdge: SelectionEdge
  readonly loop: boolean
  readonly volume: number
  readonly error: string | null
  setLoop(next: boolean): void
  setVolume(next: number): void
  playSelection(): void
  toggle(): void
  stop(): void
  // 键盘微调：每次移动 0.1 秒，正在播放时跟随定位，暂停时保持静音
  adjustEdge(edge: SelectionEdge, deltaSec: number): void
}

type SelectionPlayerInput = {
  readonly url: string
  readonly initialSelection: Selection
  readonly minLengthSec: number
  readonly maxLengthSec: number
}

// 拖动终点时定位到最后 0.8 秒，能听到即将被截掉的收尾
const AUDITION_TAIL_SEC = 0.8
// 波形峰值按 8kHz 解码，整首歌也只需要十几 MB 内存
const DECODE_SAMPLE_RATE = 8000
const DEFAULT_VOLUME = 0.85

export function useSelectionPlayer(input: SelectionPlayerInput): SelectionPlayerApi {
  const { url, initialSelection, minLengthSec, maxLengthSec } = input
  const containerRef = useRef<HTMLDivElement | null>(null)
  const initialColors = useMemo(readWaveformColors, [])
  // 插件与选项必须在多次渲染间保持同一引用，否则 hook 会销毁并重建播放器
  const plugin = useMemo(() => RegionsPlugin.create(), [])
  const plugins = useMemo(() => [plugin], [plugin])

  const { wavesurfer, isReady, isPlaying, currentTime } = useWavesurfer({
    container: containerRef,
    url,
    height: 'auto',
    waveColor: initialColors.wave,
    progressColor: initialColors.progress,
    cursorColor: initialColors.cursor,
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 1,
    normalize: true,
    dragToSeek: true,
    hideScrollbar: true,
    sampleRate: DECODE_SAMPLE_RATE,
    backend: 'WebAudio',
    plugins,
  })

  useWaveformColors(wavesurfer)

  const [selection, setSelectionState] = useState<Selection>(() =>
    normalizeSelection(initialSelection, initialSelection.end, minLengthSec, maxLengthSec),
  )
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const [loop, setLoopState] = useState(true)
  const loopRef = useRef(loop)
  loopRef.current = loop

  const [activeEdge, setActiveEdge] = useState<SelectionEdge>('end')

  const [volume, setVolumeState] = useState(DEFAULT_VOLUME)
  const [duration, setDuration] = useState(0)
  const durationRef = useRef(duration)
  durationRef.current = duration
  const [error, setError] = useState<string | null>(null)

  // 贴住文件末尾的选区窄于 1px 时会被 wavesurfer 当成不可见元素摘掉，
  // 用当前波形宽度换算出可见下限，保证末尾至少留出 1.5px 的宽度
  const visibleMinLengthRef = useRef(minLengthSec)

  useEffect(
    function measureVisibleMinLength() {
      const width = containerRef.current?.clientWidth ?? 0
      visibleMinLengthRef.current =
        duration > 0 && width > 0 ? Math.max(minLengthSec, (duration / width) * 1.5) : minLengthSec
    },
    [duration, minLengthSec],
  )

  // 起点拖到文件末尾时不能窄于可见下限，否则手柄会整块消失
  const minStartLengthAtEnd = useCallback(
    (end: number): number => {
      const total = durationRef.current
      if (total > 0 && end >= total - 1e-6) {
        return Math.max(minLengthSec, visibleMinLengthRef.current)
      }
      return minLengthSec
    },
    [minLengthSec],
  )

  const commitSelection = useCallback(
    (next: Selection) => {
      selectionRef.current = next
      setSelectionState(next)
      plugin.getRegions()[0]?.setOptions({ start: next.start, end: next.end })
    },
    [plugin],
  )

  useEffect(
    function readDuration() {
      if (wavesurfer === null || !isReady) {
        return
      }
      const next = wavesurfer.getDuration()
      if (Number.isFinite(next) && next > 0) {
        setDuration(next)
      }
    },
    [wavesurfer, isReady],
  )

  useEffect(
    function normalizeToSource() {
      if (duration <= 0) {
        return
      }
      const previous = selectionRef.current
      const next = keepSelectionVisibleAtEnd(
        normalizeSelection(previous, duration, minLengthSec, maxLengthSec),
        duration,
        visibleMinLengthRef.current,
      )
      if (next.start === previous.start && next.end === previous.end) {
        return
      }
      commitSelection(next)
    },
    [duration, minLengthSec, maxLengthSec, commitSelection],
  )

  useEffect(
    function subscribeErrors() {
      if (wavesurfer === null) {
        return
      }
      return wavesurfer.on('error', function handleError(cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    },
    [wavesurfer],
  )

  useEffect(
    function syncLoopOnFinish() {
      if (wavesurfer === null) {
        return
      }
      return wavesurfer.on('finish', function restartSelection() {
        if (!loopRef.current) {
          return
        }
        const current = selectionRef.current
        void wavesurfer.play(current.start, current.end)
      })
    },
    [wavesurfer],
  )

  useEffect(
    function createRegion() {
      if (wavesurfer === null || !isReady) {
        return
      }
      const current = selectionRef.current
      const region: Region = plugin.addRegion({
        start: current.start,
        end: current.end,
        // 手柄仍改单端；正文拖动整段平移，两种方式都在 handleUpdate 里走绝对夹紧
        drag: true,
        resize: true,
        resizeStart: true,
        resizeEnd: true,
        // 最小长度交给 handleUpdate 按绝对边界夹紧；库在低于 minLength 时会直接丢弃更新，
        // 快速拖动反而停在离边界很远的位置，表现为“卡住”
        minLength: 0,
        // 选区颜色跟随主题令牌
        color: 'var(--color-selection)',
      })

      // setOptions 会再次触发 update，用标记避免递归
      let syncing = false

      function handleUpdate(side?: UpdateSide): void {
        if (syncing) {
          return
        }
        const proposed = { start: region.start, end: region.end }
        // side 有值代表按在手柄上，只改对应一端；无值代表按在选区内部，
        // wavesurfer 会同时平移两端，这里按固定长度重建，避免被当成端点缩放
        const currentEdge: SelectionEdge | null =
          side === 'start' ? 'start' : side === 'end' ? 'end' : null
        let next: Selection
        if (currentEdge === 'start') {
          next = {
            start: clampSelectionStart(
              proposed.start,
              proposed.end,
              minStartLengthAtEnd(proposed.end),
              maxLengthSec,
            ),
            end: proposed.end,
          }
        } else if (currentEdge === 'end') {
          next = {
            start: proposed.start,
            end: clampSelectionEnd(
              proposed.end,
              proposed.start,
              durationRef.current,
              minLengthSec,
              maxLengthSec,
            ),
          }
        } else {
          const current = selectionRef.current
          const length = current.end - current.start
          const start = clampSelectionMove(proposed.start, length, durationRef.current)
          next = { start, end: start + length }
        }
        // 只回写被夹紧的端点，绝不移动另一端；平移时两端一起回到合法位置
        if (next.start !== proposed.start || next.end !== proposed.end) {
          syncing = true
          region.setOptions({ start: next.start, end: next.end })
          syncing = false
        }
        selectionRef.current = next
        setSelectionState(next)
        if (currentEdge !== null) {
          setActiveEdge(currentEdge)
        }
        if (wavesurfer === null) {
          return
        }
        // 暂停时只更新选区，不自动出声；正在播放才跟随拖动定位
        if (!wavesurfer.isPlaying()) {
          return
        }
        const target =
          currentEdge === 'end'
            ? Math.max(next.start, next.end - AUDITION_TAIL_SEC)
            : next.start
        wavesurfer.setTime(target)
      }

      function handleUpdateEnd(): void {
        if (wavesurfer === null || !wavesurfer.isPlaying() || !loopRef.current) {
          return
        }
        const next = selectionRef.current
        wavesurfer.pause()
        void wavesurfer.play(next.start, next.end)
      }

      const offUpdate = region.on('update', handleUpdate)
      const offEnd = region.on('update-end', handleUpdateEnd)
      return function cleanupRegion(): void {
        offUpdate()
        offEnd()
        region.remove()
      }
    },
    [wavesurfer, isReady, plugin, minStartLengthAtEnd, maxLengthSec],
  )

  const setLoop = useCallback((next: boolean) => {
    setLoopState(next)
    loopRef.current = next
  }, [])

  const setVolume = useCallback(
    (next: number) => {
      const bounded = Math.min(1, Math.max(0, next))
      setVolumeState(bounded)
      wavesurfer?.setVolume(bounded)
    },
    [wavesurfer],
  )

  const playSelection = useCallback(() => {
    if (wavesurfer === null || !isReady) {
      return
    }
    const current = selectionRef.current
    wavesurfer.setTime(current.start)
    void wavesurfer.play(current.start, current.end)
  }, [wavesurfer, isReady])

  const toggle = useCallback(() => {
    if (wavesurfer === null || !isReady) {
      return
    }
    if (wavesurfer.isPlaying()) {
      wavesurfer.pause()
      return
    }
    playSelection()
  }, [wavesurfer, isReady, playSelection])

  const stop = useCallback(() => {
    if (wavesurfer === null) {
      return
    }
    wavesurfer.pause()
    wavesurfer.setTime(selectionRef.current.start)
  }, [wavesurfer])

  const adjustEdge = useCallback(
    (edge: SelectionEdge, deltaSec: number) => {
      const current = selectionRef.current
      const next: Selection =
        edge === 'start'
          ? {
              start: clampSelectionStart(
                current.start + deltaSec,
                current.end,
                minStartLengthAtEnd(current.end),
                maxLengthSec,
              ),
              end: current.end,
            }
          : {
              start: current.start,
              end: clampSelectionEnd(
                current.end + deltaSec,
                current.start,
                durationRef.current,
                minLengthSec,
                maxLengthSec,
              ),
            }
      commitSelection(next)
      if (wavesurfer === null || !wavesurfer.isPlaying()) {
        return
      }
      const target =
        edge === 'start' ? next.start : Math.max(next.start, next.end - AUDITION_TAIL_SEC)
      wavesurfer.setTime(target)
    },
    [commitSelection, minStartLengthAtEnd, maxLengthSec, wavesurfer],
  )

  return {
    containerRef,
    isReady,
    isPlaying,
    currentTime,
    duration,
    selection,
    activeEdge,
    loop,
    volume,
    error,
    setLoop,
    setVolume,
    playSelection,
    toggle,
    stop,
    adjustEdge,
  }
}
