import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

const legacy = {
  accounts: [account, { ...account, id: 'a2', platform: 'x', uid: undefined, checkedAt: 5 }],
  posts: [{ ...post, overrides: undefined }],
  jobs: [job('j2', 20), job('j1', 10)],
  commonTopics: ['#旅行', '美食', '旅行'],
  lastSettings: { a1: { visibility: '粉丝' } },
  useLast: { a1: false },
  collections: { a1: { items: [{ id: 'c1', name: '合集' }], fetchedAt: 99 } },
}

const tmp = () => mkdtempSync(join(tmpdir(), 'mxe-db-'))

describe('Db', () => {
  it('从旧 JSON 导入全部数据，并把旧文件改名留作备份', () => {
    const dir = tmp()
    const jsonFile = join(dir, 'maxiaoer.json')
    writeFileSync(jsonFile, JSON.stringify(legacy))
    const db = new Db(join(dir, 'maxiaoer.db'), jsonFile)

    expect(db.listAccounts()).toEqual(legacy.accounts.map((a) => JSON.parse(JSON.stringify(a))))
    expect(db.getPost('p1')).toEqual({ ...post, overrides: {} })
    expect(db.listJobs()).toEqual(legacy.jobs)
    expect(db.listTopicPresets()).toEqual([{ id: 'common', name: '常用话题', topics: ['旅行', '美食'] }])
    expect(db.lastSettings()).toEqual(legacy.lastSettings)
    expect(db.useLast()).toEqual(legacy.useLast)
    expect(db.collections('a1')).toEqual(legacy.collections.a1)
    expect(existsSync(jsonFile)).toBe(false)
    expect(JSON.parse(readFileSync(`${jsonFile}.migrated`, 'utf8'))).toEqual(legacy)
    db.close()

    // 再次打开不会重复导入
    writeFileSync(jsonFile, JSON.stringify({ accounts: [{ ...account, id: 'zz' }] }))
    const again = new Db(join(dir, 'maxiaoer.db'), jsonFile)
    expect(again.listAccounts().map((a) => a.id)).toEqual(['a1', 'a2'])
    again.close()
  })

  it('导入失败时什么都不写，旧文件保持原样', () => {
    const dir = tmp()
    const jsonFile = join(dir, 'maxiaoer.json')
    // 第二个账号缺少必填字段
    writeFileSync(jsonFile, JSON.stringify({ accounts: [account, { id: 'b' }] }))
    expect(() => new Db(join(dir, 'maxiaoer.db'), jsonFile)).toThrow()
    expect(existsSync(jsonFile)).toBe(true)
    // 修好之后重新打开能正常导入
    writeFileSync(jsonFile, JSON.stringify({ accounts: [account] }))
    const db = new Db(join(dir, 'maxiaoer.db'), jsonFile)
    expect(db.listAccounts()).toEqual([account])
    db.close()
  })

  it('任务更新只改状态字段，顺序不变', () => {
    const db = new Db(':memory:')
    db.insertJob(job('j1', 1))
    const j = db.getJob('j1')!
    db.saveTask('j1', { ...j.tasks[1], status: 'success', error: undefined, url: 'https://x.com/1' })
    expect(db.getJob('j1')!.tasks.map((t) => [t.id, t.status, t.error, t.url])).toEqual([
      ['j1-t1', 'success', undefined, 'https://weibo.com/1'],
      ['j1-t2', 'success', undefined, 'https://x.com/1'],
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

// 用真实数据的备份验证迁移：MXE_LEGACY_JSON=/path/to/maxiaoer.json pnpm test db
describe.skipIf(!process.env.MXE_LEGACY_JSON)('真实数据迁移', () => {
  it('导入后再读出来和原 JSON 一致', () => {
    const dir = tmp()
    const src = readFileSync(process.env.MXE_LEGACY_JSON!, 'utf8')
    writeFileSync(join(dir, 'maxiaoer.json'), src)
    const data = JSON.parse(src)
    const db = new Db(join(dir, 'maxiaoer.db'), join(dir, 'maxiaoer.json'))
    expect(db.listAccounts()).toEqual(data.accounts)
    expect(db.listJobs()).toEqual(data.jobs)
    for (const p of data.posts) expect(db.getPost(p.id)).toEqual({ ...p, overrides: {} })
    expect(db.lastSettings()).toEqual(data.lastSettings)
    expect(db.listTopicPresets()[0]?.topics ?? []).toEqual(data.commonTopics)
  })
})
