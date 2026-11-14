import type { ChangeEvent } from 'react'
import { t } from '../translation'
import { formatPlayerTime } from './format-time'

type AudioPlayerControlsProps = {
  readonly isReady: boolean
  readonly isPlaying: boolean
  readonly currentTime: number
  readonly duration: number
  readonly loop: boolean
  readonly volume: number
  readonly onToggle: () => void
  readonly onLoopChange: (next: boolean) => void
  readonly onVolumeChange: (next: number) => void
}

// 与具体业务无关的播放条：截取预览、铃声试听都复用它
export function AudioPlayerControls(props: AudioPlayerControlsProps) {
  const { isReady, isPlaying, currentTime, duration, loop, volume } = props
  const { onToggle, onLoopChange, onVolumeChange } = props

  function handleLoopChange(event: ChangeEvent<HTMLInputElement>): void {
    onLoopChange(event.currentTarget.checked)
  }

  function handleVolumeChange(event: ChangeEvent<HTMLInputElement>): void {
    onVolumeChange(Number(event.currentTarget.value))
  }

  return (
    <div className="audio-player" data-playing={isPlaying} data-ready={isReady}>
      <button
        type="button"
        className="ghost compact audio-player-toggle"
        aria-pressed={isPlaying}
        aria-label={isPlaying ? t('audio.pause') : t('audio.play')}
        onClick={onToggle}
        disabled={!isReady}
      >
        {isPlaying ? t('audio.pause') : t('audio.play')}
      </button>

      <span className="mono audio-player-time">
        {formatPlayerTime(currentTime)} / {formatPlayerTime(duration)}
      </span>

      <label className="audio-player-loop">
        <input type="checkbox" checked={loop} onChange={handleLoopChange} disabled={!isReady} />
        <span>{t('audio.loopSelection')}</span>
      </label>

      <label className="audio-player-volume">
        <span className="label">{t('audio.volume')}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={handleVolumeChange}
          disabled={!isReady}
          aria-label={t('audio.volume')}
        />
      </label>
    </div>
  )
}
