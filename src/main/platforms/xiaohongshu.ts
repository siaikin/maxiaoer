import type { Collection } from '../../shared/types'
import { IS_DECOY } from '../anti-detection/decoy'
import { placeholderImage } from './placeholder'
import type { BrowserContext, PlatformAdapter } from './types'
import { clickWithin, mark, until } from './util'

/**
 * 小红书创作服务平台，登录态浏览器自动化。
 * 发布流程参考 xpzouying/xiaohongshu-mcp（Apache-2.0）的 xiaohongshu/publish.go，
 * 选择器在 2026-10 的创作平台页面上核对过。
 */
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official&target=image'
const NOTE_MANAGER_URL = 'https://creator.xiaohongshu.com/new/note-manager'
const CONTENT_EDITOR = 'div.tiptap[contenteditable="true"], div[role="textbox"][contenteditable="true"]'
/** 内容类型声明一级选项 */
const DECLARATIONS = ['虚构演绎，仅供娱乐', '笔记含AI合成内容', '内容包含营销广告']
/** 在「内容来源声明」二级菜单里的选项 */
const SOURCE_DECLARATIONS = ['自主拍摄', '来源转载']

export const xiaohongshu: PlatformAdapter = {
  id: 'xiaohongshu',
  name: '小红书',
  color: '#ff2442',
  loginUrl: 'https://creator.xiaohongshu.com/login',
  homeUrl: 'https://creator.xiaohongshu.com/new/home',
  limits: { titleMax: 20, contentMax: 1000, minImages: 1, maxImages: 18, requiresTitle: false, maxTopics: 10 },
  settings: [
    { key: 'visibility', label: '谁可以看', type: 'select', options: ['公开可见', '仅自己可见', '仅互关好友可见'], default: '公开可见' },
    {
      key: 'declaration',
      label: '内容类型声明',
      type: 'select',
      options: ['不声明', ...DECLARATIONS, ...SOURCE_DECLARATIONS],
      default: '不声明',
    },
    { key: 'original', label: '原创声明', type: 'switch', default: false },
    { key: 'collection', label: '添加到合集', type: 'collection', default: null },
  ],

  async checkLogin(ctx) {
    await ctx.goto(this.homeUrl)
    await ctx.sleep(1500)
    if (ctx.currentUrl().includes('/login')) return null
    return ctx.evaluate(`fetch('/api/galaxy/user/info', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => j?.data ? { nickname: j.data.userName, avatar: j.data.userAvatar, uid: j.data.userId } : { nickname: '小红书账号' })
      .catch(() => ({ nickname: '小红书账号' }))`)
  },

  async publish(ctx, input, onProgress) {
    onProgress('打开发布页')
    await openImageTab(ctx)

    for (const [i, path] of input.images.entries()) {
      onProgress(`上传图片 ${i + 1}/${input.images.length}`)
      // 第一张用 .upload-input，之后用编辑区里的图片 input，每张等预览出现再传下一张
      if (i === 0) await ctx.setFiles('.upload-input', [path])
      else await ctx.setFiles('input[type="file"][accept*="image"], input[type="file"][accept*=".jpg"]', [path])
      await until(ctx, () => ctx.evaluate<boolean>(`document.querySelectorAll('.img-preview-area .pr').length >= ${i + 1}`), 60_000, `第 ${i + 1} 张图片上传超时`)
      await ctx.sleep(800)
    }
    // 上传后会弹“图片可以编辑啦”之类的新功能引导，挡住输入框
    await closeGuides(ctx)

    onProgress('填写标题和正文')
    if (input.title) await ctx.type('input[placeholder*="标题"]', input.title)
    await ctx.waitFor(CONTENT_EDITOR, 10_000)
    await ctx.type(CONTENT_EDITOR, input.content)

    if (input.topics.length) {
      onProgress('添加话题')
      // 光标移到正文末尾另起一段
      for (let i = 0; i < 20; i++) await ctx.press('ArrowDown')
      await ctx.press('Enter')
      for (const topic of input.topics) {
        // 输入 # 触发话题联想，选中第一项才会变成真正的话题标签
        await ctx.insertText(`#${topic}`)
        // 联想结果异步返回，先显示“无结果”，等几秒
        const found = await until(ctx, () => ctx.exists('#creator-editor-topic-container .item'), 5000, '').catch(() => false)
        if (found) {
          // 鼠标移上去列表会整体重新渲染，标记会跟着旧节点丢掉，所以按位置定位，每次重试都能找到新节点
          const index = await ctx.evaluate<number>(`(() => {
            const items = [...document.querySelectorAll('#creator-editor-topic-container > .item')]
            return Math.max(0, items.findIndex((e) => e.querySelector('.name')?.textContent.trim() === ${JSON.stringify(`#${topic}`)}))
          })()`)
          await ctx.click(`#creator-editor-topic-container > .item:nth-child(${index + 1})`)
        } else await ctx.press('Space')
        await ctx.sleep(400)
      }
    }

    const s = input.settings
    if (s.visibility && s.visibility !== '公开可见') {
      onProgress('设置可见范围')
      await ctx.click('div.permission-card-wrapper div.d-select-content')
      await ctx.sleep(400)
      await ctx.click('div.d-dropdown-content div.custom-option', String(s.visibility))
      await ctx.sleep(400)
    }
    if (s.original) {
      onProgress('声明原创')
      await setOriginal(ctx)
    }
    if (s.declaration && s.declaration !== '不声明') {
      onProgress('内容类型声明')
      await setDeclaration(ctx, String(s.declaration))
    }
    if (s.collection && typeof s.collection === 'object') {
      onProgress('添加到合集')
      await selectCollection(ctx, s.collection)
    }

    if (input.dryRun) return {}
    onProgress('提交发布')
    let remoteId: string | undefined
    try {
      const res = await ctx.captureResponse<{ data?: { id?: string; note_id?: string } }>('/web_api/sns/v2/note', () => clickPublish(ctx), 20_000)
      remoteId = res.data?.id ?? res.data?.note_id
    } catch {
      // 没抓到接口不影响发布结果判断，下面以页面跳转为准
    }
    // 发布成功后会跳离发布页（参考 xiaohongshu-mcp 的 waitPublishSuccess）
    await ctx.waitForUrl((u) => !u.includes('/publish/publish'), 20_000).catch(() => {
      throw new Error('点击发布后没有跳转，可能校验没通过或被拦截')
    })
    if (!remoteId) {
      // 接口没带回 id 时，到笔记管理按标题找最新一篇（删除要用）
      onProgress('读取笔记 id')
      remoteId = await findNoteId(ctx, input.title || input.content.split('\n')[0]).catch(() => undefined)
    }
    return { remoteId, url: remoteId ? `https://www.xiaohongshu.com/explore/${remoteId}` : undefined }
  },

  async deleteRemote(ctx, remote) {
    if (!remote.remoteId) throw new Error('没有记录到笔记 id，请到小红书后台手动删除')
    await ctx.goto(NOTE_MANAGER_URL)
    // 笔记卡片的埋点属性里带 noteId
    const id = JSON.stringify(remote.remoteId)
    await until(
      ctx,
      () =>
        ctx.evaluate<boolean>(`(() => {
          const el = [...document.querySelectorAll('.note-card')].find((e) => (e.getAttribute('data-impression') ?? '').includes(${id}))
          if (el) el.setAttribute('data-mxe', 'note-target')
          return !!el
        })()`),
      15_000,
      '笔记管理里没找到这篇笔记，可能已被删除',
    )
    await ctx.click('[data-mxe="note-target"] .note-card__action-btn--del')
    await ctx.sleep(600)
    await ctx.click('.d-modal button, .d-popconfirm button, [role="dialog"] button', '删除').catch(() =>
      ctx.click('.d-modal button, .d-popconfirm button, [role="dialog"] button', '确定'),
    )
    await until(
      ctx,
      async () => !(await ctx.evaluate<boolean>(`[...document.querySelectorAll('.note-card')].some((e) => (e.getAttribute('data-impression') ?? '').includes(${id}))`)),
      15_000,
      '删除后笔记仍在列表里',
    )
  },

  async listCollections(ctx) {
    // 合集列表在上传图片、表单展开时由页面请求，先传一张占位图触发，读完不发布
    await openImageTab(ctx)
    const res = await ctx.captureResponse<{ data?: { collection_info_list?: { id: string; name: string; note_num?: number }[] } }>(
      '/note/collection/pc/list_v2',
      async () => ctx.setFiles('.upload-input', [await placeholderImage()]),
      60_000,
    )
    return (res.data?.collection_info_list ?? []).map((c) => ({ id: c.id, name: c.name.trim(), count: c.note_num }))
  },
}

