import { describe, expect, it } from 'vitest'
import { resolvePost, validatePost } from './adapter'
import type { Post } from './types'

const post: Post = {
  id: 'p1',
  title: '通用标题',
  content: '正文',
  images: [{ path: '/a.jpg' }],
  topics: ['旅行'],
  overrides: { weibo: { title: '' } },
  createdAt: 0,
  updatedAt: 0,
}

describe('resolvePost', () => {
  it('applies per-platform overrides', () => {
    expect(resolvePost(post, 'weibo').title).toBe('')
    expect(resolvePost(post, 'xiaohongshu').title).toBe('通用标题')
  })
})

describe('validatePost', () => {
  it('reports limit violations', () => {
    const errors = validatePost(resolvePost(post, 'xiaohongshu'), {
      titleMax: 2,
      contentMax: 1000,
      minImages: 2,
      maxImages: 18,
      requiresTitle: true,
    })
    expect(errors).toEqual(['标题不能超过 2 字', '至少需要 2 张图片'])
  })
})
