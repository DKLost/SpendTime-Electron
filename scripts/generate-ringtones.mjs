// 生成内置铃声 WAV：无外部版权素材，全部为正弦波合成
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SAMPLE_RATE = 22_050
const root = process.cwd()
const outputDir = join(root, 'resources/ringtones')
mkdirSync(outputDir, { recursive: true })

function writeWav(name, render) {
  const samples = render()
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2)
  })
  writeFileSync(join(outputDir, `${name}.wav`), buffer)
}

function tone(frequency, startAt, duration, volume) {
  return (t) => {
    if (t < startAt || t > startAt + duration) {
      return 0
    }
    const local = t - startAt
    const envelope = Math.min(1, local / 0.015) * Math.max(0, 1 - local / duration) ** 2
    return Math.sin(2 * Math.PI * frequency * local) * envelope * volume
  }
}

function mix(durationSec, parts) {
  return () => {
    const total = Math.floor(durationSec * SAMPLE_RATE)
    return Array.from({ length: total }, (_, index) => {
      const t = index / SAMPLE_RATE
      return parts.reduce((sum, part) => sum + part(t), 0)
    })
  }
}

writeWav(
  'chime',
  mix(1.6, [tone(880, 0, 0.9, 0.32), tone(1174.66, 0.18, 1.1, 0.24)]),
)

writeWav(
  'bell',
  mix(2.0, [
    tone(659.25, 0, 1.6, 0.26),
    tone(1318.5, 0, 1.2, 0.12),
    tone(1977.75, 0, 0.8, 0.06),
  ]),
)

writeWav(
  'pulse',
  mix(1.2, [
    tone(520, 0, 0.14, 0.3),
    tone(520, 0.24, 0.14, 0.3),
    tone(780, 0.48, 0.2, 0.28),
  ]),
)
