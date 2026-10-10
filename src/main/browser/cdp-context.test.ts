import { describe, expect, it } from 'vitest'
import { createPageContext, type CdpClient, type PageHandle } from './cdp-context'

function fakeTransport() {
  const cdpListeners = new Map<string, Set<(params: any) => void>>()
  const pageListeners = new Map<string, Set<() => void>>()
  const cdp: CdpClient & { emit(event: string, params: any): void; count(event: string): number } = {
    async send<T = any>(method: string): Promise<T> {
      if (method === 'Network.getResponseBody') return { body: JSON.stringify({ ok: 1 }), base64Encoded: false } as T
      return {} as T
    },
    on(event, handler) {
      const set = cdpListeners.get(event) ?? new Set()
      set.add(handler)
      cdpListeners.set(event, set)
    },
    off(event, handler) {
      cdpListeners.get(event)?.delete(handler)
    },
    async detach() {},
    emit(event, params) {
      for (const handler of cdpListeners.get(event) ?? []) handler(params)
    },
    count: (event) => cdpListeners.get(event)?.size ?? 0,
  }
  const page: PageHandle & { emit(event: string): void; listenerCount(event: string): number } = {
    url: () => 'http://127.0.0.1/form',
    async goto() {},
    on(event, handler) {
      const set = pageListeners.get(event) ?? new Set()
      set.add(handler)
      pageListeners.set(event, set)
    },
    off(event, handler) {
      pageListeners.get(event)?.delete(handler)
    },
    emit(event) {
      for (const handler of pageListeners.get(event) ?? []) handler()
    },
    listenerCount: (event) => pageListeners.get(event)?.size ?? 0,
  }
  return { cdp, page }
}

describe('响应监听', () => {
  it('成功、超时、动作异常和页面关闭后都释放监听', async () => {
    const { cdp, page } = fakeTransport()
    const ctx = await createPageContext(page, cdp, { enabled: false })

    const ok = ctx.captureResponse('/api/echo', async () => {
      cdp.emit('Network.responseReceived', { requestId: '1', response: { url: 'https://example.test/api/echo' } })
      cdp.emit('Network.loadingFinished', { requestId: '1' })
    })
    await expect(ok).resolves.toEqual({ ok: 1 })

    await expect(ctx.captureResponse('/missing', async () => undefined, 20)).rejects.toThrow('等待接口响应超时')
    await expect(ctx.captureResponse('/api', async () => {
      throw new Error('动作失败')
    })).rejects.toThrow('动作失败')
    await expect(ctx.captureResponse('/api', async () => page.emit('close'))).rejects.toThrow('页面已关闭')

    expect(cdp.count('Network.responseReceived')).toBe(0)
    expect(cdp.count('Network.loadingFinished')).toBe(0)
    expect(page.listenerCount('close')).toBe(0)
  })
})
