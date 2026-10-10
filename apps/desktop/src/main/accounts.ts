import { randomUUID } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { BrowserWindow, session } from 'electron'
import type { Account, ApiContext, PlatformId } from '@maxiaoer/core'
import { getAdapter } from '@maxiaoer/adapters'
import { createBrowserContext, partitionFor } from './browser-context'
import { getStore } from './store'

export function apiContextFor(account: Account): ApiContext {
  if (!account.credentialRef) throw new Error('该账号没有凭据')
  return {
    credentials: getStore().getSecret(account.credentialRef),
    fetch,
    readFile: (p) => openAsBlob(p),
  }
}

/**
 * 浏览器模式添加账号：打开一个独立分区的登录窗口，用户扫码 / 输入密码，
 * 每次页面跳转后在同一分区里用隐藏窗口检测登录态，成功即关闭并保存。
 */
export async function loginWithBrowser(platform: PlatformId): Promise<Account | null> {
  const adapter = getAdapter(platform)
  if (adapter.mode !== 'browser') throw new Error(`${adapter.name} 使用 API 凭据添加`)
  const id = randomUUID()
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: `登录${adapter.name}`,
    webPreferences: { partition: partitionFor(id) },
  })
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
        if (profile) {
          const store = getStore()
          const account: Account = {
            id,
            platform,
            nickname: profile.nickname,
            avatar: profile.avatar,
            status: 'active',
            createdAt: Date.now(),
            checkedAt: Date.now(),
          }
          store.data.accounts.push(account)
          store.save()
          finish(account)
        }
      } catch {
        // 页面还在登录流程中，忽略
      } finally {
        probe.dispose()
        checking = false
      }
    }
    // 扫码登录不一定触发导航，所以导航 + 定时双保险
    win.webContents.on('did-navigate', () => void check())
    const timer = setInterval(() => void check(), 5000)
    win.on('closed', () => finish(null))
  })
}

export async function addWithCredentials(platform: PlatformId, credentials: Record<string, string>) {
  const adapter = getAdapter(platform)
  if (adapter.mode !== 'api') throw new Error(`${adapter.name} 使用扫码 / 网页登录添加`)
  const store = getStore()
  const account: Account = {
    id: randomUUID(),
    platform,
    nickname: adapter.name,
    status: 'unknown',
    credentialRef: randomUUID(),
    createdAt: Date.now(),
  }
  store.setSecret(account.credentialRef!, credentials)
  const profile = await adapter.checkLogin(apiContextFor(account))
  if (!profile) throw new Error('凭据无效，请检查后重试')
  Object.assign(account, { nickname: profile.nickname, avatar: profile.avatar, status: 'active', checkedAt: Date.now() })
  store.data.accounts.push(account)
  store.save()
  return account
}

export async function checkAccount(id: string): Promise<Account> {
  const store = getStore()
  const account = store.data.accounts.find((a) => a.id === id)
  if (!account) throw new Error('账号不存在')
  const adapter = getAdapter(account.platform)
  let profile
  if (adapter.mode === 'api') {
    profile = await adapter.checkLogin(apiContextFor(account))
  } else {
    const probe = await createBrowserContext(id)
    try {
      profile = await adapter.checkLogin(probe.ctx)
    } finally {
      probe.dispose()
    }
  }
  Object.assign(account, profile ?? {}, { status: profile ? 'active' : 'expired', checkedAt: Date.now() })
  store.save()
  return account
}

export async function openAccount(id: string) {
  const account = getStore().data.accounts.find((a) => a.id === id)
  if (!account) throw new Error('账号不存在')
  const adapter = getAdapter(account.platform)
  if (adapter.mode !== 'browser') return
  const win = new BrowserWindow({ width: 1280, height: 860, webPreferences: { partition: partitionFor(id) } })
  await win.loadURL(adapter.loginUrl)
}

export async function removeAccount(id: string) {
  const store = getStore()
  const account = store.data.accounts.find((a) => a.id === id)
  if (!account) return
  store.data.accounts = store.data.accounts.filter((a) => a.id !== id)
  if (account.credentialRef) delete store.data.secrets[account.credentialRef]
  store.save()
  await session.fromPartition(partitionFor(id)).clearStorageData()
}
