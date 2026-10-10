import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPageContext, type CdpClient, type PageContext } from './cdp-context'
import { applyCookies, planCookieMigration, type RawCookie } from './cookies'
import { loadOrCreateIdentity, readIdentity, writeIdentity, type Identity } from './identity'
import { createQueue } from './queue'
import { sleep } from '../anti-detection/human'

export interface LaunchConfig {
  binary: string
  userDataDir: string
  seed: number
  locale: string
  timezone: string
  args: string[]
}

export interface CloakPage {
  url(): string
  goto(url: string, options?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>
  on(event: string, handler: (...args: any[]) => void): void
  off(event: string, handler: (...args: any[]) => void): void
  close(): Promise<void>
  isClosed(): boolean
  createCDPSession(): Promise<CdpClient>
}

interface CloakProcess {
  killed: boolean
  exitCode: number | null
  kill(signal?: NodeJS.Signals | number): void
}

export interface CloakBrowser {
  connected: boolean
  pages(): Promise<CloakPage[]>
  newPage(): Promise<CloakPage>
  close(): Promise<void>
  on(event: 'disconnected', handler: () => void): void
  process(): CloakProcess | null
}

export interface HostDeps {
  kernelBinary: string | (() => string)
  profileDir(accountId: string): string
  readCookies(accountId: string): Promise<RawCookie[]>
  isExistingAccount(accountId: string): boolean
  timezone(): string
  launch?(config: LaunchConfig): Promise<CloakBrowser>
}

export interface TabSession {
  ctx: PageContext
  page: CloakPage
  release(): Promise<void>
  whenClosed: Promise<void>
}

export function automationArgs(seed: number) {
  return [
    `--fingerprint=${seed}`,
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
  ]
}

function profileReady(dir: string) {
  return ['Default/Cookies', 'Default/Network/Cookies'].some((rel) => {
    const file = join(dir, rel)
    return existsSync(file) && statSync(file).size > 0
  })
}

async function defaultLaunch(config: LaunchConfig): Promise<CloakBrowser> {
  if (!existsSync(config.binary)) {
    throw new Error(`未找到指纹浏览器内核：${config.binary}。请先运行 pnpm browser:prepare。运行时不会下载，也不会改用本机 Chrome。`)
  }
  process.env.CLOAKBROWSER_BINARY_PATH = config.binary
  process.env.CLOAKBROWSER_AUTO_UPDATE = 'false'
  try {
    const { launchPersistentContext } = await import('cloakbrowser/puppeteer')
    return (await launchPersistentContext({
      headless: false,
      humanize: false,
      locale: config.locale,
      timezone: config.timezone,
      userDataDir: config.userDataDir,
      args: config.args,
    })) as unknown as CloakBrowser
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`指纹浏览器内核启动失败。运行时不会下载，也不会改用本机 Chrome。${message}`)
  }
}

interface Running {
  browser: CloakBrowser
  manual: Set<CloakPage>
  auto: Set<CloakPage>
  tracked: Set<CloakPage>
  dispose(): Promise<void>
}

