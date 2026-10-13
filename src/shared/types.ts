/** 支持的平台 */
export const PLATFORM_IDS = ['xiaohongshu', 'weibo', 'wechat-mp', 'x', 'facebook'] as const
export type PlatformId = (typeof PLATFORM_IDS)[number]

/** 账号：一个平台上的一个登录身份，对应一份独立的指纹浏览器资料 */
export interface Account {
  id: string
  platform: PlatformId
  nickname: string
  avatar?: string
  /** 平台侧用户 id，防止重复添加 */
  uid?: string
  status: 'active' | 'expired' | 'unknown'
  createdAt: number
  checkedAt?: number
}

export interface ImageAsset {
  /** 本地绝对路径 */
  path: string
  /** 像素尺寸和文件大小，选图时读取，用来检查平台限制 */
  width?: number
  height?: number
  bytes?: number
}

/** 发布配置的值，key 对应 PlatformSettingField.key */
export type SettingValues = Record<string, SettingValue>
export type SettingValue = string | boolean | Collection | null

/** 小红书合集 */
export interface Collection {
  id: string
  name: string
  count?: number
}

/** 图片、标题、正文、话题：各平台可以单独改写的部分 */
export interface PostContent {
  title: string
  content: string
  images: ImageAsset[]
  /** 话题，不带 # */
  topics: string[]
}

export const CONTENT_FIELDS = ['images', 'title', 'content', 'topics'] as const satisfies readonly (keyof PostContent)[]
export type ContentField = (typeof CONTENT_FIELDS)[number]

/** 某个平台单独设置的字段；没有出现的字段沿用通用内容 */
export type ContentOverride = Partial<PostContent>

/** 一篇内容：通用稿 + 各平台的单独设置 */
export interface Post extends PostContent {
  id: string
  /** 平台 -> 单独设置的字段 */
  overrides: Partial<Record<PlatformId, ContentOverride>>
  /** 每个账号的发布配置（谁可以看、内容声明、合集……） */
  settings: Record<string, SettingValues>
  createdAt: number
  updatedAt: number
}

/** 某个平台实际发布的内容：单独设置的字段优先，其余沿用通用内容 */
export function contentFor(post: PostContent & { overrides?: Post['overrides'] }, platform: PlatformId): PostContent {
  const o = post.overrides?.[platform] ?? {}
  return {
    title: o.title ?? post.title,
    content: o.content ?? post.content,
    images: o.images ?? post.images,
    topics: o.topics ?? post.topics,
  }
}

/** 话题合集：一组预设话题，发布时一键加入 */
export interface TopicPreset {
  id: string
  name: string
  topics: string[]
}

export type PublishTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'deleting' | 'deleted'

export interface PublishJob {
  id: string
  postId: string
  title: string
  cover?: string
  scheduledAt?: number
  tasks: PublishTask[]
  createdAt: number
}

export interface PublishTask {
  id: string
  accountId: string
  platform: PlatformId
  status: PublishTaskStatus
  progress?: string
  /** 平台作品 id，删除时用 */
  remoteId?: string | number
  url?: string
  error?: string
  /** 不影响发布的提示，例如跳过了超出限制的图片 */
  warning?: string
  startedAt?: number
  finishedAt?: number
}

/** 内容限制，用于编辑器实时校验 */
export interface PlatformLimits {
  titleMax?: number
  contentMax: number
  minImages: number
  maxImages: number
  /** 单张图片的大小上限（字节）。超过的图片编辑时警告，发布时跳过 */
  maxImageBytes?: number
  /** 单张图片最长边的像素上限。超过的图片编辑时警告，发布时跳过 */
  maxImageSide?: number
  requiresTitle: boolean
  maxTopics?: number
}

/** 发布配置字段，渲染进程据此生成表单 */
export type PlatformSettingField =
  | { key: string; label: string; type: 'select'; options: string[]; default: string; help?: string }
  | { key: string; label: string; type: 'switch'; default: boolean; help?: string }
  | { key: string; label: string; type: 'collection'; default: null; help?: string }

export interface PlatformInfo {
  id: PlatformId
  name: string
  color: string
  limits: PlatformLimits
  settings: PlatformSettingField[]
  /** 是否支持从平台删除已发布作品 */
  canDelete: boolean
}

export function defaultSettings(fields: PlatformSettingField[]): SettingValues {
  return Object.fromEntries(fields.map((f) => [f.key, f.default]))
}

/** 默认配置叠加上次的选择；平台改版后已不存在的选项丢弃，回到默认值 */
export function withLastSettings(fields: PlatformSettingField[], last?: SettingValues): SettingValues {
  const values = defaultSettings(fields)
  if (!last) return values
  for (const f of fields) {
    if (!(f.key in last)) continue
    const v = last[f.key]
    if (f.type === 'select' ? typeof v === 'string' && f.options.includes(v) : f.type === 'switch' ? typeof v === 'boolean' : true) values[f.key] = v
  }
  return values
}
