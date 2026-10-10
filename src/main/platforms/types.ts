import type { Collection, PlatformInfo, SettingValues } from '../../shared/types'

/**
 * 浏览器自动化上下文，由 browser.ts 基于 Electron webContents + CDP 实现。
 * 适配器只依赖这个接口，不直接 import electron。
 */
export interface BrowserContext {
  goto(url: string): Promise<void>
  currentUrl(): string
  sleep(ms: number): Promise<void>
  evaluate<T>(expression: string): Promise<T>
  exists(selector: string): Promise<boolean>
  waitFor(selector: string, timeoutMs?: number): Promise<void>
  /** 等待 URL 满足条件 */
  waitForUrl(test: (url: string) => boolean, timeoutMs?: number): Promise<void>
  /** 用真实鼠标事件点击元素；text 不为空时点第一个文字包含 text 的可见元素 */
  click(selector: string, text?: string): Promise<void>
  /** 点击 host 影子树（含 closed shadow root）里文字等于 text 的元素 */
  clickInShadow(host: string, text: string): Promise<void>
  /** 聚焦元素后用真实输入事件输入文字 */
  type(selector: string, text: string): Promise<void>
  /** 在当前焦点处输入 */
  insertText(text: string): Promise<void>
  press(key: 'Enter' | 'Backspace' | 'Escape' | 'ArrowDown' | 'Space'): Promise<void>
  /** 给第 index 个匹配的 <input type=file> 设置本地文件 */
  setFiles(selector: string, files: string[], index?: number): Promise<void>
  /** 执行 action，同时等待 URL 包含 urlPart 的请求返回，并解析其 JSON 响应 */
  captureResponse<T = unknown>(urlPart: string, action: () => Promise<void>, timeoutMs?: number): Promise<T>
}

export interface AccountProfile {
  nickname: string
  avatar?: string
  uid?: string
}

export interface PublishInput {
  title: string
  content: string
  images: string[]
  topics: string[]
  settings: SettingValues
  /** 试运行：填好表单后不点发布（开发调试用） */
  dryRun?: boolean
}

export interface PublishResult {
  remoteId?: string
  url?: string
}

export interface PlatformAdapter extends Omit<PlatformInfo, 'canDelete'> {
  loginUrl: string
  /** “进入后台”打开的地址 */
  homeUrl: string
  checkLogin(ctx: BrowserContext): Promise<AccountProfile | null>
  publish(ctx: BrowserContext, input: PublishInput, onProgress: (msg: string) => void): Promise<PublishResult>
  deleteRemote?(ctx: BrowserContext, remote: PublishResult): Promise<void>
  listCollections?(ctx: BrowserContext): Promise<Collection[]>
}
