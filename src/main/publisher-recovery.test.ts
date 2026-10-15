import { expect, it } from 'vitest'
import { Db } from './db'
import { recoverInterruptedJobs } from './publisher-recovery'

it('重启只恢复未执行的即时及到期任务，中断发布保留失败和待核对提示', () => {
  const db = new Db(':memory:')
  try {
    for (const [id, scheduledAt] of [['now', undefined], ['due', 50], ['later', 200]] as const) {
      db.insertJob({ id, postId: 'post', title: '测试', createdAt: 1, scheduledAt, tasks: [{ id: `${id}-task`, accountId: 'account', platform: 'weibo', status: 'pending' }] })
    }
    db.insertJob({ id: 'interrupted', postId: 'post', title: '中断', createdAt: 1, tasks: [
      { id: 'running', accountId: 'account', platform: 'weibo', status: 'running', startedAt: 20 },
      { id: 'deleting', accountId: 'account', platform: 'weibo', status: 'deleting', remoteId: 'remote' },
    ] })
    expect(recoverInterruptedJobs(db, 100).sort()).toEqual(['due', 'now'])
    expect(db.getJob('interrupted')!.tasks).toMatchObject([
      { id: 'running', status: 'failed', startedAt: 20, error: expect.stringContaining('无法确认') },
      { id: 'deleting', status: 'success', remoteId: 'remote', error: expect.stringContaining('删除结果无法确认') },
    ])
    expect(db.getJob('later')!.tasks[0].status).toBe('pending')
  } finally { db.close() }
})
