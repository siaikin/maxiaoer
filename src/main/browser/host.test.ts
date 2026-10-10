import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CdpClient } from './cdp-context'
import { createBrowserHost, type CloakBrowser, type CloakPage, type LaunchConfig } from './session'

function fakeCdp(imported: unknown[]): CdpClient {
  return {
    async send<T = any>(method: string, params?: object): Promise<T> {
      if (method === 'Network.setCookie') imported.push(params)
      if (method === 'Browser.getWindowForTarget') return { windowId: 1, bounds: { windowState: 'normal' } } as T
      return {} as T
    },
    on() {},
    off() {},
    async detach() {},
  }
}

function fakeBrowser(imported: unknown[]): CloakBrowser & { closeCount: number } {
  const proc = { killed: false, exitCode: null as number | null, kill() { this.killed = true; this.exitCode = -9 } }
  const disconnected = new Set<() => void>()
  const pages: CloakPage[] = []
  let connected = true
  let closeCount = 0
  const makePage = (): CloakPage => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    let location = 'about:blank'
    let closed = false
    const page: CloakPage = {
      url: () => location,
      async goto(url) {
        location = url
      },
      on(event, handler) {
        const set = listeners.get(event) ?? new Set()
        set.add(handler)
        listeners.set(event, set)
      },
      off(event, handler) {
        listeners.get(event)?.delete(handler)
      },
      isClosed: () => closed,
      async close() {
        if (closed) return
        closed = true
        for (const handler of listeners.get('close') ?? []) handler()
      },
      async createCDPSession() {
        return fakeCdp(imported)
      },
    }
    pages.push(page)
    return page
  }
  makePage()
  const browser = {
    get connected() {
      return connected
    },
    pages: async () => pages.filter((page) => !page.isClosed()),
    newPage: async () => makePage(),
    on(event: 'disconnected', handler: () => void) {
      if (event === 'disconnected') disconnected.add(handler)
    },
    process: () => proc,
    async close() {
      closeCount++
      connected = false
      proc.exitCode = 0
      for (const handler of disconnected) handler()
    },
    get closeCount() {
      return closeCount
    },
  }
  return browser
}

describe('账号会话', () => {
  const logs: string[] = []
  afterEach(() => vi.restoreAllMocks())

  function hostFor(root: string, readCookies: () => Promise<any[]>, launches: LaunchConfig[], imported: unknown[]) {
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => logs.push(args.map(String).join(' ')))
    }
    return createBrowserHost({
      kernelBinary: '/kernel/not-launched',
      profileDir: (id) => join(root, id),
      readCookies: async () => {
        const cookies = await readCookies()
        return cookies
      },
      isExistingAccount: () => true,
      timezone: () => 'Asia/Shanghai',
      launch: async (config) => {
        launches.push(config)
        return fakeBrowser(imported)
      },
    })
  }

  it('迁移只执行一次，重启后身份不变，且不输出 Cookie 内容', async () => {
    logs.length = 0
    const root = mkdtempSync(join(tmpdir(), 'mxe-session-'))
    const launches: LaunchConfig[] = []
    const imported: unknown[] = []
    let reads = 0
    const host = hostFor(
      root,
      async () => {
        reads++
        return [{ name: 'sid', value: 'secret-value', domain: '.example.com', path: '/', secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 3600, sameSite: 'lax' as const }]
      },
      launches,
      imported,
    )
    await host.withBrowser('alpha', async () => 'first')
    await host.withBrowser('alpha', async () => 'second')
    expect(reads).toBe(1)
    expect(imported).toHaveLength(1)
    expect(launches).toHaveLength(2)
    expect(launches[1].seed).toBe(launches[0].seed)
    expect(launches[1].locale).toBe('zh-CN')
    expect(launches[1].timezone).toBe('Asia/Shanghai')
    expect(launches[1].userDataDir).toBe(launches[0].userDataDir)
    expect(logs.join('\n')).not.toContain('secret-value')

    const other: LaunchConfig[] = []
    await host.withBrowser('beta', async () => 'other')
    const beta = launches.at(-1)!
    expect(beta.userDataDir).not.toBe(launches[0].userDataDir)
    expect(beta.seed).not.toBe(launches[0].seed)
    expect(other).toHaveLength(0)
  })

  it('同账号自动化串行，退出时关闭浏览器', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mxe-queue-'))
    const launches: LaunchConfig[] = []
    const host = hostFor(root, async () => [], launches, [])
    let inside = 0
    let max = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = host.withBrowser('alpha', async () => {
      inside++
      max = Math.max(max, inside)
      await gate
      inside--
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = host.withBrowser('alpha', async () => {
      inside++
      max = Math.max(max, inside)
      inside--
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(max).toBe(1)
    release()
    await Promise.all([first, second])
    expect(max).toBe(1)

    await host.openTab('manual', { role: 'manual', show: true })
    expect(host.hasOpen()).toBe(true)
    await host.shutdown()
    expect(host.hasOpen()).toBe(false)
  })
})
