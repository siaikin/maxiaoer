import type { Collection } from '../../shared/types'
import { placeholderImage } from './placeholder'
import type { BrowserContext, PlatformAdapter } from './types'
import { clickWithin, mark, until } from './util'

/**
 * 小红书创作服务平台，登录态浏览器自动化。
 * 发布流程和选择器参考 xpzouying/xiaohongshu-mcp（Apache-2.0）的 xiaohongshu/publish.go，
 * 标 TODO(实测) 的是那边没有覆盖、需要在真实页面上确认的部分。
 */
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official&target=image'
const CONTENT_EDITOR = 'div[role="textbox"][contenteditable="true"], div.tiptap[contenteditable="true"], div.ql-editor'

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
      options: ['不声明', '虚构演绎，仅供娱乐', '笔记含AI合成内容', '已自主标注', '自主拍摄', '来源转载'],
      default: '不声明',
    },
    { key: 'original', label: '原创声明', type: 'switch', default: false },
    { key: 'collection', label: '添加到合集', type: 'collection', default: null },
  ],

  async checkLogin(ctx) {
    await ctx.goto(this.homeUrl)
    await ctx.sleep(1500)
    if (ctx.currentUrl().includes('/login')) return null
    // TODO(实测): 创作平台用户信息接口
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

    onProgress('填写标题和正文')
    if (input.title) await ctx.type('div.d-input input', input.title)
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
        await ctx.sleep(1200)
        if (await ctx.exists('#creator-editor-topic-container .item')) await ctx.click('#creator-editor-topic-container .item')
        else await ctx.press('Space')
        await ctx.sleep(400)
      }
    }

    const s = input.settings
    if (s.visibility && s.visibility !== '公开可见') {
      onProgress('设置可见范围')
      await ctx.click('div.permission-card-wrapper div.d-select-content')
      await ctx.sleep(400)
      await ctx.click('div.d-options-wrapper div.d-grid-item div.custom-option', String(s.visibility))
    }
    if (s.original) {
      onProgress('声明原创')
      await setOriginal(ctx)
    }
    if (s.declaration && s.declaration !== '不声明') {
      onProgress('内容类型声明')
      // TODO(实测): 内容类型声明下拉的选择器
      await clickWithin(ctx, 'div.d-select-wrapper, div.custom-select', '内容类型声明', 'div.d-select-content')
      await ctx.sleep(400)
      await ctx.click('div.d-options-wrapper .custom-option, div.d-options-wrapper .d-option', String(s.declaration))
    }
    if (s.collection && typeof s.collection === 'object') {
      onProgress('添加到合集')
      await selectCollection(ctx, s.collection)
    }

    onProgress('提交发布')
    // TODO(实测): 发布接口路径和返回结构
    let remoteId: string | undefined
    try {
      const res = await ctx.captureResponse<{ data?: { id?: string } }>('/web_api/sns/v2/note', () => clickPublish(ctx), 20_000)
      remoteId = res.data?.id
    } catch {
      // 没抓到接口不影响发布结果判断，下面以页面跳转为准
    }
    // 发布成功后会跳离发布页（参考 xiaohongshu-mcp 的 waitPublishSuccess）
    await ctx.waitForUrl((u) => !u.includes('/publish/publish'), 20_000).catch(() => {
      throw new Error('点击发布后没有跳转，可能校验没通过或被拦截')
    })
    return { remoteId, url: remoteId ? `https://www.xiaohongshu.com/explore/${remoteId}` : undefined }
  },

  async deleteRemote(ctx, remote) {
    if (!remote.remoteId) throw new Error('没有记录到笔记 id，请到小红书后台手动删除')
    await ctx.goto('https://creator.xiaohongshu.com/new/note-manager')
    // TODO(实测): 笔记管理页的卡片结构和删除按钮
    const card = await until(
      ctx,
      () => mark(ctx, 'div.note', remote.remoteId!),
      15_000,
      '笔记管理里没找到这篇笔记，可能已被删除',
    ).catch(async () => {
      const byHtml = await ctx.evaluate<boolean>(`(() => {
        const el = [...document.querySelectorAll('div.note')].find((e) => e.innerHTML.includes(${JSON.stringify(remote.remoteId)}))
        if (el) el.setAttribute('data-mxe', 'note-target')
        return !!el
      })()`)
      if (!byHtml) throw new Error('笔记管理里没找到这篇笔记，可能已被删除')
      return '[data-mxe="note-target"]'
    })
    await ctx.click(`${card} .control.data-del, ${card} span`, '删除')
    await ctx.sleep(500)
    await ctx.click('.d-modal button, .d-popconfirm button', '确定')
    await ctx.sleep(1500)
  },

  async listCollections(ctx) {
    // 合集选项要上传图片后才出现，先传一张占位图把表单打开，读完不发布
    await openImageTab(ctx)
    await ctx.setFiles('.upload-input', [await placeholderImage()])
    await until(ctx, () => ctx.exists('.img-preview-area .pr'), 60_000, '占位图上传超时')
    await ctx.sleep(1000)
    // TODO(实测): 合集下拉的触发器和选项结构
    await clickWithin(ctx, 'div.d-select-wrapper, div.collection-select, div.custom-select', '合集', 'div.d-select-content')
    await ctx.sleep(1000)
    return ctx.evaluate<Collection[]>(`[...document.querySelectorAll('div.d-options-wrapper .custom-option, div.d-options-wrapper .d-option')]
      .map((el, i) => {
        const name = (el.querySelector('.name, .title') ?? el).textContent.trim()
        const count = Number((el.textContent.match(/(\\d+)\\s*篇/) ?? [])[1]) || undefined
        return { id: el.getAttribute('data-id') ?? name ?? String(i), name, count }
      })
      .filter((c) => c.name && !c.name.includes('创建合集'))`)
  },
}

async function openImageTab(ctx: BrowserContext) {
  await ctx.goto(PUBLISH_URL)
  await ctx.waitFor('div.upload-content', 20_000)
  await ctx.sleep(1000)
  // 有浮层挡住时先按 Esc
  if (await ctx.exists('div.d-popover')) await ctx.press('Escape')
  if (await ctx.exists('div.creator-tab')) await ctx.click('div.creator-tab', '上传图文')
  await ctx.sleep(800)
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

async function selectCollection(ctx: BrowserContext, collection: Collection) {
  // TODO(实测): 同 listCollections
  await clickWithin(ctx, 'div.d-select-wrapper, div.collection-select, div.custom-select', '合集', 'div.d-select-content')
  await ctx.sleep(800)
  await ctx.click('div.d-options-wrapper .custom-option, div.d-options-wrapper .d-option', collection.name)
}

async function clickPublish(ctx: BrowserContext) {
  // 新版是 <xhs-publish-btn> 自定义元素，旧版是 .publish-page-publish-btn button.bg-red
  const selector = (await ctx.exists('xhs-publish-btn:not([is-publish="false"])'))
    ? 'xhs-publish-btn:not([is-publish="false"])'
    : '.publish-page-publish-btn button.bg-red'
  await until(
    ctx,
    () =>
      ctx.evaluate<boolean>(`(() => {
        const b = document.querySelector(${JSON.stringify(selector)})
        return !!b && b.getAttribute('submit-disabled') !== 'true' && !b.disabled && b.getAttribute('aria-disabled') !== 'true'
      })()`),
    15_000,
    '发布按钮一直不可点击',
  )
  await ctx.click(selector)
}
