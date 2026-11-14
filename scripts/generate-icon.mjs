// 零依赖生成 512×512 应用图标：深色圆角底 + 品牌蓝计时刻度环
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'

const SIZE = 512
const CENTER = SIZE / 2

const BACKGROUND_TOP = [35, 39, 47] // #23272f
const BACKGROUND_BOTTOM = [23, 29, 37] // #171d25
const ACCENT = [26, 159, 253] // #1a9ffd
const HAND = [255, 255, 255]
const OUTER_RADIUS = 96

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

// 距离场的 1px 过渡作为抗锯齿
function coverage(distance, edge) {
  return clamp01(0.5 - (distance - edge))
}

function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x) - (halfWidth - radius)
  const dy = Math.abs(y) - (halfHeight - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  const inside = Math.min(Math.max(dx, dy), 0)
  return outside + inside - radius
}

function capsuleDistance(x, y, fromX, fromY, toX, toY, radius) {
  const vx = toX - fromX
  const vy = toY - fromY
  const wx = x - fromX
  const wy = y - fromY
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy))
  return Math.hypot(wx - vx * t, wy - vy * t) - radius
}

function mix(base, color, alpha) {
  return [
    Math.round(base[0] + (color[0] - base[0]) * alpha),
    Math.round(base[1] + (color[1] - base[1]) * alpha),
    Math.round(base[2] + (color[2] - base[2]) * alpha),
  ]
}

function drawPixel(x, y) {
  let color = [0, 0, 0]
  let alpha = 0

  const background = coverage(roundedRectDistance(x - CENTER, y - CENTER, 256, 256, OUTER_RADIUS), 0)
  if (background <= 0) {
    return [0, 0, 0, 0]
  }
  const ratio = y / SIZE
  const base = [
    Math.round(BACKGROUND_TOP[0] + (BACKGROUND_BOTTOM[0] - BACKGROUND_TOP[0]) * ratio),
    Math.round(BACKGROUND_TOP[1] + (BACKGROUND_BOTTOM[1] - BACKGROUND_TOP[1]) * ratio),
    Math.round(BACKGROUND_TOP[2] + (BACKGROUND_BOTTOM[2] - BACKGROUND_TOP[2]) * ratio),
  ]
  color = base
  alpha = background

  // 内层凹槽
  const groove = coverage(roundedRectDistance(x - CENTER, y - CENTER, 208, 208, 72), 0)
  if (groove > 0) {
    color = mix(color, [23, 29, 37], groove)
  }

  // 品牌蓝刻度环
  const radius = Math.hypot(x - CENTER, y - CENTER)
  const ring = coverage(Math.abs(radius - 158) - 18, 0)
  if (ring > 0) {
    color = mix(color, ACCENT, ring)
  }

  // 表盘指针
  const minuteHand = coverage(
    capsuleDistance(x, y, CENTER, CENTER, CENTER, CENTER - 104, 9),
    0,
  )
  const hourHand = coverage(
    capsuleDistance(x, y, CENTER, CENTER, CENTER + 76, CENTER + 34, 11),
    0,
  )
  const hand = Math.max(minuteHand, hourHand)
  if (hand > 0) {
    color = mix(color, HAND, hand)
  }

  const hub = coverage(Math.hypot(x - CENTER, y - CENTER) - 15, 0)
  if (hub > 0) {
    color = mix(color, ACCENT, hub)
  }
  return [color[0], color[1], color[2], Math.round(alpha * 255)]
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng() {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  let offset = 0
  for (let y = 0; y < SIZE; y += 1) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = drawPixel(x + 0.5, y + 0.5)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
      offset += 4
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const target = join(import.meta.dirname, '../build/icon.png')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, encodePng())
console.log(`已生成图标：${target}`)
