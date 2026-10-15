import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { normalizeTopics } from '../../shared/validate'
import type { AccountProfile, BrowserContext, PlatformAdapter, PublishInput } from './types'
import { imageMime, until } from './util'

const HOME_URL = 'https://www.bilibili.com/bubble/home/26'
const PUBLISH_URL = 'https://www.bilibili.com/bubble/publish?tribee_id=26&tribee_name=%E6%A8%A1%E5%9E%8B%E5%B0%8F%E7%AB%99'
const TITLE = 'textarea.title-input__inner'
const EDITOR = '.editor-content .opus-editor[contenteditable="true"]'
const CATEGORY = '.tribee-tag-category-name'
const SUBMIT = '.publish-btn'
const CATEGORIES = ['模型展示', '模友热聊', '技术交流', '求助', '评测', '水区', '入站申请']
const q = JSON.stringify

interface OpusResponse {
  code?: number
  message?: string
  data?: { dyn_id?: string }
}

/** 官方响应可能直接返回 19 位整数，必须在 JSON.parse 前保留其原文。 */
export function parseOpusResponse(body: string): OpusResponse {
  return JSON.parse(body.replace(/("dyn_id"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'))
}

/** 小站的标签放在正文末尾，标题使用独立字段。 */
export function bubbleContent(input: Pick<PublishInput, 'content' | 'topics'>): string {
  return [input.content, normalizeTopics(input.topics).map((t) => `#${t}#`).join(' ')].filter(Boolean).join('\n')
}

interface EditorLimits {
  titleMax: number
  contentMax: number
  maxImages: number
  maxImageBytes: number
  maxGifBytes: number
  mimeTypes: string[]
}

/**
 * 模型小站（固定 tribee_id=26）。选择器和图片节点按 2026-10 官方
 * tribee-pc/assets/Publish-CgUH4OcJ.js 核对；提交由页面处理签名与风控。
 */
export const bilibiliBubble: PlatformAdapter = {
  id: 'bilibili-bubble',
  name: '哔哩哔哩·模型小站',
  color: '#00aeec',
  loginUrl: `https://passport.bilibili.com/login?gourl=${encodeURIComponent(HOME_URL)}`,
  homeUrl: HOME_URL,
  limits: { titleMax: 20, contentMax: 2000, minImages: 0, maxImages: 18, maxImageBytes: 20 * 1024 * 1024, requiresTitle: true },
  settings: [
    { key: 'category', label: '小站分区', type: 'select', options: CATEGORIES, default: '模型展示', help: '发布到模型小站；账号须具备所选分区的发帖权限。' },
    { key: 'syncDynamic', label: '同步至动态', type: 'switch', default: false, help: '开启后也会发布到哔哩哔哩个人动态。话题以 #标签# 文字附在正文末尾。' },
  ],

  async checkLogin(ctx) {
    await ctx.goto(HOME_URL)
    return readProfile(ctx)
  },

  async publish(ctx, input, onProgress) {
    const content = bubbleContent(input)
    const category = input.settings.category ?? '模型展示'
    if (typeof category !== 'string' || !CATEGORIES.includes(category)) throw new Error('请选择有效的模型小站分区')
    if (!input.title.trim()) throw new Error('模型小站标题不能为空')
    if (input.title.includes('\n') || input.title.includes('\r')) throw new Error('模型小站标题不能换行')

    onProgress('检查哔哩哔哩登录状态')
    await ctx.goto(HOME_URL)
    const profile = await readProfile(ctx)
    if (!profile) throw new Error('哔哩哔哩登录已失效，请重新登录')
    // 先在首页查草稿，避免编辑器出现后仍在异步恢复/迁移旧稿的竞态。
    if (await hasLocalDraft(ctx, profile.uid!)) throw new Error('模型小站有未处理的草稿，请先进入后台处理草稿后重试，避免覆盖原有内容')
    onProgress('打开模型小站发布页')
    await ctx.goto(PUBLISH_URL)
    await ctx.waitFor(EDITOR, 25_000)
    await until(ctx, () => ctx.evaluate<boolean>('!!window.editor?.storage?.biliImage && !!window.editor?.storage?.biliCounter'), 10_000, '模型小站编辑器未加载完成')
    // 官方会自动恢复旧草稿及封面、定时、跨小站等设置，不能把它们混进本次发布。
    const draft = await ctx.evaluate<boolean>(`(() => {
      const url = new URL(location.href)
      if (url.pathname !== '/bubble/publish' || url.searchParams.get('tribee_id') !== '26') throw new Error('没有进入模型小站发布页')
      return url.searchParams.has('draft_id') || !!document.querySelector(${q(TITLE)})?.value.trim() || !window.editor.isEmpty
    })()`)
    if (draft) throw new Error('模型小站恢复了已有草稿，请先进入后台处理草稿后重试，避免覆盖原有内容')

    const limits = await ctx.evaluate<EditorLimits>(`(() => {
      const extensions = window.editor.extensionManager.extensions
      const image = extensions.find((e) => e.name === 'biliImage')?.options
      const counter = extensions.find((e) => e.name === 'biliCounter')?.options
      if (!image || typeof image.uploadHandler !== 'function' || !counter) throw new Error('模型小站编辑器已改版，请更新渠道适配')
      return {
        titleMax: document.querySelector(${q(TITLE)})?.maxLength,
        contentMax: counter.limit, maxImages: image.limit,
        maxImageBytes: image.maxFileSize, maxGifBytes: image.maxGifFileSize,
        mimeTypes: image.allowedMimeTypes,
      }
    })()`)
    validateLimits(limits, input, content)
    // 先检查全部图片，避免传到一半才发现格式或大小不合要求。
    for (const path of input.images) {
      const mime = imageMime(path)
      if (!limits.mimeTypes.includes(mime)) throw new Error(`模型小站不支持图片格式：${basename(path)}`)
      const max = mime === 'image/gif' ? limits.maxGifBytes : limits.maxImageBytes
      if ((await stat(path)).size > max) throw new Error(`图片「${basename(path)}」超过模型小站 ${max / 1024 / 1024}MB 限制`)
    }

    onProgress('设置小站分区')
    await selectCategory(ctx, category)
    const sync = input.settings.syncDynamic === true
    const readSync = () => ctx.evaluate<boolean | null>(`document.querySelector('.sync-checkbox input[type="checkbox"]')?.checked ?? null`)
    const currentSync = await readSync()
    if (currentSync === null) throw new Error('没有找到「同步至动态」设置')
    if (currentSync !== sync) await ctx.click('.sync-checkbox label')
    await until(ctx, async () => (await readSync()) === sync, 3000, '「同步至动态」设置未生效')

    onProgress('填写标题和正文')
    await ctx.type(TITLE, input.title)
    await ctx.type(EDITOR, content)
    for (const [index, path] of input.images.entries()) {
      onProgress(`上传图片 ${index + 1}/${input.images.length}`)
      await uploadImage(ctx, path)
    }

    // 原生编辑器会过滤未完成的图片；提交前逐张核对，禁止静默丢图。
    await until(ctx, () => ctx.evaluate<boolean>(`(() => {
      const images = window.editor.storage.biliImage.allImages
      return images.length === ${input.images.length} && images.every((image) => image.attrs.status === 1 && !!image.attrs['data-url'])
    })()`), 10_000, '模型小站图片没有全部上传成功，已停止发布')
    const ready = await ctx.evaluate<boolean>(`(() => {
      const button = document.querySelector(${q(SUBMIT)})
      return document.querySelector(${q(TITLE)})?.value === ${q(input.title)}
        && window.editor.storage.biliCounter.characters() <= ${limits.contentMax}
        && !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
    })()`)
    if (!ready) throw new Error('模型小站内容校验未通过，请检查标题、正文和发帖权限')
    if (input.dryRun) return {}

    onProgress('提交到模型小站')
    let response: OpusResponse
    try {
      // 只提交一次；超时可能已经发布，不能自动再次点击造成重复帖。
      response = await ctx.captureResponse<OpusResponse>('/x/dynamic/feed/create/opus', () => ctx.click(SUBMIT), 60_000, parseOpusResponse)
    } catch (error) {
      throw new Error(`未能确认模型小站发布结果，请先进入后台核对后再重试：${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.code !== 0) throw new Error(response.message || '模型小站返回发布失败')
    const id = response.data?.dyn_id
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) throw new Error('模型小站未返回有效帖子 ID，请先进入后台核对后再重试')
    return { remoteId: id, url: `https://www.bilibili.com/opus/${id}` }
  },
}

async function readProfile(ctx: BrowserContext): Promise<AccountProfile | null> {
  return ctx.evaluate(`(async () => {
    const response = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
    if (!response.ok) throw new Error('哔哩哔哩登录检查失败：HTTP ' + response.status)
    const body = await response.json()
    if (body.code === -101 || (body.code === 0 && body.data?.isLogin === false)) return null
    if (body.code !== 0) throw new Error(body.message || '哔哩哔哩登录检查失败')
    const user = body.data
    if (!user?.isLogin || !user.mid || !user.uname) throw new Error('哔哩哔哩没有返回有效账号信息')
    return { uid: String(user.mid), nickname: user.uname, avatar: user.face || undefined }
  })()`)
}

async function hasLocalDraft(ctx: BrowserContext, uid: string): Promise<boolean> {
  return ctx.evaluate(`(async () => {
    const databases = await indexedDB.databases()
    if (!databases.some((database) => database.name === 'tribee')) return false
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('tribee')
      request.onupgradeneeded = () => request.transaction.abort()
      request.onerror = () => reject(new Error('无法检查模型小站草稿，请进入后台确认后重试'))
      request.onblocked = () => reject(new Error('模型小站草稿正被其他窗口占用，请关闭后台后重试'))
      request.onsuccess = () => {
        const db = request.result
        try {
          if (!db.objectStoreNames.contains('user-drafts')) throw new Error('模型小站草稿存储已改版')
          const transaction = db.transaction('user-drafts', 'readonly')
          const read = transaction.objectStore('user-drafts').get(${q(`26-${uid}`)})
          read.onsuccess = () => resolve(!!read.result)
          read.onerror = () => reject(new Error('无法读取模型小站草稿'))
          transaction.onabort = () => reject(new Error('模型小站草稿检查被中断'))
        } catch (error) { reject(error) }
        finally { db.close() }
      }
    })
  })()`)
}

function validateLimits(limits: EditorLimits, input: PublishInput, content: string) {
  for (const value of [limits.titleMax, limits.contentMax, limits.maxImages, limits.maxImageBytes, limits.maxGifBytes]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('无法读取模型小站的内容限制，请更新渠道适配')
  }
  if (!Array.isArray(limits.mimeTypes)) throw new Error('无法读取模型小站支持的图片格式')
  // 官方用 JS length 计数，包括 emoji 占用的两个 UTF-16 单元。
  if (input.title.length > limits.titleMax) throw new Error(`模型小站标题不能超过 ${limits.titleMax} 字（表情可能占 2 字）`)
  if (content.length > limits.contentMax) throw new Error(`模型小站正文与话题合计不能超过 ${limits.contentMax} 字`)
  if (input.images.length > limits.maxImages) throw new Error(`模型小站最多 ${limits.maxImages} 张图片`)
}

async function selectCategory(ctx: BrowserContext, category: string) {
  const selected = () => ctx.evaluate<boolean>(`[...document.querySelectorAll(${q(CATEGORY)})].some((e) => e.textContent.trim() === ${q(category)})`)
  if (await selected()) return
  const trigger = '.tribee-category .tribee-select__trigger'
  if (!(await ctx.exists(trigger))) throw new Error(`当前账号不能选择「${category}」，请先在模型小站确认入站和分区权限`)
  await ctx.click(trigger)
  await ctx.waitFor('.tribee-select__dropdown .tribee-select__option', 5000)
  const found = await ctx.evaluate<boolean>(`(() => {
    const option = [...document.querySelectorAll('.tribee-select__dropdown .tribee-select__option')]
      .find((e) => e.querySelector('.tribee-select__option-label')?.textContent.trim() === ${q(category)})
    if (!option || option.classList.contains('disabled') || option.getAttribute('aria-disabled') === 'true') return false
    option.setAttribute('data-mxe-bubble-category', 'target')
    return true
  })()`)
  if (!found) throw new Error(`当前账号没有可用的「${category}」分区，请进入模型小站确认发帖权限`)
  await ctx.click('[data-mxe-bubble-category="target"]')
  await until(ctx, selected, 5000, `模型小站分区没有选成「${category}」`)
}

async function uploadImage(ctx: BrowserContext, path: string) {
  const bytes = await readFile(path)
  // 工具栏临时创建的文件框会立即移除，复用官方上传回调与图片命令；签名、CSRF 仍由页面处理。
  await ctx.evaluate(`(async () => {
    const editor = window.editor
    const options = editor.extensionManager.extensions.find((e) => e.name === 'biliImage')?.options
    if (!options?.uploadHandler || !editor.commands.insertContentAt || !editor.schema.nodes.enhancedImage) throw new Error('模型小站图片编辑器已改版')
    const bytes = Uint8Array.from(atob(${q(bytes.toString('base64'))}), (c) => c.charCodeAt(0))
    const file = new File([bytes], ${q(basename(path))}, { type: ${q(imageMime(path))} })
    const max = file.type === 'image/gif' ? options.maxGifFileSize : options.maxFileSize
    if (!options.allowedMimeTypes.includes(file.type) || file.size > max) throw new Error('图片格式或大小超过模型小站限制')
    const image = await options.uploadHandler(file)
    if (!image?.url || !(image.width > 0) || !(image.height > 0)) throw new Error('模型小站图片上传失败')
    const previousImages = editor.storage.biliImage.allImages.map((item) => item.attrs['data-url'])
    // 文末为图片时 focus('end') 会选中该图片，setImage 会替换它；显式追加到文档末尾。
    const inserted = editor.commands.insertContentAt(editor.state.doc.content.size, [
      { type: 'enhancedImage', attrs: {
        src: image.url, status: 1, alt: '[图片]',
        'data-url': image.url, 'data-width': image.width, 'data-height': image.height,
        'data-size': image.size, 'data-ai-gen-pic': image.ai_gen_pic || 0,
      } },
      { type: 'paragraph' },
    ])
    if (!inserted) throw new Error('图片已上传，但没有插入模型小站正文')
    const images = editor.storage.biliImage.allImages
    if (images.length !== previousImages.length + 1
      || previousImages.some((url, index) => images[index].attrs['data-url'] !== url)
      || images[images.length - 1].attrs['data-url'] !== image.url) {
      throw new Error('模型小站图片插入后数量或顺序不正确，已停止发布')
    }
  })()`)
}
