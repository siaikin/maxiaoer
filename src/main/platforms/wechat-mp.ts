import type { PlatformAdapter } from './types'
import { pageFetchForm, until } from './util'

/**
 * 微信公众号「图片消息」（贴图）。
 * 先用公众号后台自己的接口上传图片、创建图文草稿，再打开编辑页点“发表”。
 * 接口参数参考 leaperone/MultiPost-Extension（Apache-2.0）的 src/sync/dynamic/weixin.ts。
 */
interface MpInfo {
  token: string
  ticket: string
  userName: string
  nickname: string
  avatar?: string
}

async function readInfo(ctx: Parameters<PlatformAdapter['checkLogin']>[0]): Promise<MpInfo | null> {
  return ctx.evaluate(`(async () => {
    const html = await fetch('https://mp.weixin.qq.com/', { credentials: 'include' }).then((r) => r.text())
    const token = (html.match(/[?&]token=(\\d+)/) ?? html.match(/\\bt:\\s*["'](\\d+)["']/) ?? [])[1]
    if (!token) return null
    const pick = (re) => (html.match(re) ?? [])[1] ?? ''
    return {
      token,
      ticket: pick(/ticket\\s*:\\s*"(\\w+)"/),
      userName: pick(/user_name\\s*:\\s*"(\\w+)"/),
      nickname: decodeURIComponent(pick(/nick_name\\s*:\\s*["']([^"']+)["']/)) || '公众号',
      avatar: pick(/head_img\\s*:\\s*['"]([^'"]+)['"]/) || undefined,
    }
  })()`)
}

export const wechatMp: PlatformAdapter = {
  id: 'wechat-mp',
  name: '微信公众号',
  color: '#07c160',
  loginUrl: 'https://mp.weixin.qq.com/',
  homeUrl: 'https://mp.weixin.qq.com/',
  limits: { titleMax: 64, contentMax: 1000, minImages: 1, maxImages: 20, requiresTitle: false },
  settings: [
    { key: 'comment', label: '开启留言', type: 'switch', default: true },
    { key: 'fansOnlyComment', label: '仅关注者可留言', type: 'switch', default: false },
  ],

  async checkLogin(ctx) {
    await ctx.goto('https://mp.weixin.qq.com/')
    await ctx.sleep(1500)
    const info = await readInfo(ctx)
    return info ? { nickname: info.nickname, avatar: info.avatar, uid: info.userName || undefined } : null
  },

  async publish(ctx, input, onProgress) {
    await ctx.goto('https://mp.weixin.qq.com/')
    const info = await readInfo(ctx)
    if (!info) throw new Error('公众号登录已失效，请重新扫码')

    const images: { url: string; file_id: number; cdn_url: string }[] = []
    for (const [i, path] of input.images.entries()) {
      onProgress(`上传图片 ${i + 1}/${input.images.length}`)
      const params = new URLSearchParams({
        action: 'upload_material', f: 'json', scene: '5', writetype: 'doublewrite', groupid: '1',
        ticket_id: info.userName, ticket: info.ticket, svr_time: String(Math.floor(Date.now() / 1000)),
        token: info.token, lang: 'zh_CN', seq: String(Date.now()), t: String(Math.random()),
      })
      const res = await pageFetchForm<{ base_resp: { err_msg: string }; content: string; cdn_url: string }>(
        ctx,
        `https://mp.weixin.qq.com/cgi-bin/filetransfer?${params}`,
        { id: String(Date.now()), file: { file: path } },
      )
      if (res.base_resp.err_msg !== 'ok') throw new Error(`第 ${i + 1} 张图片上传失败：${res.base_resp.err_msg}`)
      images.push({ url: res.cdn_url, file_id: Number(res.content), cdn_url: res.cdn_url })
    }

    onProgress('创建图片消息')
    // 话题在公众号里没有原生标签，按 #话题 追加在正文末尾
    const body = [input.content, input.topics.map((t) => `#${t}`).join(' ')].filter(Boolean).join('\n').slice(0, 1000)
    const title = (input.title || input.content.trim().split('\n')[0]).slice(0, 64)
    const s = input.settings
    const created = await pageFetchForm<{ appMsgId?: string; base_resp?: { err_msg: string } }>(
      ctx,
      `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${info.token}&lang=zh_CN`,
      {
        token: info.token, lang: 'zh_CN', f: 'json', ajax: '1', random: String(Math.random()),
        AppMsgId: '', count: '1', data_seq: '0', operate_from: 'Chrome', isnew: '0', articlenum: '1',
        title0: title, is_user_title0: '1', content0: body, guide_words0: body, auto_gen_digest0: '1',
        need_open_comment0: s.comment === false ? '0' : '1',
        only_fans_can_comment0: s.fansOnlyComment ? '1' : '0',
        share_imageinfo0: JSON.stringify({ list: images }),
        share_page_type0: '8', style_type0: '3', new_pic_process0: '1', copyright_type0: '0',
        is_auto_type_setting: '3', save_type: '1', isneedsave: '0',
      },
    )
    if (!created.appMsgId) throw new Error(`创建失败：${created.base_resp?.err_msg ?? '未知错误'}`)

    onProgress('发表（如需扫码验证，请在弹出的窗口里完成）')
    await ctx.goto(
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${created.appMsgId}&token=${info.token}&lang=zh_CN`,
    )
    // TODO(实测): 编辑页“发表”按钮和确认弹窗
    await ctx.click('button, span.weui-desktop-btn', '发表')
    await ctx.sleep(1000)
    await ctx.click('.weui-desktop-dialog button, .weui-desktop-popover button', '发表')
    // 有时需要管理员扫码确认，最多等 3 分钟
    await until(ctx, () => ctx.evaluate<boolean>(`location.href.includes('appmsgpublish') || document.body.textContent.includes('发表成功')`), 180_000, '发表没有完成（可能未扫码确认）')
    return { remoteId: created.appMsgId }
  },

  async deleteRemote(ctx, remote) {
    if (!remote.remoteId) throw new Error('没有记录到消息 id')
    await ctx.goto('https://mp.weixin.qq.com/')
    const info = await readInfo(ctx)
    if (!info) throw new Error('公众号登录已失效，请重新扫码')
    // TODO(实测): 已发表内容的删除接口；这里先按草稿删除接口实现
    const res = await pageFetchForm<{ base_resp?: { ret: number; err_msg: string } }>(
      ctx,
      `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=del&t=ajax-response&token=${info.token}&lang=zh_CN`,
      { AppMsgId: remote.remoteId, token: info.token, lang: 'zh_CN', f: 'json', ajax: '1' },
    )
    if (res.base_resp?.ret !== 0) throw new Error(res.base_resp?.err_msg || '删除失败')
  },
}
