import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { skippedText, splitImages } from '../../shared/images'
import { contentFor, withLastSettings } from '../../shared/types'
import type { PlatformId, PlatformInfo, Post, PublishJob } from '../../shared/types'
import { normalizeTopics, validatePost } from '../../shared/validate'
import type { Db } from '../db'
import type { MaterialLibrary } from '../materials'
import { publicMessage } from './public-message'

const materialIds = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50)
const topics = z.array(z.string().max(200)).max(100)
const override = z.strictObject({
  title: z.string().max(1000).optional(), content: z.string().max(100_000).optional(),
  materialIds: materialIds.optional(), topics: topics.optional(),
})
const settingValue = z.union([z.string().max(2000), z.boolean(), z.null(), z.strictObject({
  id: z.string().min(1).max(300), name: z.string().max(300), count: z.number().int().nonnegative().optional(),
})])

/** 外部只接受素材 ID，永远不接受本地图片路径或完整 Post 对象。 */
export const publishInputSchema = z.strictObject({
  title: z.string().max(1000).default(''),
  content: z.string().max(100_000).default(''),
  materialIds: materialIds.default([]),
  topics: topics.default([]),
  accountIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  overrides: z.record(z.string(), override).default({}),
  settings: z.record(z.string(), z.record(z.string(), settingValue)).default({}),
  scheduledAt: z.iso.datetime({ offset: true }).optional().describe('带时区的 ISO 时间，如 2026-10-14T10:00:00+08:00；省略表示立即发布'),
})
export type PublishInput = z.infer<typeof publishInputSchema>

interface Dependencies {
  db: Db
  materials: Pick<MaterialLibrary, 'resolve' | 'list' | 'importSource'>
  platforms: () => PlatformInfo[]
  startPublish: (post: Post, accountIds: string[], scheduledAt?: number) => PublishJob
  retryTask: (jobId: string, taskId: string) => Promise<void>
}

/** 去掉仅供桌面端预览的路径。 */
export function publicJob(job: PublishJob) {
  const { cover: _cover, ...result } = job
  return { ...result, tasks: result.tasks.map((task) => ({
    ...task,
    ...(task.error ? { error: publicMessage(task.error) } : {}),
    ...(task.warning ? { warning: publicMessage(task.warning) } : {}),
    ...(task.progress ? { progress: publicMessage(task.progress) } : {}),
  })) }
}

export class PublishingService {
  constructor(readonly deps: Dependencies) {}

  private async build(input: PublishInput) {
    const { db, materials } = this.deps
    const platforms = new Map(this.deps.platforms().map((p) => [p.id, p]))
    if (new Set(input.accountIds).size !== input.accountIds.length) throw new Error('账号不能重复选择')
    const accounts = input.accountIds.map((id) => {
      const account = db.getAccount(id)
      if (!account) throw new Error(`账号不存在：${id}`)
      if (!platforms.has(account.platform)) throw new Error('账号的平台不受支持')
      return account
    })
    const selectedPlatforms = new Set<string>(accounts.map((a) => a.platform))
    for (const id of Object.keys(input.overrides)) {
      if (!selectedPlatforms.has(id)) throw new Error(`未选择此平台的账号：${id}`)
    }
    for (const id of Object.keys(input.settings)) if (!input.accountIds.includes(id)) throw new Error(`发布配置包含未选择的账号：${id}`)
    const scheduledAt = input.scheduledAt ? Date.parse(input.scheduledAt) : undefined
    if (scheduledAt !== undefined && scheduledAt <= Date.now()) throw new Error('定时发布时间必须晚于当前时间')
    // 同一素材用于多个平台时，每次预检只读取一次；提交仍会重新读取，避免沿用过期结果。
    const ids = new Set([...input.materialIds, ...Object.values(input.overrides).flatMap((o) => o.materialIds ?? [])])
    const images = new Map(await Promise.all([...ids].map(async (id) => [id, await materials.resolve(id)] as const)))
    const resolveImages = (ids: string[]) => ids.map((id) => images.get(id)!)
    const now = Date.now()
    const post: Post = {
      id: randomUUID(), title: input.title, content: input.content,
      images: resolveImages(input.materialIds), topics: normalizeTopics(input.topics),
      overrides: {}, settings: {}, createdAt: now, updatedAt: now,
    }
    for (const [id, value] of Object.entries(input.overrides)) {
      const { materialIds: ids, ...rest } = value
      post.overrides[id as PlatformId] = {
        ...rest, ...(rest.topics ? { topics: normalizeTopics(rest.topics) } : {}),
        ...(ids ? { images: resolveImages(ids) } : {}),
      }
    }
    const last = db.lastSettings()
    const useLast = db.useLast()
    const errors: string[] = []
    const preview = accounts.map((account) => {
      const platform = platforms.get(account.platform)!
      if (account.status === 'expired') errors.push(`${account.nickname}：需要在桌面应用中重新登录`)
      const provided = input.settings[account.id] ?? {}
      for (const [key, value] of Object.entries(provided)) {
        const field = platform.settings.find((f) => f.key === key)
        if (!field) throw new Error(`${account.nickname}：未知发布配置 ${key}`)
        const valid = field.type === 'select' ? typeof value === 'string' && field.options.includes(value)
          : field.type === 'switch' ? typeof value === 'boolean'
          : value === null || (typeof value === 'object' && typeof value.id === 'string' && typeof value.name === 'string')
        if (!valid) throw new Error(`${account.nickname}：发布配置 ${field.label} 的值不正确`)
      }
      post.settings[account.id] = { ...withLastSettings(platform.settings, useLast[account.id] !== false ? last[account.id] : undefined), ...provided }
      const content = contentFor(post, account.platform)
      const { kept, skipped } = splitImages(content.images, platform.limits)
      errors.push(...validatePost({ ...content, images: kept }, platform.limits).map((error) => `${account.nickname}：${error}`))
      const selectedIds = input.overrides[account.platform]?.materialIds ?? input.materialIds
      const skippedIndices = new Set(skipped.map(({ index }) => index))
      return {
        accountId: account.id, nickname: account.nickname, platform: account.platform,
        title: content.title, content: content.content, topics: content.topics,
        materialIds: selectedIds.filter((_, index) => !skippedIndices.has(index)),
        skippedMaterials: skipped.map(({ index, reason }) => ({ materialId: selectedIds[index], index: index + 1, reason })),
        warning: skippedText(skipped),
        settings: post.settings[account.id],
      }
    })
    return { post, scheduledAt, preview, errors }
  }

