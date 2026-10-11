import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertKernel } from './kernel'
import { createBrowserHost, type TabSession } from './session'

const kernelRoot = fileURLToPath(new URL('../../../resources/cloakbrowser/bundled/', import.meta.url))
const binary = (() => {
  try {
    return assertKernel(kernelRoot)
  } catch {
    return null
  }
})()

function page(title: string, body: string) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{margin:48px;font:16px sans-serif}</style>${body}`
}

const pages: Record<string, string> = {
  '/form': page('form', '<input id="name">'),
  '/rich': page('rich', '<div id="editor" contenteditable="true" style="min-height:80px;border:1px solid #ccc"></div>'),
  '/shadow': page(
    'shadow',
    `<div id="host"></div><script>
      const root = document.getElementById('host').attachShadow({ mode: 'closed' })
      const button = document.createElement('button')
      button.textContent = '发布'
      button.onclick = () => { document.body.dataset.hit = '1' }
      root.append(button)
    </script>`,
  ),
  '/scroll': page('scroll', '<div id="box" style="height:100px;overflow:auto;border:1px solid #ccc"><div style="height:900px">内容</div></div>'),
  '/cover': page('cover', '<button id="go" onclick="document.body.dataset.hit=\'1\'">点我</button><div style="position:fixed;inset:0"></div>'),
  '/move': page(
    'move',
    `<button id="go" style="position:absolute;left:-240px;top:80px" onclick="document.body.dataset.hit='1'">点我</button>
     <script>setTimeout(() => { document.getElementById('go').style.left = '80px' }, 400)</script>`,
  ),
  '/dup': page('dup', '<div style="display:none"><button class="go">发表</button></div><button class="go" onclick="document.body.dataset.hit=\'1\'">发表</button>'),
  '/inner': page('inner', '<button id="send" onclick="document.body.dataset.hit=\'1\'"><span class="label" style="pointer-events:none">发送</span></button>'),
  '/upload': page('upload', '<input id="file" type="file">'),
  '/fetch': page('fetch', `<button id="go">请求</button><script>document.getElementById('go').onclick = () => fetch('/api/echo')</script>`),
  '/fp': page('fp', '<button id="pop" onclick="window.open(location.href)">弹窗</button>'),
}

// 会在屏幕上打开真实的浏览器窗口，默认跳过；需要时用 MXE_LIVE=1 pnpm test
describe.skipIf(!binary || process.env.MXE_LIVE !== '1')('本地指纹浏览器', () => {
  let server: Server
  let origin = ''
  const root = mkdtempSync(join(tmpdir(), 'mxe-live-'))
  const host = createBrowserHost({
    kernelBinary: binary!,
    profileDir: (id) => join(root, id),
    readCookies: async () => [],
    isExistingAccount: () => false,
    timezone: () => 'Asia/Shanghai',
  })

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/api/echo') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, n: 7 }))
        return
      }
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(pages[path] ?? page('empty', ''))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务没有端口')
    origin = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await host.shutdown()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function tab(id: string, role: 'auto' | 'manual' = 'auto', show = false) {
    return host.openTab(id, { role, show: role === 'manual' || show })
  }

  it('填写普通表单、富文本，并点击 closed shadow', async () => {
    const form = await tab('interact', 'manual', true)
    await form.ctx.goto(`${origin}/form`)
    await form.ctx.type('#name', '你好👍')
    expect(await form.ctx.evaluate<string>(`document.querySelector('#name').value`)).toBe('你好👍')
    await form.ctx.goto(`${origin}/rich`)
    await form.ctx.type('#editor', '第一行\n第二行')
    expect(await form.ctx.evaluate<string>(`document.querySelector('#editor').innerText`)).toContain('第一行')
    expect(await form.ctx.evaluate<string>(`document.querySelector('#editor').innerText`)).toContain('第二行')
    // 再次输入先清空，不追加
    await form.ctx.type('#editor', '新内容')
    expect((await form.ctx.evaluate<string>(`document.querySelector('#editor').innerText`)).trim()).toBe('新内容')
    await form.ctx.goto(`${origin}/form`)
    await form.ctx.evaluate(`document.querySelector('#name').value = '旧草稿'`)
    await form.ctx.type('#name', '新标题')
    expect(await form.ctx.evaluate<string>(`document.querySelector('#name').value`)).toBe('新标题')
    await form.ctx.goto(`${origin}/shadow`)
    await form.ctx.clickInShadow('#host', '发布')
    expect(await form.ctx.evaluate<string>(`document.body.dataset.hit`)).toBe('1')
    await form.release()
  }, 60_000)

  it('滚动嵌套容器，避开遮挡，并跟上移动后的按钮，跳过隐藏的同名按钮', async () => {
    const view = await tab('layout', 'manual', true)
    await view.ctx.goto(`${origin}/scroll`)
    const before = await view.ctx.evaluate<number>(`document.querySelector('#box').scrollTop`)
    await view.ctx.scroll('#box', 360)
    expect(await view.ctx.evaluate<number>(`document.querySelector('#box').scrollTop`)).toBeGreaterThan(before)
    await view.ctx.goto(`${origin}/move`)
    await view.ctx.click('#go')
    expect(await view.ctx.evaluate<string>(`document.body.dataset.hit`)).toBe('1')
    await view.ctx.goto(`${origin}/dup`)
    await view.ctx.click('.go', '发表')
    expect(await view.ctx.evaluate<string>(`document.body.dataset.hit`)).toBe('1')
    await view.ctx.goto(`${origin}/cover`)
    await expect(view.ctx.click('#go')).rejects.toThrow(/遮挡|找不到可点击/)
    expect(await view.ctx.evaluate<string>(`document.body.dataset.hit ?? ''`)).toBe('')
    await view.release()
  }, 40_000)

  it('点击 pointer-events: none 的按钮文字时点外层按钮', async () => {
    const view = await tab('inner', 'auto', false)
    await view.ctx.goto(`${origin}/inner`)
    await view.ctx.click('span.label', '发送')
    expect(await view.ctx.evaluate<string>(`document.body.dataset.hit`)).toBe('1')
    await view.release()
  }, 30_000)

  it('上传文件并捕获接口响应', async () => {
    const work = await tab('files', 'manual', true)
    const file = join(root, 'picture.png')
    writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
    await work.ctx.goto(`${origin}/upload`)
    await work.ctx.setFiles('#file', [file])
    expect(await work.ctx.evaluate<number>(`document.querySelector('#file').files.length`)).toBe(1)
    await work.ctx.goto(`${origin}/fetch`)
    const body = await work.ctx.captureResponse<{ ok: boolean; n: number }>('/api/echo', () => work.ctx.click('#go'))
    expect(body).toEqual({ ok: true, n: 7 })
    await expect(work.ctx.captureResponse('/api/echo', async () => {
      throw new Error('动作失败')
    })).rejects.toThrow('动作失败')
    const closing = work.ctx.captureResponse('/api/echo', () => work.page.close())
    await expect(closing).rejects.toThrow('页面已关闭')
  }, 30_000)

  it('后台窗口在屏幕外照常渲染，能恢复到屏幕内', async () => {
    const auto = await tab('window', 'auto', false)
    await auto.ctx.goto(`${origin}/form`)
    const bounds = async (current: TabSession) => {
      const cdp = await current.page.createCDPSession()
      try {
        const { windowId } = await cdp.send<{ windowId: number }>('Browser.getWindowForTarget')
        const result = await cdp.send<{ bounds: { left: number; windowState: string } }>('Browser.getWindowBounds', { windowId })
        return result.bounds
      } finally {
        await cdp.detach().catch(() => undefined)
      }
    }
    expect((await bounds(auto)).left).toBeLessThan(0)
    // 最小化的页面是 hidden，不出帧；屏幕外的必须仍是 visible，动画帧照常回调
    expect(await auto.ctx.evaluate<string>('document.visibilityState')).toBe('visible')
    expect(await auto.ctx.evaluate<boolean>('new Promise((r) => { requestAnimationFrame(() => r(true)); setTimeout(() => r(false), 2000) })')).toBe(true)
    await auto.ctx.reveal()
    await expect.poll(async () => (await bounds(auto)).left, { timeout: 5_000 }).toBeGreaterThanOrEqual(0)
    await auto.release()
  }, 20_000)

  it('固定资料的指纹在重启、弹窗和新标签页之间保持一致，账号之间隔离', async () => {
    const read = (session: TabSession) =>
      session.ctx.evaluate<{ ua: string; language: string; timezone: string; canvas: string; vendor: string; renderer: string; brands: string; platform: string }>(`(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 220
        canvas.height = 40
        const g = canvas.getContext('2d')
        g.textBaseline = 'top'
        g.font = '16px sans-serif'
        g.fillStyle = '#f60'
        g.fillRect(0, 0, 80, 30)
        g.fillStyle = '#069'
        g.fillText('蚂小儿', 2, 2)
        const pixels = g.getImageData(0, 0, 220, 40).data
        let canvasHash = 0
        for (let i = 0; i < pixels.length; i++) canvasHash = (canvasHash * 33 + pixels[i]) >>> 0
        const gl = document.createElement('canvas').getContext('webgl')
        const ext = gl.getExtension('WEBGL_debug_renderer_info')
        const data = navigator.userAgentData
        return {
          ua: navigator.userAgent,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          canvas: String(canvasHash),
          vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
          renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
          brands: data ? data.brands.map((item) => item.brand + '/' + item.version).join(',') : '',
          platform: data ? data.platform : '',
        }
      })()`)

    const first = await tab('print-a', 'manual', true)
    await first.ctx.goto(`${origin}/fp`)
    await first.ctx.evaluate(`document.cookie = 'mxe=persisted; path=/; max-age=86400'; localStorage.setItem('who', 'a')`)
    const before = await read(first)
    expect(before.language.toLowerCase()).toContain('zh')
    expect(before.timezone).toBe('Asia/Shanghai')
    expect(before.ua).not.toMatch(/Headless|Electron/)
    expect(before.canvas).toMatch(/^\d+$/)
    expect(before.renderer.length).toBeGreaterThan(0)

    const popupPromise = new Promise<TabSession['page']>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('没有等到弹窗')), 8_000)
      const browser = (first.page as unknown as { browser(): { on(event: string, handler: (target: { type(): string; opener(): unknown; page(): Promise<TabSession['page']> }) => void): void } }).browser()
      browser.on('targetcreated', (target) => {
        if (target.type() !== 'page' || !target.opener()) return
        clearTimeout(timer)
        void target.page().then(resolve, reject)
      })
    })
    await first.ctx.click('#pop')
    const popup = await popupPromise
    const popupCdp = await popup.createCDPSession()
    const popupUa = await popupCdp.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: 'navigator.userAgent',
      returnByValue: true,
    })
    expect(popupUa.result.value).toBe(before.ua)
    await popup.close()

    const opened = (first.page as unknown as { browser(): { newPage(): Promise<TabSession['page']> } }).browser()
    const extra = await opened.newPage()
    await extra.goto(`${origin}/fp`, { waitUntil: 'domcontentloaded' })
    const extraCdp = await extra.createCDPSession()
    const extraUa = await extraCdp.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: 'navigator.userAgent',
      returnByValue: true,
    })
    expect(extraUa.result.value).toBe(before.ua)
    await extra.close()
    await first.release()
    await host.closeAccount('print-a')

    const restarted = createBrowserHost({
      kernelBinary: binary!,
      profileDir: (id) => join(root, id),
      readCookies: async () => [],
      isExistingAccount: () => false,
      timezone: () => 'Europe/London',
    })
    const again = await restarted.openTab('print-a', { role: 'manual', show: true })
    await again.ctx.goto(`${origin}/fp`)
    const after = await read(again)
    expect(after).toEqual(before)
    expect(await again.ctx.evaluate<string>(`document.cookie`)).toContain('mxe=persisted')
    expect(await again.ctx.evaluate<string>(`localStorage.getItem('who')`)).toBe('a')

    const other = await restarted.openTab('print-b', { role: 'manual', show: true })
    await other.ctx.goto(`${origin}/fp`)
    expect(await other.ctx.evaluate<string>(`localStorage.getItem('who') ?? ''`)).toBe('')
    const otherPrint = await read(other)
    expect(otherPrint.canvas).not.toBe(before.canvas)
    await restarted.shutdown()
    expect(restarted.hasOpen()).toBe(false)
  }, 120_000)
})
