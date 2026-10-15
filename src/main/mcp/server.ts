import { randomBytes, timingSafeEqual } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { MAX_IMAGE_BYTES } from '../../shared/materials'

export const MAX_UPLOAD_BYTES = MAX_IMAGE_BYTES
export const MAX_MCP_BODY_BYTES = 36 * 1024 * 1024

export interface LocalMcpOptions {
  createServer: () => McpServer
  importImage: (bytes: Buffer, filename?: string) => Promise<unknown>
  connectionPath: string
  port?: number
}

export interface LocalMcpService {
  close(): Promise<void>
  url: string
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function respond(response: ServerResponse, status: number, message: string) {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify({ error: message }))
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const length = request.headers['content-length']
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    request.resume()
    return Promise.reject(new HttpError(413, '请求内容超过大小限制'))
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let failed = false
    request.on('data', (chunk: Buffer) => {
      if (failed) return
      size += chunk.length
      if (size > limit) {
        failed = true
        chunks.length = 0
        reject(new HttpError(413, '请求内容超过大小限制'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks))
    })
    request.on('aborted', () => reject(new HttpError(400, '请求已中断')))
    request.on('error', () => reject(new HttpError(400, '无法读取请求内容')))
  })
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const received = Buffer.from(request.headers.authorization ?? '')
  const expected = Buffer.from(`Bearer ${token}`)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

async function publishConnection(temporaryPath: string, connectionPath: string) {
  try {
    // 将完整的私密文件以硬链接原子写入，避免覆盖其他正在运行实例的连接。
    await link(temporaryPath, connectionPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    let existing: { pid?: number }
    try {
      existing = JSON.parse(await readFile(connectionPath, 'utf8')) as { pid?: number }
    } catch {
      throw new Error('蚂小儿连接信息已存在，请关闭其他应用实例后重试')
    }
    if (!Number.isSafeInteger(existing.pid) || existing.pid! <= 0) throw new Error('蚂小儿连接信息已存在，请关闭其他应用实例后重试')
    try {
      process.kill(existing.pid!, 0)
      throw new Error('蚂小儿本地 MCP 服务已在运行')
    } catch (error) {
      // 仅在确认进程已退出时回收崩溃残留；EPERM 代表进程仍存在。
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    await unlink(connectionPath)
    await link(temporaryPath, connectionPath)
  }
}

/** 每个 HTTP 请求使用独立传输实例，隔离不同客户端的相同 JSON-RPC 请求编号。 */
export async function startMcpServer(options: LocalMcpOptions): Promise<LocalMcpService> {
  const token = randomBytes(32).toString('hex')
  const activeServers = new Set<McpServer>()
  let port = 0
  let closing = false
  const httpServer = createHttpServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      if (error instanceof HttpError) respond(response, error.status, error.message)
      else respond(response, 500, '蚂小儿无法处理此请求')
    })
  })
  httpServer.requestTimeout = 60_000
  httpServer.headersTimeout = 15_000
  httpServer.keepAliveTimeout = 5_000
  const closeHttpServer = () => {
    httpServer.closeAllConnections()
    return new Promise<void>((resolve) => httpServer.close(() => resolve()))
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
    if (!allowedHosts.has(request.headers.host ?? '')) throw new HttpError(403, '不允许访问此主机地址')
    // 浏览器请求只允许来自当前本地服务，不启用通配跨域访问。
    const origin = request.headers.origin
    if (origin && origin !== `http://${request.headers.host}`) throw new HttpError(403, '不允许此请求来源')
    if (!isAuthorized(request, token)) throw new HttpError(401, '需要有效的本地连接凭据')
    if (closing) throw new HttpError(503, '蚂小儿服务正在关闭')
    if (request.url !== '/mcp' && request.url !== '/materials/upload') throw new HttpError(404, '请求接口不存在')
    if (request.method !== 'POST') throw new HttpError(405, '不支持此请求方式')
    const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase() ?? ''

    if (request.url === '/materials/upload') {
      if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
        throw new HttpError(415, '请以二进制内容上传图片')
      }
      const rawName = request.headers['x-filename']
      let filename: string | undefined
      if (typeof rawName === 'string') {
        if (rawName.length > 2048) throw new HttpError(400, '图片文件名过长')
        try {
          filename = decodeURIComponent(rawName)
        } catch {
          throw new HttpError(400, '图片文件名无效')
        }
        if (/[\x00-\x1f\x7f]/.test(filename)) throw new HttpError(400, '图片文件名无效')
        // 文件名仅作显示信息，不得作为路径传给素材导入器。
        filename = filename.split(/[\\/]/).at(-1)
      }
      const bytes = await readBody(request, MAX_UPLOAD_BYTES)
      if (!bytes.length) throw new HttpError(400, '图片内容为空')
      let result: unknown
      try {
        result = await options.importImage(bytes, filename)
      } catch {
        throw new HttpError(422, '无法导入图片，请检查图片格式和大小')
      }
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result))
      return
    }

    if (contentType !== 'application/json') {
      throw new HttpError(415, 'MCP 请求必须使用 application/json 格式')
    }
    const bytes = await readBody(request, MAX_MCP_BODY_BYTES)
    let body: unknown
    try {
      body = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new HttpError(400, '请求的 JSON 内容无效')
    }
    const server = options.createServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    activeServers.add(server)
    const dispose = async () => {
      if (activeServers.delete(server)) await server.close().catch(() => {})
    }
    response.once('close', () => { void dispose() })
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response, body)
    } catch (error) {
      await dispose()
      throw error
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port ?? 0, '127.0.0.1', () => {
      httpServer.removeListener('error', reject)
      resolve()
    })
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('无法启动蚂小儿本地 MCP 服务')
  port = address.port
  const url = `http://127.0.0.1:${port}/mcp`
  const connection = { version: 1, url, token, pid: process.pid, uploadUrl: `http://127.0.0.1:${port}/materials/upload` }
  const temporaryPath = `${options.connectionPath}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await mkdir(dirname(options.connectionPath), { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await publishConnection(temporaryPath, options.connectionPath)
    await unlink(temporaryPath)
  } catch {
    await closeHttpServer()
    await unlink(temporaryPath).catch(() => {})
    throw new Error('无法保存蚂小儿连接信息；请确认没有其他应用实例正在运行')
  }

  let closePromise: Promise<void> | undefined
  return {
    url,
    close() {
      closePromise ??= (async () => {
        closing = true
        await Promise.allSettled([...activeServers].map((server) => server.close()))
        await closeHttpServer()
        // 其他实例可能已经替换连接文件，仅清除当前实例自己的信息。
        try {
          const current = JSON.parse(await readFile(options.connectionPath, 'utf8')) as { token?: string; pid?: number }
          if (current.token === token && current.pid === process.pid) await unlink(options.connectionPath)
        } catch { /* 连接文件已移除或替换时无需处理。 */ }
      })()
      return closePromise
    },
  }
}
