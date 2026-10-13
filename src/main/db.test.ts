import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Account, Post, PublishJob } from '../shared/types'
import { Db } from './db'

const account: Account = { id: 'a1', platform: 'weibo', nickname: '小明', uid: '42', status: 'active', createdAt: 1 }
const post: Post = {
  id: 'p1',
  title: '标题',
  content: '正文',
  images: [{ path: '/a.jpg' }],
  topics: ['旅行'],
  overrides: { x: { content: '短正文' } },
  settings: { a1: { visibility: '公开' } },
  createdAt: 1,
  updatedAt: 2,
}
const job = (id: string, createdAt: number): PublishJob => ({
  id,
  postId: 'p1',
  title: '标题',
  createdAt,
  tasks: [
    { id: `${id}-t1`, accountId: 'a1', platform: 'weibo', status: 'success', remoteId: 'r1', url: 'https://weibo.com/1' },
    { id: `${id}-t2`, accountId: 'a2', platform: 'x', status: 'failed', error: '超时' },
  ],
})

const tmp = () => mkdtempSync(join(tmpdir(), 'mxe-db-'))

describe('Db', () => {
  it('重新打开已有的库不会重复建表，数据还在', () => {
    const file = join(tmp(), 'maxiaoer.db')
    const db = new Db(file)
    db.saveAccount(account)
    db.close()
    const again = new Db(file)
    expect(again.listAccounts()).toEqual([account])
    again.close()
  })

  it('内容连同各平台的单独设置一起保存', () => {
    const db = new Db(':memory:')
    db.savePost(post)
    db.savePost({ ...post, title: '改过的标题', updatedAt: 3 })
    expect(db.getPost('p1')).toEqual({ ...post, title: '改过的标题', updatedAt: 3 })
  })

  it('任务更新只改状态字段，顺序不变', () => {
    const db = new Db(':memory:')
    db.insertJob(job('j1', 1))
    const j = db.getJob('j1')!
    db.saveTask('j1', { ...j.tasks[1], status: 'success', error: undefined, warning: '第 2 张超出限制', url: 'https://x.com/1' })
    expect(db.getJob('j1')!.tasks.map((t) => [t.id, t.status, t.error, t.warning, t.url])).toEqual([
      ['j1-t1', 'success', undefined, undefined, 'https://weibo.com/1'],
      ['j1-t2', 'success', undefined, '第 2 张超出限制', 'https://x.com/1'],
    ])
    db.removeJob('j1')
    expect(db.listJobs()).toEqual([])
    expect(db.sql.prepare('SELECT COUNT(*) n FROM tasks').get()).toEqual({ n: 0 })
  })

  it('话题合集：新建、改名、排序、删除', () => {
    const db = new Db(':memory:')
    db.saveTopicPreset({ id: 'a', name: '旅行', topics: ['#旅行', '自驾'] })
    db.saveTopicPreset({ id: 'b', name: '美食', topics: ['美食'] })
    db.saveTopicPreset({ id: 'a', name: '出行', topics: ['旅行'] })
    expect(db.listTopicPresets().map((p) => p.name)).toEqual(['出行', '美食'])
    db.reorderTopicPresets(['b', 'a'])
    expect(db.listTopicPresets().map((p) => p.id)).toEqual(['b', 'a'])
    db.removeTopicPreset('b')
    expect(db.listTopicPresets()).toEqual([{ id: 'a', name: '出行', topics: ['旅行'] }])
  })

  it('删除账号同时清掉它的偏好和合集缓存', () => {
    const db = new Db(':memory:')
    db.saveAccount(account)
    db.setLastSettings('a1', { v: '1' })
    db.setUseLast('a1', false)
    db.setCollections('a1', [])
    db.removeAccount('a1')
    expect([db.listAccounts(), db.lastSettings(), db.useLast(), db.collections('a1')]).toEqual([[], {}, {}, undefined])
  })
})
