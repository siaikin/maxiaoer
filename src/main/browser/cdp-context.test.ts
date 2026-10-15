import { describe, expect, it } from 'vitest'
import { createPageContext, type CdpClient, type PageHandle } from './cdp-context'

function fakeTransport(response = { body: JSON.stringify({ ok: 1 }), base64Encoded: false }) {
  const cdpListeners = new Map<string, Set<(params: any) => void>>()
  const pageListeners = new Map<string, Set<() => void>>()
  const cdp: CdpClient & { emit(event: string, params: any): void; count(event: string): number } = {
    async send<T = any>(method: string): Promise<T> {
      if (method === 'Network.getResponseBody') return response as T
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
  it('忽略同地址的跨域预检，等待实际提交的响应', async () => {
    const { cdp, page } = fakeTransport()
    const ctx = await createPageContext(page, cdp, { enabled: false })
    let parsed = 0
    const result = await ctx.captureResponse('/api/create', async () => {
      cdp.emit('Network.responseReceived', { requestId: 'preflight', type: 'Preflight', response: { url: 'https://example.test/api/create' } })
      cdp.emit('Network.loadingFinished', { requestId: 'preflight' })
      await Promise.resolve()
      expect(parsed).toBe(0)
      expect(cdp.count('Network.responseReceived')).toBe(1)
      cdp.emit('Network.responseReceived', { requestId: 'post', type: 'Fetch', response: { url: 'https://example.test/api/create' } })
      cdp.emit('Network.loadingFinished', { requestId: 'post' })
    }, undefined, (body) => {
      parsed++
      return JSON.parse(body)
    })
    expect(result).toEqual({ ok: 1 })
    expect(parsed).toBe(1)
  })

  it.each([false, true])('默认解析 JSON 响应（base64Encoded=%s）', async (base64Encoded) => {
    const raw = '{ "ok": 1, "message": "成功" }'
    const { cdp, page } = fakeTransport({ body: base64Encoded ? Buffer.from(raw).toString('base64') : raw, base64Encoded })
    const ctx = await createPageContext(page, cdp, { enabled: false })
    await expect(ctx.captureResponse('/api/echo', async () => {
      cdp.emit('Network.responseReceived', { requestId: '1', response: { url: 'https://example.test/api/echo' } })
      cdp.emit('Network.loadingFinished', { requestId: '1' })
    })).resolves.toEqual({ ok: 1, message: '成功' })
  })

  it.each([false, true])('自定义解析器收到完整原文，保留长数字 id（base64Encoded=%s）', async (base64Encoded) => {
    const raw = '{\n  "code": 0, "data": { "dyn_id": 1234567890123456789 }, "message": "成功"\n}'
    const { cdp, page } = fakeTransport({ body: base64Encoded ? Buffer.from(raw).toString('base64') : raw, base64Encoded })
    const ctx = await createPageContext(page, cdp, { enabled: false })
    let received: string | undefined
    const result = await ctx.captureResponse('/api/create', async () => {
      cdp.emit('Network.responseReceived', { requestId: '1', response: { url: 'https://example.test/api/create' } })
      cdp.emit('Network.loadingFinished', { requestId: '1' })
    }, undefined, (body) => {
      received = body
      return { remoteId: body.match(/"dyn_id": (\d+)/)?.[1] }
    })
    expect(received).toBe(raw)
    expect(result).toEqual({ remoteId: '1234567890123456789' })
  })

  it('解析异常向调用方抛出并释放监听', async () => {
    const { cdp, page } = fakeTransport()
    const ctx = await createPageContext(page, cdp, { enabled: false })
    await expect(ctx.captureResponse('/api/echo', async () => {
      cdp.emit('Network.responseReceived', { requestId: '1', response: { url: 'https://example.test/api/echo' } })
      cdp.emit('Network.loadingFinished', { requestId: '1' })
    }, undefined, () => {
      throw new Error('响应格式不正确')
    })).rejects.toThrow('响应格式不正确')

    expect(cdp.count('Network.responseReceived')).toBe(0)
    expect(cdp.count('Network.loadingFinished')).toBe(0)
    expect(page.listenerCount('close')).toBe(0)
  })

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
