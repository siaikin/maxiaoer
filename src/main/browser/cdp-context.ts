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

/** 有内容时选中输入框里的全部文字并返回 true；随后按退格删除，编辑器框架能收到真实的删除事件 */
const selectContent = (selector: string) => `(() => {
  const el = document.querySelector('[data-mxe-click]') ?? document.querySelector(${q(selector)})
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    if (!el.value) return false
    el.focus()
    el.select()
    return true
  }
  const box = el.isContentEditable ? el : el.querySelector('[contenteditable="true"]') ?? el
  if (!box.innerText.trim()) return false
  box.focus()
  const range = document.createRange()
  range.selectNodeContents(box)
  const selection = getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  return true
})()`

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

  /** 找到第一个可见、可用的匹配元素，滚到可视区，并打上 data-mxe-click 标记供点击前复核 */
  const locate = (selector: string, text?: string) =>
    evaluate<Box | null>(`(() => {
      for (const old of document.querySelectorAll('[data-mxe-click]')) old.removeAttribute('data-mxe-click')
      const els = [...document.querySelectorAll(${q(selector)})]
      for (const found of els) {
        if (${q(text ?? '')} !== '' && !(found.textContent ?? '').includes(${q(text ?? '')})) continue
        // 按钮里的文字常设 pointer-events: none（如微博「发送」），鼠标事件落在外层按钮上，改为点它
        const el = getComputedStyle(found).pointerEvents === 'none' ? found.closest('button, a, [role="button"], label') ?? found : found
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
        const r = el.getBoundingClientRect()
        const left = Math.max(r.left, 0)
        const top = Math.max(r.top, 0)
        const right = Math.min(r.right, innerWidth)
        const bottom = Math.min(r.bottom, innerHeight)
        if (right - left < 1 || bottom - top < 1) continue
        const disabled = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none'
        if (disabled) continue
        el.setAttribute('data-mxe-click', '1')
        return { left, top, right, bottom, disabled }
      }
      return null
    })()`)

  // 复核的是 locate 选中的那个元素，而不是第一个匹配项：前面可能有隐藏的同名按钮（如未打开的弹窗）
  const stillClickable = (point: { x: number; y: number }) =>
    evaluate<boolean>(`(() => {
      const el = document.querySelector('[data-mxe-click]')
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
        await human.click(point, await viewport(), () => stillClickable(point))
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

  const setWindow = async (state: 'normal' | 'offscreen') => {
    const { windowId } = await cdp.send<{ windowId: number }>('Browser.getWindowForTarget')
    // 最小化后页面变成 hidden，不再出帧：动画停住、弹窗遮罩不撤，点击会一直被拒。
    // 后台任务改为把窗口移到屏幕外，页面仍按可见渲染。窗口状态和位置不能在一次调用里同时改
    const { bounds: current } = await cdp.send<{ bounds: { windowState: string } }>('Browser.getWindowBounds', { windowId })
    if (current.windowState !== 'normal') await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    const bounds = state === 'offscreen' ? { left: -20000, top: -20000, width: 1280, height: 900 } : { left: 80, top: 60, width: 1280, height: 900 }
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
    async reveal() {
      await setWindow('normal')
      // 从屏幕外移回来后再切到前台，等用户扫码
      await cdp.send('Page.bringToFront').catch(() => undefined)
    },
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
      // 平台会恢复上次没发出去的草稿，先清空再输入，不在旧内容后面追加
      for (let i = 0; i < 3 && (await evaluate<boolean>(selectContent(selector))); i++) {
        await ctx.press('Backspace')
        await sleep(200)
      }
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

export type PageContext = BrowserContext & { setWindow(state: 'normal' | 'offscreen'): Promise<void> }
