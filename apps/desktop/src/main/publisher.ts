import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { resolvePost, validatePost, type Post, type PublishJob, type PublishTask } from '@maxiaoer/core'
import { getAdapter } from '@maxiaoer/adapters'
import { apiContextFor } from './accounts'
import { createBrowserContext } from './browser-context'
import { getStore } from './store'

function broadcast(job: PublishJob) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('publish:update', job)
}

/** 创建一次发布：每个选中的账号一个子任务，定时任务交给 scheduler 处理 */
export function startPublish(post: Post, accountIds: string[], scheduledAt?: number): PublishJob {
  const store = getStore()
  const accounts = store.data.accounts.filter((a) => accountIds.includes(a.id))
  const job: PublishJob = {
    id: randomUUID(),
    postId: post.id,
    title: post.title || post.content.slice(0, 20),
    scheduledAt,
    createdAt: Date.now(),
    tasks: accounts.map((a) => ({ id: randomUUID(), accountId: a.id, platform: a.platform, status: 'pending' })),
  }
  const existing = store.data.posts.findIndex((p) => p.id === post.id)
  if (existing >= 0) store.data.posts[existing] = post
  else store.data.posts.push(post)
  store.data.jobs.unshift(job)
  store.save()
  if (!scheduledAt || scheduledAt <= Date.now()) void runJob(job.id)
  return job
}

/** 不同账号之间并行，同一账号串行（一个账号同时只开一个自动化窗口） */
export async function runJob(jobId: string) {
  const job = getStore().data.jobs.find((j) => j.id === jobId)
  if (!job) return
  await Promise.all(job.tasks.filter((t) => t.status === 'pending').map((t) => runTask(job, t)))
}

export async function retryTask(jobId: string, taskId: string) {
  const job = getStore().data.jobs.find((j) => j.id === jobId)
  const task = job?.tasks.find((t) => t.id === taskId)
  if (!job || !task) return
  Object.assign(task, { status: 'pending', error: undefined, progress: undefined })
  await runTask(job, task)
}

async function runTask(job: PublishJob, task: PublishTask) {
  const store = getStore()
  const update = (patch: Partial<PublishTask>) => {
    Object.assign(task, patch)
    store.save()
    broadcast(job)
  }
  const post = store.data.posts.find((p) => p.id === job.postId)
  const account = store.data.accounts.find((a) => a.id === task.accountId)
  if (!post || !account) return update({ status: 'failed', error: '内容或账号已被删除' })

  const adapter = getAdapter(task.platform)
  const content = resolvePost(post, task.platform)
  const errors = validatePost(content, adapter.limits)
  if (errors.length) return update({ status: 'failed', error: errors.join('；') })

  update({ status: 'running', startedAt: Date.now(), progress: '准备中' })
  const onProgress = (progress: string) => update({ progress })
  try {
    let result
    if (adapter.mode === 'api') {
      result = await adapter.publish(apiContextFor(account), content, { onProgress })
    } else {
      // 先显示窗口，便于观察和处理验证码；稳定后改为后台运行
      const browser = await createBrowserContext(account.id, { show: true })
      try {
        result = await adapter.publish(browser.ctx, content, { onProgress })
      } finally {
        browser.dispose()
      }
    }
    update({ status: 'success', url: result.url, progress: undefined, finishedAt: Date.now() })
  } catch (e) {
    update({ status: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() })
  }
}

/** 简单的定时发布轮询 */
export function startScheduler() {
  setInterval(() => {
    for (const job of getStore().data.jobs) {
      if (job.scheduledAt && job.scheduledAt <= Date.now() && job.tasks.some((t) => t.status === 'pending')) {
        void runJob(job.id)
      }
    }
  }, 30_000)
}
