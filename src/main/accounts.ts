import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { session } from 'electron'
import type { Account, Collection, PlatformId } from '../shared/types'
import { sleep } from './anti-detection/human'
import { browserHost, partitionFor } from './browser'
import { isNetworkError } from './browser/net'
import { IdentityMismatchError, IdentityUnconfirmedError, mergeRelogin } from './browser/relogin'
import { getAdapter } from './platforms'
import type { AccountProfile, BrowserContext } from './platforms/types'
import { getStore } from './store'

export function findAccount(id: string) {
  const account = getStore().data.accounts.find((item) => item.id === id)
  if (!account) throw new Error('账号不存在')
  return account
}

async function removeProfile(id: string) {
  const dir = browserHost().profileDir(id)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await sleep(200)
    }
  }
}

/** 导入过旧 Cookie 后，第一次自动化先确认登录。网络失败保留标记，下次再查。 */
export async function confirmSession(account: Account, ctx: BrowserContext) {
  const host = browserHost()
  if (!host.needsVerify(account.id)) return
  let profile: AccountProfile | null
  try {
    profile = await getAdapter(account.platform).checkLogin(ctx)
  } catch (error) {
    if (isNetworkError(error)) throw new Error('网络错误，暂时无法确认登录状态')
    throw error
  }
  host.clearVerify(account.id)
  if (!profile) {
    Object.assign(account, { status: 'expired', checkedAt: Date.now() })
    getStore().save()
    throw new Error('需要重新登录')
  }
  Object.assign(account, profile, { status: 'active', checkedAt: Date.now() })
  getStore().save()
}

async function cleanupLogin(id: string, account: Account | null) {
  await browserHost().closeAccount(id).catch(() => undefined)
  if (!account) {
    await removeProfile(id)
    await session.fromPartition(partitionFor(id)).clearStorageData().catch(() => undefined)
  }
  return account
}

/**
 * 打开这个账号自己的指纹浏览器。用户扫码或输入密码；
 * 探测在另一个标签页进行，不打断登录页。
 */
export async function loginWithBrowser(platform: PlatformId): Promise<Account | null> {
  const adapter = getAdapter(platform)
  const id = randomUUID()
  const host = browserHost()
  try {
    let stopped = false
    let checking = false
    let timer: ReturnType<typeof setInterval> | undefined
    let finishLogin!: (account: Account | null) => void
    const result = new Promise<Account | null>((resolve) => {
      finishLogin = resolve
    })
    const done = (account: Account | null) => {
      if (stopped) return
      stopped = true
      if (timer) clearInterval(timer)
      void cleanupLogin(id, account).then(finishLogin)
    }
    const check = async () => {
      if (checking || stopped) return
      checking = true
      try {
        const profile = await host.withBrowser(id, (ctx) => adapter.checkLogin(ctx), { show: false, background: true, key: `login:${id}:${Date.now()}` })
        if (!profile || stopped) return
        const store = getStore()
        const duplicate = profile.uid && store.data.accounts.find((item) => item.platform === platform && item.uid === profile.uid)
        if (duplicate) {
          Object.assign(duplicate, profile, { status: 'active', checkedAt: Date.now() })
          store.save()
          done(null)
          return
        }
        const account: Account = { id, platform, ...profile, status: 'active', createdAt: Date.now(), checkedAt: Date.now() }
        store.data.accounts.push(account)
        store.save()
        host.clearVerify(id)
        done(account)
      } catch {
        // 还在登录流程中
      } finally {
        checking = false
      }
    }
    const manual = await host.openManual(id, adapter.loginUrl, { onNavigate: () => void check() })
    timer = setInterval(() => void check(), 5_000)
    void manual.whenClosed.then(() => done(null))
    return await result
  } catch (error) {
    await cleanupLogin(id, null)
    throw error
  }
}

export async function relogin(id: string): Promise<Account | null> {
  const account = findAccount(id)
  const adapter = getAdapter(account.platform)
  const host = browserHost()
  let stopped = false
  let checking = false
  let timer: ReturnType<typeof setInterval> | undefined
  let finishLogin!: (result: Account | null) => void
  let failLogin!: (error: Error) => void
  const result = new Promise<Account | null>((resolve, reject) => {
    finishLogin = resolve
    failLogin = reject
  })
  const done = (value: Account | null, error?: Error) => {
    if (stopped) return
    stopped = true
    if (timer) clearInterval(timer)
    void host.closeAccount(id).catch(() => undefined).then(() => (error ? failLogin(error) : finishLogin(value)))
  }
  const check = async () => {
    if (checking || stopped) return
    checking = true
    try {
      const profile = await host.withBrowser(id, (ctx) => adapter.checkLogin(ctx), { show: false, background: true, key: `relogin:${id}:${Date.now()}` })
      if (!profile || stopped) return
      try {
        Object.assign(account, mergeRelogin(account, profile))
      } catch (error) {
        if (error instanceof IdentityUnconfirmedError) return
        if (error instanceof IdentityMismatchError) await host.clearCookies(id).catch(() => undefined)
        done(null, error instanceof Error ? error : new Error(String(error)))
        return
      }
      getStore().save()
      host.clearVerify(id)
      done(account)
    } catch (error) {
      if (!isNetworkError(error)) return
    } finally {
      checking = false
    }
  }
  const manual = await host.openManual(id, adapter.loginUrl, { onNavigate: () => void check() })
  timer = setInterval(() => void check(), 5_000)
  void manual.whenClosed.then(() => done(null))
  return await result
}

export async function checkAccount(id: string): Promise<Account> {
  const account = findAccount(id)
  let profile: AccountProfile | null
  try {
    profile = await browserHost().withBrowser(id, (ctx) => getAdapter(account.platform).checkLogin(ctx))
  } catch (error) {
    if (isNetworkError(error)) throw new Error('网络错误，暂时无法确认登录状态')
    throw error
  }
  browserHost().clearVerify(id)
  Object.assign(account, profile ?? {}, { status: profile ? 'active' : 'expired', checkedAt: Date.now() })
  getStore().save()
  return account
}

export async function openAccount(id: string) {
  const account = findAccount(id)
  await browserHost().openManual(id, getAdapter(account.platform).homeUrl)
}

export async function removeAccount(id: string) {
  await browserHost().closeAccount(id)
  const store = getStore()
  store.data.accounts = store.data.accounts.filter((item) => item.id !== id)
  delete store.data.lastSettings[id]
  delete store.data.useLast[id]
  delete store.data.collections[id]
  store.save()
  await removeProfile(id)
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
    const items = await browserHost().withBrowser(id, async (ctx) => {
      await confirmSession(account, ctx)
      return adapter.listCollections!(ctx)
    })
    store.data.collections[id] = { items, fetchedAt: Date.now() }
    store.save()
  }
  const kw = keyword.trim().toLowerCase()
  const items = store.data.collections[id].items
  return kw ? items.filter((item) => item.name.toLowerCase().includes(kw)) : items
}
