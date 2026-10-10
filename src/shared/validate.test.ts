import { describe, expect, it } from 'vitest'
import { normalizeTopics, validatePost } from './validate'

describe('validatePost', () => {
  it('reports limit violations', () => {
    const errors = validatePost(
      { title: '通用标题', content: '正文', images: [{ path: '/a.jpg' }], topics: ['a', 'b', 'c'] },
      { titleMax: 2, contentMax: 1000, minImages: 2, maxImages: 18, requiresTitle: true, maxTopics: 2 },
    )
    expect(errors).toEqual(['标题不能超过 2 字', '至少需要 2 张图片', '最多 2 个话题'])
  })
})

describe('normalizeTopics', () => {
  it('strips hashes and dedupes', () => {
    expect(normalizeTopics(['#旅行#', ' 旅行', '#美食', '', '##'])).toEqual(['旅行', '美食'])
  })
})
