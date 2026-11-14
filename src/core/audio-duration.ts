// 导入铃声前的可解码校验：纯函数解析容器头，不依赖 ffmpeg 或 DOM
export const RINGTONE_FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'm4a'] as const
export type RingtoneFormat = (typeof RINGTONE_FORMATS)[number]

export function isRingtoneFormat(value: string): value is RingtoneFormat {
  return (RINGTONE_FORMATS as readonly string[]).includes(value)
}

// 返回秒数（可能带小数）；无法解析时返回 null，由调用方拒绝导入
export function readAudioDuration(bytes: Uint8Array, format: RingtoneFormat): number | null {
  if (bytes.byteLength < 12) {
    return null
  }
  try {
    switch (format) {
      case 'wav':
        return readWavDuration(bytes)
      case 'mp3':
        return readMp3Duration(bytes)
      case 'ogg':
        return readOggDuration(bytes)
      case 'flac':
        return readFlacDuration(bytes)
      case 'm4a':
        return readM4aDuration(bytes)
    }
  } catch {
    return null
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = ''
  for (let index = 0; index < length; index += 1) {
    const code = bytes[offset + index]
    if (code === undefined) {
      return ''
    }
    text += String.fromCharCode(code)
  }
  return text
}

function readWavDuration(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    return null
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  let byteRate = 0
  let dataSize = -1
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4)
    const size = data.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= bytes.byteLength) {
      byteRate = data.getUint32(body + 8, true)
    } else if (id === 'data') {
      dataSize = Math.min(size, bytes.byteLength - body)
      break
    }
    offset = body + size + (size % 2)
    if (size <= 0) {
      break
    }
  }
  if (byteRate <= 0 || dataSize <= 0) {
    return null
  }
  return dataSize / byteRate
}

type Mp3Frame = {
  readonly sampleRate: number
  readonly samples: number
  readonly length: number
  readonly bitrate: number
  readonly version: 1 | 2 | 25
  readonly layer: 1 | 2 | 3
  readonly mono: boolean
}

const MP3_BITRATES: Readonly<Record<string, readonly number[]>> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}

const MP3_SAMPLE_RATES: Readonly<Record<'1' | '2' | '25', readonly number[]>> = {
  '1': [44100, 48000, 32000],
  '2': [22050, 24000, 16000],
  '25': [11025, 12000, 8000],
}

function readMp3Duration(bytes: Uint8Array): number | null {
  let start = 0
  if (ascii(bytes, 0, 3) === 'ID3') {
    const size =
      ((bytes[6] ?? 0) & 0x7f) * 0x200000 +
      ((bytes[7] ?? 0) & 0x7f) * 0x4000 +
      ((bytes[8] ?? 0) & 0x7f) * 0x80 +
      ((bytes[9] ?? 0) & 0x7f)
    start = 10 + size + ((bytes[5] ?? 0) & 0x10 ? 10 : 0)
  }
  const frameStart = findFrameSync(bytes, start)
  if (frameStart === -1) {
    return null
  }
  const first = parseMp3Frame(bytes, frameStart)
  if (first === null) {
    return null
  }
  // Xing/Info 提供总帧数，VBR 也能精确计算
  const xingFrames = readXingFrameCount(bytes, frameStart, first)
  if (xingFrames !== null && xingFrames > 0) {
    return (xingFrames * first.samples) / first.sampleRate
  }
  // 无 Xing 时逐帧累计，避免按文件体积估算 VBR
  let offset = frameStart
  let samples = 0
  let frames = 0
  while (offset + 4 <= bytes.byteLength && frames < 200_000) {
    const frame = parseMp3Frame(bytes, offset)
    if (frame === null) {
      const next = findFrameSync(bytes, offset + 1)
      if (next === -1) {
        break
      }
      offset = next
      continue
    }
    samples += frame.samples
    offset += frame.length
    frames += 1
  }
  return frames === 0 ? null : samples / first.sampleRate
}

