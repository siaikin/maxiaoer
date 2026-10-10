import type { PlatformAdapter } from './types'
import { until } from './util'

/**
 * X 网页版，登录态浏览器自动化（不需要付费 API）。
 * 编辑器和按钮选择器参考 leaperone/MultiPost-Extension（Apache-2.0）的 src/sync/dynamic/x.ts。
 */
export const x: PlatformAdapter = {
  id: 'x',
  name: 'X',
  color: '#000000',
  loginUrl: 'https://x.com/i/flow/login',
  homeUrl: 'https://x.com/home',
  limits: { contentMax: 280, minImages: 0, maxImages: 4, requiresTitle: false },
  settings: [
    {
      key: 'replies',
      label: '谁可以回复',
      type: 'select',
      options: ['所有人', '你关注的账号', '已认证账号', '你提及的账号'],
      default: '所有人',
    },
  ],

  async checkLogin(ctx) {
    await ctx.goto('https://x.com/home')
    await ctx.sleep(2500)
    if (ctx.currentUrl().includes('/login') || ctx.currentUrl().includes('/i/flow')) return null
    return ctx.evaluate(`(async () => {
      const html = await fetch('/home', { credentials: 'include' }).then((r) => r.text())
      const m = html.match(/window\\.__INITIAL_STATE__\\s*=\\s*(\\{.+?\\})(?:\\s*;|\\s*<\\/script>)/s)
      if (!m) return null
      const users = JSON.parse(m[1]).entities?.users?.entities ?? {}
      const u = Object.values(users)[0]
      return u ? { nickname: u.name, avatar: u.profile_image_url_https, uid: u.id_str ?? u.screen_name } : null
    })()`)
  },

  async publish(ctx, input, onProgress) {
    onProgress('打开发帖框')
    await ctx.goto('https://x.com/compose/post')
    const editor = 'div[data-testid="tweetTextarea_0"]'
    await ctx.waitFor(editor, 20_000)
    const hashtags = input.topics.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')
    await ctx.type(editor, [input.content, hashtags].filter(Boolean).join('\n'))
    // 关掉话题联想浮层
    await ctx.press('Space')

    if (input.images.length) {
      onProgress(`上传 ${input.images.length} 张图片`)
      await ctx.setFiles('input[data-testid="fileInput"]', input.images)
      await until(ctx, () => ctx.evaluate<boolean>(`document.querySelectorAll('[data-testid="attachments"] img').length >= ${input.images.length}`), 60_000, '图片上传超时')
    }

    const replies = String(input.settings.replies ?? '所有人')
    if (replies !== '所有人') {
      onProgress('设置谁可以回复')
      // TODO(实测): 回复权限按钮；界面语言不同文字不同
      await ctx.click('button[aria-label*="reply"], button[aria-label*="回复"]')
      await ctx.sleep(500)
      await ctx.click('div[role="menuitem"]', replies)
    }

    if (input.dryRun) return {}
    onProgress('提交发布')
    const res = await ctx.captureResponse<{ data?: { create_tweet?: { tweet_results?: { result?: { rest_id?: string } } } }; errors?: { message: string }[] }>(
      '/CreateTweet',
      () => ctx.click('button[data-testid="tweetButton"]'),
      30_000,
    )
    const id = res.data?.create_tweet?.tweet_results?.result?.rest_id
    if (!id) throw new Error(res.errors?.[0]?.message ?? 'X 返回发布失败')
    return { remoteId: id, url: `https://x.com/i/web/status/${id}` }
  },

  async deleteRemote(ctx, remote) {
    if (!remote.remoteId) throw new Error('没有记录到帖子 id')
    await ctx.goto(`https://x.com/i/web/status/${remote.remoteId}`)
    await ctx.waitFor('article [data-testid="caret"]', 20_000)
    await ctx.click('article [data-testid="caret"]')
    await ctx.sleep(500)
    // 菜单第一项红色的“删除 / Delete”
    await ctx.click('div[role="menuitem"]', (await ctx.exists('html[lang^="zh"]')) ? '删除' : 'Delete')
    await ctx.captureResponse('/DeleteTweet', () => ctx.click('button[data-testid="confirmationSheetConfirm"]'), 20_000)
  },
}
