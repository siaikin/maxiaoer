import { describe, expect, it } from 'vitest'
import { beginTask, createQueue, singleFlight } from './queue'

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('任务队列', () => {
  it('同一个账号串行，不同账号最多同时两个', async () => {
    const queue = createQueue(2)
    let active = 0
    let max = 0
    const release: Array<() => void> = []
    const gates = [0, 1, 2].map(() => new Promise<void>((resolve) => release.push(resolve)))
    const messages: string[] = []
    const tasks = [0, 1, 2].map((index) =>
      queue.run(
        `job-${index}`,
        `account-${index}`,
        async () => {
          active++
          max = Math.max(max, active)
          await gates[index]
          active--
        },
        (message) => messages.push(message),
      ),
    )
    await flush()
    expect(max).toBe(2)
    expect(messages.some((message) => message.startsWith('排队中'))).toBe(true)
    release[0]()
    await flush()
    expect(max).toBe(2)
    release[1]()
    release[2]()
    await Promise.all(tasks)
  })

  it('同一账号在有空位时也要等上一个任务结束', async () => {
    const queue = createQueue(2)
    let started = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const messages: string[] = []
    const first = queue.run('first', 'same', async () => {
      started++
      await gate
    })
    const second = queue.run('second', 'same', async () => {
      started++
    }, (message) => messages.push(message))
    await flush()
    expect(started).toBe(1)
    expect(messages.at(-1)).toBe('等待该账号的上一个任务结束')
    release()
    await Promise.all([first, second])
    expect(started).toBe(2)
  })

  it('相同任务不会重复执行', async () => {
    const queue = createQueue(2)
    let runs = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = queue.run('same', 'account', async () => {
      runs++
      await gate
      return 'ok'
    })
    const second = queue.run('same', 'account', async () => {
      runs++
      return 'again'
    })
    expect(second).toBe(first)
    release()
    await expect(first).resolves.toBe('ok')
    expect(runs).toBe(1)
  })

  it('取消排队不会启动该账号的等待任务', async () => {
    const queue = createQueue(1)
    let started = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const running = queue.run('running', 'busy', () => gate)
    const waiting = queue.run('waiting', 'gone', async () => {
      started = true
    })
    await flush()
    queue.cancelAccount('gone')
    await expect(waiting).rejects.toThrow('账号已删除')
    expect(started).toBe(false)
    release()
    await running
  })

  it('调度和重试发现任务已入队时不再重置', async () => {
    const inflight = new Map<string, Promise<unknown>>()
    let prepared = 0
    let runs = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = beginTask(inflight, 'task', () => prepared++, async () => {
      runs++
      await gate
    })
    const second = beginTask(inflight, 'task', () => prepared++, async () => {
      runs++
    })
    expect(second).toBe(first)
    expect(prepared).toBe(1)
    release()
    await first
    await beginTask(inflight, 'task', () => prepared++, async () => {
      runs++
    })
    expect(prepared).toBe(2)
    expect(runs).toBe(2)
  })

  it('singleFlight 在执行期间挡住同键调用', async () => {
    const inflight = new Map<string, Promise<unknown>>()
    let runs = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = singleFlight(inflight, 'k', async () => {
      runs++
      await gate
      return 1
    })
    const second = singleFlight(inflight, 'k', async () => {
      runs++
      return 2
    })
    expect(second).toBe(first)
    release()
    await expect(first).resolves.toBe(1)
    expect(runs).toBe(1)
  })
})
