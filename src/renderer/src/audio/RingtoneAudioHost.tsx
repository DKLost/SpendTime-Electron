import { useEffect, useRef } from 'react'
import { useWavesurfer } from '@wavesurfer/react'
import { setRingtoneAudioHost } from './ringtone-audio'

// 常驻的隐藏播放器：行动铃声、提醒循环、计时结束与试听全部复用它
export function RingtoneAudioHost() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { wavesurfer } = useWavesurfer({
    container: containerRef,
    height: 1,
    waveColor: 'transparent',
    progressColor: 'transparent',
    cursorWidth: 0,
    interact: false,
    hideScrollbar: true,
    sampleRate: 8000,
    backend: 'WebAudio',
  })

  useEffect(
    function registerHost() {
      if (wavesurfer === null) {
        return
      }
      setRingtoneAudioHost(wavesurfer)
      return function unregisterHost(): void {
        setRingtoneAudioHost(null)
      }
    },
    [wavesurfer],
  )

  return (
    <div className="ringtone-audio-host" aria-hidden="true">
      <div ref={containerRef} />
    </div>
  )
}