/** 笔记管理里第一篇文字包含 text 的笔记 id（列表按发布时间倒序） */
async function findNoteId(ctx: BrowserContext, text: string) {
  await ctx.goto(NOTE_MANAGER_URL)
  return until(
    ctx,
    () =>
      ctx.evaluate<string | null>(`(() => {
        const el = [...document.querySelectorAll('.note-card')].find((e) => e.innerText.includes(${JSON.stringify(text.slice(0, 20))}))
        return el ? JSON.parse(el.getAttribute('data-impression') ?? '{}')?.noteTarget?.value?.noteId ?? null : null
      })()`),
    15_000,
    '笔记管理里没找到刚发布的笔记',
  )
}

async function openImageTab(ctx: BrowserContext) {
  await ctx.goto(PUBLISH_URL)
  await ctx.waitFor('div.upload-content', 20_000)
  await ctx.sleep(1000)
  await closeGuides(ctx)
  // 顶部 tab 混有透明的诱饵克隆，只看真实 tab；URL 带 target=image 时通常已经选中
  const active = await ctx.evaluate<boolean>(`(() => {
    const isDecoy = ${IS_DECOY}
    return [...document.querySelectorAll('div.creator-tab.active')].some((e) => !isDecoy(e) && e.textContent.includes('上传图文'))
  })()`)
  if (!active && (await ctx.exists('div.creator-tab'))) {
    await ctx.click('div.creator-tab', '上传图文')
    await ctx.sleep(800)
  }
}

