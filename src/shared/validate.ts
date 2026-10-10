import type { PlatformLimits, Post } from './types'

const len = (s: string) => [...s].length

/** 按平台限制校验，返回错误信息列表（空数组即通过） */
export function validatePost(post: Pick<Post, 'title' | 'content' | 'images' | 'topics'>, limits: PlatformLimits): string[] {
  const errors: string[] = []
  if (limits.requiresTitle && !post.title.trim()) errors.push('标题不能为空')
  if (limits.titleMax && len(post.title) > limits.titleMax) errors.push(`标题不能超过 ${limits.titleMax} 字`)
  if (len(post.content) > limits.contentMax) errors.push(`正文不能超过 ${limits.contentMax} 字`)
  if (post.images.length < limits.minImages) errors.push(`至少需要 ${limits.minImages} 张图片`)
  if (post.images.length > limits.maxImages) errors.push(`最多 ${limits.maxImages} 张图片`)
  if (limits.maxTopics && post.topics.length > limits.maxTopics) errors.push(`最多 ${limits.maxTopics} 个话题`)
  return errors
}

/** 话题输入归一化：去掉首尾 # 和空白，过滤空值并去重 */
export function normalizeTopics(input: string[]): string[] {
  const out: string[] = []
  for (const raw of input) {
    const t = raw.trim().replace(/^#+|#+$/g, '').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}
