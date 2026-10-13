import { randomUUID } from 'node:crypto'
import { app, BrowserWindow } from 'electron'
import type { ImageAsset, Post, PublishJob, PublishTask } from '../shared/types'
import { contentFor, defaultSettings } from '../shared/types'
import { findPublishedDuplicate } from '../shared/duplicate'
import { skippedText, splitImages } from '../shared/images'
import { validatePost } from '../shared/validate'
import { beginTask } from './browser/queue'
import { confirmSession } from './accounts'
import { browserHost } from './browser'
import { imageInfo } from './images'
import { getAdapter } from './platforms'
import { getDb } from './store'

/** 从库里重新读一遍再发，同一次发布的几个任务并行更新时不会互相覆盖 */
function broadcast(jobId: string) {
  const job = getDb().getJob(jobId)
  if (job) for (const win of BrowserWindow.getAllWindows()) win.webContents.send('publish:update', job)
}

function findTask(jobId: string, taskId: string) {
  const job = getDb().getJob(jobId)
  const task = job?.tasks.find((t) => t.id === taskId)
  if (!job || !task) throw new Error('发布记录不存在')
  return { job, task }
}

function updater(job: PublishJob, task: PublishTask) {
  return (patch: Partial<PublishTask>) => {
    Object.assign(task, patch)
    getDb().saveTask(job.id, task)
    broadcast(job.id)
  }
}

/** 一次发布 = 一篇内容 × 多个账号，每个账号一个子任务 */
export function startPublish(post: Post, accountIds: string[], scheduledAt?: number): PublishJob {
  const db = getDb()
  const accounts = db.listAccounts().filter((a) => accountIds.includes(a.id))
  const job: PublishJob = {
    id: randomUUID(),
    postId: post.id,
    title: post.title || post.content.slice(0, 30),
    cover: post.images[0]?.path,
    scheduledAt,
    createdAt: Date.now(),
    tasks: accounts.map((a) => ({ id: randomUUID(), accountId: a.id, platform: a.platform, status: 'pending' })),
  }
  db.tx(() => {
    db.savePost({ ...post, overrides: post.overrides ?? {} })
    // 记住每个账号这次的配置，供下次“使用上次选择”
    for (const a of accounts) if (post.settings[a.id]) db.setLastSettings(a.id, post.settings[a.id])
    db.insertJob(job)
  })
  if (!scheduledAt || scheduledAt <= Date.now()) void runJob(job.id)
  return job
}

const inflight = new Map<string, Promise<unknown>>()

/** 不同账号最多同时两个；同一个账号串行。已经入队的调度和重试直接复用。 */
export async function runJob(jobId: string) {
  const job = getDb().getJob(jobId)
  if (!job) return
  await Promise.all(job.tasks.filter((t) => t.status === 'pending').map((t) => runTask(job, t)))
}

/** 重试失败的任务；对“已跳过”的任务重试即用户确认仍要发布，不再检查同名 */
export async function retryTask(jobId: string, taskId: string) {
  const { job, task } = findTask(jobId, taskId)
  const force = task.status === 'skipped'
  await beginTask(inflight, task.id, () => {
    Object.assign(task, { status: 'pending', error: undefined, warning: undefined, progress: undefined })
    getDb().saveTask(job.id, task)
    broadcast(job.id)
  }, () => runTaskBody(job, task, force))
}

function runTask(job: PublishJob, task: PublishTask) {
  return beginTask(inflight, task.id, () => undefined, () => runTaskBody(job, task))
}

