import { BrowserWindow } from 'electron'
import type { BrowserContext } from './platforms/types'

/** 每个账号一个独立的持久化分区，cookie 互不干扰 */
export const partitionFor = (accountId: string) => `persist:account-${accountId}`

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
} as const

/**
 * 用 BrowserWindow + CDP（webContents.debugger）实现 BrowserContext。
 * 交互尽量走 CDP 的真实输入事件，而不是 JS 里直接改 value / dispatchEvent，减少被风控识别。
 */
export async function createBrowserContext(accountId: string, opts: { show?: boolean } = {}) {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: opts.show ?? false,
    webPreferences: { partition: partitionFor(accountId), contextIsolation: true, sandbox: true },
  })
  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  const cdp = <T = any>(method: string, params?: object) => dbg.sendCommand(method, params) as Promise<T>
  await cdp('Network.enable')

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const q = (s: string) => JSON.stringify(s)

  const evaluate = async <T>(expression: string): Promise<T> => {
    const { result, exceptionDetails } = await cdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value as T
  }

  /** 找到第一个可见的匹配元素（可按文字过滤），滚到可视区并返回中心坐标 */
  const locate = (selector: string, text?: string) =>
    evaluate<{ x: number; y: number } | null>(`(() => {
      const els = [...document.querySelectorAll(${q(selector)})]
      const el = els.find((e) => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && (${q(text ?? '')} === '' || e.textContent.includes(${q(text ?? '')}))
      })
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)

  const ctx: BrowserContext = {
    async goto(url) {
      await win.loadURL(url).catch((e: Error) => {
        // 页面内重定向会让 loadURL 以 ERR_ABORTED 结束，不算失败
        if (!e.message.includes('ERR_ABORTED')) throw e
      })
    },
    currentUrl: () => win.webContents.getURL(),
    sleep,
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
    async click(selector, text) {
      const deadline = Date.now() + 15_000
      let pos = await locate(selector, text)
      while (!pos && Date.now() < deadline) {
        await sleep(300)
        pos = await locate(selector, text)
      }
      if (!pos) throw new Error(`找不到可点击的元素：${selector}${text ? `「${text}」` : ''}`)
      await sleep(120)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await cdp('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
      }
    },
    async type(selector, text) {
      await ctx.click(selector)
      await ctx.insertText(text)
    },
    async insertText(text) {
      // 换行用回车键，contenteditable 编辑器才会正确分段
      const lines = text.split('\n')
      for (const [i, line] of lines.entries()) {
        if (line) await cdp('Input.insertText', { text: line })
        if (i < lines.length - 1) await ctx.press('Enter')
      }
    },
    async press(name) {
      const k = KEYS[name]
      const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode }
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...('text' in k ? { text: k.text } : {}) })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    },
    async setFiles(selector, files, index = 0) {
      await ctx.waitFor(selector)
      const { root } = await cdp('DOM.getDocument', { depth: -1, pierce: true })
      const { nodeIds } = await cdp<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId: root.nodeId, selector })
      if (!nodeIds[index]) throw new Error(`找不到上传控件：${selector}`)
      await cdp('DOM.setFileInputFiles', { nodeId: nodeIds[index], files })
    },
    async captureResponse(urlPart, action, timeoutMs = 30_000) {
      const body = new Promise<any>((resolve, reject) => {
        const ids = new Set<string>()
        const timer = setTimeout(() => {
          dbg.off('message', onMessage)
          reject(new Error(`等待接口响应超时：${urlPart}`))
        }, timeoutMs)
        const onMessage = async (_: unknown, method: string, params: any) => {
          if (method === 'Network.responseReceived' && params.response.url.includes(urlPart)) ids.add(params.requestId)
          if (method === 'Network.loadingFinished' && ids.has(params.requestId)) {
            clearTimeout(timer)
            dbg.off('message', onMessage)
            try {
              const res = await cdp<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', { requestId: params.requestId })
              resolve(JSON.parse(res.base64Encoded ? Buffer.from(res.body, 'base64').toString() : res.body))
            } catch (e) {
              reject(e)
            }
          }
        }
        dbg.on('message', onMessage)
      })
      await action()
      return body
    },
  }

  return {
    ctx,
    win,
    dispose() {
      if (dbg.isAttached()) dbg.detach()
      if (!win.isDestroyed()) win.destroy()
    },
  }
}

/** 在一个账号的分区里执行一段自动化，结束后关闭窗口 */
export async function withBrowser<T>(accountId: string, fn: (ctx: BrowserContext) => Promise<T>, opts: { show?: boolean } = {}) {
  const browser = await createBrowserContext(accountId, opts)
  try {
    return await fn(browser.ctx)
  } finally {
    browser.dispose()
  }
}
