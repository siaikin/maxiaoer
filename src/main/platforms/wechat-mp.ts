import type { BrowserContext, PlatformAdapter } from './types'
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

async function readInfo(ctx: BrowserContext): Promise<MpInfo | null> {
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
  limits: { titleMax: 20, contentMax: 1000, minImages: 1, maxImages: 20, requiresTitle: false },
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

    // 试运行不上传：上传会写进公众号素材库
    if (input.dryRun) return {}
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
    const title = (input.title || input.content.trim().split('\n')[0]).slice(0, 20)
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
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=77&appmsgid=${created.appMsgId}&token=${info.token}&lang=zh_CN`,
    )
    // 编辑页里的图片是异步加载的，没加载完就点发表会提示“必须插入一张图片”
    await until(ctx, () => ctx.evaluate<boolean>(`!!document.querySelector('.image-selector__bottom-list-item img[src*="mmbiz"]')`), 30_000, '编辑页图片加载超时')
    await ctx.sleep(1000)
    // 点发表会先自动保存，几秒后弹出确认框（贴图不占群发次数）
    await ctx.click('button.mass_send', '发表')
    await ctx.click('.weui-desktop-dialog__wrp button.weui-desktop-btn_primary', '发表')
    // 发表成功会离开编辑页；有时需要管理员扫码确认，最多等 3 分钟
    await ctx.waitForUrl((u) => !u.includes('appmsg_edit'), 180_000).catch(() => {
      throw new Error('发表没有完成（可能未扫码确认）')
    })

    onProgress('读取发表链接')
    const url = await findPublished(ctx, info.token, title).catch(() => undefined)
    return { remoteId: created.appMsgId, url }
  },

  async deleteRemote(ctx, remote) {
    if (!remote.url) throw new Error('没有记录到发表链接，请到公众号「发表记录」手动删除')
    await ctx.goto('https://mp.weixin.qq.com/')
    const info = await readInfo(ctx)
    if (!info) throw new Error('公众号登录已失效，请重新扫码')
    await ctx.goto(publishListUrl(info.token))
    const block = await until(ctx, () => markRecord(ctx, remote.url!), 15_000, '发表记录里没找到这条内容，可能已被删除')
    // 操作按钮只在悬停时出现：「更多」菜单里的删除，再在确认气泡里点确定
    await ctx.hover(block)
    await ctx.hover(`${block} .more_icon`)
    // 菜单在 mousedown 时就会重新渲染，真实鼠标点不中，这里用 DOM click
    await until(
      ctx,
      () =>
        ctx.evaluate<boolean>(`(() => {
          const li = [...document.querySelectorAll('ul.select_option li')].find((e) => e.offsetWidth && e.textContent.trim() === '删除')
          li?.click()
          return !!li
        })()`),
      5000,
      '没找到「删除」菜单',
    )
    await ctx.sleep(1000)
    // 确认是记录旁边的气泡，被图片层盖住，同样用 DOM click
    await ctx.evaluate(`[...document.querySelectorAll('.weui-desktop-popover__bar button.weui-desktop-btn_primary')].find((b) => b.offsetWidth && b.textContent.trim() === '确定')?.click()`)
    // 删除已发表内容要管理员微信扫码验证，最多等 3 分钟
    await until(
      ctx,
      async () => {
        const status = await ctx.evaluate<string>(`document.querySelector(${JSON.stringify(block)})?.innerText ?? ''`)
        return !status || status.includes('已删除')
      },
      180_000,
      '删除没有完成（需要管理员在弹出的窗口里扫码验证）',
    )
  },
}

const publishListUrl = (token: string) => `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=10&token=${token}&lang=zh_CN`

/** 发表记录里第一条标题匹配的内容链接（列表按时间倒序） */
async function findPublished(ctx: BrowserContext, token: string, title: string) {
  await ctx.goto(publishListUrl(token))
  return until(
    ctx,
    () =>
      ctx.evaluate<string | null>(`(() => {
        const b = [...document.querySelectorAll('.publish_record_history .weui-desktop-block')].find((e) => e.innerText.includes(${JSON.stringify(title)}))
        return b?.querySelector('a[href*="/s/"]')?.href ?? null
      })()`),
    15_000,
    '发表记录里没找到刚发表的内容',
  )
}

/** 给发表记录里链接为 url 的那一条打标记，返回选择器 */
async function markRecord(ctx: BrowserContext, url: string) {
  const ok = await ctx.evaluate<boolean>(`(() => {
    const b = [...document.querySelectorAll('.publish_record_history .weui-desktop-block')].find((e) => [...e.querySelectorAll('a')].some((a) => a.href === ${JSON.stringify(url)}))
    if (b) b.setAttribute('data-mxe', 'record-target')
    return !!b
  })()`)
  return ok ? '[data-mxe="record-target"]' : null
}
