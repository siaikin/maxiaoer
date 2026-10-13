// 临时复现脚本，不提交
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { assertKernel } from './browser/kernel'
import { createBrowserHost } from './browser/session'
import { adapters } from './platforms'
import { pageFetchForm } from './platforms/util'
import { defaultSettings } from '../shared/types'

const env = process.env
it.skipIf(env.MXE_REPRO !== '1')('repro', async () => {
  const binary = assertKernel(fileURLToPath(new URL('../../resources/cloakbrowser/bundled/', import.meta.url)))
  const root = join(homedir(), 'Library/Application Support/maxiaoer/browsers')
  const host = createBrowserHost({
    kernelBinary: binary,
    profileDir: (id) => join(root, id),
    readCookies: async () => [],
    isExistingAccount: () => true,
    timezone: () => 'Asia/Shanghai',
  })
  const adapter = adapters[env.P as keyof typeof adapters]
  const t0 = Date.now()
  const log = (m: string) => appendFileSync(env.LOG!, `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`)
  if (env.RMODE === 'net') {
    const tab = await host.openTab(env.A!, { role: 'auto' })
    const cdp = await tab.page.createCDPSession()
    await cdp.send('Network.enable')
    const reqs = new Map<string, any>()
    cdp.on('Network.requestWillBeSent', (e: any) => {
      if (!new RegExp(env.NET ?? 'upload|statuses').test(e.request.url)) return
      reqs.set(e.requestId, { url: e.request.url, method: e.request.method, headers: e.request.headers, post: e.request.postData?.slice(0, 1500), hasPost: e.request.hasPostData })
    })
    cdp.on('Network.loadingFinished', async (e: any) => {
      const r = reqs.get(e.requestId)
      if (!r) return
      r.body = await cdp.send('Network.getResponseBody', { requestId: e.requestId }).then((b: any) => b.body.slice(0, 1500), () => '')
      log('NET ' + JSON.stringify(r))
    })
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor
    try {
      await new AsyncFunction('ctx', 'log', env.SCRIPT!)(tab.ctx, log)
    } catch (e) {
      log('ERROR ' + (e as Error).message)
    }
    await tab.release()
    await host.shutdown()
    return
  }
  try {
    const res = await host.withBrowser(env.A!, async (raw) => {
      const ctx = new Proxy(raw, { get(t, k) { const v = (t as any)[k]; if (typeof v !== 'function' || ['sleep','evaluate','exists','currentUrl'].includes(String(k))) return v; return async (...a: any[]) => { log(`> ${String(k)} ${JSON.stringify(a.filter((x) => typeof x !== 'function')).slice(0, 160)}`); try { return await v.apply(t, a) } catch (e) { log(`! ${String(k)} ${(e as Error).message}`); throw e } } } })
      if (env.RMODE === 'delete') {
        await adapter.deleteRemote!(ctx, JSON.parse(env.REMOTE!))
        return 'deleted'
      }
      if (env.RMODE === 'script') {
        const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor
        return new AsyncFunction('ctx', 'log', env.SCRIPT!)(ctx, log)
      }
      if (env.RMODE === 'wxupload') {
        await ctx.goto('https://mp.weixin.qq.com/')
        const html: string = await raw.evaluate(`fetch('https://mp.weixin.qq.com/', { credentials: 'include' }).then((r) => r.text())`)
        const token = (html.match(/[?&]token=(\d+)/) ?? [])[1]
        const pick = (re: RegExp) => (html.match(re) ?? [])[1] ?? ''
        const out = []
        for (const path of env.IMAGES!.split(',')) {
          const params = new URLSearchParams({ action: 'upload_material', f: 'json', scene: '5', writetype: 'doublewrite', groupid: '1', ticket_id: pick(/user_name\s*:\s*"(\w+)"/), ticket: pick(/ticket\s*:\s*"(\w+)"/), svr_time: String(Math.floor(Date.now() / 1000)), token: token!, lang: 'zh_CN', seq: String(Date.now()), t: String(Math.random()) })
          const t = Date.now()
          out.push(await pageFetchForm(raw, `https://mp.weixin.qq.com/cgi-bin/filetransfer?${params}`, { id: String(Date.now()), file: { file: path } }).then((r) => JSON.stringify(r).slice(0, 200), (e) => 'ERR ' + e.message.slice(0, 80)) + ' ' + (Date.now() - t) + 'ms')
        }
        return out
      }
      if (env.RMODE === 'eval') {
        await ctx.goto(env.URL!)
        await ctx.sleep(3000)
        return ctx.evaluate(env.JS!)
      }
      return await adapter.publish(
        ctx,
        {
          title: env.TITLE ?? '',
          content: env.CONTENT ?? '自动化测试，稍后删除',
          images: (env.IMAGES ?? '').split(',').filter(Boolean),
          topics: (env.TOPICS ?? '').split(',').filter(Boolean),
          settings: { ...defaultSettings(adapter.settings), ...JSON.parse(env.SETTINGS ?? '{}') },
          dryRun: env.RMODE !== 'real',
        },
        log,
      ).then(async (r) => { if (env.AFTER) log('AFTER ' + JSON.stringify(await raw.evaluate(env.AFTER))); return r }).catch(async (e) => {
        log('DIAG ' + JSON.stringify(await raw.evaluate(env.DIAG ?? `[...document.querySelectorAll('[role=alert],[data-testid=toast]')].map((e) => e.innerText).join(' | ')`).catch((x) => String(x))))
        throw e
      })
    }, { show: env.SHOW === '1', onWait: log })
    log('RESULT ' + JSON.stringify(res))
  } catch (e) {
    log('ERROR ' + (e instanceof Error ? e.stack : String(e)))
  } finally {
    await host.shutdown()
  }
}, 900_000)
