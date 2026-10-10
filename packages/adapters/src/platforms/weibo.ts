import type { BrowserAdapter } from '@maxiaoer/core'

/** 微博网页版。开放平台的发布接口需要审核且限制多，默认走登录态浏览器自动化。 */
export const weibo: BrowserAdapter = {
  id: 'weibo',
  name: '微博',
  icon: 'weibo',
  mode: 'browser',
  loginUrl: 'https://passport.weibo.com/sso/signin?entry=miniblog&source=miniblog',
  limits: { contentMax: 2000, minImages: 0, maxImages: 18, requiresTitle: false },

  async checkLogin(ctx) {
    await ctx.goto('https://weibo.com/')
    await ctx.sleep(1500)
    // 网页版已登录时 /ajax/profile/info 可返回当前用户；未登录会 302 到 passport
    return ctx.evaluate(`fetch('/ajax/config/get_config', { credentials: 'include' })
      .then(r => r.json())
      .then(j => j?.data?.user ? { nickname: j.data.user.screen_name, avatar: j.data.user.avatar_large, uid: String(j.data.user.idstr) } : null)
      .catch(() => null)`)
  },

  async publish(ctx, post, { onProgress }) {
    onProgress?.('打开微博首页')
    await ctx.goto('https://weibo.com/')
    await ctx.waitFor('textarea')
    const text = [post.title, post.content, post.topics.map((t) => `#${t}#`).join(' ')].filter(Boolean).join('\n')
    await ctx.type('textarea', text)
    if (post.images.length) {
      onProgress?.(`上传 ${post.images.length} 张图片`)
      await ctx.setFiles('input[type=file]', post.images.map((i) => i.path))
      // TODO(实测): 等待缩略图全部出现
      await ctx.sleep(post.images.length * 1500)
    }
    onProgress?.('提交发布')
    // TODO(实测): 发送按钮选择器
    await ctx.click('button[class*="Tool_btn"]')
    await ctx.sleep(2000)
    return {}
  },
}
