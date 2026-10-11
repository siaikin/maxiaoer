import type { BrowserContext, PlatformAdapter } from './types'
import { mark, until } from './util'

/**
 * Facebook 个人主页动态，登录态浏览器自动化。
 * 选择器参考 leaperone/MultiPost-Extension（Apache-2.0）的 src/sync/dynamic/facebook.ts。
 * 发布接口不返回易用的帖子 id，发完到个人主页按正文找到帖子链接，删除时按链接打开帖子再删除。
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
    // 左侧导航第一项是自己的主页：头像 + 昵称
    const me = await ctx.evaluate<{ nickname: string; avatar?: string } | null>(`(() => {
      const a = [...document.querySelectorAll('[role="navigation"] a')].find((e) => e.innerText.trim() && e.querySelector('img[src*="fbcdn"], image'))
      if (!a) return null
      const img = a.querySelector('img')?.src ?? a.querySelector('image')?.getAttribute('xlink:href') ?? undefined
      return { nickname: a.innerText.trim(), avatar: img }
    })()`)
    return { nickname: me?.nickname ?? 'Facebook 用户', avatar: me?.avatar, uid }
  },

  async publish(ctx, input, onProgress) {
    onProgress('打开发帖框')
    await ctx.goto('https://www.facebook.com/')
    const create = createLabels.map((l) => `div[aria-label="${l}"]`).join(', ')
    await ctx.waitFor(create, 20_000)
    const editor = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]'
    // 首页刚加载完时第一下点击偶尔没反应，发帖框没弹出就再点
    for (let i = 0; i < 3 && !(await ctx.exists(editor)); i++) {
      await ctx.click(`${create} span`)
      await until(ctx, () => ctx.exists(editor), 8000, '').catch(() => undefined)
    }
    await ctx.waitFor(editor, 5_000)

    const audience = String(input.settings.audience ?? '公开')
    // 发帖框沿用上次的分享对象，不一致才改；中文界面「好友」显示为「你的好友」
    if (!(await ctx.exists(`div[role="dialog"] div[role="button"][aria-label*="分享对象："][aria-label*="${audience}"]`))) {
      onProgress('设置谁可以看')
      // 发帖框刚弹出时按钮还没响应，列表没打开就再点
      const listed = () =>
        ctx.evaluate<boolean>(`[...document.querySelectorAll('div[role="dialog"] label')].some((l) => l.textContent.includes(${JSON.stringify(audience)}))`)
      for (let i = 0; i < 3 && !(await listed()); i++) {
        await ctx.click('div[role="dialog"] div[role="button"][aria-label^="编辑隐私设置"], div[role="dialog"] div[role="button"][aria-label*="privacy"]')
        await until(ctx, listed, 4000, '').catch(() => undefined)
      }
      if (!(await listed())) throw new Error('分享对象列表没有打开')
      await ctx.click('div[role="dialog"] label', audience)
      await ctx.sleep(500)
      // 「设为默认分享对象」勾着会改掉账号的默认设置，只对这一条生效
      await ctx.evaluate(`[...document.querySelectorAll('div[role="dialog"] label')].find((l) => l.textContent.includes('默认分享对象') && l.querySelector('input')?.checked)?.click()`)
      // 有时选完就自动收起，没收起再点完成
      const done = 'div[role="dialog"] div[role="button"][aria-label^="完成"], div[role="dialog"] div[role="button"][aria-label^="Done"]'
      if (await ctx.exists(done)) await ctx.click(done).catch(() => undefined)
      await until(
        ctx,
        () => ctx.exists(`div[role="dialog"] div[role="button"][aria-label*="分享对象："][aria-label*="${audience}"]`),
        10_000,
        `谁可以看没有设置成「${audience}」`,
      )
    }

    const hashtags = input.topics.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')
    await ctx.type(editor, [input.title, input.content, hashtags].filter(Boolean).join('\n'))

    if (input.images.length) {
      onProgress(`上传 ${input.images.length} 张图片`)
      await ctx.setFiles('div[role="dialog"] input[type="file"][accept*="image"]', input.images)
      // 图多或长图时只显示前几张，最后一格盖着「+N」（N 含被盖住的那张）
      await until(
        ctx,
        () =>
          ctx.evaluate<boolean>(`(() => {
            const shown = document.querySelectorAll('div[role="dialog"] img[src^="blob:"]').length
            const more = [...document.querySelectorAll('div[role="dialog"] *')]
              .map((e) => !e.children.length && /^\\+(\\d+)$/.exec(e.textContent.trim()))
              .find(Boolean)
            return shown + (more ? Number(more[1]) - 1 : 0) >= ${input.images.length}
          })()`),
        60_000,
        '图片上传超时',
      )
    }

    if (input.dryRun) return {}
    onProgress('提交发布')
    const post = postLabels.map((l) => `div[role="dialog"] div[aria-label="${l}"]`).join(', ')
    // 话题联想浮层开着时第一下点击只会关掉浮层，发帖框没关就再点
    for (let i = 0; i < 3 && (await ctx.exists(editor)); i++) {
      await ctx.click(post).catch(() => undefined)
      await until(ctx, async () => !(await ctx.exists(editor)), 8000, '').catch(() => undefined)
    }
    await until(ctx, async () => !(await ctx.exists(editor)), 60_000, '发帖框没有关闭，可能发布失败')

    onProgress('读取帖子链接')
    const firstLine = [input.title, input.content].filter(Boolean).join('\n').split('\n')[0]
    const url = await findPostUrl(ctx, firstLine).catch(() => undefined)
    return { url }
  },

  async deleteRemote(ctx, remote) {
    if (!remote.url) throw new Error('没有记录到帖子链接，请到 Facebook 个人主页手动删除')
    await ctx.goto(remote.url)
    // 帖子链接会以弹窗形式盖在动态消息上，只认弹窗里的操作按钮，别点到背后别人的帖子
    const actions = '[role="dialog"] [aria-label*="这篇帖子执行的操作"], [role="dialog"] [aria-label^="Actions for this post"]'
    await ctx.waitFor(actions, 20_000)
    // 菜单偶尔第一下点不开，重点一次
    for (let i = 0; i < 3 && !(await ctx.exists('[role="menuitem"]')); i++) {
      await ctx.click(actions)
      await until(ctx, () => ctx.exists('[role="menuitem"]'), 4000, '').catch(() => undefined)
    }
    // 个人主页里是「移至垃圾箱」（30 天后清除），帖子详情里是「删除帖子」（直接删除）
    const item = await mark(ctx, '[role="menuitem"]', '删除帖子') ?? await mark(ctx, '[role="menuitem"]', '移至垃圾箱')
      ?? await mark(ctx, '[role="menuitem"]', 'Delete post') ?? await mark(ctx, '[role="menuitem"]', 'Move to trash')
    if (!item) throw new Error('帖子菜单里没有删除选项')
    await ctx.click(item)
    const confirm = ['删除', '转移', 'Delete', 'Move'].map((l) => `div[role="dialog"] div[role="button"][aria-label="${l}"]`).join(', ')
    await ctx.waitFor(confirm, 10_000)
    await ctx.click(confirm)
    await until(ctx, async () => !(await ctx.exists(confirm)), 15_000, '删除没有完成')
  },
}

/** 个人主页里第一条正文包含 text 的帖子链接（按时间倒序） */
async function findPostUrl(ctx: BrowserContext, text: string) {
  await ctx.goto('https://www.facebook.com/me')
  return until(
    ctx,
    () =>
      ctx.evaluate<string | null>(`(() => {
        const a = [...document.querySelectorAll('[role="article"]')].find((e) => e.innerText.includes(${JSON.stringify(text)}))
        const link = a && [...a.querySelectorAll('a[href*="/posts/"]')].map((x) => x.href)[0]
        return link ? link.split('?')[0] : null
      })()`),
    20_000,
    '个人主页里没找到刚发的帖子',
  )
}
