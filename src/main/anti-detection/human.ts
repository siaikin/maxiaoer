/**
 * 参考 xiaohongshu-mcp 的 humanize 模块设计，按本项目 CDP 接口独立实现。
 * 行为随机化不等于不可检测。输入或点击失败向上抛出，不重放已经发出的按键、滚轮或提交点击。
 * MXE_HUMANIZE=0 只关闭这里的轨迹和停顿，不更换指纹内核。
 */
export class ClickRejectedError extends Error {
  constructor() {
    super('点击前元素已移动、被遮挡或不可用，请重试')
    this.name = 'ClickRejectedError'
  }
}
export type Point = { x: number; y: number }
export type Rect = { left: number; top: number; right: number; bottom: number }
type Random = () => number
type Send = (method: string, params: Record<string, unknown>) => Promise<unknown>
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** 有界对数正态分布，保留长尾停顿，但限制最坏耗时。 */
export function sampleDelay(median: number, min: number, max: number, random: Random = Math.random) {
  const normal = Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random()))) * Math.cos(2 * Math.PI * random())
  return Math.round(clamp(median * Math.exp(0.35 * normal), min, max))
}

export function targetPoint(rect: Rect, random: Random = Math.random): Point {
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  if (width <= 0 || height <= 0) throw new Error('元素没有可见的交互区域')
  return {
    x: (rect.left + rect.right) / 2 + (random() * 2 - 1) * Math.min(6, width * 0.15),
    y: (rect.top + rect.bottom) / 2 + (random() * 2 - 1) * Math.min(6, height * 0.15),
  }
}

/** 三阶贝塞尔曲线，缓入缓出；所有采样点都限制在视口内。 */
export function mousePath(start: Point, end: Point, bounds: Rect, random: Random = Math.random): Point[] {
  const dx = end.x - start.x, dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  if (distance < 2) return [end]
  const bend = (random() * 2 - 1) * Math.min(80, distance * 0.2)
  const c1 = { x: start.x + dx / 3 - dy / distance * bend, y: start.y + dy / 3 + dx / distance * bend }
  const c2 = { x: start.x + dx * 2 / 3 - dy / distance * bend / 2, y: start.y + dy * 2 / 3 + dx / distance * bend / 2 }
  const steps = Math.round(clamp(distance / 16, 8, 32))
  return Array.from({ length: steps }, (_, i) => {
    if (i === steps - 1) return end
    const t = (i + 1) / steps
    const v = t * t * (3 - 2 * t), u = 1 - v
    return {
      x: clamp(u ** 3 * start.x + 3 * u * u * v * c1.x + 3 * u * v * v * c2.x + v ** 3 * end.x, bounds.left, bounds.right),
      y: clamp(u ** 3 * start.y + 3 * u * u * v * c1.y + 3 * u * v * v * c2.y + v ** 3 * end.y, bounds.top, bounds.bottom),
    }
  })
}

export function createHumanBehavior(send: Send, options: {
  enabled?: boolean
  random?: Random
  wait?: (ms: number) => Promise<void>
} = {}) {
  const enabled = options.enabled ?? process.env.MXE_HUMANIZE !== '0'
  const random = options.random ?? Math.random
  const wait = options.wait ?? sleep
  let pointer: Point = { x: 0, y: 0 }
  const delay = (median: number, min: number, max: number) => wait(sampleDelay(median, min, max, random))
  const behavior = {
    enabled,
    point: (rect: Rect) => targetPoint(rect, enabled ? random : () => 0.5),
    // 适配器原有等待是页面准备的下限，只增加抖动，不缩短；轮询使用原始 sleep。
    pause: (minimum: number) => enabled && minimum > 0 ? delay(minimum * 1.2, minimum, minimum * 1.7) : wait(minimum),
    async move(target: Point, bounds: Rect) {
      for (const point of enabled ? mousePath(pointer, target, bounds, random) : [target]) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0 })
        pointer = point
        if (enabled) await delay(10, 5, 20)
      }
    },
    async click(target: Point, bounds: Rect, validate: () => Promise<boolean>) {
      await behavior.move(target, bounds)
      if (enabled) await delay(140, 80, 400)
      else await wait(120)
      if (!(await validate())) throw new ClickRejectedError()
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', buttons: 1, clickCount: 1 })
      try {
        if (enabled) await delay(85, 45, 180)
      } finally {
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', buttons: 0, clickCount: 1 })
      }
    },
    async press(key: { key: string; code: string; keyCode: number; text?: string }) {
      const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key.text ? { text: key.text } : {}) })
      try {
        if (enabled) await delay(65, 30, 140)
      } finally {
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      }
      if (enabled) await delay(75, 40, 180)
    },
    async type(text: string, enter: () => Promise<void>) {
      const lines = text.replace(/\r\n?/g, '\n').split('\n')
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      for (const [index, line] of lines.entries()) {
        const chunks = enabled ? Array.from(segmenter.segment(line), (part) => part.segment) : line ? [line] : []
        for (const chunk of chunks) {
          await send('Input.insertText', { text: chunk })
          if (enabled) {
            await delay(85, 50, 150)
            if (/[，。！？；,.!?;\s]/u.test(chunk) || random() < 0.025) await delay(260, 120, 650)
          }
        }
        if (index < lines.length - 1) await enter()
      }
    },
    async scroll(at: Point, delta: Point, bounds: Rect) {
      await behavior.move(at, bounds)
      const steps = enabled ? Math.max(3, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.y)) / 90)) : 1
      // 权重逐步衰减，最后一段补足余量，避免累计误差。
      const weights = Array.from({ length: steps }, (_, i) => (steps - i) * (0.8 + random() * 0.4))
      const total = weights.reduce((a, b) => a + b, 0)
      let sentX = 0, sentY = 0
      for (let i = 0; i < steps; i++) {
        const deltaX = i === steps - 1 ? delta.x - sentX : delta.x * weights[i] / total
        const deltaY = i === steps - 1 ? delta.y - sentY : delta.y * weights[i] / total
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...at, deltaX, deltaY })
        sentX += deltaX
        sentY += deltaY
        if (enabled) await delay(30, 16, 65)
      }
      await wait(enabled ? sampleDelay(180, 100, 350, random) : 100)
    },
  }
  return behavior
}
