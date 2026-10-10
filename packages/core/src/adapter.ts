import type { Account, ImageAsset, PlatformId, Post } from './types'

/** 每个平台的内容限制，用于编辑器实时校验 */
export interface PlatformLimits {
  titleMax?: number
  contentMax: number
  minImages: number
  maxImages: number
  /** 是否必须有标题 */
  requiresTitle: boolean
}

/**
 * 浏览器自动化上下文，由桌面端主进程实现（基于 Electron webContents + CDP）。
 * 适配器只依赖这个接口，不直接依赖 Electron，方便单测和以后换 Playwright。
 */
export interface BrowserContext {
  goto(url: string): Promise<void>
  waitFor(selector: string, timeoutMs?: number): Promise<void>
  click(selector: string): Promise<void>
  /** 在可编辑元素（input / textarea / contenteditable）里输入文字 */
  type(selector: string, text: string): Promise<void>
  /** 给 <input type=file> 设置本地文件 */
  setFiles(selector: string, files: string[]): Promise<void>
  evaluate<T>(expression: string): Promise<T>
  currentUrl(): string
  sleep(ms: number): Promise<void>
}

/** API 模式的上下文：拿到解密后的凭据和一个 fetch */
export interface ApiContext {
  credentials: Record<string, string>
  fetch: typeof fetch
  /** 读取本地文件为 Blob，用于 multipart 上传 */
  readFile(path: string): Promise<Blob>
}

export interface PublishOptions {
  onProgress?: (message: string) => void
  signal?: AbortSignal
}

export interface PublishResult {
  url?: string
  /** 平台返回的作品 id */
  remoteId?: string
}

export interface AccountProfile {
  nickname: string
  avatar?: string
  /** 平台侧的用户 id，用来防止同一账号重复添加 */
  uid?: string
}

interface AdapterBase {
  id: PlatformId
  name: string
  /** 平台图标（renderer 用） */
  icon: string
  limits: PlatformLimits
}

export interface BrowserAdapter extends AdapterBase {
  mode: 'browser'
  loginUrl: string
  /** 登录后检测：返回资料表示已登录，返回 null 表示未登录 / 已失效 */
  checkLogin(ctx: BrowserContext): Promise<AccountProfile | null>
  publish(ctx: BrowserContext, post: ResolvedPost, opts: PublishOptions): Promise<PublishResult>
}

export interface ApiAdapter extends AdapterBase {
  mode: 'api'
  /** 需要用户填写的凭据字段，用于渲染“添加账号”表单 */
  credentialFields: { key: string; label: string; secret?: boolean }[]
  checkLogin(ctx: ApiContext): Promise<AccountProfile | null>
  publish(ctx: ApiContext, post: ResolvedPost, opts: PublishOptions): Promise<PublishResult>
}

export type PlatformAdapter = BrowserAdapter | ApiAdapter

/** 合并平台覆盖后的最终内容 */
export interface ResolvedPost {
  title: string
  content: string
  html?: string
  images: ImageAsset[]
  topics: string[]
}

export function resolvePost(post: Post, platform: PlatformId): ResolvedPost {
  const o = post.overrides?.[platform] ?? {}
  return {
    title: o.title ?? post.title,
    content: o.content ?? post.content,
    html: o.html ?? post.html,
    images: o.images ?? post.images,
    topics: o.topics ?? post.topics,
  }
}

/** 按平台限制校验，返回错误信息列表（空数组即通过） */
export function validatePost(post: ResolvedPost, limits: PlatformLimits): string[] {
  const errors: string[] = []
  if (limits.requiresTitle && !post.title.trim()) errors.push('标题不能为空')
  if (limits.titleMax && [...post.title].length > limits.titleMax) errors.push(`标题不能超过 ${limits.titleMax} 字`)
  if ([...post.content].length > limits.contentMax) errors.push(`正文不能超过 ${limits.contentMax} 字`)
  if (post.images.length < limits.minImages) errors.push(`至少需要 ${limits.minImages} 张图片`)
  if (post.images.length > limits.maxImages) errors.push(`最多 ${limits.maxImages} 张图片`)
  return errors
}

export type { Account }
