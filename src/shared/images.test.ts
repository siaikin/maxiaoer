import { describe, expect, it } from 'vitest'
import { imageProblem, skippedText, splitImages } from './images'

const limits = { maxImageBytes: 5_000_000, maxImageSide: 16384 }

describe('imageProblem', () => {
  it('没超出限制时返回 undefined', () => {
    expect(imageProblem({ path: 'a', width: 1968, height: 9089, bytes: 2_600_000 }, limits)).toBeUndefined()
  })

  it('平台没有限制或还不知道尺寸时不算超出', () => {
    expect(imageProblem({ path: 'a', width: 1968, height: 17954, bytes: 9_000_000 }, {})).toBeUndefined()
    expect(imageProblem({ path: 'a' }, limits)).toBeUndefined()
  })

  it('大小和边长分别超出', () => {
    expect(imageProblem({ path: 'a', width: 100, height: 100, bytes: 6_200_000 }, limits)).toBe('6.2MB，超过 5MB')
    expect(imageProblem({ path: 'a', width: 1968, height: 17954, bytes: 4_000_000 }, limits)).toBe('1968×17954，边长超过 16384 像素')
  })
})

describe('splitImages', () => {
  it('保留顺序，记下跳过的是第几张', () => {
    const images = [
      { path: 'cover', width: 2160, height: 2700, bytes: 1_200_000 },
      { path: 'runner', width: 1968, height: 17954, bytes: 4_100_000 },
      { path: 'region', width: 1968, height: 9089, bytes: 2_600_000 },
    ]
    const { kept, skipped } = splitImages(images, limits)
    expect(kept.map((i) => i.path)).toEqual(['cover', 'region'])
    expect(skipped.map((s) => s.index)).toEqual([1])
    expect(skippedText(skipped)).toBe('第 2 张（1968×17954，边长超过 16384 像素）超出限制，发布时跳过')
  })
})