export function createBrowserHost(deps: HostDeps) {
  const queue = createQueue(2)
  const sessions = new Map<string, Running>()
  const opening = new Map<string, Promise<Running>>()
  const closing = new Set<string>()
  const launch = deps.launch ?? defaultLaunch

  const binary = () => (typeof deps.kernelBinary === 'function' ? deps.kernelBinary() : deps.kernelBinary)

  const forget = (id: string) => sessions.delete(id)

  async function migrate(id: string, identity: Identity) {
    if (identity.cookiesMigrated) return []
    const dir = deps.profileDir(id)
    const migrationOpen = existsSync(join(dir, '.migration-open'))
    const exists = profileReady(dir)
    const raw = exists && !migrationOpen ? [] : await deps.readCookies(id)
    const plan = planCookieMigration({ migrated: false, profileExists: exists, migrationOpen, raw, nowSec: Date.now() / 1000 })
    if (plan.action !== 'import') {
      identity.cookiesMigrated = true
      writeIdentity(dir, identity)
      return []
    }
    if (plan.cookies.length === 0) {
      identity.cookiesMigrated = true
      identity.pendingVerify = deps.isExistingAccount(id)
      writeIdentity(dir, identity)
      rmSync(join(dir, '.migration-open'), { force: true })
      return []
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.migration-open'), '')
    return plan.cookies
  }

  async function start(id: string): Promise<Running> {
    if (closing.has(id)) throw new Error('账号已删除')
    const dir = deps.profileDir(id)
    const identity = loadOrCreateIdentity(dir, deps.timezone())
    const cookies = await migrate(id, identity)
    const browser = await launch({
      binary: binary(),
      userDataDir: dir,
      seed: identity.seed,
      locale: identity.locale,
      timezone: identity.timezone,
      args: automationArgs(identity.seed),
    })
    if (closing.has(id)) {
      await browser.close().catch(() => undefined)
      throw new Error('账号已删除')
    }
    if (cookies.length) {
      const page = (await browser.pages())[0] ?? (await browser.newPage())
      const cdp = await page.createCDPSession()
      try {
        await applyCookies(cookies, (method, params) => cdp.send(method, params))
      } finally {
        await cdp.detach().catch(() => undefined)
      }
      identity.cookiesMigrated = true
      identity.pendingVerify = true
      writeIdentity(dir, identity)
      rmSync(join(dir, '.migration-open'), { force: true })
    }
    const running: Running = { browser, manual: new Set(), auto: new Set(), tracked: new Set(), dispose: async () => undefined }
    let disposed = false
    browser.on('disconnected', () => {
      if (sessions.get(id)?.browser === browser) forget(id)
    })
    running.dispose = async () => {
      if (disposed) return
      disposed = true
      forget(id)
      const proc = browser.process()
      await Promise.race([browser.close().catch(() => undefined), sleep(5_000)])
      if (proc && proc.exitCode == null && !proc.killed) proc.kill('SIGKILL')
    }
    sessions.set(id, running)
    return running
  }

  async function ensure(id: string) {
    const current = sessions.get(id)
    if (current?.browser.connected) return current
    const pending = opening.get(id)
    if (pending) return pending
    const promise = start(id).finally(() => opening.delete(id))
    opening.set(id, promise)
    return promise
  }

  async function takePage(running: Running) {
    const pages = await running.browser.pages()
    const blank = pages.find((page) => !running.tracked.has(page) && !page.isClosed() && (page.url() === 'about:blank' || page.url() === ''))
    const page = blank ?? (await running.browser.newPage())
    running.tracked.add(page)
    page.on('close', () => {
      running.tracked.delete(page)
      running.manual.delete(page)
      running.auto.delete(page)
      if (running.manual.size + running.auto.size === 0) void running.dispose()
    })
    return page
  }

  async function openTab(id: string, opts: { role: 'auto' | 'manual'; show?: boolean; onNavigate?: () => void }): Promise<TabSession> {
    const running = await ensure(id)
    const page = await takePage(running)
    const cdp = await page.createCDPSession()
    const ctx = await createPageContext(page, cdp)
    if (opts.role === 'manual') running.manual.add(page)
    else running.auto.add(page)
    if (opts.role === 'manual' || opts.show) await ctx.setWindow('normal')
    else if (running.manual.size === 0) await ctx.setWindow('minimized')
    if (opts.onNavigate) {
      page.on('framenavigated', (frame: { parentFrame?: () => unknown }) => {
        if (!frame.parentFrame?.()) opts.onNavigate?.()
      })
    }
    const whenClosed = new Promise<void>((resolve) => page.on('close', () => resolve()))
    let released = false
    return {
      ctx,
      page,
      whenClosed,
      async release() {
        if (released || page.isClosed()) return
        released = true
        running.auto.delete(page)
        running.manual.delete(page)
        await cdp.detach().catch(() => undefined)
        await page.close().catch(() => undefined)
      },
    }
  }

  return {
    profileDir: deps.profileDir,
    identity(id: string): Identity | null {
      return readIdentity(deps.profileDir(id))
    },
    needsVerify(id: string) {
      return readIdentity(deps.profileDir(id))?.pendingVerify ?? false
    },
    clearVerify(id: string) {
      const identity = readIdentity(deps.profileDir(id))
      if (!identity?.pendingVerify) return
      identity.pendingVerify = false
      writeIdentity(deps.profileDir(id), identity)
    },
    restoreVerify(id: string) {
      const identity = readIdentity(deps.profileDir(id))
      if (!identity) return
      identity.pendingVerify = true
      writeIdentity(deps.profileDir(id), identity)
    },
    openTab,
    async openManual(id: string, url: string, opts: { onNavigate?: () => void } = {}) {
      const running = await ensure(id)
      const existing = [...running.manual].find((page) => !page.isClosed())
      if (existing) {
        if (opts.onNavigate) {
          existing.on('framenavigated', (frame: { parentFrame?: () => unknown }) => {
            if (!frame.parentFrame?.()) opts.onNavigate?.()
          })
        }
        const cdp = await existing.createCDPSession()
        const ctx = await createPageContext(existing, cdp)
        await ctx.setWindow('normal')
        await ctx.goto(url)
        await cdp.detach().catch(() => undefined)
        return { whenClosed: new Promise<void>((resolve) => existing.on('close', () => resolve())) }
      }
      const tab = await openTab(id, { role: 'manual', show: true, onNavigate: opts.onNavigate })
      await tab.ctx.goto(url)
      return { whenClosed: tab.whenClosed }
    },
    withBrowser<T>(
      id: string,
      fn: (ctx: PageContext) => Promise<T>,
      opts: { show?: boolean; keepOpen?: boolean; key?: string; onWait?: (message: string) => void; onStart?: () => void } = {},
    ) {
      return queue.run(opts.key ?? randomUUID(), id, async () => {
        if (closing.has(id)) throw new Error('账号已删除')
        opts.onStart?.()
        const tab = await openTab(id, { role: 'auto', show: opts.show })
        try {
          return await fn(tab.ctx)
        } finally {
          if (opts.keepOpen) await tab.ctx.reveal().catch(() => undefined)
          else await tab.release().catch(() => undefined)
        }
      }, opts.onWait)
    },
    async clearCookies(id: string) {
      const running = sessions.get(id)
      const page = running && [...running.manual, ...running.auto].find((item) => !item.isClosed())
      if (!page) return
      const cdp = await page.createCDPSession()
      try {
        await cdp.send('Network.clearBrowserCookies')
      } finally {
        await cdp.detach().catch(() => undefined)
      }
    },
    async closeAccount(id: string) {
      closing.add(id)
      try {
        queue.cancelAccount(id)
        await sessions.get(id)?.dispose()
        await Promise.race([queue.settled(id), sleep(5_000)])
      } finally {
        closing.delete(id)
      }
    },
    hasOpen() {
      return [...sessions.values()].some((item) => item.browser.connected)
    },
    async shutdown() {
      await Promise.all([...sessions.keys()].map((id) => this.closeAccount(id)))
    },
  }
}