function findFrameSync(bytes: Uint8Array, from: number): number {
  for (let offset = Math.max(0, from); offset + 4 < bytes.byteLength; offset += 1) {
    if (bytes[offset] === 0xff && ((bytes[offset + 1] ?? 0) & 0xe0) === 0xe0) {
      if (parseMp3Frame(bytes, offset) !== null) {
        return offset
      }
    }
  }
  return -1
}

function parseMp3Frame(bytes: Uint8Array, offset: number): Mp3Frame | null {
  if (offset + 4 > bytes.byteLength || bytes[offset] !== 0xff) {
    return null
  }
  const b1 = bytes[offset + 1] ?? 0
  const b2 = bytes[offset + 2] ?? 0
  const b3 = bytes[offset + 3] ?? 0
  if ((b1 & 0xe0) !== 0xe0) {
    return null
  }
  const versionBits = (b1 >> 3) & 3
  const layerBits = (b1 >> 1) & 3
  if (versionBits === 1 || layerBits === 0) {
    return null
  }
  const version: 1 | 2 | 25 = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25
  const layer: 1 | 2 | 3 = layerBits === 3 ? 1 : layerBits === 2 ? 2 : 3
  if (layer > 3) {
    return null
  }
  const bitrateIndex = (b2 >> 4) & 0x0f
  const sampleRateIndex = (b2 >> 2) & 3
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null
  }
  const group = version === 1 ? '1' : version === 2 ? '2' : '2'
  const bitrate = MP3_BITRATES[`${group}-${layer}`]?.[bitrateIndex] ?? 0
  const sampleRate = MP3_SAMPLE_RATES[version === 1 ? '1' : version === 2 ? '2' : '25']?.[
    sampleRateIndex
  ]
  if (bitrate <= 0 || sampleRate === undefined) {
    return null
  }
  const padding = (b2 >> 1) & 1
  const mono = ((b3 >> 6) & 3) === 3
  const samples =
    layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576
  const length =
    layer === 1
      ? Math.floor((12 * bitrate * 1000) / sampleRate + padding) * 4
      : Math.floor((samples / 8) * (bitrate * 1000) / sampleRate + padding)
  if (length < 4) {
    return null
  }
  return { sampleRate, samples, length, bitrate, version, layer, mono }
}

