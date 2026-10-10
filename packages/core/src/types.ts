/** 支持的平台 */
export const PLATFORM_IDS = ['xiaohongshu', 'weibo', 'wechat-mp', 'x', 'facebook'] as const
export type PlatformId = (typeof PLATFORM_IDS)[number]

/** 账号：一个平台上的一个登录身份。浏览器模式下每个账号对应一个独立的持久化 session 分区。 */
export interface Account {
  id: string
  platform: PlatformId
  /** 平台上的昵称 / 头像，登录成功后从页面抓取 */
  nickname: string
  avatar?: string
  /** 分组，对应蚁小二的“账号分组” */
  group?: string
  status: 'active' | 'expired' | 'unknown'
  /** API 模式的凭据引用（实际密钥存在系统钥匙串，不落盘明文） */
  credentialRef?: string
  createdAt: number
  checkedAt?: number
}

export interface ImageAsset {
  /** 本地绝对路径 */
  path: string
  width?: number
  height?: number
}

/** 一篇图文草稿：一份通用内容，可按平台覆盖 */
export interface Post {
  id: string
  title: string
  /** 纯文本正文；公众号等富文本平台可用 html 覆盖 */
  content: string
  html?: string
  images: ImageAsset[]
  /** 话题 / 标签，不带 # */
  topics: string[]
  /** 按平台覆盖的字段，对应蚁小二“单独设置每个平台” */
  overrides?: Partial<Record<PlatformId, Partial<Pick<Post, 'title' | 'content' | 'html' | 'images' | 'topics'>>>>
  createdAt: number
  updatedAt: number
}

export type PublishTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

/** 一次发布 = 一篇 Post × 多个账号，每个账号一个子任务 */
export interface PublishJob {
  id: string
  postId: string
  title: string
  /** 定时发布时间，空为立即 */
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
  /** 发布成功后的作品链接 */
  url?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}