/** 关掉新功能引导浮层 */
async function closeGuides(ctx: BrowserContext) {
  await ctx.sleep(500)
  for (let i = 0; i < 3 && (await ctx.exists('button.feature-guide__close')); i++) {
    await ctx.click('button.feature-guide__close').catch(() => undefined)
    await ctx.sleep(400)
  }
}

async function setOriginal(ctx: BrowserContext) {
  const checked = await ctx.evaluate<boolean | null>(`(() => {
    const card = [...document.querySelectorAll('div.custom-switch-card')].find((c) => c.textContent.includes('原创声明'))
    if (!card) return null
    return !!card.querySelector('input[type="checkbox"]')?.checked
  })()`)
  if (checked === null) throw new Error('没找到原创声明选项')
  if (checked) return
  await clickWithin(ctx, 'div.custom-switch-card', '原创声明', 'div.d-switch')
  await ctx.sleep(800)
  // 确认弹窗：勾选须知，再点“声明原创”
  const agree = await mark(ctx, 'div.footer', '原创声明须知', 'div.d-checkbox')
  if (agree) await ctx.click(agree)
  await ctx.sleep(400)
  await clickWithin(ctx, 'div.footer', '声明原创', 'button.custom-button')
}

async function setDeclaration(ctx: BrowserContext, value: string) {
  await ctx.click('div.d-select-wrapper', '添加内容类型声明')
  await ctx.sleep(600)
  if (SOURCE_DECLARATIONS.includes(value)) {
    // 二级菜单：内容来源声明 → 自主拍摄 / 来源转载
    await ctx.click('div.d-dropdown-content .d-option-name', '内容来源声明')
    await ctx.sleep(800)
  }
  await ctx.click('div.d-dropdown-content .d-option-name', value)
  await ctx.sleep(800)
  // 自主拍摄 / 来源转载会弹框补充拍摄地点、媒体名称，都是选填，取消后声明仍然保留
  if (await ctx.exists('.d-modal.self-shooting-contain')) {
    await ctx.click('.d-modal.self-shooting-contain button', '取消')
    await ctx.sleep(400)
  }
  const shown = await ctx.evaluate<string>(`[...document.querySelectorAll('div.d-select-wrapper')].map((e) => e.innerText).join('|')`)
  if (!shown.includes(value)) throw new Error(`内容类型声明没有选上「${value}」`)
}

async function selectCollection(ctx: BrowserContext, collection: Collection) {
  await ctx.click('div.collection-plugin-button')
  await ctx.sleep(800)
  const item = '.collection-plugin-popover-content .item'
  // 合集多时列表要往下滚才加载
  const target = await until(
    ctx,
    async () => {
      const hit = await ctx.evaluate<boolean>(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(item)})].find((e) => e.textContent.trim() === ${JSON.stringify(collection.name)})
        if (el) { el.setAttribute('data-mxe', 'collection-target'); return true }
        return false
      })()`)
      if (!hit && (await ctx.exists('.collection-plugin-popover-content'))) await ctx.scroll('.collection-plugin-popover-content', 480)
      return hit ? '[data-mxe="collection-target"]' : null
    },
    10_000,
    `合集里没找到「${collection.name}」，可能已被删除或改名`,
  )
  await ctx.click(target)
  await ctx.sleep(500)
}

async function clickPublish(ctx: BrowserContext) {
  // <xhs-publish-btn> 是 closed shadow root 的自定义元素，里面有“暂存离开”和“发布”两个按钮
  await until(
    ctx,
    () =>
      ctx.evaluate<boolean>(`(() => {
        const b = document.querySelector('xhs-publish-btn')
        return !!b && b.getAttribute('submit-disabled') !== 'true' && b.getAttribute('submit-loading') !== 'true'
      })()`),
    15_000,
    '发布按钮一直不可点击',
  )
  await ctx.clickInShadow('xhs-publish-btn', '发布')
}
