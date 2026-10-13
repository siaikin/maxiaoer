import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { IS_DECOY } from '../anti-detection/decoy'
import type { BrowserContext } from './types'

const q = (s: string) => JSON.stringify(s)

/**
 * 在页面里找到「selector 匹配、且文字包含 text」的元素，给它（或它内部 inner 匹配的子元素）打标记，
 * 返回标记选择器，再交给 ctx.click 用真实鼠标点击。
 */
export async function mark(ctx: BrowserContext, selector: string, text: string, inner?: string) {
  const id = `mxe-${Math.random().toString(36).slice(2)}`
  const ok = await ctx.evaluate<boolean>(`(() => {
    const isDecoy = ${IS_DECOY}
    const el = [...document.querySelectorAll(${q(selector)})].find((e) => !isDecoy(e) && e.textContent.includes(${q(text)}))
    const target = el && ${inner ? `el.querySelector(${q(inner)})` : 'el'}
    if (!target || isDecoy(target)) return false
    target.setAttribute('data-mxe', ${q(id)})
    return true
  })()`)
  return ok ? `[data-mxe="${id}"]` : null
}

export async function clickWithin(ctx: BrowserContext, selector: string, text: string, inner?: string) {
  const target = await mark(ctx, selector, text, inner)
  if (!target) throw new Error(`找不到「${text}」`)
  await ctx.click(target)
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

export const imageMime = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 在页面上下文里用 fetch 以 application/octet-stream 上传原始文件内容（带页面自己的 cookie），返回 JSON */
export async function pageFetchBinary<T>(ctx: BrowserContext, url: string, data: Buffer): Promise<T> {
  return ctx.evaluate<T>(`(async () => {
    const body = Uint8Array.from(atob(${q(data.toString('base64'))}), (c) => c.charCodeAt(0))
    const res = await fetch(${q(url)}, { method: 'POST', body, credentials: 'include', headers: { 'content-type': 'application/octet-stream' } })
    return res.json()
  })()`)
}

/**
 * 在页面上下文里用 fetch 提交 multipart 表单（带上页面自己的 cookie / referer），返回 JSON。
 * 值为 { file } 的字段会读取本地文件作为 Blob 上传。
 */
export async function pageFetchForm<T>(
  ctx: BrowserContext,
  url: string,
  fields: Record<string, string | { file: string }>,
): Promise<T> {
  const encoded: Record<string, string | { name: string; type: string; base64: string }> = {}
  for (const [k, v] of Object.entries(fields)) {
    encoded[k] =
      typeof v === 'string'
        ? v
        : { name: basename(v.file), type: imageMime(v.file), base64: (await readFile(v.file)).toString('base64') }
  }
  return ctx.evaluate<T>(`(async () => {
    const fields = ${JSON.stringify(encoded)}
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === 'string') form.append(k, v)
      else form.append(k, new File([Uint8Array.from(atob(v.base64), (c) => c.charCodeAt(0))], v.name, { type: v.type }))
    }
    const res = await fetch(${q(url)}, { method: 'POST', body: form, credentials: 'include' })
    return res.json()
  })()`)
}

/** 轮询直到 fn 返回真值 */
export async function until<T>(ctx: BrowserContext, fn: () => Promise<T>, timeoutMs: number, message: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await fn()
    if (v) return v
    await ctx.sleep(500)
  }
  throw new Error(message)
}
