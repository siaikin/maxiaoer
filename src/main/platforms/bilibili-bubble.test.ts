import { File } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bilibiliBubble, bubbleContent, parseOpusResponse } from './bilibili-bubble'
import type { BrowserContext, PublishInput } from './types'

vi.mock('./util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./util')>()
  return {
    ...actual,
    // 页面状态在 fake context 中同步更新；仍执行真实条件，但不等待超时。
    async until(_ctx: BrowserContext, condition: () => Promise<unknown>, _timeout: number, message: string) {
      const value = await condition()
      if (!value) throw new Error(message)
      return value
    },
  }
})

const TITLE = 'textarea.title-input__inner'
const EDITOR = '.editor-content .opus-editor[contenteditable="true"]'
const SUBMIT = '.publish-btn'
const REMOTE_ID = '1234567890123456789'
const input = (overrides: Partial<PublishInput> = {}): PublishInput => ({
  title: '模型完成记录', content: '第一台模型完成了', images: [], topics: ['高达'], settings: {}, ...overrides,
})

interface PageOptions {
  loggedIn?: boolean
  draftTitle?: string
  draftContent?: string
  draftId?: string
  localDraft?: boolean
  titleMax?: number
  contentMax?: number
  maxImages?: number
  maxImageBytes?: number
  selectedCategory?: string
  categoryDisabled?: boolean
  uploadResult?: { url: string; width: number; height: number; size: number }
  insertImage?: boolean
  responseBody?: string
  captureError?: string
}

type EditorNode = { type: 'paragraph'; text?: string } | { type: 'enhancedImage'; attrs: Record<string, unknown> }
const nodeSize = (node: EditorNode) => node.type === 'paragraph' ? (node.text?.length ?? 0) + 2 : 1

