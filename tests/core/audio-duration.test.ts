import { describe, expect, it } from 'vitest'
import { isRingtoneFormat, readAudioDuration } from '@core/audio-duration'

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    target[offset + index] = text.charCodeAt(index)
  }
}

function writeU32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

function writeU32LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

function buildWav(seconds: number): Uint8Array {
  const byteRate = 8000
  const dataSize = byteRate * seconds
  const bytes = new Uint8Array(44 + dataSize)
  writeAscii(bytes, 0, 'RIFF')
  writeU32LE(bytes, 4, 36 + dataSize)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  writeU32LE(bytes, 16, 16)
  writeU32LE(bytes, 20, 1)
  writeU32LE(bytes, 24, byteRate)
  writeU32LE(bytes, 28, byteRate)
  writeAscii(bytes, 36, 'data')
  writeU32LE(bytes, 40, dataSize)
  return bytes
}

describe('readAudioDuration', () => {
  it('识别格式白名单', () => {
    expect(isRingtoneFormat('mp3')).toBe(true)
    expect(isRingtoneFormat('wav')).toBe(true)
    expect(isRingtoneFormat('exe')).toBe(false)
  })

  it('WAV 按 data/byteRate 计算', () => {
    expect(readAudioDuration(buildWav(2), 'wav')).toBeCloseTo(2, 5)
  })

  it('MP3 逐帧累计，不按文件体积估算', () => {
    const frameLength = Math.floor((144 * 128_000) / 44_100)
    const bytes = new Uint8Array(frameLength * 2)
    for (let index = 0; index < 2; index += 1) {
      const offset = index * frameLength
      bytes[offset] = 0xff
      bytes[offset + 1] = 0xfb
      bytes[offset + 2] = 0x90
      bytes[offset + 3] = 0x64
    }
    const duration = readAudioDuration(bytes, 'mp3')
    expect(duration).not.toBeNull()
    expect(duration ?? 0).toBeCloseTo((2 * 1152) / 44_100, 5)
  })

  it('OGG 用末页 granule 计算', () => {
    const first = new Uint8Array(28 + 30)
    writeAscii(first, 0, 'OggS')
    first[4] = 0
    first[5] = 2
    writeU32LE(first, 26, 0)
    first[26] = 1
    first[27] = 30
    const packet = 28
    first[packet] = 1
    writeAscii(first, packet + 1, 'vorbis')
    writeU32LE(first, packet + 12, 44_100)

    const second = new Uint8Array(27)
    writeAscii(second, 0, 'OggS')
    second[4] = 0
    second[5] = 0
    writeU32LE(second, 6, 88_200)
    writeU32LE(second, 10, 0)
    writeU32LE(second, 14, 1)
    writeU32LE(second, 18, 1)
    writeU32LE(second, 22, 0)
    second[26] = 0

    const bytes = new Uint8Array(first.length + second.length)
    bytes.set(first, 0)
    bytes.set(second, first.length)
    // 第一个 page 的 granule 在 6..13，保持 0；最终以第二页 88200 为准
    expect(readAudioDuration(bytes, 'ogg')).toBeCloseTo(2, 5)
  })

  it('FLAC 读取 STREAMINFO 总采样数', () => {
    const bytes = new Uint8Array(4 + 4 + 34)
    writeAscii(bytes, 0, 'fLaC')
    bytes[4] = 0x80
    bytes[5] = 0x00
    bytes[6] = 0x00
    bytes[7] = 0x22
    const info = 8
    const packed = ((44_100 << 12) | (1 << 9) | (15 << 4)) >>> 0
    writeU32BE(bytes, info + 10, packed)
    writeU32BE(bytes, info + 14, 88_200)
    expect(readAudioDuration(bytes, 'flac')).toBeCloseTo(2, 5)
  })

  it('M4A 读取 mvhd 时间刻度与时长', () => {
    const bytes = new Uint8Array(36)
    writeU32BE(bytes, 0, 36)
    writeAscii(bytes, 4, 'moov')
    writeU32BE(bytes, 8, 28)
    writeAscii(bytes, 12, 'mvhd')
    // version/flags(4) + creation(4) + modification(4) + timescale(4) + duration(4)
    writeU32BE(bytes, 28, 1000)
    writeU32BE(bytes, 32, 5000)
    expect(readAudioDuration(bytes, 'm4a')).toBeCloseTo(5, 5)
  })

  it('损坏或空文件返回 null', () => {
    expect(readAudioDuration(new Uint8Array(4), 'mp3')).toBeNull()
    expect(readAudioDuration(new Uint8Array(64), 'wav')).toBeNull()
  })
})
