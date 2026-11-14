import { createMockApi } from './mock-api'

// 铃声由主进程通过 spendtime-audio:// 自定义协议提供；无头 harness 没有该协议，
// 这里返回一段真实可解码的 WAV，让 waveforms 真正走一遍 fetch + decodeAudioData
const MOCK_AUDIO_SEC = 186
const MOCK_SAMPLE_RATE = 8000
// 预置的旧铃声只有 12 秒，用于覆盖“音频短于 60 秒”的截取场景
const MOCK_SHORT_AUDIO_SEC = 12
const SHORT_AUDIO_MARKER = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff'

const mockAudioByDuration = new Map<number, ArrayBuffer>()

const originalFetch = window.fetch.bind(window)

window.fetch = function mockFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('spendtime-audio://')) {
    const durationSec = url.includes(SHORT_AUDIO_MARKER) ? MOCK_SHORT_AUDIO_SEC : MOCK_AUDIO_SEC
    let audio = mockAudioByDuration.get(durationSec)
    if (audio === undefined) {
      audio = createMockWav(durationSec, MOCK_SAMPLE_RATE)
      mockAudioByDuration.set(durationSec, audio)
    }
    return Promise.resolve(
      new Response(audio.slice(0), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }),
    )
  }
  return originalFetch(input, init)
}

function createMockWav(durationSec: number, sampleRate: number): ArrayBuffer {
  const totalSamples = Math.floor(durationSec * sampleRate)
  const bytes = new ArrayBuffer(44 + totalSamples * 2)
  const view = new DataView(bytes)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + totalSamples * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, totalSamples * 2, true)

  // 起伏的音量包络，截图里能看到明确的波形而不是一条直线
  for (let index = 0; index < totalSamples; index += 1) {
    const seconds = index / sampleRate
    const swell = 0.16 + 0.24 * Math.abs(Math.sin(seconds * 0.45))
    const pulse = 0.55 + 0.45 * Math.sin(seconds * 2.1)
    const tone = Math.sin(2 * Math.PI * (210 + 40 * Math.sin(seconds * 0.3)) * seconds)
    const sample = Math.max(-1, Math.min(1, tone * swell * pulse))
    view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true)
  }
  return bytes
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

// 必须在渲染入口之前执行：main.tsx 会直接读取 window.spendTime
// ?empty-records=1 用于验证统计「全部」在零记录时的空状态
const api = createMockApi({
  emptyRecords: new URLSearchParams(window.location.search).has('empty-records'),
})
Object.defineProperty(window, 'spendTime', { value: api, configurable: true })
