import { describe, expect, it } from 'vitest'
import { ClickRejectedError, createHumanBehavior, mousePath, sampleDelay, targetPoint, type Rect } from './human'

const view: Rect = { left: 0, top: 0, right: 400, bottom: 300 }

describe('行为模拟', () => {
  it('随机时间落在上下界内', () => {
    for (let i = 0; i < 300; i++) {
      const delay = sampleDelay(80, 50, 150, Math.random)
      expect(delay).toBeGreaterThanOrEqual(50)
      expect(delay).toBeLessThanOrEqual(150)
    }
    expect(sampleDelay(80, 40, 40, () => 0.2)).toBe(40)
  })

  it('小元素的点击落点仍在可见区域内', () => {
    const rect = { left: 10, top: 20, right: 12, bottom: 21 }
    for (let i = 0; i < 80; i++) {
      const point = targetPoint(rect, Math.random)
      expect(point.x).toBeGreaterThanOrEqual(rect.left)
      expect(point.x).toBeLessThanOrEqual(rect.right)
      expect(point.y).toBeGreaterThanOrEqual(rect.top)
      expect(point.y).toBeLessThanOrEqual(rect.bottom)
    }
  })

  it('轨迹采样点不超出给定范围', () => {
    const path = mousePath({ x: 4, y: 6 }, { x: 180, y: 90 }, view, () => 0.85)
    expect(path.at(-1)).toEqual({ x: 180, y: 90 })
    for (const point of path) {
      expect(point.x).toBeGreaterThanOrEqual(view.left)
      expect(point.x).toBeLessThanOrEqual(view.right)
      expect(point.y).toBeGreaterThanOrEqual(view.top)
      expect(point.y).toBeLessThanOrEqual(view.bottom)
    }
  })

  it('按字素输入中文、组合 emoji 和换行', async () => {
    const inserted: string[] = []
    let enters = 0
    const behavior = createHumanBehavior(
      async (method, params) => {
        if (method === 'Input.insertText') inserted.push(String(params.text))
      },
      { enabled: true, random: () => 0.5, wait: async () => undefined },
    )
    await behavior.type('你好👍\n👨‍👩‍👧‍👦', async () => {
      enters++
    })
    expect(inserted).toEqual(['你', '好', '👍', '👨‍👩‍👧‍👦'])
    expect(enters).toBe(1)
  })

  it('输入中断后不重复已经发出的字素', async () => {
    const inserted: string[] = []
    const behavior = createHumanBehavior(
      async (method, params) => {
        if (method !== 'Input.insertText') return
        if (inserted.length === 1) throw new Error('中断')
        inserted.push(String(params.text))
      },
      { enabled: true, random: () => 0.5, wait: async () => undefined },
    )
    await expect(behavior.type('abcd', async () => undefined)).rejects.toThrow('中断')
    expect(inserted).toEqual(['a'])
  })

  it('分段滚轮的总量等于请求的距离', async () => {
    const sent: number[] = []
    const behavior = createHumanBehavior(
      async (_method, params) => {
        if (params.type === 'mouseWheel') sent.push(Number(params.deltaY))
      },
      { enabled: true, random: () => 0.3, wait: async () => undefined },
    )
    await behavior.scroll({ x: 20, y: 20 }, { x: 0, y: 250 }, view)
    expect(sent.length).toBeGreaterThan(1)
    expect(sent.reduce((sum, item) => sum + item, 0)).toBeCloseTo(250, 5)
  })

  it('点击前校验失败时不发送按下事件', async () => {
    const types: string[] = []
    const behavior = createHumanBehavior(
      async (_method, params) => {
        if (typeof params.type === 'string') types.push(params.type)
      },
      { enabled: true, random: () => 0.5, wait: async () => undefined },
    )
    await expect(behavior.click({ x: 30, y: 30 }, view, async () => false)).rejects.toBeInstanceOf(ClickRejectedError)
    expect(types).toContain('mouseMoved')
    expect(types).not.toContain('mousePressed')
  })

  it('操作间停顿不短于下限，关闭模拟后按原值等待', async () => {
    const waits: number[] = []
    const enabled = createHumanBehavior(async () => undefined, {
      enabled: true,
      random: Math.random,
      wait: async (ms) => {
        waits.push(ms)
      },
    })
    await enabled.pause(100)
    expect(waits[0]).toBeGreaterThanOrEqual(100)
    expect(waits[0]).toBeLessThanOrEqual(170)

    const exact: number[] = []
    const disabled = createHumanBehavior(async () => undefined, {
      enabled: false,
      wait: async (ms) => {
        exact.push(ms)
      },
    })
    await disabled.pause(100)
    expect(exact).toEqual([100])
  })
})
