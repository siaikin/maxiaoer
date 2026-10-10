import type { Account, Collection, PlatformId, PlatformInfo, Post, PublishJob, SettingValues } from './types'

/** 主进程经 preload 暴露给渲染进程的 API */
export interface MaxiaoerApi {
  platforms(): Promise<PlatformInfo[]>
  accounts: {
    list(): Promise<Account[]>
    /** 弹出独立分区的登录窗口，登录成功后返回新账号 */
    login(platform: PlatformId): Promise<Account | null>
    check(id: string): Promise<Account>
    /** 带登录态打开平台后台 */
    open(id: string): Promise<void>
    remove(id: string): Promise<void>
    /** 小红书合集列表，keyword 为空返回全部 */
    collections(id: string, keyword: string, refresh?: boolean): Promise<Collection[]>
  }
  posts: {
    pickImages(): Promise<string[]>
  }
  publish: {
    start(post: Post, accountIds: string[], scheduledAt?: number): Promise<PublishJob>
    jobs(): Promise<PublishJob[]>
    retry(jobId: string, taskId: string): Promise<void>
    /** 从平台删除已发布的作品 */
    deleteRemote(jobId: string, taskId: string): Promise<void>
    /** 只删除本地记录 */
    removeJob(jobId: string): Promise<void>
    onUpdate(cb: (job: PublishJob) => void): () => void
  }
  prefs: {
    commonTopics(): Promise<string[]>
    setCommonTopics(topics: string[]): Promise<void>
    /** 每个账号上次用的发布配置 */
    lastSettings(): Promise<Record<string, SettingValues>>
    /** 每个账号是否启用“使用上次选择” */
    useLast(): Promise<Record<string, boolean>>
    setUseLast(accountId: string, value: boolean): Promise<void>
  }
}
