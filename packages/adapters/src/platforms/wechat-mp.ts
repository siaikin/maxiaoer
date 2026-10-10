import type { BrowserAdapter } from '@maxiaoer/core'

/**
 * 微信公众号后台（mp.weixin.qq.com），扫码登录。
 * 官方 API（草稿箱 + 发布）要求认证账号并配置 IP 白名单，个人号用不了，所以默认走浏览器自动化，
 * 发“图片消息”（贴图）类型；以后可再加一个 API 模式的适配器给认证号用。
 */
export const wechatMp: BrowserAdapter = {
  id: 'wechat-mp',
  name: '微信公众号',
  icon: 'wechat',
  mode: 'browser',
  loginUrl: 'https://mp.weixin.qq.com/',
  limits: { titleMax: 64, contentMax: 1000, minImages: 1, maxImages: 20, requiresTitle: true },

  async checkLogin(ctx) {
    await ctx.goto('https://mp.weixin.qq.com/')
    await ctx.sleep(1500)
    // 登录后 URL 会带 token 参数
    if (!/[?&]token=\d+/.test(ctx.currentUrl())) return null
    return ctx.evaluate(`(() => {
      const name = document.querySelector('.weui-desktop-account__nickname, .weui-desktop_name')?.textContent?.trim()
      const avatar = document.querySelector('.weui-desktop-account__img')?.src
      return { nickname: name || '公众号', avatar }
    })()`)
  },

  async publish(ctx, post, { onProgress }) {
    const token = /[?&]token=(\d+)/.exec(ctx.currentUrl())?.[1]
    if (!token) throw new Error('公众号登录已失效，请重新扫码')
    onProgress?.('打开图片消息编辑页')
    // type=77 为图片消息（贴图）
    await ctx.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`)
    await ctx.waitFor('input[type=file]', 30_000)
    onProgress?.(`上传 ${post.images.length} 张图片`)
    await ctx.setFiles('input[type=file]', post.images.map((i) => i.path))
    // TODO(实测): 标题、正文、发表按钮及“群发/发表”确认弹窗
    await ctx.type('textarea#title, input#title', post.title)
    await ctx.type('[contenteditable="true"]', post.content)
    onProgress?.('保存为草稿（发表需扫码确认，暂由用户手动完成）')
    await ctx.click('#js_submit')
    await ctx.sleep(2000)
    return {}
  },
}
