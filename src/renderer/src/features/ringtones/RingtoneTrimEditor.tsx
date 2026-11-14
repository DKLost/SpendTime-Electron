import { useEffect, type KeyboardEvent } from 'react'
import { AudioPlayerControls } from '../../audio/AudioPlayerControls'
import { formatPlayerTime } from '../../audio/format-time'
import { useSelectionPlayer } from '../../audio/use-selection-player'
import { t } from '../../translation'
import { pendingRingtoneUrl, stopRingtone } from './play-ringtone'

// 与主进程校验保持一致：长度上限 60 秒，粒度 0.1 秒
const CLIP_MIN_SEC = 0.1
const CLIP_MAX_SEC = 60

export type RingtoneTrimSource = {
  readonly fileName: string
  readonly name: string
  readonly durationSec: number
}

type RingtoneTrimEditorProps = {
  readonly source: RingtoneTrimSource
  readonly initialRange: { readonly start: number; readonly end: number }
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: (startSec: number, endSec: number) => void
}

export function RingtoneTrimEditor(props: RingtoneTrimEditorProps) {
  const { source, initialRange, busy, onCancel, onConfirm } = props
  const fallbackDuration = Math.max(CLIP_MIN_SEC, source.durationSec)

  const player = useSelectionPlayer({
    url: pendingRingtoneUrl(source.fileName),
    initialSelection: initialRange,
    minLengthSec: CLIP_MIN_SEC,
    maxLengthSec: CLIP_MAX_SEC,
  })

  // 打开截取卡片时先让提醒铃声闭嘴，关闭时也确保共享播放器停止
  useEffect(function silenceSharedPlayer() {
    stopRingtone()
    return function cleanup(): void {
      stopRingtone()
    }
  }, [])

  const duration = player.duration > 0 ? player.duration : fallbackDuration
  const range = player.selection
  const length = range.end - range.start

  function handlePreview(): void {
    if (player.isPlaying) {
      player.stop()
      return
    }
    player.playSelection()
  }

  function handleCancel(): void {
    player.stop()
    onCancel()
  }

  function handleConfirm(): void {
    player.stop()
    onConfirm(range.start, range.end)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    const step = event.shiftKey ? 1 : CLIP_MIN_SEC
    player.adjustEdge(player.activeEdge, event.key === 'ArrowLeft' ? -step : step)
  }

  return (
    <section
      className="ringtone-trim"
      aria-label={t('ringtone.trimTitle')}
      data-ready={player.isReady}
      data-playing={player.isPlaying}
    >
      <div className="ringtone-trim-head">
        <span className="ringtone-trim-name" title={source.name}>
          {source.name}
        </span>
        <span className="badge">{t('ringtone.trimSource', { length: formatPlayerTime(duration) })}</span>
      </div>

      <div
        className="ringtone-waveform"
        data-ready={player.isReady}
        tabIndex={0}
        role="group"
        aria-label={t('ringtone.trimWaveformAria')}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
      >
        <div className="ringtone-waveform-canvas" ref={player.containerRef} />
        {!player.isReady && player.error === null ? (
          <span className="ringtone-waveform-hint">{t('ringtone.waveformLoading')}</span>
        ) : null}
        {player.error !== null ? (
          <span className="ringtone-waveform-hint">{t('ringtone.waveformError')}</span>
        ) : null}
      </div>

      <div className="ringtone-trim-summary">
        <span className="mono ringtone-trim-range" aria-live="polite">
          {formatPlayerTime(range.start)} → {formatPlayerTime(range.end)}
        </span>
        <span className="mono ringtone-trim-length">
          {t('ringtone.trimLength', { length: formatPlayerTime(length) })}
        </span>
        <span className="hint">{t('ringtone.trimKeyboard')}</span>
      </div>

      <AudioPlayerControls
        isReady={player.isReady}
        isPlaying={player.isPlaying}
        currentTime={player.currentTime}
        duration={duration}
        loop={player.loop}
        volume={player.volume}
        onToggle={player.toggle}
        onLoopChange={player.setLoop}
        onVolumeChange={player.setVolume}
      />

      <div className="ringtone-trim-actions">
        <button
          type="button"
          className={player.isPlaying ? 'primary compact' : 'ghost compact'}
          aria-pressed={player.isPlaying}
          data-previewing={player.isPlaying}
          onClick={handlePreview}
          disabled={busy || !player.isReady}
        >
          {player.isPlaying ? t('ringtone.trimStop') : t('ringtone.trimPreview')}
        </button>
        <button type="button" className="ghost compact" onClick={handleCancel} disabled={busy}>
          {t('ringtone.trimCancel')}
        </button>
        <button
          type="button"
          className="primary compact"
          onClick={handleConfirm}
          disabled={busy || !player.isReady}
        >
          {busy ? t('ringtone.trimSaving') : t('ringtone.trimConfirm')}
        </button>
      </div>
    </section>
  )
}