/** 运行实际页面脚本，避免用表达式子串判断伪造脚本的执行结果。 */
function fakePage(options: PageOptions = {}) {
  const title = { value: options.draftTitle ?? '', maxLength: options.titleMax ?? 20 }
  const checkbox = { checked: false }
  const button = { disabled: false, getAttribute: () => null }
  const location = { href: 'about:blank' }
  const nodes: EditorNode[] = [{ type: 'paragraph', text: options.draftContent ?? '' }]
  const selection = { from: 1, to: 1, node: undefined as EditorNode | undefined }
  const images: Array<{ attrs: Record<string, unknown> }> = []
  const size = () => nodes.reduce((length, node) => length + nodeSize(node), 0)
  const syncImages = () => {
    images.splice(0, images.length, ...nodes.flatMap((node) => node.type === 'enhancedImage' ? [{ attrs: node.attrs }] : []))
  }
  const focusEnd = () => {
    const last = nodes.at(-1)!
    // ProseMirror 文末若是原子图片，会得到 NodeSelection；段落文末则是光标。
    selection.from = last.type === 'enhancedImage' ? size() - nodeSize(last) : size() - 1
    selection.to = last.type === 'enhancedImage' ? size() : selection.from
    selection.node = last.type === 'enhancedImage' ? last : undefined
  }
  const state = {
    get content() { return nodes.flatMap((node) => node.type === 'paragraph' && node.text ? [node.text] : []).join('\n') },
    set content(value: string) {
      nodes.splice(0, nodes.length, { type: 'paragraph', text: value })
      syncImages()
      focusEnd()
    },
    selectedCategory: options.selectedCategory ?? '模型展示',
  }
  const insertContentAt = vi.fn((position: number, content: EditorNode[]) => {
    if (options.insertImage === false) return false
    let offset = 0
    let index = 0
    while (index < nodes.length && offset < position) offset += nodeSize(nodes[index++])
    if (position < 0 || offset !== position) throw new Error('Insertion must use a valid document node boundary')
    nodes.splice(index, 0, ...content)
    syncImages()
    focusEnd()
    return true
  })
  const setImage = (attrs: Record<string, unknown>) => {
    if (options.insertImage === false) return false
    if (selection.node) {
      // 旧 setImage 插入命令会替换已选节点，不能无条件模拟成 append。
      nodes.splice(nodes.indexOf(selection.node), 1, { type: 'enhancedImage', attrs })
    } else {
      let offset = 0
      const index = nodes.findIndex((node) => { offset += nodeSize(node); return offset >= selection.to })
      nodes.splice(index + 1, 0, { type: 'enhancedImage', attrs })
    }
    syncImages()
    focusEnd()
    return true
  }
  const uploadHandler = vi.fn(async (file: File) => options.uploadResult ?? {
    url: `https://image.example.test/${file.name === '模型.png' ? 'model.png' : file.name}`, width: 120, height: 80, size: file.size,
  })
  const categoryOptions = ['模型展示', '技术交流'].map((name) => {
    const attributes = new Map<string, string>()
    return {
      name,
      querySelector: () => ({ textContent: name }),
      classList: { contains: (value: string) => value === 'disabled' && !!options.categoryDisabled },
      getAttribute: (key: string) => attributes.get(key) ?? null,
      setAttribute: (key: string, value: string) => { attributes.set(key, value) },
    }
  })
  const document = {
    querySelector(selector: string) {
      if (selector === TITLE) return title
      if (selector === '.sync-checkbox input[type="checkbox"]') return checkbox
      if (selector === SUBMIT) return button
      throw new Error(`Unexpected querySelector: ${selector}`)
    },
    querySelectorAll(selector: string) {
      if (selector === '.tribee-tag-category-name') return [{ textContent: state.selectedCategory }]
      if (selector === '.tribee-select__dropdown .tribee-select__option') return categoryOptions
      throw new Error(`Unexpected querySelectorAll: ${selector}`)
    },
  }
  const editor = {
    get isEmpty() { return !state.content && images.length === 0 },
    schema: { nodes: { enhancedImage: {}, paragraph: {} } },
    state: { doc: { content: { get size() { return size() } } }, selection },
    storage: {
      biliImage: { allImages: images },
      biliCounter: { characters: () => state.content.length },
    },
    extensionManager: {
      extensions: [
        { name: 'biliImage', options: {
          uploadHandler, limit: options.maxImages ?? 18,
          maxFileSize: options.maxImageBytes ?? 20 * 1024 * 1024, maxGifFileSize: 10 * 1024 * 1024,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        } },
        { name: 'biliCounter', options: { limit: options.contentMax ?? 2000 } },
      ],
    },
    commands: { setImage, insertContentAt },
    chain() {
      let attrs: Record<string, unknown>
      const chain = {
        focus(position: string) {
          if (position !== 'end') throw new Error('Unsupported fake focus position')
          focusEnd()
          return chain
        },
        setImage(value: Record<string, unknown>) { attrs = value; return chain },
        run() {
          return setImage(attrs)
        },
      }
      return chain
    },
  }
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => options.loggedIn === false
      ? { code: -101, message: '账号未登录' }
      : { code: 0, data: { isLogin: true, mid: 123, uname: '测试模友', face: 'https://image.example.test/avatar' } },
  }))
  const draftRead = vi.fn((_key: string) => {
    const request = { result: options.localDraft ? { title: '未恢复的旧草稿' } : undefined, onsuccess: undefined as (() => void) | undefined }
    queueMicrotask(() => request.onsuccess?.())
    return request
  })
  const draftTransaction = vi.fn((_store: string, _mode: string) => ({ objectStore: () => ({ get: draftRead }) }))
  const draftClose = vi.fn()
  const indexedDB = {
    databases: async () => options.localDraft === undefined ? [] : [{ name: 'tribee' }],
    open: vi.fn((_name: string) => {
      const request = {
        result: { objectStoreNames: { contains: () => true }, transaction: draftTransaction, close: draftClose },
        onsuccess: undefined as (() => void) | undefined,
      }
      queueMicrotask(() => request.onsuccess?.())
      return request
    }),
  }
  const sandbox = { document, window: { editor }, location, URL, File, fetch, indexedDB, atob: (s: string) => Buffer.from(s, 'base64').toString('binary') }
  const ctx = {
    goto: vi.fn(async (url: string) => {
      location.href = options.draftId && url.includes('/bubble/publish') ? `${url}&draft_id=${options.draftId}` : url
    }),
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => runInNewContext(expression, sandbox)),
    waitFor: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    click: vi.fn(async (selector: string) => {
      if (selector === '.sync-checkbox label') checkbox.checked = !checkbox.checked
      if (selector === '[data-mxe-bubble-category="target"]') {
        const selected = categoryOptions.find((option) => option.getAttribute('data-mxe-bubble-category') === 'target')
        if (!selected) throw new Error('No category was marked')
        state.selectedCategory = selected.name
      }
    }),
    type: vi.fn(async (selector: string, value: string) => {
      if (selector === TITLE) title.value = value
      else if (selector === EDITOR) state.content = value
      else throw new Error(`Unexpected type: ${selector}`)
    }),
    captureResponse: vi.fn(async <T>(urlPart: string, action: () => Promise<void>, _timeout?: number, parse?: (body: string) => T): Promise<T> => {
      expect(urlPart).toBe('/x/dynamic/feed/create/opus')
      await action()
      if (options.captureError) throw new Error(options.captureError)
      const body = options.responseBody ?? `{"code":0,"data":{"dyn_id":${REMOTE_ID}}}`
      return parse ? parse(body) : JSON.parse(body)
    }),
  }
  return { ctx: ctx as typeof ctx & BrowserContext, state, title, checkbox, images, nodes, editor, insertContentAt, uploadHandler, fetch, draftRead, draftTransaction, draftClose }
}

