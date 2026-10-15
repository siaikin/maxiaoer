import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { basename, join, resolve as resolvePath } from 'node:path'
import sharp from 'sharp'
import { MAX_IMAGE_BYTES } from '../shared/materials'
import type { Material, MaterialSourceInput } from '../shared/materials'
import type { ImageAsset } from '../shared/types'

export { MAX_IMAGE_BYTES } from '../shared/materials'

const MAX_IMAGE_FRAMES = 300
const DOWNLOAD_TIMEOUT = 15_000
const MAX_REDIRECTS = 4
const ID_PATTERN = /^[a-f0-9]{64}$/
const MIME_TYPES = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  tiff: 'image/tiff',
  heif: 'image/heif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
} as const
const OUTPUT_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }

interface StoredMaterial {
  version: 1
  material: Material
  originalFile: string
  publishFile: string
}

/** 只把可由重新上传修复的数据损坏与权限、磁盘故障区分开。 */
class MaterialRecordError extends Error {}

const isMissing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT'

function checkByteSize(size: number) {
  if (!size) throw new Error('图片内容不能为空')
  if (size > MAX_IMAGE_BYTES) throw new Error('图片超过 25 MiB 大小限制')
}

function decodeBase64(value: string): Buffer {
  // 不接受空白、URL-safe 编码或非规范末尾位，避免宽松解码掩盖损坏的输入。
  if (!value.length) throw new Error('Base64 图片不能为空')
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('图片超过 25 MiB 大小限制')
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  if (value.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))) {
    throw new Error('Base64 图片编码无效')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('Base64 图片编码无效')
  checkByteSize(bytes.length)
  return bytes
}

function decodeDataUrl(value: string): Buffer {
  const comma = value.indexOf(',')
  if (!value.startsWith('data:') || comma < 0 || comma > 512) throw new Error('Data URL 必须包含图片类型和图片内容')
  const [mimeType, ...parameters] = value.slice(5, comma).split(';')
  if (!/^image\/[a-zA-Z0-9.+-]+$/.test(mimeType)) throw new Error('Data URL 必须声明 image 图片类型')
  const isBase64 = parameters.at(-1)?.toLowerCase() === 'base64'
  const attributes = isBase64 ? parameters.slice(0, -1) : parameters
  if (attributes.some((attribute) => !/^[a-zA-Z0-9!#$&^_.+-]+=[^,;\r\n]+$/.test(attribute))) {
    throw new Error('Data URL 类型参数无效，请使用 charset=UTF-8 或 base64')
  }
  const payload = value.slice(comma + 1)
  if (isBase64) return decodeBase64(payload)
  // 百分号编码代表原始字节，不能用 decodeURIComponent（它会拒绝 PNG 等二进制的非 UTF-8 字节）。
  // 先核对长度再分配，避免大段百分号输入带来大量小 Buffer。
  if (payload.length > MAX_IMAGE_BYTES * 3) throw new Error('图片超过 25 MiB 大小限制')
  let size = Buffer.byteLength(payload, 'utf8')
  for (let position = payload.indexOf('%'); position !== -1; position = payload.indexOf('%', position + 3)) {
    if (!/^[a-fA-F0-9]{2}$/.test(payload.slice(position + 1, position + 3))) throw new Error('Data URL 百分号编码无效')
    size -= 2
  }
  checkByteSize(size)
  const bytes = Buffer.allocUnsafe(size)
  let cursor = 0
  let written = 0
  for (let position = payload.indexOf('%'); position !== -1; position = payload.indexOf('%', cursor)) {
    written += bytes.write(payload.slice(cursor, position), written, 'utf8')
    bytes[written++] = Number.parseInt(payload.slice(position + 1, position + 3), 16)
    cursor = position + 3
  }
  bytes.write(payload.slice(cursor), written, 'utf8')
  return bytes
}

/** 拒绝内网、回环、链路本地、文档和其他保留地址。IPv6 只接受公开单播。 */
function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113))
  }
  if (family !== 6 || address.includes('.') || address.includes('%')) return false
  const groups = address.toLowerCase().split(':')
  const first = Number.parseInt(groups[0], 16)
  const second = Number.parseInt(groups[1] || '0', 16)
  return first >= 0x2000 && first <= 0x3fff
    && first !== 0x2002
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    && !(first === 0x3fff && second <= 0x0fff)
}

function parseRemoteUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('图片 URL 无效') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('图片 URL 仅支持 HTTP 或 HTTPS')
  if (url.username || url.password) throw new Error('图片 URL 不能包含用户名或密码')
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('图片 URL 仅支持 80 或 443 端口')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || (isIP(hostname) && !isPublicAddress(hostname))) {
    throw new Error('图片 URL 不能访问本机或内网地址')
  }
  return url
}

