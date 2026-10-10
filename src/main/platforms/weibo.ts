import type { PlatformAdapter } from './types'
import { until } from './util'

/**
 * 微博网页版，登录态浏览器自动化。
 * 发布流程参考 leaperone/MultiPost-Extension（Apache-2.0）的 src/sync/dynamic/weibo.ts。
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

    // 微博原生话题语法是 #话题#，发出后会渲染成话题链接
    const topics = input.topics.map((t) => `#${t}#`).join(' ')
    const text = [input.title, input.content, topics].filter(Boolean).join('\n')
    await ctx.type(editor, text)

    if (input.images.length) {
      onProgress(`上传 ${input.images.length} 张图片`)
      await ctx.setFiles('input[type="file"]', input.images)
      // 每张图上传完会出现删除按钮，缩略图换成微博图床地址
      await until(
        ctx,
        () =>
          ctx.evaluate<boolean>(`document.querySelectorAll('i[title="删除"]').length >= ${input.images.length}
            && document.querySelectorAll('div[class*="_publishCard_"] img[src*="sinaimg.cn/"][src*="/bmiddle/"]').length >= ${input.images.length}`),
        60_000,
        '图片上传超时',
      )
    }

    const declaration = String(input.settings.declaration ?? '无')
    if (declaration !== '无') {
      onProgress('内容声明')
      await ctx.click('div[class*="_statement_"] span.woo-pop-ctrl')
      await ctx.sleep(500)
      await ctx.click('div[class*="_statement_"] .woo-pop-main button', declaration)
      await ctx.sleep(400)
      // 选完菜单不会自动收起，再点一次触发器
      if (await ctx.exists('div[class*="_statement_"] .woo-pop-main')) await ctx.click('div[class*="_statement_"] span.woo-pop-ctrl')
    }

    const visibility = String(input.settings.visibility ?? '公开')
    if (visibility !== '公开') {
      onProgress('设置可见范围')
      await ctx.click('div[class*="_limits_"] span.woo-pop-ctrl')
      await ctx.sleep(500)
      await ctx.click('div[class*="_limits_"] .woo-pop-item-main', visibility)
      await ctx.sleep(400)
    }

    if (input.dryRun) return {}
    onProgress('提交发布')
    const res = await ctx.captureResponse<{ ok: number; msg?: string; data?: { idstr: string; mblogid: string; user?: { idstr: string } } }>(
      '/ajax/statuses/update',
      () => ctx.click('span.woo-button-content', '发送'),
      60_000,
    )
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

