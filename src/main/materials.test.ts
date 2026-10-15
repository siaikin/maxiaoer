import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type { RequestOptions } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MaterialLibrary, MAX_IMAGE_BYTES } from './materials'

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }))
vi.mock('node:http', () => ({ request: network.request }))
vi.mock('node:https', () => ({ request: network.request }))

interface ResponseFixture {
  status?: number
  headers?: Record<string, string>
  chunks?: Buffer[]
  error?: Error
  stall?: boolean
}

let png: Buffer
const roots: string[] = []
let replies: ResponseFixture[]

async function library() {
  const root = await mkdtemp(join(tmpdir(), 'maxiaoer-materials-'))
  roots.push(root)
  return { root, materials: new MaterialLibrary(root) }
}

beforeAll(async () => {
  png = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#cc8844' } }).png().toBuffer()
})

beforeEach(() => {
  replies = []
  network.lookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  network.request.mockReset().mockImplementation((_url: URL, options: RequestOptions, respond: (response: PassThrough) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void }
    request.end = () => {
      const fixture = replies.shift() ?? { chunks: [png] }
      const response = Object.assign(new PassThrough(), { statusCode: fixture.status ?? 200, headers: fixture.headers ?? {} })
      const aborted = () => response.destroy(new Error('请求已中止'))
      options.signal?.addEventListener('abort', aborted, { once: true })
      response.once('close', () => options.signal?.removeEventListener('abort', aborted))
      queueMicrotask(() => {
        respond(response)
        if (response.destroyed) return
        for (const chunk of fixture.chunks ?? []) response.write(chunk)
        if (fixture.error) queueMicrotask(() => response.destroy(fixture.error))
        else if (!fixture.stall) response.end()
      })
    }
    return request
  })
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('MaterialLibrary', () => {
  it('保存独立副本并在重启后恢复，返回值不包含本地路径', async () => {
    const { root, materials } = await library()
    const upload = Buffer.from(png)
    const material = await materials.importBytes(upload, '../假扩展名.jpg')
    upload.fill(0)
    expect(material).toMatchObject({ name: '假扩展名.png', mimeType: 'image/png', bytes: png.length, width: 2, height: 3 })
    expect(material).not.toHaveProperty('path')
    const reopened = new MaterialLibrary(root)
    expect(await reopened.list()).toEqual([material])
    expect(await reopened.get(material.id)).toEqual(material)
    const image = await reopened.resolve(material.id)
    expect(await readFile(image.path)).toEqual(png)
    expect(await readFile(join(root, `${material.id}.original.png`))).toEqual(png)
    expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('同样的字节并发导入以及重启后导入均去重', async () => {
    const { root, materials } = await library()
    const [first, second] = await Promise.all([materials.importBytes(png, '第一份.png'), materials.importBytes(png, '第二份.png')])
    expect(second).toEqual(first)
    expect(await new MaterialLibrary(root).importSource({ base64: png.toString('base64') })).toEqual(first)
    expect(await materials.list()).toHaveLength(1)
  })

  it('Base64 和 Data URL 均按真实图片内容识别格式', async () => {
    const { materials } = await library()
    const first = await materials.importSource({ dataUrl: `data:image/jpeg;base64,${png.toString('base64')}`, filename: '封面.jpeg' })
    const second = await materials.importSource({ base64: png.toString('base64') })
    expect(first.mimeType).toBe('image/png')
    expect(second.id).toBe(first.id)
  })

  it.each(['a', 'AAAA\n', '!!!!', 'AA=A', 'AB==', 'SGVsbG8_', ''])('拒绝损坏或非规范 Base64：%j', async (base64) => {
    const { materials } = await library()
    await expect(materials.importSource({ base64 })).rejects.toThrow(/Base64|来源/)
  })

  it('不接受多个来源、普通路径或非图片 Data URL', async () => {
    const { materials } = await library()
    await expect(materials.importSource({ url: 'https://example.com/a.png', base64: 'AAAA' })).rejects.toThrow('只能提供一种')
    await expect(materials.importSource({ url: '/tmp/a.png' })).rejects.toThrow('URL 无效')
    await expect(materials.importSource({ dataUrl: `data:text/plain;base64,${png.toString('base64')}` })).rejects.toThrow('Data URL')
    await expect(materials.importSource({ dataUrl: 'data:image/png,anything' })).rejects.toThrow('图片')
  })

  it('支持百分号编码的 SVG Data URL，并保留中文、加号及原始图片字节', async () => {
    const { root, materials } = await library()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><title>中文+a</title><rect width="2" height="3" fill="red"/></svg>'
    const material = await materials.importSource({ dataUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` })
    expect(material).toMatchObject({ mimeType: 'image/png', originalMimeType: 'image/svg+xml', width: 2, height: 3 })
    expect(await readFile(join(root, `${material.id}.original.svg`), 'utf8')).toBe(svg)
    expect(await materials.importSource({ dataUrl: `data:image/svg+xml,${svg}` })).toEqual(material)
  })

  it('百分号 Data URL 按字节解码二进制图片，带 charset 的 Base64 仍可导入', async () => {
    const { materials } = await library()
    const encoded = Array.from(png, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')
    const material = await materials.importSource({ dataUrl: `data:image/png,${encoded}` })
    expect(material).toMatchObject({ mimeType: 'image/png', width: 2, height: 3 })
    expect(await materials.importSource({ dataUrl: `data:image/png;charset=UTF-8;base64,${png.toString('base64')}` })).toEqual(material)
  })

  it.each(['data:image/svg+xml,%GG', 'data:image/svg+xml,%3', 'data:image/svg+xml;bogus,abc', 'data:text/html,%3Csvg%2F%3E'])('拒绝无效的 Data URL：%s', async (dataUrl) => {
    const { materials } = await library()
    await expect(materials.importSource({ dataUrl })).rejects.toThrow('Data URL')
  })

  it('拒绝伪装图片、截断图片和超大输入，不产生可列出的素材', async () => {
    const { materials } = await library()
    await expect(materials.importBytes(Buffer.from('<html>不是图片</html>'), 'cover.png')).rejects.toThrow('图片')
    await expect(materials.importBytes(png.subarray(0, png.length - 12), 'cover.png')).rejects.toThrow('图片')
    await expect(materials.importBytes(Buffer.alloc(MAX_IMAGE_BYTES + 1))).rejects.toThrow('25 MiB')
    expect(await materials.list()).toEqual([])
  })

  it('SVG 转为 PNG，同时保存原图', async () => {
    const { root, materials } = await library()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>')
    const material = await materials.importBytes(svg, '图.svg')
    expect(material).toMatchObject({ name: '图.png', mimeType: 'image/png', originalMimeType: 'image/svg+xml', width: 12, height: 8 })
    const image = await materials.resolve(material.id)
    expect((await sharp(image.path).metadata()).format).toBe('png')
    expect(await readFile(join(root, `${material.id}.original.svg`))).toEqual(svg)
  })

  it('TIFF 转为 PNG', async () => {
    const { materials } = await library()
    const tiff = await sharp(png).tiff().toBuffer()
    expect(await materials.importBytes(tiff, '测试.tiff')).toMatchObject({ mimeType: 'image/png', originalMimeType: 'image/tiff', width: 2, height: 3 })
  })

  it('转换后的尺寸遵循原图旋转方向', async () => {
    const { materials } = await library()
    const tiff = await sharp(png).withMetadata({ orientation: 6 }).tiff().toBuffer()
    const material = await materials.importBytes(tiff)
    expect(material).toMatchObject({ width: 3, height: 2 })
    expect(await sharp((await materials.resolve(material.id)).path).metadata()).toMatchObject({ width: 3, height: 2 })
  })

  it('AVIF 转为 PNG', async () => {
    const { materials } = await library()
    const avif = await sharp(png).avif().toBuffer()
    expect(await materials.importBytes(avif, '测试.avif')).toMatchObject({ mimeType: 'image/png', originalMimeType: 'image/avif', width: 2, height: 3 })
  })

  it.each(['jpeg', 'gif', 'webp'] as const)('保留 %s 的原始图片字节', async (format) => {
    const { materials } = await library()
    const bytes = await sharp(png).toFormat(format).toBuffer()
    const material = await materials.importBytes(bytes)
    expect(material.mimeType).toBe(`image/${format}`)
    expect(await readFile((await materials.resolve(material.id)).path)).toEqual(bytes)
  })

  it('长图超过 16384 边长和 4000 万像素仍保存原图，重启后可读取', async () => {
    const { root, materials } = await library()
    const bytes = await sharp({ create: { width: 1968, height: 25828, channels: 3, background: '#cc8844' } }).jpeg().toBuffer()
    const material = await materials.importBytes(bytes, '长图.jpeg')
    expect(material).toMatchObject({ mimeType: 'image/jpeg', width: 1968, height: 25828, bytes: bytes.length })
    const reopened = new MaterialLibrary(root)
    expect(await reopened.list()).toEqual([material])
    expect(await readFile((await reopened.resolve(material.id)).path)).toEqual(bytes)
    expect(await readFile(join(root, `${material.id}.original.jpg`))).toEqual(bytes)
  })

  it('保留解码器资源保护，错误不再误报格式不支持', async () => {
    const { root, materials } = await library()
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="17000" height="17000"/>')
    await expect(materials.importBytes(bytes)).rejects.toThrow('解码器的像素资源保护上限')
    expect(await readdir(root)).toEqual([])
  })

  it('拒绝含外部资源的 SVG', async () => {
    const { materials } = await library()
    await expect(materials.importBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="file:///etc/passwd"/></svg>'))).rejects.toThrow('外部资源')
  })

  it('无效素材 ID 不会成为文件路径，损坏的副本不能继续发布', async () => {
    const { materials } = await library()
    await expect(materials.resolve('../outside')).rejects.toThrow('ID 无效')
    const material = await materials.importBytes(png)
    const image = await materials.resolve(material.id)
    await writeFile(image.path, 'changed')
    await expect(materials.resolve(material.id)).rejects.toThrow('已损坏')
  })

  it.each(['metadata', 'missing-publish', 'damaged-publish', 'missing-original'])('重新上传相同内容可修复损坏的素材：%s', async (damage) => {
    const { root, materials } = await library()
    const material = await materials.importBytes(png)
    const image = await materials.resolve(material.id)
    if (damage === 'metadata') await writeFile(join(root, `${material.id}.json`), '{broken')
    if (damage === 'missing-publish') await rm(image.path)
    if (damage === 'damaged-publish') await writeFile(image.path, 'damaged')
    if (damage === 'missing-original') await rm(join(root, `${material.id}.original.png`))
    await expect(materials.get(material.id)).rejects.toThrow('重新导入')
    const repaired = await new MaterialLibrary(root).importBytes(png)
    expect(repaired.id).toBe(material.id)
    expect(await readFile((await materials.resolve(material.id)).path)).toEqual(png)
    expect(await materials.list()).toEqual([repaired])
  })
})

describe('图片 URL 下载', () => {
  it('校验并固定公开 DNS 地址，忽略不可信的扩展名和 MIME 头', async () => {
    const { materials } = await library()
    replies.push({ headers: { 'content-type': 'application/octet-stream' }, chunks: [png] })
    const material = await materials.importSource({ url: 'https://images.example.test/cover.jpg' })
    expect(material).toMatchObject({ name: 'cover.png', mimeType: 'image/png' })
    const options = network.request.mock.calls[0][1] as RequestOptions
    const callback = vi.fn()
    options.lookup!('images.example.test', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(options.agent).toBe(false)
  })

  it.each([
    'file:///etc/passwd', 'ftp://example.com/image.png', 'http://localhost/image', 'http://localhost./image',
    'http://127.0.0.1/image', 'http://2130706433/image', 'http://10.0.0.1/image', 'http://169.254.169.254/image',
    'http://[::1]/image', 'http://[::ffff:127.0.0.1]/image', 'http://[fc00::1]/image', 'http://[fe80::1]/image',
    'http://[2002:7f00:1::]/image', 'https://user:pass@example.com/image', 'https://example.com:3000/image',
  ])('下载前拒绝不允许的地址：%s', async (url) => {
    const { materials } = await library()
    await expect(materials.importSource({ url })).rejects.toThrow('图片 URL')
    expect(network.request).not.toHaveBeenCalled()
  })

  it('域名解析到内网或混合公私网地址时拒绝下载', async () => {
    const { materials } = await library()
    network.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.1', family: 4 }])
    await expect(materials.importSource({ url: 'https://images.example.test/image' })).rejects.toThrow('内网')
    expect(network.request).not.toHaveBeenCalled()
  })

  it('每一次重定向都重新校验目标地址', async () => {
    const { materials } = await library()
    replies.push({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
    await expect(materials.importSource({ url: 'https://images.example.test/image' })).rejects.toThrow('内网')
    expect(network.request).toHaveBeenCalledTimes(1)
  })

  it('限制重定向次数', async () => {
    const { materials } = await library()
    replies = Array.from({ length: 5 }, () => ({ status: 302, headers: { location: '/again' } }))
    await expect(materials.importSource({ url: 'https://images.example.test/image' })).rejects.toThrow('重定向次数过多')
    expect(network.request).toHaveBeenCalledTimes(5)
  })

  it('公开重定向重新解析 DNS，并采用最终图片文件名', async () => {
    const { materials } = await library()
    replies.push({ status: 302, headers: { location: 'https://cdn.example.test/final.png' } }, { chunks: [png] })
    expect(await materials.importSource({ url: 'https://images.example.test/image' })).toMatchObject({ name: 'final.png', mimeType: 'image/png' })
    expect(network.lookup).toHaveBeenCalledTimes(2)
    expect(network.lookup.mock.calls.map(([hostname]) => hostname)).toEqual(['images.example.test', 'cdn.example.test'])
  })

  it.each([
    [{ status: 503 }, 'HTTP 状态码 503'],
    [{ status: 302 }, '重定向缺少目标地址'],
    [{ headers: { 'content-encoding': 'gzip' } }, '传输压缩格式'],
    [{ headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } }, '25 MiB'],
  ] satisfies Array<[ResponseFixture, string]>)('收到不允许的响应时停止下载：%j', async (response, message) => {
    const { materials } = await library()
    replies.push(response)
    await expect(materials.importSource({ url: 'https://images.example.test/image' })).rejects.toThrow(message)
    expect(await materials.list()).toEqual([])
  })

  it('响应中断不会把不完整字节保存为素材', async () => {
    const { materials } = await library()
    replies.push({ chunks: [png.subarray(0, 20)], error: new Error('连接中断') })
    await expect(materials.importSource({ url: 'https://images.example.test/image' })).rejects.toThrow('图片下载失败')
    expect(await materials.list()).toEqual([])
  })

  it('限制实际流量，不能靠省略 Content-Length 绕过', async () => {
    const { materials } = await library()
    replies.push({ chunks: [Buffer.alloc(13 * 1024 * 1024), Buffer.alloc(13 * 1024 * 1024)] })
    await expect(materials.importSource({ url: 'https://images.example.test/image' })).rejects.toThrow('25 MiB')
  })

  it('DNS 查询也受总下载超时限制', async () => {
    const { materials } = await library()
    vi.useFakeTimers()
    network.lookup.mockReturnValue(new Promise(() => undefined))
    const assertion = expect(materials.importSource({ url: 'https://images.example.test/image' })).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15_001)
    await assertion
  })

  it('收到响应头后未完成的图片仍受总下载超时限制', async () => {
    const { materials } = await library()
    vi.useFakeTimers()
    replies.push({ chunks: [png.subarray(0, 20)], stall: true })
    const assertion = expect(materials.importSource({ url: 'https://images.example.test/image' })).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15_001)
    await assertion
    expect(await materials.list()).toEqual([])
  })
})