async function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('图片下载超时')
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new Error('图片下载超时'))
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

/** 每次连接都检查 DNS，并固定地址，避免检查后的二次解析访问内网。 */
async function requestImage(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  const addresses = family ? [{ address: hostname, family }]
    : await waitWithAbort(lookup(hostname, { all: true, verbatim: true }), signal)
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('图片 URL 不能访问本机或内网地址')
  const address = addresses[0]
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(url, {
      method: 'GET', signal, agent: false,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [address]) : callback(null, address.address, address.family),
      headers: { Accept: 'image/*', 'Accept-Encoding': 'identity', 'User-Agent': 'Maxiaoer-MaterialLibrary/1.0' },
    }, resolve)
    req.once('error', reject)
    req.end()
  })
}

async function downloadImage(value: string): Promise<{ bytes: Buffer; filename: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)
  timeout.unref()
  try {
    let url = parseRemoteUrl(value)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await requestImage(url, controller.signal)
      try {
        const { headers, statusCode: status = 0 } = response
        if ([301, 302, 303, 307, 308].includes(status)) {
          if (!headers.location) throw new Error('图片 URL 重定向缺少目标地址')
          if (redirects === MAX_REDIRECTS) throw new Error('图片 URL 重定向次数过多')
          url = parseRemoteUrl(new URL(headers.location, url).href)
          continue
        }
        if (status < 200 || status >= 300) throw new Error(`图片下载失败，HTTP 状态码 ${status}`)
        if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') throw new Error('图片服务器返回了不支持的传输压缩格式')
        if (Number(headers['content-length']) > MAX_IMAGE_BYTES) throw new Error('图片超过 25 MiB 大小限制')
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of response) {
          size += chunk.length
          if (size > MAX_IMAGE_BYTES) throw new Error('图片超过 25 MiB 大小限制')
          chunks.push(chunk)
        }
        let filename = basename(url.pathname)
        try { filename = decodeURIComponent(filename) } catch { /* 非法转义保留原名称。 */ }
        return { bytes: Buffer.concat(chunks, size), filename }
      } finally {
        response.destroy()
      }
    }
    throw new Error('图片下载失败')
  } catch (error) {
    if (controller.signal.aborted) throw new Error('图片下载超时')
    if (error instanceof Error && error.message.startsWith('图片')) throw error
    throw new Error('图片下载失败，请检查公开 URL 是否可以访问')
  } finally {
    clearTimeout(timeout)
  }
}

