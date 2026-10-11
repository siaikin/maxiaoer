import { describe, expect, it } from 'vitest'
import { presetSelected, togglePreset } from './topics'

describe('togglePreset', () => {
  it('补齐合集里还没选的话题', () => {
    expect(togglePreset(['旅行'], ['旅行', '自驾', '#露营'])).toEqual({ topics: ['旅行', '自驾', '露营'], dropped: 0 })
  })

  it('已经全选上时再点取消这组', () => {
    expect(togglePreset(['美食', '旅行', '自驾'], ['旅行', '自驾'])).toEqual({ topics: ['美食'], dropped: 0 })
  })

  it('超出平台上限的丢掉并告知个数', () => {
    expect(togglePreset(['a', 'b'], ['c', 'd', 'e'], 3)).toEqual({ topics: ['a', 'b', 'c'], dropped: 2 })
  })

  it('空合集不算已选', () => {
    expect(presetSelected(['a'], [])).toBe(false)
  })
})
