import { useEffect, useState } from 'react'
import type WaveSurfer from 'wavesurfer.js'

export type WaveformColors = {
  readonly wave: string
  readonly progress: string
  readonly cursor: string
}

// 波形画在 wavesurfer 的 Shadow DOM 画布里，颜色只能通过配置项注入，
// 因此统一从主题令牌读取，主题/密度切换时再回写，不重建播放器实例。
const TOKEN_WAVE = '--color-text-weak'
const TOKEN_PROGRESS = '--color-accent'
const TOKEN_CURSOR = '--color-accent-deep'

export function readWaveformColors(): WaveformColors {
  const styles = getComputedStyle(document.documentElement)
  return {
    wave: readToken(styles, TOKEN_WAVE),
    progress: readToken(styles, TOKEN_PROGRESS),
    cursor: readToken(styles, TOKEN_CURSOR),
  }
}

function readToken(styles: CSSStyleDeclaration, token: string): string {
  return styles.getPropertyValue(token).trim()
}

export function useWaveformColors(wavesurfer: WaveSurfer | null): WaveformColors {
  const [colors, setColors] = useState(readWaveformColors)

  useEffect(function followThemeChanges() {
    const observer = new MutationObserver(() => setColors(readWaveformColors()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-density', 'class', 'style'],
    })
    return function cleanup(): void {
      observer.disconnect()
    }
  }, [])

  useEffect(
    function applyWaveformColors() {
      if (wavesurfer === null) {
        return
      }
      wavesurfer.setOptions({
        waveColor: colors.wave,
        progressColor: colors.progress,
        cursorColor: colors.cursor,
      })
    },
    [wavesurfer, colors],
  )

  return colors
}
