import { describe, expect, it } from 'vitest'
import { commonLimits, resetOverride, setOverride } from './content'
import { contentFor, type PlatformInfo, type Post } from './types'

const platform = (id: PlatformInfo['id'], name: string, limits: Partial<PlatformInfo['limits']>): PlatformInfo => ({
  id,
  name,
  color: '',
  settings: [],
  canDelete: true,
  limits: { contentMax: 1000, minImages: 0, maxImages: 18, requiresTitle: false, ...limits },
})
const weibo = platform('weibo', '微博', { contentMax: 2000 })
const x = platform('x', 'X', { contentMax: 280, maxImages: 4 })
const mp = platform('wechat-mp', '公众号', { titleMax: 20, minImages: 1, maxImages: 20 })

const post = (): Post => ({
  id: 'p',
  title: '通用标题',
  content: '通用正文',
  images: [{ path: '/a.jpg' }],
  topics: ['旅行'],
  overrides: {},
  settings: {},
  createdAt: 0,
  updatedAt: 0,
})

describe('contentFor', () => {
  it('单独设置的字段优先，其余沿用通用', () => {
    const p = post()
    setOverride(p, 'x', 'content', '短')
    expect(contentFor(p, 'x')).toEqual({ title: '通用标题', content: '短', images: [{ path: '/a.jpg' }], topics: ['旅行'] })
    expect(contentFor(p, 'weibo').content).toBe('通用正文')
  })

  it('单独设置为空也算单独设置', () => {
    const p = post()
    setOverride(p, 'x', 'topics', [])
    expect(contentFor(p, 'x').topics).toEqual([])
  })
})

describe('resetOverride', () => {
  it('恢复通用后平台没有单独设置就整个去掉', () => {
    const p = post()
    setOverride(p, 'x', 'content', '短')
    setOverride(p, 'x', 'title', 'T')
    resetOverride(p, 'x', 'content')
    expect(p.overrides).toEqual({ x: { title: 'T' } })
    resetOverride(p, 'x', 'title')
    expect(p.overrides).toEqual({})
  })
})

describe('commonLimits', () => {
  it('取沿用通用内容的平台里最严的限制', () => {
    expect(commonLimits(post(), [weibo, x, mp])).toEqual({
      title: { max: 20, by: '公众号' },
      content: { max: 280, by: 'X' },
      topics: undefined,
      images: { min: 1, max: 4, minBy: '公众号', maxBy: 'X' },
    })
  })

  it('已单独设置的平台不再约束通用内容', () => {
    const p = post()
    setOverride(p, 'x', 'content', '短')
    setOverride(p, 'x', 'images', [])
    expect(commonLimits(p, [weibo, x, mp])).toMatchObject({ content: { max: 1000, by: '公众号' }, images: { min: 1, max: 18, minBy: '公众号', maxBy: '微博' } })
  })
})