const temporaryDirs: string[] = []
async function imageFile(name = '模型.png', bytes = [1, 2, 3]) {
  const dir = await mkdtemp(join(tmpdir(), 'maxiaoer-bubble-test-'))
  temporaryDirs.push(dir)
  const path = join(dir, name)
  await writeFile(path, new Uint8Array(bytes))
  return path
}
afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('模型小站内容与响应', () => {
  it.each([REMOTE_ID, `"${REMOTE_ID}"`])('保留 19 位帖子 ID 原文：%s', (value) => {
    expect(parseOpusResponse(`{"code":0,"data":{"dyn_id": ${value} }}`)).toEqual({ code: 0, data: { dyn_id: REMOTE_ID } })
  })

  it('正文保留原文，话题去重清理后追加；空正文不产生开头换行', () => {
    expect(bubbleContent({ content: '正文\n第二行', topics: [' #高达# ', '高达', '', '##模型##'] })).toBe('正文\n第二行\n#高达# #模型#')
    expect(bubbleContent({ content: '', topics: ['#模型#'] })).toBe('#模型#')
    expect(bubbleContent({ content: '正文', topics: [] })).toBe('正文')
  })
})

describe('模型小站发布', () => {
  it('试运行填写独立标题、正文和话题，选择分区和同步选项，但不提交', async () => {
    const { ctx, state, title, checkbox } = fakePage()
    const post = input({ dryRun: true, settings: { category: '技术交流', syncDynamic: true } })
    await expect(bilibiliBubble.publish(ctx, post, vi.fn())).resolves.toEqual({})
    expect(title.value).toBe(post.title)
    expect(state.content).toBe(`${post.content}\n#高达#`)
    expect(state.selectedCategory).toBe('技术交流')
    expect(checkbox.checked).toBe(true)
    expect(ctx.captureResponse).not.toHaveBeenCalled()
    expect(ctx.click).not.toHaveBeenCalledWith(SUBMIT)
  })

  it('上传原始文件，插入完成图片后只提交一次，并解析完整帖子 ID', async () => {
    const path = await imageFile()
    const { ctx, images, uploadHandler } = fakePage()
    await expect(bilibiliBubble.publish(ctx, input({ images: [path] }), vi.fn())).resolves.toEqual({
      remoteId: REMOTE_ID, url: `https://www.bilibili.com/opus/${REMOTE_ID}`,
    })
    expect(uploadHandler).toHaveBeenCalledOnce()
    const file = uploadHandler.mock.calls[0][0]
    expect({ name: file.name, type: file.type, size: file.size }).toEqual({ name: '模型.png', type: 'image/png', size: 3 })
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3])
    expect(images).toEqual([{ attrs: expect.objectContaining({ status: 1, 'data-url': 'https://image.example.test/model.png', 'data-width': 120 }) }])
    expect(ctx.captureResponse).toHaveBeenCalledWith('/x/dynamic/feed/create/opus', expect.any(Function), 60_000, parseOpusResponse)
    expect(ctx.click.mock.calls.filter(([selector]) => selector === SUBMIT)).toHaveLength(1)
  })

  it('连续上传三张不同图片按顺序追加，保留正文和话题，不受当前选区影响', async () => {
    const paths = await Promise.all(['front.png', 'side.png', 'back.png'].map((name, index) => imageFile(name, [index + 1])))
    const { ctx, state, images, nodes, editor, uploadHandler } = fakePage()
    uploadHandler.mockImplementation(async (file) => {
      // 上传返回时用户仍可能选中正文；追加图片不得用该选区替换文档。
      editor.state.selection.from = 0
      editor.state.selection.to = editor.state.doc.content.size
      editor.state.selection.node = undefined
      return { url: `https://image.example.test/${file.name}`, width: 120, height: 80, size: file.size }
    })
    const post = input({ content: '模型正面与侧面\n背部细节', images: paths })
    await expect(bilibiliBubble.publish(ctx, post, vi.fn())).resolves.toEqual({ remoteId: REMOTE_ID, url: `https://www.bilibili.com/opus/${REMOTE_ID}` })
    expect(images.map((image) => image.attrs['data-url'])).toEqual(['front.png', 'side.png', 'back.png'].map((name) => `https://image.example.test/${name}`))
    expect(state.content).toBe(`${post.content}\n#高达#`)
    expect(nodes[0]).toEqual({ type: 'paragraph', text: `${post.content}\n#高达#` })
    expect(editor.state.doc.content.size).toBe(state.content.length + 2 + 3 * (1 + 2))
    expect(uploadHandler).toHaveBeenCalledTimes(3)
    expect(ctx.click.mock.calls.filter(([selector]) => selector === SUBMIT)).toHaveLength(1)
  })

  it('插入回调误用选区、替换上一张图片时停止提交', async () => {
    const paths = await Promise.all(['front.png', 'side.png', 'back.png'].map((name) => imageFile(name)))
    const { ctx, editor, insertContentAt, images, state, uploadHandler } = fakePage()
    // 注入实发遇到的旧实现，证明模型确实复现文末图片被选中并替换的行为。
    insertContentAt.mockImplementation((_position, content) => {
      const image = content.find((node) => node.type === 'enhancedImage')!
      return editor.chain().focus('end').setImage(image.attrs).run()
    })
    const post = input({ images: paths })
    await expect(bilibiliBubble.publish(ctx, post, vi.fn())).rejects.toThrow('图片插入后数量或顺序不正确')
    expect(images.map((image) => image.attrs['data-url'])).toEqual(['https://image.example.test/side.png'])
    expect(state.content).toBe(`${post.content}\n#高达#`)
    expect(uploadHandler).toHaveBeenCalledTimes(2)
    expect(ctx.captureResponse).not.toHaveBeenCalled()
    expect(ctx.click).not.toHaveBeenCalledWith(SUBMIT)
  })

  it.each([
    ['服务端拒绝', '{"code":-403,"message":"没有发帖权限"}', '没有发帖权限'],
    ['没有帖子 ID', '{"code":0,"data":{}}', '未返回有效帖子 ID'],
    ['非法帖子 ID', '{"code":0,"data":{"dyn_id":"undefined"}}', '未返回有效帖子 ID'],
  ])('%s 时不报告成功或重试提交', async (_label, responseBody, message) => {
    const { ctx } = fakePage({ responseBody })
    await expect(bilibiliBubble.publish(ctx, input(), vi.fn())).rejects.toThrow(message)
    expect(ctx.click.mock.calls.filter(([selector]) => selector === SUBMIT)).toHaveLength(1)
  })

  it('等待响应失败时要求人工核对，不重复点击发布', async () => {
    const { ctx } = fakePage({ captureError: '等待接口响应超时' })
    await expect(bilibiliBubble.publish(ctx, input(), vi.fn())).rejects.toThrow('请先进入后台核对后再重试')
    expect(ctx.click.mock.calls.filter(([selector]) => selector === SUBMIT)).toHaveLength(1)
  })

  it('登录过期时不打开发布页、不填写或提交', async () => {
    const { ctx } = fakePage({ loggedIn: false })
    await expect(bilibiliBubble.publish(ctx, input(), vi.fn())).rejects.toThrow('登录已失效')
    expect(ctx.goto).toHaveBeenCalledTimes(1)
    expect(ctx.type).not.toHaveBeenCalled()
    expect(ctx.captureResponse).not.toHaveBeenCalled()
  })

  it.each([{ draftTitle: '旧标题' }, { draftContent: '旧正文' }, { draftId: '12345' }])('恢复草稿时阻止覆盖：%j', async (options) => {
    const { ctx } = fakePage(options)
    await expect(bilibiliBubble.publish(ctx, input(), vi.fn())).rejects.toThrow('恢复了已有草稿')
    expect(ctx.type).not.toHaveBeenCalled()
    expect(ctx.captureResponse).not.toHaveBeenCalled()
  })

  it('只读检查当前账号在模型小站的本地草稿，在打开编辑器前停止', async () => {
    const { ctx, draftRead, draftTransaction, draftClose } = fakePage({ localDraft: true })
    await expect(bilibiliBubble.publish(ctx, input(), vi.fn())).rejects.toThrow('有未处理的草稿')
    expect(draftRead).toHaveBeenCalledWith('26-123')
    expect(draftTransaction).toHaveBeenCalledWith('user-drafts', 'readonly')
    expect(draftClose).toHaveBeenCalledOnce()
    expect(ctx.goto).toHaveBeenCalledTimes(1)
    expect(ctx.type).not.toHaveBeenCalled()
    expect(ctx.captureResponse).not.toHaveBeenCalled()
  })

  it.each([
    [{ titleMax: 3 }, { title: '模型😀' }, '标题不能超过 3'],
    [{ contentMax: 4 }, { content: '模型', topics: ['高达'] }, '正文与话题合计不能超过 4'],
    [{ maxImages: 1 }, { images: ['first.png', 'second.png'] }, '最多 1 张图片'],
  ] satisfies Array<[PageOptions, Partial<PublishInput>, string]>)('遵守页面返回的限制：%j', async (limits, overrides, message) => {
    const { ctx } = fakePage(limits)
    await expect(bilibiliBubble.publish(ctx, input(overrides), vi.fn())).rejects.toThrow(message)
    expect(ctx.type).not.toHaveBeenCalled()
    expect(ctx.captureResponse).not.toHaveBeenCalled()
  })

  it('分区不可用时停止，不填写内容或提交', async () => {
    const { ctx } = fakePage({ categoryDisabled: true })
    await expect(bilibiliBubble.publish(ctx, input({ settings: { category: '技术交流' } }), vi.fn())).rejects.toThrow('没有可用的「技术交流」分区')
    expect(ctx.type).not.toHaveBeenCalled()
    expect(ctx.captureResponse).not.toHaveBeenCalled()
  })

  it('图片超限时在上传任何文件前停止', async () => {
    const path = await imageFile()
    const { ctx, uploadHandler } = fakePage({ maxImageBytes: 2 })
    await expect(bilibiliBubble.publish(ctx, input({ images: [path] }), vi.fn())).rejects.toThrow('超过模型小站')
    expect(uploadHandler).not.toHaveBeenCalled()
    expect(ctx.captureResponse).not.toHaveBeenCalled()
  })

  it.each([
    [{ uploadResult: { url: '', width: 120, height: 80, size: 3 } }, '图片上传失败'],
    [{ insertImage: false }, '没有插入模型小站正文'],
  ] satisfies Array<[PageOptions, string]>)('上传或插入图片失败时禁止提交：%j', async (options, message) => {
    const path = await imageFile()
    const { ctx, images } = fakePage(options)
    await expect(bilibiliBubble.publish(ctx, input({ images: [path] }), vi.fn())).rejects.toThrow(message)
    expect(images).toHaveLength(0)
    expect(ctx.captureResponse).not.toHaveBeenCalled()
    expect(ctx.click).not.toHaveBeenCalledWith(SUBMIT)
  })
})
