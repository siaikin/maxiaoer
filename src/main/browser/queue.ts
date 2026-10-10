export function singleFlight<T>(inflight: Map<string, Promise<unknown>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const task = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  inflight.set(key, task)
  Promise.resolve()
    .then(run)
    .then(
      (value) => {
        if (inflight.get(key) === task) inflight.delete(key)
        resolve(value)
      },
      (error) => {
        if (inflight.get(key) === task) inflight.delete(key)
        reject(error)
      },
    )
  return task
}

/** 已经在队列或执行中时不再 prepare，避免调度和重试把同一次任务重置后再入队。 */
export function beginTask<T>(inflight: Map<string, Promise<unknown>>, key: string, prepare: () => void, run: () => Promise<T>): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>
  prepare()
  return singleFlight(inflight, key, run)
}

interface Waiter {
  accountId: string
  onWait: (message: string) => void
  start: () => void
  cancel: () => void
}

/** 同一个账号的自动化串行，全部账号同时最多 limit 个。 */
export function createQueue(limit = 2) {
  let active = 0
  const busyAccounts = new Set<string>()
  const waiting: Waiter[] = []
  const accountJobs = new Map<string, Set<Promise<unknown>>>()
  const inflight = new Map<string, Promise<unknown>>()

  const track = (accountId: string, task: Promise<unknown>) => {
    let jobs = accountJobs.get(accountId)
    if (!jobs) accountJobs.set(accountId, (jobs = new Set()))
    jobs.add(task)
    const done = () => {
      jobs!.delete(task)
      if (jobs!.size === 0) accountJobs.delete(accountId)
    }
    task.then(done, done)
  }

  const refresh = () => {
    waiting.forEach((job, index) => {
      job.onWait(busyAccounts.has(job.accountId) ? '等待该账号的上一个任务结束' : `排队中，前面还有 ${index + 1} 个任务`)
    })
  }

  const pump = () => {
    for (let i = 0; i < waiting.length && active < limit; ) {
      const job = waiting[i]
      if (busyAccounts.has(job.accountId)) {
        i++
        continue
      }
      waiting.splice(i, 1)
      job.start()
    }
    refresh()
  }

  return {
    run<T>(key: string, accountId: string, fn: () => Promise<T>, onWait: (message: string) => void = () => undefined): Promise<T> {
      const existing = inflight.get(key)
      if (existing) return existing as Promise<T>
      let resolve!: (value: T) => void
      let reject!: (error: unknown) => void
      const task = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      inflight.set(key, task)
      track(accountId, task)
      const finish = () => {
        inflight.delete(key)
        active--
        busyAccounts.delete(accountId)
        pump()
      }
      const start = () => {
        active++
        busyAccounts.add(accountId)
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(finish)
      }
      if (active < limit && !busyAccounts.has(accountId)) start()
      else {
        waiting.push({
          accountId,
          onWait,
          start,
          cancel: () => {
            inflight.delete(key)
            reject(new Error('账号已删除'))
          },
        })
        refresh()
      }
      return task
    },
    cancelAccount(accountId: string) {
      for (let i = waiting.length - 1; i >= 0; i--) {
        if (waiting[i].accountId !== accountId) continue
        const [job] = waiting.splice(i, 1)
        job.cancel()
      }
      refresh()
    },
    settled(accountId: string) {
      return Promise.allSettled([...(accountJobs.get(accountId) ?? [])])
    },
  }
}
