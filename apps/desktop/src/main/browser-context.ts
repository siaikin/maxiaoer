import { BrowserWindow } from 'electron'
import type { BrowserContext } from '@maxiaoer/core'

/** 每个账号一个独立的持久化分区，cookie 互不干扰，等价于蚁小二的“多账号环境隔离” */
export const partitionFor = (accountId: string) => `persist:account-${accountId}`

/**
 * 用 Electron BrowserWindow + CDP（webContents.debugger）实现适配器需要的浏览器操作。
 * show=true 时可以看到自动化过程，方便调试和处理验证码。
 */
export async function createBrowserContext(accountId: string, opts: { show?: boolean } = {}) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: opts.show ?? false,
    webPreferences: { partition: partitionFor(accountId), contextIsolation: true, sandbox: true },
  })
  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  const cdp = <T = any>(method: string, params?: object) => dbg.sendCommand(method, params) as Promise<T>

  const evaluate = async <T>(expression: string): Promise<T> => {
    const { result, exceptionDetails } = await cdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value as T
  }

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  const ctx: BrowserContext = {
    async goto(url) {
      await win.loadURL(url)
    },
    async waitFor(selector, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (await evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) return
        await sleep(300)
      }
      throw new Error(`等待元素超时：${selector}`)
    },
    async click(selector) {
      await ctx.waitFor(selector)
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    },
    async type(selector, text) {
      await ctx.waitFor(selector)
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
      // insertText 走真实输入事件，React/Vue 受控组件都能感知
      await cdp('Input.insertText', { text })
    },
    async setFiles(selector, files) {
      await ctx.waitFor(selector)
      const { root } = await cdp('DOM.getDocument', { depth: -1, pierce: true })
      const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector })
      await cdp('DOM.setFileInputFiles', { nodeId, files })
    },
    evaluate,
    currentUrl: () => win.webContents.getURL(),
    sleep,
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
