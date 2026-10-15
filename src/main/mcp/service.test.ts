import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Material } from '../../shared/materials'
import type { ImageAsset, PlatformInfo, Post, PublishJob } from '../../shared/types'
import { Db } from '../db'
import { x } from '../platforms/x'
import { PublishingService } from './service'

const materialId = 'a'.repeat(64)
const image: ImageAsset = { path: '/private/materials/test.png', width: 100, height: 100, bytes: 100 }
const material: Material = { id: materialId, name: 'test.png', mimeType: 'image/png', width: 100, height: 100, bytes: 100, createdAt: 1 }
const cleanup: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'maxiaoer-service-test-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const dbPath = join(directory, 'isolated.sqlite')
  let db = new Db(dbPath)
  cleanup.push(() => db.close())
  db.saveAccount({ id: 'account', platform: 'weibo', nickname: '测试账号', status: 'active', createdAt: 1 })
  const platform: PlatformInfo = {
    id: 'weibo', name: '测试平台', color: '#fff', canDelete: false,
    limits: { minImages: 1, maxImages: 9, contentMax: 1000, requiresTitle: false, maxImageBytes: 1000, maxImageSide: 500 },
    settings: [
      { key: 'visibility', label: '可见性', type: 'select', options: ['public', 'private'], default: 'public' },
      { key: 'comments', label: '评论', type: 'switch', default: true },
    ],
  }
  const resolve = vi.fn(async (id: string): Promise<ImageAsset> => {
    if (id !== materialId) throw new Error('素材不存在')
    return { ...image }
  })
  const materials = {
    resolve,
    get: vi.fn(async () => material),
    list: vi.fn(async () => [material]),
    importSource: vi.fn(async () => material),
  }
  const startPublish = vi.fn((post: Post, accountIds: string[], scheduledAt?: number): PublishJob => {
    const job: PublishJob = {
      id: randomUUID(), postId: post.id, title: post.title, cover: post.images[0]?.path,
      createdAt: Date.now(), scheduledAt,
      tasks: accountIds.map((accountId) => ({ id: randomUUID(), accountId, platform: 'weibo', status: 'pending' })),
    }
    db.savePost(post)
    db.insertJob(job)
    return job
  })
  const retryTask = vi.fn(async () => {})
  const platforms = [platform]
  const makeService = () => new PublishingService({ db, materials, startPublish, retryTask, platforms: () => platforms })
  const service = makeService()
  const input = { title: '测试标题', content: '测试正文', materialIds: [materialId], accountIds: ['account'] }
  return {
    get db() { return db }, service, input, platform, platforms, materials, startPublish, retryTask,
    reopen() {
      db.close()
      db = new Db(dbPath)
      return makeService()
    },
  }
}

async function prepare(service: PublishingService, input: unknown) {
  const result = await service.prepare(input)
  expect(result.valid).toBe(true)
  if (!result.draftId) throw new Error('测试准备稿件失败')
  return result.draftId
}

