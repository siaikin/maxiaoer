import type { BrowserContext } from '../platforms/types'
import { ClickRejectedError, createHumanBehavior, sleep, type Rect } from '../anti-detection/human'

export interface PageHandle {
  url(): string
  goto(url: string, options?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>
  on(event: 'close', handler: () => void): void
  off(event: 'close', handler: () => void): void
}

export interface CdpClient {
  send<T = any>(method: string, params?: object): Promise<T>
  on(event: string, handler: (params: any) => void): void
  off(event: string, handler: (params: any) => void): void
  detach(): Promise<void>
}

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
} as const

const q = (value: string) => JSON.stringify(value)

interface Box extends Rect {
  disabled: boolean
}

export async function createPageContext(page: PageHandle, cdp: CdpClient, options: { enabled?: boolean } = {}): Promise<PageContext> {
  await cdp.send('Network.enable')
  const human = createHumanBehavior((method, params) => cdp.send(method, params), { enabled: options.enabled })

  const evaluate = async <T>(expression: string): Promise<T> => {
    const { result, exceptionDetails } = await cdp.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    )
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  const viewport = async (): Promise<Rect> => {
    const size = await evaluate<{ width: number; height: number }>('({ width: innerWidth, height: innerHeight })')
    return { left: 0, top: 0, right: size.width, bottom: size.height }
  }

  const locate = (selector: string, text?: string) =>
    evaluate<Box | null>(`(() => {
      const els = [...document.querySelectorAll(${q(selector)})]
      for (const el of els) {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (${q(text ?? '')} !== '' && !(el.textContent ?? '').includes(${q(text ?? '')})) continue
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
        const r = el.getBoundingClientRect()
        const left = Math.max(r.left, 0)
        const top = Math.max(r.top, 0)
        const right = Math.min(r.right, innerWidth)
        const bottom = Math.min(r.bottom, innerHeight)
        if (right - left < 1 || bottom - top < 1) continue
        const disabled = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none'
        if (disabled) continue
        return { left, top, right, bottom, disabled }
      }
      return null
    })()`)

  const stillClickable = (selector: string, text: string | undefined, point: { x: number; y: number }) =>
    evaluate<boolean>(`(() => {
      const el = [...document.querySelectorAll(${q(selector)})].find((item) => ${q(text ?? '')} === '' || (item.textContent ?? '').includes(${q(text ?? '')}))
      if (!el) return false
      const style = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const point = { x: ${point.x}, y: ${point.y} }
      if (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom) return false
      if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none' || style.visibility === 'hidden') return false
      const top = document.elementFromPoint(point.x, point.y)
      return !!top && (top === el || el.contains(top))
    })()`)

  const click = async (selector: string, text?: string) => {
    const deadline = Date.now() + 15_000
    let rejected: Error | undefined
    while (Date.now() < deadline) {
      const box = await locate(selector, text)
      if (!box) {
        await sleep(300)
        continue
      }
      const point = human.point(box)
      try {
        await human.click(point, await viewport(), () => stillClickable(selector, text, point))
        return
      } catch (error) {
        if (!(error instanceof ClickRejectedError)) throw error
        rejected = error
        await sleep(300)
      }
    }
    throw rejected ?? new Error(`找不到可点击的元素：${selector}${text ? `「${text}」` : ''}`)
  }

  const findInShadow = async (host: string, text: string) => {
    type Node = { nodeId: number; nodeType: number; nodeValue: string; children?: Node[]; shadowRoots?: Node[] }
    const { root } = await cdp.send<{ root: Node }>('DOM.getDocument', { depth: -1, pierce: true })
    const { nodeId: hostId } = await cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: root.nodeId, selector: host })
    if (!hostId) return null
    const walk = (node: Node, inside: boolean): number | null => {
      const here = inside || node.nodeId === hostId
      const kids = [...(node.shadowRoots ?? []), ...(node.children ?? [])]
      if (here && node.nodeType === 1 && kids.some((child) => child.nodeType === 3 && child.nodeValue.trim() === text)) return node.nodeId
      for (const child of kids) {
        const hit = walk(child, here)
        if (hit) return hit
      }
      return null
    }
    return walk(root, false)
  }

  const boxOf = async (nodeId: number): Promise<Rect | null> => {
    try {
      const { model } = await cdp.send<{ model: { content: number[] } }>('DOM.getBoxModel', { nodeId })
      const [x1, y1, , , x3, y3] = model.content
      const rect = { left: Math.min(x1, x3), top: Math.min(y1, y3), right: Math.max(x1, x3), bottom: Math.max(y1, y3) }
      if (rect.right - rect.left < 1 || rect.bottom - rect.top < 1) return null
      return rect
    } catch {
      return null
    }
  }

  const setWindow = async (state: 'normal' | 'minimized') => {
    const { windowId } = await cdp.send<{ windowId: number }>('Browser.getWindowForTarget')
    const bounds = state === 'minimized' ? { windowState: 'minimized' } : { windowState: 'normal', width: 1280, height: 900 }
    await cdp.send('Browser.setWindowBounds', { windowId, bounds })
  }

  const ctx: BrowserContext = {
    async goto(url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((error: Error) => {
        if (!error.message.includes('ERR_ABORTED')) throw error
      })
    },
    currentUrl: () => page.url(),
    sleep,
    pause: (minMs) => human.pause(minMs),
    evaluate,
    exists: (selector) => evaluate<boolean>(`!!document.querySelector(${q(selector)})`),
    async waitFor(selector, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (await ctx.exists(selector)) return
        await sleep(300)
      }
      throw new Error(`等待元素超时：${selector}`)
    },
    async waitForUrl(test, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (test(ctx.currentUrl())) return
        await sleep(300)
      }
      throw new Error(`等待页面跳转超时，当前：${ctx.currentUrl()}`)
    },
    click,
    reveal: () => setWindow('normal'),
    async hover(selector) {
      await ctx.waitFor(selector)
      const box = await locate(selector)
      if (!box) throw new Error(`找不到元素：${selector}`)
      await human.move(human.point(box), await viewport())
      await sleep(300)
    },
    async clickInShadow(host, text) {
      const deadline = Date.now() + 15_000
      let rejected: Error | undefined
      while (Date.now() < deadline) {
        const nodeId = await findInShadow(host, text)
        if (!nodeId) {
          await sleep(300)
          continue
        }
        await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => undefined)
        const box = await boxOf(nodeId)
        if (!box) {
          await sleep(300)
          continue
        }
        const point = human.point(box)
        try {
          await human.click(point, await viewport(), async () => {
            const again = await boxOf(nodeId)
            if (!again || point.x < again.left || point.x > again.right || point.y < again.top || point.y > again.bottom) return false
            return evaluate<boolean>(`(() => {
              const host = document.querySelector(${q(host)})
              if (!host || host.matches(':disabled') || host.getAttribute('aria-disabled') === 'true') return false
              const top = document.elementFromPoint(${point.x}, ${point.y})
              return !!top && (top === host || host.contains(top))
            })()`)
          })
          return
        } catch (error) {
          if (!(error instanceof ClickRejectedError)) throw error
          rejected = error
          await sleep(300)
        }
      }
      throw rejected ?? new Error(`找不到可点击的元素：${host}「${text}」`)
    },
    async type(selector, text) {
      await click(selector)
      await ctx.insertText(text)
    },
    insertText: (text) => human.type(text, () => ctx.press('Enter')),
    press: (name) => human.press(KEYS[name]),
    async scroll(selector, deltaY) {
      const deadline = Date.now() + 5_000
      let box = await locate(selector)
      while (!box && Date.now() < deadline) {
        await sleep(200)
        box = await locate(selector)
      }
      if (!box) throw new Error(`定位滚动超时：${selector}`)
      await human.scroll(human.point(box), { x: 0, y: deltaY }, await viewport())
    },
    async setFiles(selector, files, index = 0) {
      await ctx.waitFor(selector)
      const { root } = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: -1, pierce: true })
      const { nodeIds } = await cdp.send<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId: root.nodeId, selector })
      if (!nodeIds[index]) throw new Error(`找不到上传控件：${selector}`)
      await cdp.send('DOM.setFileInputFiles', { nodeId: nodeIds[index], files })
    },
    async captureResponse<T = unknown>(urlPart: string, action: () => Promise<void>, timeoutMs = 30_000): Promise<T> {
      const pending = new Set<string>()
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let onResponse: (params: { requestId: string; response?: { url?: string } }) => void = () => undefined
      let onFinished: (params: { requestId: string }) => void = () => undefined
      let onClose: () => void = () => undefined
      let rejectBody!: (error: unknown) => void
      const off = () => {
        clearTimeout(timer)
        cdp.off('Network.responseReceived', onResponse)
        cdp.off('Network.loadingFinished', onFinished)
        page.off('close', onClose)
      }
      const body = new Promise<unknown>((resolve, reject) => {
        rejectBody = reject
        const fail = (error: Error) => {
          if (settled) return
          settled = true
          off()
          reject(error)
        }
        timer = setTimeout(() => fail(new Error(`等待接口响应超时：${urlPart}`)), timeoutMs)
        onClose = () => fail(new Error('页面已关闭'))
        onResponse = (params) => {
          if (params.response?.url?.includes(urlPart)) pending.add(params.requestId)
        }
        onFinished = (params) => {
          if (settled || !pending.has(params.requestId)) return
          settled = true
          off()
          void cdp
            .send<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', { requestId: params.requestId })
            .then((response) => resolve(JSON.parse(response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body)))
            .catch(reject)
        }
        page.on('close', onClose)
        cdp.on('Network.responseReceived', onResponse)
        cdp.on('Network.loadingFinished', onFinished)
      })
      try {
        await action()
      } catch (error) {
        if (!settled) {
          settled = true
          off()
          rejectBody(error)
        }
        await body.catch(() => undefined)
        throw error
      }
      return body as Promise<T>
    },
  }

  return Object.assign(ctx, { setWindow })
}

export type PageContext = BrowserContext & { setWindow(state: 'normal' | 'minimized'): Promise<void> }
