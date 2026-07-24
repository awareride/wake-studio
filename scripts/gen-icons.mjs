// Generate solid-brand-color raster PWA icons (192 & 512) with NO external
// dependencies - just Node's zlib. The PWA manifest currently uses icon.svg;
// run this to produce pwa-192.png / pwa-512.png for full Lighthouse PWA parity,
// then add the PNG entries to the manifest in vite.config.ts.
//
//   node scripts/gen-icons.mjs
//
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, '..', 'public')

const BG = [0x0b, 0x10, 0x20] // #0b1020
const BAR = [0x38, 0xbd, 0xf8] // #38bdf8

// Wave bar segments in 512x512 design space (matches public/icon.svg).
const BARS_512 = [
  { x: 160, y1: 224, y2: 288, w: 20 },
  { x: 208, y1: 176, y2: 336, w: 20 },
  { x: 256, y1: 128, y2: 384, w: 24 },
  { x: 304, y1: 176, y2: 336, w: 20 },
  { x: 352, y1: 224, y2: 288, w: 20 },
]
const CORNER_512 = 96

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function roundedAlpha(x, y, size, radius) {
  // 1 inside the rounded rect, 0 outside (for RGBA alpha).
  const r = radius
  if (x < r) {
    if (y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r ? 1 : 0
    if (y > size - r - 1) return (x - r) ** 2 + (y - (size - r - 1)) ** 2 <= r * r ? 1 : 0
  }
  if (x > size - r - 1) {
    if (y < r) return (x - (size - r - 1)) ** 2 + (y - r) ** 2 <= r * r ? 1 : 0
    if (y > size - r - 1)
      return (x - (size - r - 1)) ** 2 + (y - (size - r - 1)) ** 2 <= r * r ? 1 : 0
  }
  return 1
}

function buildPng(size) {
  const scale = size / 512
  const bars = BARS_512.map((b) => ({
    x: b.x * scale,
    y1: b.y1 * scale,
    y2: b.y2 * scale,
    w: b.w * scale,
  }))
  const corner = CORNER_512 * scale

  const rowLen = 1 + size * 4
  const raw = Buffer.alloc(rowLen * size)
  for (let y = 0; y < size; y++) {
    const off = y * rowLen
    raw[off] = 0 // filter type None
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 4
      const inside = roundedAlpha(x, y, size, corner)
      let [r, g, b] = BG
      const bar = bars.find(
        (barDef) =>
          x >= barDef.x - barDef.w / 2 &&
          x <= barDef.x + barDef.w / 2 &&
          y >= barDef.y1 &&
          y <= barDef.y2,
      )
      if (bar) [r, g, b] = BAR
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
      raw[p + 3] = inside ? 255 : 0
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [192, 512]) {
  const png = buildPng(size)
  const out = resolve(PUBLIC_DIR, `pwa-${size}.png`)
  writeFileSync(out, png)
  console.log(`wrote ${out} (${png.length} bytes)`)
}
