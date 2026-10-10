import type { BrowserAdapter } from '@maxiaoer/core'

/**
 * 小红书创作服务平台（creator.xiaohongshu.com）。没有开放的发布 API，走登录态浏览器自动化。
 * 选择器均为初版，需在真实页面上实测后再固定。
 */
export const xiaohongshu: BrowserAdapter = {
  id: 'xiaohongshu',
  name: '小红书',
  icon: 'xiaohongshu',
  mode: 'browser',
  loginUrl: 'https://creator.xiaohongshu.com/login',
  limits: { titleMax: 20, contentMax: 1000, minImages: 1, maxImages: 18, requiresTitle: false },

  async checkLogin(ctx) {
    await ctx.goto('https://creator.xiaohongshu.com/new/home')
    await ctx.sleep(1500)
    if (ctx.currentUrl().includes('/login')) return null
    // TODO(实测): 从页面或 /api/galaxy/user/info 读取昵称头像
    return ctx.evaluate(`(() => {
      const name = document.querySelector('.account-name, .user-name')?.textContent?.trim()
      const avatar = document.querySelector('.avatar img, img.avatar')?.src
      return name ? { nickname: name, avatar } : { nickname: '小红书账号' }
    })()`)
  },

  async publish(ctx, post, { onProgress }) {
    onProgress?.('打开发布页')
    await ctx.goto('https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image')
    await ctx.waitFor('input[type=file]')
    onProgress?.(`上传 ${post.images.length} 张图片`)
    await ctx.setFiles('input[type=file]', post.images.map((i) => i.path))
    // TODO(实测): 等待所有图片上传完成的判断
    await ctx.waitFor('input[placeholder*="标题"]', 60_000)
    if (post.title) await ctx.type('input[placeholder*="标题"]', post.title)
    const body = post.topics.length ? `${post.content}\n${post.topics.map((t) => `#${t}`).join(' ')}` : post.content
    await ctx.type('[contenteditable="true"]', body)
    onProgress?.('提交发布')
    // TODO(实测): 发布按钮选择器 & 成功后跳转判断
    await ctx.click('button.publishBtn, .publish-page-publish-btn button')
    await ctx.sleep(3000)
    return {}
  },
}
