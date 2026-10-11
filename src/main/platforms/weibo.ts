import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { PlatformAdapter } from './types'
import { crc32, imageMime, pageFetchBinary } from './util'

const q = (s: string) => JSON.stringify(s)

/** 网页版「谁可以看」对应的 visible 值 */
const VISIBLE: Record<string, number> = { 公开: 0, 粉丝: 10, 好友圈: 6, 仅自己可见: 1 }
/** 网页版「内容声明」对应的 mblog_statement 值 */
const STATEMENT: Record<string, number> = { 内容为自主创作: 4, 内容为转载: 3, 内容由AI生成: 1, 内容为虚构演绎: 2 }

/**
 * 微博网页版，登录态浏览器自动化。
 * 发帖和传图直接调网页版自己的接口（在已登录页面里请求），接口参数按网页版抓包整理。
 */
export const weibo: PlatformAdapter = {
  id: 'weibo',
  name: '微博',
  color: '#e6162d',
  loginUrl: 'https://passport.weibo.com/sso/signin?entry=miniblog&source=miniblog',
  homeUrl: 'https://weibo.com/',
  limits: { contentMax: 2000, minImages: 0, maxImages: 18, requiresTitle: false },
  settings: [
    { key: 'visibility', label: '谁可以看', type: 'select', options: ['公开', '粉丝', '好友圈', '仅自己可见'], default: '公开' },
    { key: 'declaration', label: '内容声明', type: 'select', options: ['无', '内容为自主创作', '内容为转载', '内容由AI生成', '内容为虚构演绎'], default: '无' },
  ],

  async checkLogin(ctx) {
    await ctx.goto('https://weibo.com/')
    await ctx.sleep(2000)
    if (ctx.currentUrl().includes('passport.weibo.com') || ctx.currentUrl().includes('/newlogin')) return null
    // 新版微博把当前用户放在 window.$CONFIG.user
    return ctx.evaluate(`(() => {
      const u = window.$CONFIG?.user
      return u ? { nickname: u.screen_name, avatar: u.avatar_large ?? u.profile_image_url, uid: String(u.idstr ?? u.id) } : null
    })()`)
  },

  async publish(ctx, input, onProgress) {
    onProgress('打开微博首页')
    await ctx.goto('https://weibo.com/')
    const editor = 'textarea[placeholder="有什么新鲜事想分享给大家？"]'
    await ctx.waitFor(editor, 20_000)
    const me = await ctx.evaluate<{ uid: string; nick: string } | null>(`(() => {
      const u = window.$CONFIG?.user
      return u ? { uid: String(u.idstr ?? u.id), nick: u.screen_name } : null
    })()`)
    if (!me) throw new Error('微博登录已失效，请重新登录')
    // 和网页版一样先点一下输入框，页面里留下正常的交互
    await ctx.click(editor)

    // 图片和正文走网页版自己的接口（在已登录页面里请求），不依赖发布框的按钮和弹层
    const pics: { type: string; pid: string }[] = []
    for (const [i, path] of input.images.entries()) {
      onProgress(`上传图片 ${i + 1}/${input.images.length}`)
      const data = await readFile(path)
      const params = new URLSearchParams({
        file_source: '1', cs: String(crc32(data)), ent: 'miniblog', appid: '339644097', uid: me.uid,
        raw_md5: createHash('md5').update(data).digest('hex'), ori: '1', mpos: String(i + 1), nick: `@${me.nick}`,
        pri: '0', request_id: String(Date.now()), file_size: String(data.length),
      })
      const res = await pageFetchBinary<{ ret?: boolean; pic?: { pid?: string } }>(ctx, `https://picupload.weibo.com/interface/upload.php?${params}`, data)
      if (!res.ret || !res.pic?.pid) throw new Error(`第 ${i + 1} 张图片上传失败`)
      pics.push({ type: imageMime(path), pid: res.pic.pid })
    }

    // 微博原生话题语法是 #话题#，发出后会渲染成话题链接
    const topics = input.topics.map((t) => `#${t}#`).join(' ')
    const content = [input.title, input.content, topics].filter(Boolean).join('\n')
    const visibility = String(input.settings.visibility ?? '公开')
    const declaration = String(input.settings.declaration ?? '无')
    if (input.dryRun) return {}

    onProgress('提交发布')
    const res = await ctx.evaluate<{ ok: number; msg?: string; data?: { idstr: string; mblogid: string; user?: { idstr: string } } }>(`(async () => {
      const body = new URLSearchParams({ content: ${q(content)}, visible: ${q(String(VISIBLE[visibility] ?? 0))}, share_id: '', vote: '', media: '' })
      const pics = ${JSON.stringify(pics)}
      if (pics.length) {
        body.set('need_transcode', '1')
        body.set('pic_id', JSON.stringify(pics))
      }
      // 内容声明的编号优先按网页版当前配置的名字查，查不到用抓包时的编号
      if (${q(declaration)} !== '无') {
        const list = JSON.parse(JSON.stringify(document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.config?.flags?.statement?.mblog_statement_list ?? []))
        const type = list.find((s) => s.name === ${q(declaration)})?.type ?? ${STATEMENT[declaration] ?? 'undefined'}
        if (type === undefined) return { ok: 0, msg: '找不到内容声明「' + ${q(declaration)} + '」' }
        body.set('mblog_statement', String(type))
      }
      // 网页版发帖前会向自己的风控 SDK 要一个 fp，这里照做
      const fp = await window.wbBotDetector?.get?.({ useCache: false, from: 'weibo-post' }).catch(() => null)
      if (fp?.rid) body.set('fp', fp.rid)
      const token = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) ?? [])[1] ?? '')
      const r = await fetch('/ajax/statuses/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-xsrf-token': token, 'x-requested-with': 'XMLHttpRequest', accept: 'application/json, text/plain, */*' },
        body,
      })
      return r.json()
    })()`)
    if (res.ok !== 1 || !res.data) throw new Error(res.msg || '微博返回发布失败')
    const uid = res.data.user?.idstr
    return { remoteId: res.data.idstr, url: uid ? `https://weibo.com/${uid}/${res.data.mblogid}` : undefined }
  },

  async deleteRemote(ctx, remote) {
    if (!remote.remoteId) throw new Error('没有记录到微博 id')
    await ctx.goto('https://weibo.com/')
    await ctx.sleep(1000)
    const res = await ctx.evaluate<{ ok: number; msg?: string }>(`(async () => {
      const token = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) ?? [])[1] ?? '')
      const r = await fetch('/ajax/statuses/destroy', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-xsrf-token': token },
        body: JSON.stringify({ id: ${JSON.stringify(remote.remoteId)} }),
      })
      return r.json()
    })()`)
    if (res.ok !== 1) throw new Error(res.msg || '删除失败')
  },
}

