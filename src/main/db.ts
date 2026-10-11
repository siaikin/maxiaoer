import { existsSync, readFileSync, renameSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { Account, Collection, Post, PublishJob, PublishTask, SettingValues, TopicPreset } from '../shared/types'
import { normalizeTopics } from '../shared/validate'

/** 旧版 JSON 存储的结构，只用于迁移 */
interface LegacyData {
  accounts?: Account[]
  posts?: Post[]
  jobs?: PublishJob[]
  commonTopics?: string[]
  lastSettings?: Record<string, SettingValues>
  useLast?: Record<string, boolean>
  collections?: Record<string, { items: Collection[]; fetchedAt: number }>
}

/** 每个版本一段建表语句，按顺序执行；版本号存在 PRAGMA user_version */
const MIGRATIONS = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    nickname TEXT NOT NULL,
    avatar TEXT,
    uid TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    checked_at INTEGER
  );
  CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    images TEXT NOT NULL,
    topics TEXT NOT NULL,
    overrides TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    title TEXT NOT NULL,
    cover TEXT,
    scheduled_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT,
    remote_id, -- 不声明类型：公众号是数字，其他平台是字符串，原样保存
    url TEXT,
    error TEXT,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX tasks_job ON tasks(job_id);
  CREATE TABLE topic_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    topics TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE account_prefs (
    account_id TEXT PRIMARY KEY,
    last_settings TEXT,
    use_last INTEGER
  );
  CREATE TABLE collection_cache (
    account_id TEXT PRIMARY KEY,
    items TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  `,
]

type Row = Record<string, any>
const json = (v: unknown) => JSON.stringify(v)
const opt = <T>(v: T | null | undefined) => (v === null ? undefined : v)
/** 去掉值为 undefined 的键，和旧 JSON 存储读出来的对象保持一致 */
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

const toAccount = (r: Row): Account =>
  compact({
    id: r.id,
    platform: r.platform,
    nickname: r.nickname,
    avatar: opt(r.avatar),
    uid: opt(r.uid),
    status: r.status,
    createdAt: r.created_at,
    checkedAt: opt(r.checked_at),
  })

const toPost = (r: Row): Post => ({
  id: r.id,
  title: r.title,
  content: r.content,
  images: JSON.parse(r.images),
  topics: JSON.parse(r.topics),
  overrides: JSON.parse(r.overrides),
  settings: JSON.parse(r.settings),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toTask = (r: Row): PublishTask =>
  compact({
    id: r.id,
    accountId: r.account_id,
    platform: r.platform,
    status: r.status,
    progress: opt(r.progress),
    remoteId: opt(r.remote_id),
    url: opt(r.url),
    error: opt(r.error),
    startedAt: opt(r.started_at),
    finishedAt: opt(r.finished_at),
  })

/**
 * SQLite 存储（Node 内置 node:sqlite，不需要原生模块）。
 * 第一次打开时如果有旧的 maxiaoer.json，整体导入后改名为 maxiaoer.json.migrated 留作备份。
 */
export class Db {
  readonly sql: DatabaseSync

  constructor(file: string, legacyJson?: string) {
    this.sql = new DatabaseSync(file)
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    // 建表和导入在同一个事务里：导入失败时库保持空白，旧文件不动，下次启动重试
    const imported = this.tx(() => {
      if (!this.migrate() || !legacyJson || !existsSync(legacyJson)) return false
      this.importLegacy(JSON.parse(readFileSync(legacyJson, 'utf8')))
      return true
    })
    if (imported) renameSync(legacyJson!, `${legacyJson}.migrated`)
  }

  close() {
    this.sql.close()
  }

  /** 执行未跑过的迁移，返回是否为新建的库 */
  private migrate() {
    const version = (this.sql.prepare('PRAGMA user_version').get() as Row).user_version as number
    if (version >= MIGRATIONS.length) return false
    this.tx(() => {
      for (const stmt of MIGRATIONS.slice(version)) this.sql.exec(stmt)
      this.sql.exec(`PRAGMA user_version = ${MIGRATIONS.length}`)
    })
    return version === 0
  }

  private depth = 0

  /** 事务；嵌套调用用 SAVEPOINT */
  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth++}`
    this.sql.exec(`SAVEPOINT ${sp}`)
    try {
      const result = fn()
      this.sql.exec(`RELEASE ${sp}`)
      return result
    } catch (e) {
      this.sql.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw e
    } finally {
      this.depth--
    }
  }

  /** 旧 JSON 数据整体导入；任何一条失败都回滚，旧文件保持不动 */
  importLegacy(data: LegacyData) {
    this.tx(() => {
      for (const a of data.accounts ?? []) this.saveAccount(a)
      for (const p of data.posts ?? []) this.savePost({ ...p, overrides: p.overrides ?? {} })
      // 旧数据新的在前，倒序插入保持 created_at 相同时的顺序
      for (const j of [...(data.jobs ?? [])].reverse()) this.insertJob(j)
      const common = normalizeTopics(data.commonTopics ?? [])
      if (common.length) this.saveTopicPreset({ id: 'common', name: '常用话题', topics: common })
      for (const [id, values] of Object.entries(data.lastSettings ?? {})) this.setLastSettings(id, values)
      for (const [id, value] of Object.entries(data.useLast ?? {})) this.setUseLast(id, value)
      for (const [id, c] of Object.entries(data.collections ?? {})) this.setCollections(id, c.items, c.fetchedAt)
    })
  }

  // ---- 账号 ----

  listAccounts(): Account[] {
    return this.sql.prepare('SELECT * FROM accounts ORDER BY created_at, rowid').all().map(toAccount)
  }

  getAccount(id: string): Account | undefined {
    const r = this.sql.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
    return r ? toAccount(r) : undefined
  }

  saveAccount(a: Account) {
    this.sql
      .prepare(
        `INSERT INTO accounts (id, platform, nickname, avatar, uid, status, created_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, nickname = excluded.nickname, avatar = excluded.avatar,
           uid = excluded.uid, status = excluded.status, checked_at = excluded.checked_at`,
      )
      .run(a.id, a.platform, a.nickname, a.avatar ?? null, a.uid ?? null, a.status, a.createdAt, a.checkedAt ?? null)
  }

  /** 删除账号以及它的偏好和缓存；发布记录保留 */
  removeAccount(id: string) {
    this.tx(() => {
      this.sql.prepare('DELETE FROM accounts WHERE id = ?').run(id)
      this.sql.prepare('DELETE FROM account_prefs WHERE account_id = ?').run(id)
      this.sql.prepare('DELETE FROM collection_cache WHERE account_id = ?').run(id)
    })
  }

  // ---- 内容 ----

  getPost(id: string): Post | undefined {
    const r = this.sql.prepare('SELECT * FROM posts WHERE id = ?').get(id)
    return r ? toPost(r) : undefined
  }

  savePost(p: Post) {
    this.sql
      .prepare(
        `INSERT INTO posts (id, title, content, images, topics, overrides, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, images = excluded.images, topics = excluded.topics,
           overrides = excluded.overrides, settings = excluded.settings, updated_at = excluded.updated_at`,
      )
      .run(p.id, p.title, p.content, json(p.images), json(p.topics), json(p.overrides ?? {}), json(p.settings), p.createdAt, p.updatedAt)
  }

  // ---- 发布记录 ----

  /** 新的在前 */
  listJobs(): PublishJob[] {
    const tasks = new Map<string, PublishTask[]>()
    for (const r of this.sql.prepare('SELECT * FROM tasks ORDER BY job_id, position').all()) {
      const list = tasks.get(r.job_id as string) ?? []
      list.push(toTask(r))
      tasks.set(r.job_id as string, list)
    }
    return this.sql
      .prepare('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC')
      .all()
      .map((r) => this.toJob(r, tasks.get(r.id as string) ?? []))
  }

  getJob(id: string): PublishJob | undefined {
    const r = this.sql.prepare('SELECT * FROM jobs WHERE id = ?').get(id)
    if (!r) return undefined
    return this.toJob(r, this.sql.prepare('SELECT * FROM tasks WHERE job_id = ? ORDER BY position').all(id).map(toTask))
  }

  private toJob(r: Row, tasks: PublishTask[]): PublishJob {
    return compact({ id: r.id, postId: r.post_id, title: r.title, cover: opt(r.cover), scheduledAt: opt(r.scheduled_at), createdAt: r.created_at, tasks })
  }

  insertJob(j: PublishJob) {
    this.tx(() => {
      this.sql
        .prepare('INSERT INTO jobs (id, post_id, title, cover, scheduled_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(j.id, j.postId, j.title, j.cover ?? null, j.scheduledAt ?? null, j.createdAt)
      j.tasks.forEach((t, i) => this.saveTask(j.id, t, i))
    })
  }

  saveTask(jobId: string, t: PublishTask, position?: number) {
    const pos = position ?? ((this.sql.prepare('SELECT position FROM tasks WHERE id = ?').get(t.id) as Row | undefined)?.position ?? 0)
    this.sql
      .prepare(
        `INSERT INTO tasks (id, job_id, position, account_id, platform, status, progress, remote_id, url, error, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, progress = excluded.progress, remote_id = excluded.remote_id, url = excluded.url,
           error = excluded.error, started_at = excluded.started_at, finished_at = excluded.finished_at`,
      )
      .run(
        t.id,
        jobId,
        pos,
        t.accountId,
        t.platform,
        t.status,
        t.progress ?? null,
        t.remoteId ?? null,
        t.url ?? null,
        t.error ?? null,
        t.startedAt ?? null,
        t.finishedAt ?? null,
      )
  }

  removeJob(id: string) {
    this.sql.prepare('DELETE FROM jobs WHERE id = ?').run(id)
  }

  // ---- 话题合集 ----

  listTopicPresets(): TopicPreset[] {
    return this.sql
      .prepare('SELECT * FROM topic_presets ORDER BY position, rowid')
      .all()
      .map((r) => ({ id: r.id as string, name: r.name as string, topics: JSON.parse(r.topics as string) }))
  }

  saveTopicPreset(p: TopicPreset) {
    const next = (this.sql.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM topic_presets').get() as Row).n
    this.sql
      .prepare(
        `INSERT INTO topic_presets (id, name, topics, position) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, topics = excluded.topics`,
      )
      .run(p.id, p.name.trim(), json(normalizeTopics(p.topics)), next)
  }

  removeTopicPreset(id: string) {
    this.sql.prepare('DELETE FROM topic_presets WHERE id = ?').run(id)
  }

  /** 按给定 id 顺序重排 */
  reorderTopicPresets(ids: string[]) {
    this.tx(() => ids.forEach((id, i) => this.sql.prepare('UPDATE topic_presets SET position = ? WHERE id = ?').run(i, id)))
  }

  // ---- 账号偏好 ----

  lastSettings(): Record<string, SettingValues> {
    const rows = this.sql.prepare('SELECT account_id, last_settings FROM account_prefs WHERE last_settings IS NOT NULL').all()
    return Object.fromEntries(rows.map((r) => [r.account_id, JSON.parse(r.last_settings as string)]))
  }

  setLastSettings(accountId: string, values: SettingValues) {
    this.sql
      .prepare('INSERT INTO account_prefs (account_id, last_settings) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET last_settings = excluded.last_settings')
      .run(accountId, json(values))
  }

  useLast(): Record<string, boolean> {
    const rows = this.sql.prepare('SELECT account_id, use_last FROM account_prefs WHERE use_last IS NOT NULL').all()
    return Object.fromEntries(rows.map((r) => [r.account_id, !!r.use_last]))
  }

  setUseLast(accountId: string, value: boolean) {
    this.sql
      .prepare('INSERT INTO account_prefs (account_id, use_last) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET use_last = excluded.use_last')
      .run(accountId, value ? 1 : 0)
  }

  // ---- 合集缓存 ----

  collections(accountId: string): { items: Collection[]; fetchedAt: number } | undefined {
    const r = this.sql.prepare('SELECT items, fetched_at FROM collection_cache WHERE account_id = ?').get(accountId)
    return r ? { items: JSON.parse(r.items as string), fetchedAt: r.fetched_at as number } : undefined
  }

  setCollections(accountId: string, items: Collection[], fetchedAt = Date.now()) {
    this.sql
      .prepare('INSERT INTO collection_cache (account_id, items, fetched_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET items = excluded.items, fetched_at = excluded.fetched_at')
      .run(accountId, json(items), fetchedAt)
  }
}
