import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { Db } from '../db'
import { MaterialLibrary } from '../materials'
import { PublishingService } from './service'
import { createPublishingMcp } from './tools'

it('真实 MCP 工具从图片字节到准备稿件、幂等提交和结果查询，不暴露本地路径', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mxe-tools-'))
  const db = new Db(':memory:')
  db.saveAccount({ id: 'account', platform: 'weibo', nickname: '测试账号', status: 'active', createdAt: 1 })
  const startPublish = vi.fn((post, accountIds) => {
    db.savePost(post)
    const job = { id: 'job', postId: post.id, title: post.title, cover: post.images[0].path, createdAt: Date.now(), tasks: accountIds.map((accountId: string) => ({ id: 'task', accountId, platform: 'weibo' as const, status: 'pending' as const })) }
    db.insertJob(job)
    return job
  })
  const service = new PublishingService({
    db, materials: new MaterialLibrary(root), startPublish, retryTask: vi.fn(),
    platforms: () => [{ id: 'weibo', name: '微博', color: 'red', limits: { titleMax: 30, contentMax: 2000, minImages: 1, maxImages: 9, requiresTitle: false }, settings: [], canDelete: true }],
  })
  const server = createPublishingMcp(service, async () => [])
  const client = new Client({ name: 'test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a)
    await client.connect(b)
    const tools = await client.listTools()
    expect(tools.tools).toHaveLength(10)
    expect(tools.tools.find((t) => t.name === 'publish')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true })
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } }).png().toBuffer()
    const imported = await client.callTool({ name: 'import_material', arguments: { base64: png.toString('base64'), filename: '测试.png' } })
    expect(imported.isError).not.toBe(true)
    const material = (imported.structuredContent as { material: { id: string } }).material
    expect(JSON.stringify(imported)).not.toContain(root)
    expect((await client.callTool({ name: 'prepare_publish', arguments: { accountIds: ['account'], images: [{ path: '/tmp/user.png' }] } })).isError).toBe(true)
    const prepared = await client.callTool({ name: 'prepare_publish', arguments: { accountIds: ['account'], materialIds: [material.id], title: '测试', content: '正文' } })
    expect(prepared.isError).not.toBe(true)
    const draft = prepared.structuredContent as { valid: boolean; draftId: string }
    expect(draft.valid).toBe(true)
    expect(startPublish).not.toHaveBeenCalled()
    expect(JSON.stringify(prepared)).not.toContain(root)
    const publish = () => client.callTool({ name: 'publish', arguments: { draftId: draft.draftId, requestId: 'request' } })
    const results = await Promise.all([publish(), publish()])
    expect(results.every((r) => !r.isError)).toBe(true)
    expect(startPublish).toHaveBeenCalledOnce()
    const status = await client.callTool({ name: 'get_publish_jobs', arguments: { jobId: 'job' } })
    expect(status.structuredContent).toMatchObject({ jobs: [{ id: 'job', tasks: [{ status: 'pending' }] }] })
    expect(JSON.stringify(status)).not.toContain(root)
    expect((await client.callTool({ name: 'import_material', arguments: { base64: png.toString('base64'), path: '/tmp/user.png' } })).isError).toBe(true)
  } finally {
    await client.close()
    await server.close()
    db.close()
    await rm(root, { recursive: true, force: true })
  }
})
