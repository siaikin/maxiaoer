import { randomUUID } from 'node:crypto'
import { app, BrowserWindow } from 'electron'
import type { Post, PublishJob, PublishTask } from '../shared/types'
import { defaultSettings } from '../shared/types'
import { validatePost } from '../shared/validate'
import { withBrowser } from './browser'
import { getAdapter } from './platforms'
import { getStore } from './store'

function broadcast(job: PublishJob) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('publish:update', job)
}

function findTask(jobId: string, taskId: string) {
  const job = getStore().data.jobs.find((j) => j.id === jobId)
  const task = job?.tasks.find((t) => t.id === taskId)
  if (!job || !task) throw new Error('发布记录不存在')
  return { job, task }
}

function updater(job: PublishJob, task: PublishTask) {
  return (patch: Partial<PublishTask>) => {
    Object.assign(task, patch)
    getStore().save()
    broadcast(job)
  }
}

/** 一次发布 = 一篇内容 × 多个账号，每个账号一个子任务 */
export function startPublish(post: Post, accountIds: string[], scheduledAt?: number): PublishJob {
  const store = getStore()
  const accounts = store.data.accounts.filter((a) => accountIds.includes(a.id))
  const job: PublishJob = {
    id: randomUUID(),
    postId: post.id,
    title: post.title || post.content.slice(0, 30),
    cover: post.images[0]?.path,
    scheduledAt,
    createdAt: Date.now(),
    tasks: accounts.map((a) => ({ id: randomUUID(), accountId: a.id, platform: a.platform, status: 'pending' })),
  }
  const i = store.data.posts.findIndex((p) => p.id === post.id)
  if (i >= 0) store.data.posts[i] = post
  else store.data.posts.push(post)
  // 记住每个账号这次的配置，供下次“使用上次选择”
  for (const a of accounts) if (post.settings[a.id]) store.data.lastSettings[a.id] = post.settings[a.id]
  store.data.jobs.unshift(job)
  store.save()
  if (!scheduledAt || scheduledAt <= Date.now()) void runJob(job.id)
  return job
}

/** 不同账号并行，各自一个窗口 */
export async function runJob(jobId: string) {
  const job = getStore().data.jobs.find((j) => j.id === jobId)
  if (!job) return
  await Promise.all(job.tasks.filter((t) => t.status === 'pending').map((t) => runTask(job, t)))
}

export async function retryTask(jobId: string, taskId: string) {
  const { job, task } = findTask(jobId, taskId)
  Object.assign(task, { status: 'pending', error: undefined, progress: undefined })
  await runTask(job, task)
}

async function runTask(job: PublishJob, task: PublishTask) {
  const store = getStore()
  const update = updater(job, task)
  const post = store.data.posts.find((p) => p.id === job.postId)
  const account = store.data.accounts.find((a) => a.id === task.accountId)
  if (!post || !account) return update({ status: 'failed', error: '内容或账号已被删除' })

  const adapter = getAdapter(task.platform)
  const errors = validatePost(post, adapter.limits)
  if (errors.length) return update({ status: 'failed', error: errors.join('；') })

  update({ status: 'running', startedAt: Date.now(), progress: '准备中', error: undefined })
  // 开发时 MXE_DRY_RUN=1：表单填好后不提交，窗口保留
  const dryRun = !app.isPackaged && process.env.MXE_DRY_RUN === '1'
  try {
    // 后台运行，不打扰用户；需要扫码时适配器会把窗口显示出来（不抢焦点）。试运行时显示，方便检查表单
    const result = await withBrowser(
      account.id,
      (ctx) =>
        adapter.publish(
          ctx,
          {
            title: post.title,
            content: post.content,
            images: post.images.map((i) => i.path),
            topics: post.topics.slice(0, adapter.limits.maxTopics),
            settings: { ...defaultSettings(adapter.settings), ...post.settings[account.id] },
            dryRun,
          },
          (progress) => update({ progress }),
        ),
      { show: dryRun, keepOpen: dryRun },
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
  const update = updater(job, task)
  update({ status: 'deleting', error: undefined })
  try {
    await withBrowser(task.accountId, (ctx) => adapter.deleteRemote!(ctx, { remoteId: task.remoteId, url: task.url }))
    update({ status: 'deleted', finishedAt: Date.now() })
  } catch (e) {
    update({ status: 'success', error: `删除失败：${e instanceof Error ? e.message : String(e)}` })
    throw e
  }
}

export function removeJob(jobId: string) {
  const store = getStore()
  store.data.jobs = store.data.jobs.filter((j) => j.id !== jobId)
  store.save()
}

/** 定时发布轮询 */
export function startScheduler() {
  setInterval(() => {
    for (const job of getStore().data.jobs) {
      if (job.scheduledAt && job.scheduledAt <= Date.now() && job.tasks.some((t) => t.status === 'pending')) void runJob(job.id)
    }
  }, 30_000)
}