  async prepare(raw: unknown) {
    const input = publishInputSchema.parse(raw)
    const built = await this.build(input)
    if (built.errors.length) return { valid: false, errors: built.errors, preview: built.preview, scheduledAt: input.scheduledAt }
    // 固定预览中的设置，之后账号的“上次选择”变更不能悄悄改变已准备的稿件。
    const payload = { ...input, settings: built.post.settings }
    const draftId = randomUUID()
    this.deps.db.saveMcpDraft(draftId, payload)
    return { valid: true, draftId, errors: [], preview: built.preview, scheduledAt: input.scheduledAt }
  }

  private resolveSubmission(draftId: string, requestId: string) {
    const request = this.deps.db.getMcpRequest(requestId)
    if (request && request.draftId !== draftId) throw new Error('该 requestId 已用于另一份稿件，请为新发布使用新编号')
    const draft = this.deps.db.getMcpDraft(draftId)
    if (!draft) throw new Error('稿件不存在，请先调用 prepare_publish')
    const jobId = request?.jobId ?? draft.jobId
    if (!jobId) return { draft }
    const job = this.deps.db.getJob(jobId)
    if (!job) throw new Error('此稿件已提交，但本地记录已删除；不会重复发布')
    // 即便稿件已提交，新请求编号也绑定到原稿，不能再被用于另一份稿件。
    if (!request) this.deps.db.tx(() => this.deps.db.completeMcpDraft(draftId, requestId, jobId))
    return { draft, job }
  }

  async publish(draftId: string, requestId: string) {
    const { draft, job: prior } = this.resolveSubmission(draftId, requestId)
    if (prior) return { reused: true, job: publicJob(prior) }
    const input = publishInputSchema.parse(draft.payload)
    const built = await this.build(input)
    if (built.errors.length) throw new Error(built.errors.join('；'))
    return this.deps.db.tx(() => {
      // 图片读取会让出执行权；事务内再次检查，两个并发调用只会创建一个任务。
      const { job: concurrent } = this.resolveSubmission(draftId, requestId)
      if (concurrent) return { reused: true, job: publicJob(concurrent) }
      const job = this.deps.startPublish(built.post, input.accountIds, built.scheduledAt)
      this.deps.db.completeMcpDraft(draftId, requestId, job.id)
      return { reused: false, job: publicJob(job) }
    })
  }

  jobs(jobId?: string, limit = 30, offset = 0) {
    if (jobId) {
      const job = this.deps.db.getJob(jobId)
      if (!job) throw new Error('发布记录不存在')
      return { jobs: [publicJob(job)] }
    }
    const jobs = this.deps.db.listJobs()
    return { jobs: jobs.slice(offset, offset + limit).map(publicJob), total: jobs.length }
  }

  retry(jobId: string, taskId: string, allowDuplicate = false, verifiedNotPublished = false) {
    const job = this.deps.db.getJob(jobId)
    const task = job?.tasks.find((t) => t.id === taskId)
    if (!job || !task) throw new Error('发布任务不存在')
    if (task.status !== 'failed' && task.status !== 'skipped') throw new Error('只能重试失败或已跳过的任务')
    if (task.status === 'skipped' && !allowDuplicate) throw new Error('该任务因重复内容已跳过；确实需要重复发布时才设置 allowDuplicate')
    // 开始执行后的任意异常都可能发生在平台收到提交之后，不能只依赖错误文案猜测。
    if ((task.startedAt !== undefined || task.remoteId || task.url || /超时|timeout|核对|无法确认/i.test(task.error ?? '')) && !verifiedNotPublished) {
      throw new Error('此任务可能已经提交；请先到平台核实未发布，再设置 verifiedNotPublished')
    }
    void this.deps.retryTask(jobId, taskId).catch((error: unknown) => {
      // 引擎通常会保存失败；兜底记录启动阶段的异常，避免客户端只能看到 pending。
      const current = this.deps.db.getJob(jobId)?.tasks.find((t) => t.id === taskId)
      if (current && current.status !== 'success') this.deps.db.saveTask(jobId, { ...current, status: 'failed', error: error instanceof Error ? error.message : '重试失败' })
    })
    return { accepted: true, jobId, taskId, message: '已提交重试，请用 get_publish_jobs 查询最终结果' }
  }
}
