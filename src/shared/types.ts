/** 支持的平台 */
export const PLATFORM_IDS = ['xiaohongshu', 'weibo', 'wechat-mp', 'x', 'facebook'] as const
export type PlatformId = (typeof PLATFORM_IDS)[number]

/** 账号：一个平台上的一个登录身份，对应一个独立的持久化浏览器分区 */
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

export interface Post {
  id: string
  title: string
  content: string
  images: ImageAsset[]
  /** 话题，不带 # */
  topics: string[]
  /** 每个账号的发布配置（谁可以看、内容声明、合集……） */
  settings: Record<string, SettingValues>
  createdAt: number
  updatedAt: number
}

export type PublishTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'deleting' | 'deleted'

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
  remoteId?: string
  url?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

/** 内容限制，用于编辑器实时校验 */
export interface PlatformLimits {
  titleMax?: number
  contentMax: number
  minImages: number
  maxImages: number
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
