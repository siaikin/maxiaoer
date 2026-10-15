import type { Db } from './db'

/** 重启后只恢复尚未执行的任务；中断的发布必须先核对平台结果。 */
export function recoverInterruptedJobs(db: Pick<Db, 'listJobs' | 'saveTask'>, now = Date.now()): string[] {
  const ready: string[] = []
  for (const job of db.listJobs()) {
    for (const task of job.tasks) {
      if (task.status === 'running') {
        db.saveTask(job.id, { ...task, status: 'failed', progress: undefined, finishedAt: now, error: '应用中断，发布结果无法确认；请先到平台核对，确认未发布后再重试' })
      } else if (task.status === 'deleting') {
        db.saveTask(job.id, { ...task, status: 'success', progress: undefined, error: '应用中断，删除结果无法确认；请先到平台核对' })
      }
    }
    if ((!job.scheduledAt || job.scheduledAt <= now) && job.tasks.some((task) => task.status === 'pending')) ready.push(job.id)
  }
  return ready
}
