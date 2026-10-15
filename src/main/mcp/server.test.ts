import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { MAX_UPLOAD_BYTES, startMcpServer, type LocalMcpService } from './server'

const run = promisify(execFile)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'maxiaoer-mcp-test-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const connectionPath = join(directory, 'mcp.json')
  const importImage = vi.fn(async (bytes: Buffer, filename?: string) => ({ id: 'material-test', filename, size: bytes.length }))
  const service = await startMcpServer({
    connectionPath,
    importImage,
    createServer: () => {
      const server = new McpServer({ name: 'isolated-test', version: '1.0.0' })
      server.registerTool('echo', {
        inputSchema: { value: z.string() },
        annotations: { readOnlyHint: true, destructiveHint: false },
      }, async ({ value }) => ({ content: [{ type: 'text', text: value }] }))
      return server
    },
  })
  cleanup.push(() => service.close())
  const connection = JSON.parse(await readFile(connectionPath, 'utf8')) as { token: string; uploadUrl: string }
  return { ...connection, directory, connectionPath, service, importImage }
}

async function connect(service: LocalMcpService, token: string) {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  cleanup.push(() => client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(service.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }))
  return client
}

describe('本地 MCP 传输', () => {
  it('只绑定本机并私密保存连接信息，拒绝无认证、外部 Host 和 Origin', async () => {
    const { service, connectionPath, token, importImage } = await setup()
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect((await stat(connectionPath)).mode & 0o777).toBe(0o600)
    const unauthorizedHeaders: Record<string, string>[] = [{}, { Authorization: 'Bearer incorrect' }]
    for (const headers of unauthorizedHeaders) {
      const response = await fetch(service.url, { method: 'POST', headers })
      expect(response.status).toBe(401)
      expect(await response.text()).not.toContain(token)
    }
    const externalOrigin = await fetch(service.url, { method: 'POST', headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` } })
    expect(externalOrigin.status).toBe(403)
    const nullOrigin = await fetch(service.url, { method: 'POST', headers: { Origin: 'null', Authorization: `Bearer ${token}` } })
    expect(nullOrigin.status).toBe(403)
    const externalHost = await new Promise<number>((resolve, reject) => {
      const req = request(service.url, { method: 'POST', headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, (response) => {
        response.resume()
        resolve(response.statusCode!)
      })
      req.on('error', reject)
      req.end()
    })
    expect(externalHost).toBe(403)
    expect(importImage).not.toHaveBeenCalled()
  })

  it('两个客户端能独立初始化、列举和调用工具，保留 annotations', async () => {
    const { service, token } = await setup()
    const [first, second] = await Promise.all([connect(service, token), connect(service, token)])
    const listed = await first.listTools()
    expect(listed.tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    const results = await Promise.all([
      first.callTool({ name: 'echo', arguments: { value: 'one' } }),
      second.callTool({ name: 'echo', arguments: { value: 'two' } }),
    ])
    expect(results.map((result) => result.content)).toEqual([
      [{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }],
    ])
  })

  it('上传真实二进制到素材接口并去掉文件名中的路径', async () => {
    const { token, uploadUrl, importImage } = await setup()
    const bytes = Buffer.from([0, 1, 2, 255])
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('/private/path/图片.png') },
      body: bytes,
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ id: 'material-test', filename: '图片.png', size: 4 })
    expect(importImage).toHaveBeenCalledWith(bytes, '图片.png')
  })

  it('拒绝超限上传和错误类型，不调用素材导入器', async () => {
    const { token, uploadUrl, importImage } = await setup()
    const tooLarge = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png', 'Content-Length': String(MAX_UPLOAD_BYTES + 1) },
      }, (response) => {
        let body = ''
        response.on('data', (data) => { body += data.toString() })
        response.on('end', () => { req.destroy(); resolve({ status: response.statusCode!, body }) })
      })
      req.on('error', reject)
      req.flushHeaders()
    })
    expect(tooLarge.status).toBe(413)
    expect(tooLarge.body).not.toContain(token)
    const wrongType = await fetch(uploadUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: 'not an image' })
    expect(wrongType.status).toBe(415)
    expect(importImage).not.toHaveBeenCalled()
  })

  it('没有 Content-Length 的分块上传也受字节上限约束', async () => {
    const { token, uploadUrl, importImage } = await setup()
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' },
      }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode!))
      })
      req.on('error', reject)
      req.end(Buffer.alloc(MAX_UPLOAD_BYTES + 1))
    })
    expect(status).toBe(413)
    expect(importImage).not.toHaveBeenCalled()
  })

  it('关闭时不删除另一个应用实例写入的连接信息', async () => {
    const { service, connectionPath } = await setup()
    const replacement = { token: 'new-process-token', pid: process.pid + 1 }
    await writeFile(connectionPath, JSON.stringify(replacement))
    await service.close()
    expect(JSON.parse(await readFile(connectionPath, 'utf8'))).toEqual(replacement)
  })

  it('相同连接文件已有活跃实例时拒绝第二个服务，原凭据保持有效', async () => {
    const { service, token, connectionPath } = await setup()
    await expect(startMcpServer({
      connectionPath,
      createServer: () => new McpServer({ name: 'second', version: '1.0.0' }),
      importImage: async () => ({}),
    })).rejects.toThrow('无法保存蚂小儿连接信息')
    expect(JSON.parse(await readFile(connectionPath, 'utf8')).token).toBe(token)
    expect((await (await connect(service, token)).listTools()).tools[0].name).toBe('echo')
  })

  it('客户端拒绝把连接凭据发送到其他上传地址', async () => {
    const { connectionPath } = await setup()
    const connection = JSON.parse(await readFile(connectionPath, 'utf8'))
    await writeFile(connectionPath, JSON.stringify({ ...connection, uploadUrl: 'https://evil.example/upload' }))
    await expect(run(process.execPath, ['scripts/maxiaoer-client.mjs', '--connection', connectionPath, 'info']))
      .rejects.toMatchObject({ stderr: expect.stringContaining('连接信息无效') })
  })

  it('仓库入口与独立复制的技能都支持无密钥输出的 info 和二进制上传', async () => {
    const { connectionPath, directory, token, importImage } = await setup()
    const copiedSkill = join(directory, 'standalone-skill')
    await cp('skills/maxiaoer-publish', copiedSkill, { recursive: true })
    const imageFile = join(directory, 'source.png')
    const bytes = Buffer.from([137, 80, 78, 71])
    await writeFile(imageFile, bytes)
    for (const script of [join(process.cwd(), 'scripts/maxiaoer-client.mjs'), join(copiedSkill, 'scripts/maxiaoer-client.mjs')]) {
      const info = await run(process.execPath, [script, '--connection', connectionPath, 'info'], { cwd: directory })
      expect(info.stdout).not.toContain(token)
      expect(JSON.parse(info.stdout)).not.toHaveProperty('token')
      const imported = await run(process.execPath, [script, '--connection', connectionPath, 'import', imageFile], { cwd: directory })
      expect(JSON.parse(imported.stdout)).toMatchObject({ id: 'material-test' })
    }
    expect(importImage).toHaveBeenCalledTimes(2)
    expect(importImage).toHaveBeenCalledWith(bytes, 'source.png')
  })

  it('仓库模块复用技能实现，作为库导入时不会运行命令行', async () => {
    const result = await run(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import * as repository from './scripts/maxiaoer-client.mjs'
      import * as skill from './skills/maxiaoer-publish/scripts/maxiaoer-client.mjs'
      import * as connection from './scripts/mcp-connection.mjs'
      import * as skillConnection from './skills/maxiaoer-publish/scripts/mcp-connection.mjs'
      assert.equal(repository.importFile, skill.importFile)
      assert.equal(repository.loadConnection, skill.loadConnection)
      assert.equal(connection.loadConnection, skillConnection.loadConnection)
      assert.equal(connection.parseConnectionArgument, skillConnection.parseConnectionArgument)
    `])
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('stdio 桥通过现有桌面服务列举和调用工具', async () => {
    const { connectionPath } = await setup()
    const client = new Client({ name: 'stdio-test-client', version: '1.0.0' })
    cleanup.push(() => client.close())
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['scripts/mcp-stdio.mjs', '--connection', connectionPath], stderr: 'pipe' }))
    expect((await client.listTools()).tools[0].annotations?.readOnlyHint).toBe(true)
    expect((await client.callTool({ name: 'echo', arguments: { value: 'bridged' } })).content).toEqual([{ type: 'text', text: 'bridged' }])
  })
})