function validateSvg(source: Buffer) {
  const text = source.toString('utf8')
  // 图像解码不需要外部文档、样式或资源，导入时禁止这些引用。
  if (/<!DOCTYPE|<!ENTITY|<script\b|@import/i.test(text)) throw new Error('SVG 图片不能包含脚本或外部文档')
  const references = [...text.matchAll(/(?:href|src)\s*=\s*(["'])(.*?)\1/gis)].map((m) => m[2])
  const styles = [...text.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)].map((m) => m[1])
  if ([...references, ...styles].some((reference) => !reference.startsWith('#') && !reference.startsWith('data:'))) {
    throw new Error('SVG 图片不能引用外部资源')
  }
}

function validateContainer(source: Buffer, format: string) {
  if (format === 'png') {
    let position = 8
    while (position + 12 <= source.length) {
      const length = source.readUInt32BE(position)
      const type = source.toString('ascii', position + 4, position + 8)
      if (length > source.length - position - 12) throw new Error('图片 PNG 数据不完整')
      position += length + 12
      if (type === 'IEND') {
        if (length !== 0 || position !== source.length) throw new Error('图片 PNG 结束标记无效')
        return
      }
    }
    throw new Error('图片 PNG 数据不完整')
  }
  if (format === 'jpeg' && (source.at(-2) !== 0xff || source.at(-1) !== 0xd9)) throw new Error('图片 JPEG 数据不完整')
  if (format === 'gif' && source.at(-1) !== 0x3b) throw new Error('图片 GIF 数据不完整')
  if (format === 'webp' && (source.length < 12 || source.readUInt32LE(4) + 8 !== source.length)) throw new Error('图片 WebP 数据不完整')
}

async function inspectImage(source: Buffer) {
  // 素材入库不套用发布平台的尺寸限制，保留解码器默认的资源保护。
  const options = { animated: true, failOn: 'warning' as const }
  try {
    // SVG 在任何解码前检查；不接受可隐藏外部引用的压缩或 UTF-16 XML。
    if ((source[0] === 0x1f && source[1] === 0x8b) || (source[0] === 0xff && source[1] === 0xfe) || (source[0] === 0xfe && source[1] === 0xff)
      || (source[0] === 0 && source[1] === 0x3c) || (source[0] === 0x3c && source[1] === 0)) {
      throw new Error('图片格式不支持，请使用未压缩的 UTF-8 SVG 或常见图片格式')
    }
    const looksLikeSvg = /^\s*</.test(source.subarray(0, 1024).toString('utf8'))
    if (looksLikeSvg) validateSvg(source)
    const metadata = await sharp(source, options).metadata()
    const width = metadata.width ?? 0
    const height = metadata.pageHeight ?? metadata.height ?? 0
    const pages = metadata.pages ?? 1
    if (!width || !height) throw new Error('无法识别图片尺寸')
    if (pages > MAX_IMAGE_FRAMES) throw new Error('图片动画超过解码保护上限（300 帧）')
    const format = metadata.format
    if (!format || !(format in MIME_TYPES)) throw new Error('图片格式不支持，请使用 JPEG、PNG、GIF、WebP、TIFF、AVIF 或 SVG')
    if (format === 'svg' && !looksLikeSvg) validateSvg(source)
    validateContainer(source, format)
    // metadata 只读取文件头；实际解码才能拒绝截断或伪装成图片的文件。
    // 只生成极小的校验结果，避免为长图保留完整的像素统计缓冲；保存的仍是原始字节。
    await sharp(source, options).resize(1, 1, { fit: 'inside' }).raw().toBuffer()
    const originalMimeType = format === 'heif' && metadata.compression === 'av1' ? MIME_TYPES.avif : MIME_TYPES[format as keyof typeof MIME_TYPES]
    const preserve = Object.hasOwn(OUTPUT_EXTENSIONS, originalMimeType)
    if (!preserve && pages > 1) throw new Error('图片包含多页或动画，暂不能转换为单张 PNG，请先导出需要的图片')
    const { data: output, info } = preserve ? { data: source, info: { width, height } }
      : await sharp(source, { ...options, animated: false }).rotate().png().toBuffer({ resolveWithObject: true })
    checkByteSize(output.length)
    const mimeType = preserve ? originalMimeType : MIME_TYPES.png
    return {
      output,
      mimeType,
      originalMimeType,
      width: info.width,
      height: info.height,
      originalExtension: originalMimeType === MIME_TYPES.avif ? 'avif' : format === 'jpeg' ? 'jpg' : format,
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Input image exceeds pixel limit')) throw new Error('图片超出解码器的像素资源保护上限，无法导入；这不是发布平台的尺寸限制')
    if (error instanceof Error && /^(图片|SVG|无法识别)/.test(error.message)) throw error
    throw new Error('图片内容无效、已损坏或格式不支持，请使用 JPEG、PNG、GIF、WebP、TIFF、AVIF 或 SVG')
  }
}

function materialName(filename: string | undefined, id: string, extension: string): string {
  const leaf = (filename ?? '').replaceAll('\\', '/').split('/').at(-1)!.replace(/[\x00-\x1f\x7f]/g, '').trim()
  const stem = leaf.replace(/\.[^.]*$/, '').slice(0, 160).trim() || `图片-${id.slice(0, 12)}`
  return `${stem}.${extension}`
}

async function atomicWrite(file: string, content: Buffer | string) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch((error: unknown) => { if (!isMissing(error)) throw error })
  }
}

/** 素材持有自己的不可变副本，原始上传来源不会成为发布时的文件依赖。 */
export class MaterialLibrary {
  private readonly root: string
  private readonly importing = new Map<string, Promise<Material>>()

  constructor(root: string) {
    this.root = resolvePath(root)
  }

  async importBytes(bytes: Buffer, filename?: string): Promise<Material> {
    if (!Buffer.isBuffer(bytes)) throw new Error('上传图片必须提供文件字节')
    if (filename !== undefined && typeof filename !== 'string') throw new Error('图片文件名无效')
    checkByteSize(bytes.length)
    const id = createHash('sha256').update(bytes).digest('hex')
    const existing = this.importing.get(id)
    if (existing) return existing
    const pending = this.save(Buffer.from(bytes), id, filename).finally(() => this.importing.delete(id))
    this.importing.set(id, pending)
    return pending
  }

  async importSource(input: MaterialSourceInput): Promise<Material> {
    if (!input || typeof input !== 'object') throw new Error('请选择一种图片来源')
    const fields = ['url', 'base64', 'dataUrl'] as const
    const selected = fields.filter((field) => input[field] !== undefined)
    if (selected.length !== 1) throw new Error('URL、Base64 和 Data URL 必须且只能提供一种')
    if (input.filename !== undefined && typeof input.filename !== 'string') throw new Error('图片文件名无效')
    const value = input[selected[0]]
    if (typeof value !== 'string' || !value) throw new Error('图片来源不能为空')
    if (selected[0] === 'url') {
      const result = await downloadImage(value)
      return this.importBytes(result.bytes, input.filename ?? result.filename)
    }
    if (selected[0] === 'base64') return this.importBytes(decodeBase64(value), input.filename)
    // 声明的 MIME 类型不作为图片依据，importBytes 会解码真实内容。
    return this.importBytes(decodeDataUrl(value), input.filename)
  }

  async list(): Promise<Material[]> {
    let names: string[]
    try { names = await readdir(this.root) } catch (error) { if (isMissing(error)) return []; throw error }
    const ids = names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => name.slice(0, -5))
    const materials = await Promise.all(ids.map((id) => this.get(id)))
    return materials.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  }

  async get(id: string): Promise<Material> {
    const record = await this.readRecord(id)
    if (!record) throw new Error('素材不存在')
    return { ...record.material }
  }

  async resolve(id: string): Promise<ImageAsset> {
    const record = await this.readRecord(id)
    if (!record) throw new Error('素材不存在')
    const { bytes, width, height } = record.material
    return { path: join(this.root, record.publishFile), bytes, width, height }
  }

  private async save(source: Buffer, id: string, filename?: string): Promise<Material> {
    let existing: StoredMaterial | undefined
    try {
      existing = await this.readRecord(id)
    } catch (error) {
      if (!(error instanceof MaterialRecordError)) throw error
      // 重新导入相同字节可修复该内容 ID，仍须重新解码验证后才能覆盖记录。
    }
    if (existing) return { ...existing.material }
    const image = await inspectImage(source)
    const extension = OUTPUT_EXTENSIONS[image.mimeType]
    const material: Material = {
      id,
      name: materialName(filename, id, extension),
      mimeType: image.mimeType,
      bytes: image.output.length,
      width: image.width,
      height: image.height,
      createdAt: Date.now(),
      ...(image.originalMimeType !== image.mimeType ? { originalMimeType: image.originalMimeType } : {}),
    }
    const record: StoredMaterial = {
      version: 1,
      material,
      originalFile: `${id}.original.${image.originalExtension}`,
      publishFile: `${id}.${extension}`,
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await atomicWrite(join(this.root, record.originalFile), source)
    await atomicWrite(join(this.root, record.publishFile), image.output)
    // 元数据最后提交，列表只会看见已完整保存的素材。
    await atomicWrite(join(this.root, `${id}.json`), JSON.stringify(record))
    return { ...material }
  }

  private async readRecord(id: string): Promise<StoredMaterial | undefined> {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('素材 ID 无效')
    let text: string
    try { text = await readFile(join(this.root, `${id}.json`), 'utf8') } catch (error) { if (isMissing(error)) return; throw error }
    let record: StoredMaterial
    try { record = JSON.parse(text) as StoredMaterial } catch { throw new MaterialRecordError('素材记录已损坏，请重新导入') }
    const material = record?.material
    if (record?.version !== 1 || !material || material.id !== id
      || typeof material.name !== 'string' || !OUTPUT_EXTENSIONS[material.mimeType]
      || !Number.isSafeInteger(material.bytes) || material.bytes <= 0 || material.bytes > MAX_IMAGE_BYTES
      || !Number.isSafeInteger(material.width) || material.width <= 0
      || !Number.isSafeInteger(material.height) || material.height <= 0
      || typeof material.createdAt !== 'number' || !Number.isFinite(material.createdAt)
      || record.publishFile !== `${id}.${OUTPUT_EXTENSIONS[material.mimeType]}`
      || typeof record.originalFile !== 'string'
      || !new RegExp(`^${id}\\.original\\.(jpg|png|gif|webp|tiff|heif|avif|svg)$`).test(record.originalFile)) {
      throw new MaterialRecordError('素材记录已损坏，请重新导入')
    }
    try {
      const saved = await stat(join(this.root, record.publishFile))
      const original = await stat(join(this.root, record.originalFile))
      if (!saved.isFile() || saved.size !== material.bytes || !original.isFile() || original.size <= 0 || original.size > MAX_IMAGE_BYTES) {
        throw new MaterialRecordError('素材图片已损坏，请重新导入')
      }
    } catch (error) {
      if (isMissing(error)) throw new MaterialRecordError('素材图片不存在，请重新导入')
      throw error
    }
    // 只返回约定字段，磁盘元数据中的额外字段不会泄露到对外接口。
    record.material = {
      id: material.id, name: material.name, mimeType: material.mimeType, bytes: material.bytes,
      width: material.width, height: material.height, createdAt: material.createdAt,
      ...(typeof material.originalMimeType === 'string' ? { originalMimeType: material.originalMimeType } : {}),
    }
    return record
  }
}