function readXingFrameCount(bytes: Uint8Array, frameStart: number, frame: Mp3Frame): number | null {
  const sideInfo = frame.version === 1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17
  const tag = frameStart + 4 + sideInfo
  const name = ascii(bytes, tag, 4)
  if (name !== 'Xing' && name !== 'Info') {
    return null
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = data.getUint32(tag + 4)
  if ((flags & 0x01) === 0) {
    return null
  }
  return data.getUint32(tag + 8)
}

function readOggDuration(bytes: Uint8Array): number | null {
  const firstPage = findOggPage(bytes, 0)
  if (firstPage === null) {
    return null
  }
  const packet = bytes.subarray(firstPage.payloadStart, firstPage.payloadStart + firstPage.firstPacketLength)
  let sampleRate = 0
  if (ascii(packet, 0, 8) === 'OpusHead') {
    sampleRate = 48000
  } else if (ascii(packet, 1, 6) === 'vorbis') {
    const packetView = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
    sampleRate = packetView.getUint32(12, true)
  }
  if (sampleRate <= 0) {
    return null
  }
  let offset = firstPage.nextOffset
  let lastGranule = firstPage.granule
  let pages = 0
  while (offset + 27 <= bytes.byteLength && pages < 100_000) {
    const page = findOggPage(bytes, offset)
    if (page === null) {
      break
    }
    if (page.granule >= 0) {
      lastGranule = page.granule
    }
    offset = page.nextOffset
    pages += 1
  }
  if (lastGranule < 0) {
    return null
  }
  return lastGranule / sampleRate
}

type OggPage = {
  readonly granule: number
  readonly payloadStart: number
  readonly firstPacketLength: number
  readonly nextOffset: number
}

function findOggPage(bytes: Uint8Array, from: number): OggPage | null {
  for (let offset = from; offset + 27 <= bytes.byteLength; offset += 1) {
    if (ascii(bytes, offset, 4) !== 'OggS') {
      continue
    }
    const segments = bytes[offset + 26] ?? 0
    const tableStart = offset + 27
    const payloadStart = tableStart + segments
    if (payloadStart > bytes.byteLength) {
      return null
    }
    let payloadLength = 0
    let firstPacketLength = 0
    for (let index = 0; index < segments; index += 1) {
      const size = bytes[tableStart + index] ?? 0
      payloadLength += size
      if (index === 0) {
        firstPacketLength = size
      }
    }
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const low = data.getUint32(offset + 6, true)
    const high = data.getUint32(offset + 10, true)
    const invalid = low === 0xffffffff && high === 0xffffffff
    return {
      granule: invalid ? -1 : high * 0x1_0000_0000 + low,
      payloadStart,
      firstPacketLength,
      nextOffset: payloadStart + payloadLength,
    }
  }
  return null
}

function readFlacDuration(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== 'fLaC') {
    return null
  }
  let offset = 4
  while (offset + 4 <= bytes.byteLength) {
    const header = bytes[offset] ?? 0
    const isLast = (header & 0x80) !== 0
    const type = header & 0x7f
    const length =
      ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
    const body = offset + 4
    if (body + length > bytes.byteLength) {
      return null
    }
    if (type === 0 && length >= 34) {
      const b10 = bytes[body + 10] ?? 0
      const b11 = bytes[body + 11] ?? 0
      const b12 = bytes[body + 12] ?? 0
      const b13 = bytes[body + 13] ?? 0
      const sampleRate = ((b10 << 12) | (b11 << 4) | (b12 >> 4)) & 0xfffff
      const highSamples = b13 & 0x0f
      const b14 = bytes[body + 14] ?? 0
      const b15 = bytes[body + 15] ?? 0
      const b16 = bytes[body + 16] ?? 0
      const b17 = bytes[body + 17] ?? 0
      const totalSamples =
        highSamples * 0x1_0000_0000 + ((b14 << 24) >>> 0) + (b15 << 16) + (b16 << 8) + b17
      return sampleRate > 0 ? totalSamples / sampleRate : null
    }
    if (isLast) {
      return null
    }
    offset = body + length
  }
  return null
}

function readM4aDuration(bytes: Uint8Array): number | null {
  const moov = findIsoBox(bytes, 0, bytes.byteLength, 'moov')
  if (moov === null) {
    return null
  }
  const mvhd = findIsoBox(bytes, moov.body, moov.end, 'mvhd')
  if (mvhd === null) {
    return null
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = bytes[mvhd.body] ?? 0
  const payload = mvhd.body + 4
  if (version === 1) {
    const timescale = data.getUint32(payload + 16)
    const duration = data.getBigUint64(payload + 20)
    return timescale > 0 ? Number(duration) / timescale : null
  }
  const timescale = data.getUint32(payload + 8)
  const duration = data.getUint32(payload + 12)
  return timescale > 0 ? duration / timescale : null
}

type IsoBox = { readonly body: number; readonly end: number }

function findIsoBox(bytes: Uint8Array, start: number, end: number, type: string): IsoBox | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = start
  while (offset + 8 <= end) {
    let size = data.getUint32(offset)
    const name = ascii(bytes, offset + 4, 4)
    let header = 8
    if (size === 1) {
      if (offset + 16 > end) {
        return null
      }
      size = Number(data.getBigUint64(offset + 8))
      header = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) {
      return null
    }
    if (name === type) {
      return { body: offset + header, end: offset + size }
    }
    offset += size
  }
  return null
}