async function runTaskBody(job: PublishJob, task: PublishTask, force = false) {
  const db = getDb()
  const update = updater(job, task)
  const post = db.getPost(job.postId)
  const account = db.getAccount(task.accountId)
  if (!post || !account) return update({ status: 'failed', error: '内容或账号已被删除' })

  // 同一账号已经成功发过同名内容就跳过，避免重复发布。只看本地发布记录，不打开平台
  if (!force && findPublishedDuplicate(db.listJobs(), job.id, account.id)) {
    return update({ status: 'skipped', error: undefined, progress: undefined, finishedAt: Date.now() })
  }

  const adapter = getAdapter(task.platform)
  // 这个平台单独设置过的图片、标题、正文、话题优先
  const content = contentFor(post, task.platform)
  // 超出平台限制的图片不发；文件可能在编辑后被换过，按现在的文件重新读尺寸和大小
  const { maxImageBytes, maxImageSide } = adapter.limits
  let images: ImageAsset[]
  try {
    images = maxImageBytes || maxImageSide ? await Promise.all(content.images.map((i) => imageInfo(i.path))) : content.images
  } catch (e) {
    return update({ status: 'failed', error: `图片读取失败：${e instanceof Error ? e.message : String(e)}` })
  }
  const { kept, skipped } = splitImages(images, adapter.limits)
  const warning = skippedText(skipped) || undefined
  const errors = validatePost({ ...content, images: kept }, adapter.limits)
  if (errors.length) return update({ status: 'failed', error: errors.join('；'), warning })

  // 开发时 MXE_DRY_RUN=1：表单填好后不提交，窗口保留
  const dryRun = !app.isPackaged && process.env.MXE_DRY_RUN === '1'
  try {
    // 有界面但在屏幕外；需要扫码时适配器把窗口移回来。试运行时直接显示填好的页面
    const result = await browserHost().withBrowser(
      account.id,
      async (ctx) => {
        await confirmSession(account, ctx)
        return adapter.publish(
          ctx,
          {
            title: content.title,
            content: content.content,
            images: kept.map((i) => i.path),
            topics: content.topics.slice(0, adapter.limits.maxTopics),
            settings: { ...defaultSettings(adapter.settings), ...post.settings[account.id] },
            dryRun,
          },
          (progress) => update({ progress }),
        )
      },
      {
        show: dryRun,
        keepOpen: dryRun,
        key: task.id,
        onWait: (progress) => update({ progress }),
        onStart: () => update({ status: 'running', startedAt: Date.now(), progress: '准备中', error: undefined, warning }),
      },
    )
    if (dryRun) return update({ status: 'failed', error: '试运行：表单已填好，没有提交', progress: undefined, finishedAt: Date.now() })
    update({ status: 'success', ...result, progress: undefined, finishedAt: Date.now() })
  } catch (e) {
    update({ status: 'failed', error: e instanceof Error ? e.message : String(e), progress: undefined, finishedAt: Date.now() })
  }
}

/** 从平台删除已发布的作品 */
export async function deleteRemote(jobId: string, taskId: string) {
  const { job, task } = findTask(jobId, taskId)
  const adapter = getAdapter(task.platform)
  if (!adapter.deleteRemote) throw new Error(`${adapter.name} 暂不支持自动删除，请到平台后台手动删除`)
  if (task.status !== 'success') throw new Error('只有发布成功的作品可以删除')
  const account = getDb().getAccount(task.accountId)
  const update = updater(job, task)
  await beginTask(inflight, `delete:${task.id}`, () => update({ status: 'deleting', error: undefined }), async () => {
    try {
      await browserHost().withBrowser(
        task.accountId,
        async (ctx) => {
          if (account) await confirmSession(account, ctx)
          await adapter.deleteRemote!(ctx, { remoteId: task.remoteId, url: task.url })
        },
        {
          key: `delete:${task.id}`,
          onWait: (progress) => update({ progress }),
          onStart: () => update({ status: 'deleting', progress: '准备中', error: undefined }),
        },
      )
      update({ status: 'deleted', progress: undefined, finishedAt: Date.now() })
    } catch (e) {
      update({ status: 'success', error: `删除失败：${e instanceof Error ? e.message : String(e)}`, progress: undefined })
      throw e
    }
  })
}

export function removeJob(jobId: string) {
  getDb().removeJob(jobId)
}

/** 定时发布轮询 */
export function startScheduler() {
  setInterval(() => {
    for (const job of getDb().listJobs()) {
      if (job.scheduledAt && job.scheduledAt <= Date.now() && job.tasks.some((t) => t.status === 'pending')) void runJob(job.id)
    }
  }, 30_000)
}
