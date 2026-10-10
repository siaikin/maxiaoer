import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import type { Account, Collection, PlatformId } from '../shared/types'
import { createBrowserContext, partitionFor, withBrowser } from './browser'
import { getAdapter } from './platforms'
import { getStore } from './store'

export function findAccount(id: string) {
  const account = getStore().data.accounts.find((a) => a.id === id)
  if (!account) throw new Error('账号不存在')
  return account
}

/**
 * 打开独立分区的登录窗口，用户扫码 / 输入密码；
 * 每次跳转和每 5 秒在同一分区里用隐藏窗口检测登录态，成功即保存。
 */
export async function loginWithBrowser(platform: PlatformId): Promise<Account | null> {
  const adapter = getAdapter(platform)
  const id = randomUUID()
  const win = new BrowserWindow({ width: 1100, height: 800, title: `登录${adapter.name}`, webPreferences: { partition: partitionFor(id) } })
  await win.loadURL(adapter.loginUrl)

  return new Promise((resolve) => {
    let checking = false
    let done = false
    const finish = (account: Account | null) => {
      if (done) return
      done = true
      clearInterval(timer)
      if (!win.isDestroyed()) win.destroy()
      if (!account) void session.fromPartition(partitionFor(id)).clearStorageData()
      resolve(account)
    }
    const check = async () => {
      if (checking || done) return
      checking = true
      const probe = await createBrowserContext(id)
      try {
        const profile = await adapter.checkLogin(probe.ctx)
        if (!profile) return
        const store = getStore()
        const dup = profile.uid && store.data.accounts.find((a) => a.platform === platform && a.uid === profile.uid)
        if (dup) {
          // 同一账号重复登录：更新原账号资料，丢弃新分区
          Object.assign(dup, profile, { status: 'active', checkedAt: Date.now() })
          store.save()
          finish(null)
          return
        }
        const account: Account = { id, platform, ...profile, status: 'active', createdAt: Date.now(), checkedAt: Date.now() }
        store.data.accounts.push(account)
        store.save()
        finish(account)
      } catch {
        // 还在登录流程中
      } finally {
        probe.dispose()
        checking = false
      }
    }
    win.webContents.on('did-navigate', () => void check())
    const timer = setInterval(() => void check(), 5000)
    win.on('closed', () => finish(null))
  })
}

export async function checkAccount(id: string): Promise<Account> {
  const account = findAccount(id)
  const profile = await withBrowser(id, (ctx) => getAdapter(account.platform).checkLogin(ctx))
  Object.assign(account, profile ?? {}, { status: profile ? 'active' : 'expired', checkedAt: Date.now() })
  getStore().save()
  return account
}

export async function openAccount(id: string) {
  const account = findAccount(id)
  const win = new BrowserWindow({ width: 1280, height: 860, webPreferences: { partition: partitionFor(id) } })
  await win.loadURL(getAdapter(account.platform).homeUrl)
}

export async function removeAccount(id: string) {
  const store = getStore()
  store.data.accounts = store.data.accounts.filter((a) => a.id !== id)
  delete store.data.lastSettings[id]
  delete store.data.useLast[id]
  delete store.data.collections[id]
  store.save()
  await session.fromPartition(partitionFor(id)).clearStorageData()
}

const COLLECTION_TTL = 10 * 60_000

/** 合集列表：有缓存先用缓存，过期或强制刷新时从平台拉取，再按关键字过滤 */
export async function listCollections(id: string, keyword: string, refresh = false): Promise<Collection[]> {
  const account = findAccount(id)
  const adapter = getAdapter(account.platform)
  if (!adapter.listCollections) return []
  const store = getStore()
  const cached = store.data.collections[id]
  if (refresh || !cached || Date.now() - cached.fetchedAt > COLLECTION_TTL) {
    const items = await withBrowser(id, (ctx) => adapter.listCollections!(ctx))
    store.data.collections[id] = { items, fetchedAt: Date.now() }
    store.save()
  }
  const kw = keyword.trim().toLowerCase()
  const items = store.data.collections[id].items
  return kw ? items.filter((c) => c.name.toLowerCase().includes(kw)) : items
}
