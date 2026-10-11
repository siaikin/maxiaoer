import type { PublishJob } from './types'

/**
 * 在本地发布记录里找同一账号上同名且仍在平台上的作品（不含本次发布）。
 * 已从平台删除的不算；无标题时不判断。
 */
export function findPublishedDuplicate(jobs: PublishJob[], jobId: string, accountId: string) {
  const title = jobs.find((j) => j.id === jobId)?.title.trim()
  if (!title) return undefined
  for (const job of jobs) {
    if (job.id === jobId || job.title.trim() !== title) continue
    const task = job.tasks.find((t) => t.accountId === accountId && (t.status === 'success' || t.status === 'deleting'))
    if (task) return { job, task }
  }
  return undefined
}
