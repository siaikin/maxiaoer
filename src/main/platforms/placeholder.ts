import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

/** 生成一张 600x800 的纯色 PNG，用来在发布页里“打开表单”读取合集等选项 */
export async function placeholderImage(): Promise<string> {
  const width = 600
  const height = 800
  const row = Buffer.alloc(1 + width * 3, 0xee)
  row[0] = 0 // filter: none
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.from([...u32(width), ...u32(height), 8, 2, 0, 0, 0])),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const file = join(tmpdir(), 'maxiaoer-placeholder.png')
  await writeFile(file, png)
  return file
}

function u32(n: number) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer) {
  const t = Buffer.from(type)
  return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))])
}