describe('MCP 发布服务', () => {
  it('并发提交同一稿件只创建一个任务，重启后同请求仍返回原任务', async () => {
    const fixture = await setup()
    const draftId = await prepare(fixture.service, fixture.input)
    const [first, concurrent] = await Promise.all([
      fixture.service.publish(draftId, 'request-one'), fixture.service.publish(draftId, 'request-one'),
    ])
    expect(first.job.id).toBe(concurrent.job.id)
    expect([first.reused, concurrent.reused].sort()).toEqual([false, true])
    expect(fixture.startPublish).toHaveBeenCalledTimes(1)
    const restarted = fixture.reopen()
    expect(await restarted.publish(draftId, 'request-one')).toMatchObject({ reused: true, job: { id: first.job.id } })
    expect(fixture.startPublish).toHaveBeenCalledTimes(1)
  })

  it('相同请求编号不能用于不同稿件，并发争用也只创建一次', async () => {
    const fixture = await setup()
    const first = await prepare(fixture.service, fixture.input)
    const second = await prepare(fixture.service, { ...fixture.input, title: '另一稿件' })
    const results = await Promise.allSettled([
      fixture.service.publish(first, 'same-request'), fixture.service.publish(second, 'same-request'),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(fixture.startPublish).toHaveBeenCalledTimes(1)
  })

  it('已发布稿件使用新请求编号时也要绑定原稿，不能再将该编号用于另一稿件', async () => {
    const fixture = await setup()
    const first = await prepare(fixture.service, fixture.input)
    const second = await prepare(fixture.service, { ...fixture.input, title: '另一稿件' })
    await fixture.service.publish(first, 'original-request')
    await expect(fixture.service.publish(first, 'alias-request')).resolves.toMatchObject({ reused: true })
    await expect(fixture.service.publish(second, 'alias-request')).rejects.toThrow('另一份稿件')
    expect(fixture.startPublish).toHaveBeenCalledTimes(1)
  })

  it('删除发布记录后保留防重映射，重试不能重发', async () => {
    const fixture = await setup()
    const draftId = await prepare(fixture.service, fixture.input)
    const result = await fixture.service.publish(draftId, 'request')
    fixture.db.removeJob(result.job.id)
    await expect(fixture.service.publish(draftId, 'request')).rejects.toThrow('不会重复发布')
    await expect(fixture.service.publish(draftId, 'another-request')).rejects.toThrow('不会重复发布')
    expect(fixture.startPublish).toHaveBeenCalledTimes(1)
  })

  it('外部不能提交本地图片路径，预览和任务查询不返回素材路径', async () => {
    const fixture = await setup()
    await expect(fixture.service.prepare({ ...fixture.input, images: [image] })).rejects.toThrow()
    await expect(fixture.service.prepare({ ...fixture.input, overrides: { weibo: { images: [image] } } })).rejects.toThrow()
    await expect(fixture.service.prepare({ ...fixture.input, materialIds: ['/private/photo.png'] })).rejects.toThrow()
    const preview = await fixture.service.prepare(fixture.input)
    expect(JSON.stringify(preview)).not.toContain('/private/')
    expect(fixture.startPublish).not.toHaveBeenCalled()
    const published = await fixture.service.publish(preview.draftId!, 'request')
    expect(JSON.stringify(published)).not.toContain('/private/')
    expect(JSON.stringify(fixture.service.jobs())).not.toContain('/private/')
    expect(fixture.startPublish.mock.calls[0][0].images[0].path).toBe(image.path)
  })

  it('无效账号、配置、素材或图片限制都不会生成发布任务', async () => {
    const fixture = await setup()
    const invalidInputs = [
      { ...fixture.input, accountIds: ['missing'] },
      { ...fixture.input, accountIds: ['account', 'account'] },
      { ...fixture.input, settings: { account: { unknown: true } } },
      { ...fixture.input, settings: { account: { visibility: 'unsupported' } } },
      { ...fixture.input, settings: { account: { comments: 'true' } } },
      { ...fixture.input, settings: { missing: { comments: true } } },
      { ...fixture.input, materialIds: ['b'.repeat(64)] },
      { ...fixture.input, scheduledAt: '2000-01-01T00:00:00Z' },
    ]
    for (const input of invalidInputs) await expect(fixture.service.prepare(input)).rejects.toThrow()
    expect(await fixture.service.prepare({ ...fixture.input, materialIds: [] })).toMatchObject({ valid: false })
    fixture.materials.resolve.mockResolvedValueOnce({ ...image, bytes: 1001 })
    expect(await fixture.service.prepare(fixture.input)).toMatchObject({ valid: false })
    expect(fixture.db.listJobs()).toHaveLength(0)
    expect(fixture.startPublish).not.toHaveBeenCalled()
    expect(fixture.db.sql.prepare('SELECT count(*) AS n FROM mcp_drafts').get()?.n).toBe(0)
  })

  it('提交时重新校验账号和素材，失效稿件不能进入发布队列', async () => {
    const fixture = await setup()
    const draftId = await prepare(fixture.service, fixture.input)
    fixture.materials.resolve.mockResolvedValueOnce({ ...image, bytes: 1001 })
    await expect(fixture.service.publish(draftId, 'request')).rejects.toThrow('至少需要')
    fixture.db.removeAccount('account')
    await expect(fixture.service.publish(draftId, 'request')).rejects.toThrow('账号不存在')
    expect(fixture.startPublish).not.toHaveBeenCalled()
    expect(fixture.db.getMcpRequest('request')).toBeUndefined()
  })

  it('共享素材每次预检只读一次，保持排列顺序且提交前重新读取', async () => {
    const fixture = await setup()
    const otherId = 'b'.repeat(64)
    fixture.materials.resolve.mockImplementation(async (id) => ({ ...image, path: `/private/materials/${id}.png` }))
    const preview = await fixture.service.prepare({
      ...fixture.input, materialIds: [materialId, otherId],
      overrides: { weibo: { materialIds: [otherId, materialId, otherId] } },
    })
    expect(preview.valid).toBe(true)
    expect(preview.preview[0].materialIds).toEqual([otherId, materialId, otherId])
    expect(fixture.materials.resolve).toHaveBeenCalledTimes(2)

    fixture.materials.resolve.mockResolvedValue({ ...image, bytes: 1001 })
    await expect(fixture.service.publish(preview.draftId!, 'request')).rejects.toThrow('至少需要')
    expect(fixture.materials.resolve).toHaveBeenCalledTimes(4)
    expect(fixture.startPublish).not.toHaveBeenCalled()

    fixture.materials.resolve.mockImplementation(async (id) => ({ ...image, path: `/private/materials/${id}.png` }))
    await fixture.service.publish(preview.draftId!, 'request')
    const post = fixture.startPublish.mock.calls[0][0]
    expect(post.images.map((image) => image.path)).toEqual([materialId, otherId].map((id) => `/private/materials/${id}.png`))
    expect(post.overrides.weibo!.images!.map((image) => image.path)).toEqual([otherId, materialId, otherId].map((id) => `/private/materials/${id}.png`))
  })

  it('按各平台过滤长图，预览提示跳过原因且保留稿件原图和排列顺序', async () => {
    const fixture = await setup()
    fixture.platform.limits = { ...fixture.platform.limits, maxImageBytes: undefined, maxImageSide: undefined }
    fixture.platforms.push({ ...fixture.platform, id: 'x', name: 'X', limits: x.limits })
    fixture.db.saveAccount({ id: 'x-account', platform: 'x', nickname: 'X 账号', status: 'active', createdAt: 1 })
    const longId = 'b'.repeat(64)
    fixture.materials.resolve.mockImplementation(async (id) => id === longId
      ? { path: '/private/materials/long.jpg', width: 1968, height: 25828, bytes: 4_829_498 }
      : { ...image })
    const input = { ...fixture.input, materialIds: [materialId, longId, materialId], accountIds: ['account', 'x-account'] }
    const prepared = await fixture.service.prepare(input)
    expect(prepared.valid).toBe(true)
    expect(prepared.preview[0]).toMatchObject({ materialIds: input.materialIds, skippedMaterials: [], warning: '' })
    expect(prepared.preview[1]).toMatchObject({
      materialIds: [materialId, materialId],
      skippedMaterials: [{ materialId: longId, index: 2, reason: '1968×25828，边长超过 16384 像素' }],
      warning: expect.stringContaining('发布时跳过'),
    })
    expect(JSON.stringify(prepared)).not.toContain('/private/')
    await fixture.service.publish(prepared.draftId!, 'filter-request')
    expect(fixture.startPublish.mock.calls[0][0].images.map((i) => i.path)).toEqual([image.path, '/private/materials/long.jpg', image.path])

    const onlyLong = await fixture.service.prepare({ ...input, materialIds: [longId], accountIds: ['x-account'] })
    expect(onlyLong).toMatchObject({ valid: true, preview: [{ materialIds: [], skippedMaterials: [{ materialId: longId }] }] })
  })

  it('准备稿件固定已预览的发布配置，不随上次选择变化', async () => {
    const fixture = await setup()
    fixture.db.setLastSettings('account', { visibility: 'private', comments: false })
    const draftId = await prepare(fixture.service, fixture.input)
    fixture.db.setLastSettings('account', { visibility: 'public', comments: true })
    await fixture.service.publish(draftId, 'request')
    expect(fixture.startPublish.mock.calls[0][0].settings.account).toEqual({ visibility: 'private', comments: false })
  })

  it('成功任务不能重试；提交状态不明和重复跳过必须满足显式条件', async () => {
    const fixture = await setup()
    const draftId = await prepare(fixture.service, fixture.input)
    const { job } = await fixture.service.publish(draftId, 'request')
    const task = job.tasks[0]
    fixture.db.saveTask(job.id, { ...task, status: 'success', url: 'https://example.test/post' })
    expect(() => fixture.service.retry(job.id, task.id, true, true)).toThrow('只能重试')
    fixture.db.saveTask(job.id, { ...task, status: 'failed', error: '提交超时，请核对' })
    expect(() => fixture.service.retry(job.id, task.id)).toThrow('核实未发布')
    expect(fixture.retryTask).not.toHaveBeenCalled()
    expect(fixture.service.retry(job.id, task.id, false, true)).toMatchObject({ accepted: true })
    fixture.db.saveTask(job.id, { ...task, status: 'skipped' })
    expect(() => fixture.service.retry(job.id, task.id)).toThrow('重复内容')
    expect(fixture.service.retry(job.id, task.id, true)).toMatchObject({ accepted: true })
    expect(fixture.retryTask).toHaveBeenCalledTimes(2)
  })

  it('任务开始执行后即使只有普通网络错误，也必须先核实未发布再重试', async () => {
    const fixture = await setup()
    const draftId = await prepare(fixture.service, fixture.input)
    const { job } = await fixture.service.publish(draftId, 'request')
    const task = job.tasks[0]
    fixture.db.saveTask(job.id, { ...task, status: 'failed', startedAt: 1, error: 'Failed to fetch' })
    expect(fixture.db.getJob(job.id)?.tasks[0]).toMatchObject({ startedAt: 1, error: 'Failed to fetch' })
    expect(fixture.db.getJob(job.id)?.tasks[0].remoteId).toBeUndefined()
    expect(fixture.db.getJob(job.id)?.tasks[0].url).toBeUndefined()
    expect(() => fixture.service.retry(job.id, task.id)).toThrow('核实未发布')
    expect(fixture.retryTask).not.toHaveBeenCalled()
    expect(fixture.service.retry(job.id, task.id, false, true)).toMatchObject({ accepted: true })
    expect(fixture.retryTask).toHaveBeenCalledExactlyOnceWith(job.id, task.id)
  })
})
