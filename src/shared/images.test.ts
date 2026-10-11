import { describe, expect, it } from 'vitest'
import { shrinkSteps } from './images'

describe('shrinkSteps', () => {
  it('先降质量再缩小，宽度不低于下限', () => {
    const steps = shrinkSteps(2000)
    expect(steps.slice(0, 3)).toEqual([
      { width: 2000, quality: 90 },
      { width: 2000, quality: 80 },
      { width: 2000, quality: 70 },
    ])
    expect(steps[3]).toEqual({ width: 1600, quality: 75 })
    expect(Math.min(...steps.map((s) => s.width))).toBeGreaterThanOrEqual(640)
  })

  it('原图比下限还窄时只降质量', () => {
    expect(shrinkSteps(500)).toHaveLength(3)
  })
})
