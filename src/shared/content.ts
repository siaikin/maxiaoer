import type { ContentField, PlatformId, PlatformInfo, PlatformLimits, Post, PostContent } from './types'

/** 某个字段的上限，以及是哪个平台的 */
export interface FieldLimit {
  max: number
  by?: string
}

export interface ContentLimits {
  title?: FieldLimit
  content?: FieldLimit
  topics?: FieldLimit
  /** minBy / maxBy：通用页上分别是哪个平台定的下限和上限 */
  images?: { min: number; max: number; minBy?: string; maxBy?: string }
}

/** 单个平台的限制，换成编辑表单用的形式 */
export function platformLimits(l: PlatformLimits): ContentLimits {
  return {
    title: l.titleMax ? { max: l.titleMax } : undefined,
    content: { max: l.contentMax },
    topics: l.maxTopics ? { max: l.maxTopics } : undefined,
    images: { min: l.minImages, max: l.maxImages },
  }
}

/**
 * 通用页显示的限制：只看还在沿用通用内容的平台，取其中最严的，并注明是哪个平台。
 * 已经单独设置了这个字段的平台不再约束通用内容。
 */
export function commonLimits(post: Pick<Post, 'overrides'>, platforms: PlatformInfo[]): ContentLimits {
  const inheriting = (field: ContentField) => platforms.filter((p) => post.overrides[p.id]?.[field] === undefined)
  const strictest = (field: ContentField, pick: (l: PlatformLimits) => number | undefined): FieldLimit | undefined => {
    let best: FieldLimit | undefined
    for (const p of inheriting(field)) {
      const max = pick(p.limits)
      if (max !== undefined && (!best || max < best.max)) best = { max, by: p.name }
    }
    return best
  }
  const imagePlatforms = inheriting('images')
  let images: ContentLimits['images']
  if (imagePlatforms.length) {
    const minP = imagePlatforms.reduce((a, b) => (b.limits.minImages > a.limits.minImages ? b : a))
    const maxP = imagePlatforms.reduce((a, b) => (b.limits.maxImages < a.limits.maxImages ? b : a))
    images = { min: minP.limits.minImages, max: maxP.limits.maxImages, minBy: minP.limits.minImages ? minP.name : undefined, maxBy: maxP.name }
  }
  return {
    title: strictest('title', (l) => l.titleMax),
    content: strictest('content', (l) => l.contentMax),
    topics: strictest('topics', (l) => l.maxTopics),
    images,
  }
}

/** 在平台页改一个字段：写进这个平台的单独设置 */
export function setOverride<F extends ContentField>(post: Pick<Post, 'overrides'>, platform: PlatformId, field: F, value: PostContent[F]) {
  ;(post.overrides[platform] ??= {})[field] = value
}

/** 恢复通用：去掉这个字段的单独设置，平台没有单独设置的字段了就整个去掉 */
export function resetOverride(post: Pick<Post, 'overrides'>, platform: PlatformId, field: ContentField) {
  const o = post.overrides[platform]
  if (!o) return
  delete o[field]
  if (!Object.keys(o).length) delete post.overrides[platform]
}
