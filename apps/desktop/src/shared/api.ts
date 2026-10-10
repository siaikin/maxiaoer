import type { Account, PlatformId, Post, PublishJob } from '@maxiaoer/core'

/** 主进程通过 preload 暴露给渲染进程的 API，两端共用这一份类型 */
export interface MaxiaoerApi {
  platforms(): Promise<PlatformInfo[]>
  accounts: {
    list(): Promise<Account[]>
    /** 浏览器模式：弹出登录窗口，登录成功后返回新账号 */
    login(platform: PlatformId): Promise<Account | null>
    /** API 模式：填写凭据添加账号 */
    addWithCredentials(platform: PlatformId, credentials: Record<string, string>): Promise<Account>
    /** 重新检测登录态 */
    check(id: string): Promise<Account>
    /** 打开该账号的平台后台（带登录态），对应蚁小二的“进入账号后台” */
    open(id: string): Promise<void>
    remove(id: string): Promise<void>
  }
  posts: {
    save(post: Post): Promise<Post>
    pickImages(): Promise<string[]>
  }
  publish: {
    start(post: Post, accountIds: string[], scheduledAt?: number): Promise<PublishJob>
    jobs(): Promise<PublishJob[]>
    retry(jobId: string, taskId: string): Promise<void>
    onUpdate(cb: (job: PublishJob) => void): () => void
  }
}

export interface PlatformInfo {
  id: PlatformId
  name: string
  mode: 'browser' | 'api'
  limits: import('@maxiaoer/core').PlatformLimits
  credentialFields?: { key: string; label: string; secret?: boolean }[]
}
