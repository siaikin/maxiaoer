import type { PlatformAdapter } from './types'
import { until } from './util'

/**
 * Facebook 个人主页动态，登录态浏览器自动化。
 * 选择器参考 leaperone/MultiPost-Extension（Apache-2.0）的 src/sync/dynamic/facebook.ts。
 * Facebook 的发布接口不返回易用的帖子 id，暂不支持从平台删除。
 */
const createLabels = ['创建帖子', 'Create a post', '建立貼文']
const postLabels = ['发帖', 'Post', '發佈']

export const facebook: PlatformAdapter = {
  id: 'facebook',
  name: 'Facebook',
  color: '#1877f2',
  loginUrl: 'https://www.facebook.com/login',
  homeUrl: 'https://www.facebook.com/',
  limits: { contentMax: 63206, minImages: 0, maxImages: 10, requiresTitle: false },
  settings: [{ key: 'audience', label: '谁可以看', type: 'select', options: ['公开', '好友', '仅限自己'], default: '公开' }],

  async checkLogin(ctx) {
    await ctx.goto('https://www.facebook.com/')
    await ctx.sleep(2000)
    const uid = await ctx.evaluate<string | null>(`(document.cookie.match(/c_user=(\\d+)/) ?? [])[1] ?? null`)
    if (!uid) return null
    // TODO(实测): 昵称头像
    const nickname = await ctx.evaluate<string | null>(`document.querySelector('[role="navigation"] a[href*="/profile.php"], [aria-label][role="link"] image')?.getAttribute('aria-label') ?? null`)
    return { nickname: nickname ?? 'Facebook 用户', uid }
  },

  async publish(ctx, input, onProgress) {
    onProgress('打开发帖框')
    await ctx.goto('https://www.facebook.com/')
    const create = createLabels.map((l) => `div[aria-label="${l}"]`).join(', ')
    await ctx.waitFor(create, 20_000)
    await ctx.click(`${create} span`)
    const editor = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]'
    await ctx.waitFor(editor, 15_000)

    const audience = String(input.settings.audience ?? '公开')
    if (audience !== '公开') {
      // TODO(实测): 发帖框里的受众按钮
      await ctx.click('div[role="dialog"] div[role="button"][aria-label*="隐私"], div[role="dialog"] div[role="button"][aria-label*="privacy"]')
      await ctx.sleep(500)
      await ctx.click('div[role="radio"], div[role="listitem"]', audience)
      await ctx.click('div[role="dialog"] div[role="button"]', '完成')
    }

    const hashtags = input.topics.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')
    await ctx.type(editor, [input.title, input.content, hashtags].filter(Boolean).join('\n'))

    if (input.images.length) {
      onProgress(`上传 ${input.images.length} 张图片`)
      await ctx.setFiles('div[role="dialog"] input[type="file"][accept*="image"]', input.images)
      await until(ctx, () => ctx.evaluate<boolean>(`document.querySelectorAll('div[role="dialog"] img[src^="blob:"]').length >= ${input.images.length}`), 60_000, '图片上传超时')
    }

    onProgress('提交发布')
    await ctx.click(postLabels.map((l) => `div[role="dialog"] div[aria-label="${l}"]`).join(', '))
    await until(ctx, async () => !(await ctx.exists(editor)), 60_000, '发帖框没有关闭，可能发布失败')
    return {}
  },
}
