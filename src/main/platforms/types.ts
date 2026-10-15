import type { Collection, PlatformInfo, SettingValues } from '../../shared/types'

/**
 * 浏览器自动化上下文。平台适配器只依赖这个接口，不直接 import electron。
 * 鼠标、输入和滚动走行为模拟；MXE_HUMANIZE=0 时改为直接输入，指纹内核不变。
 * 公众号的后台接口上传，以及少数必须走 DOM click 的菜单，不在这套鼠标模拟里。
 */
export interface BrowserContext {
  goto(url: string): Promise<void>
  currentUrl(): string
  /** 精确等待，不加入随机停顿 */
  sleep(ms: number): Promise<void>
  /** 操作之间的随机停顿，不会短于 minMs。MXE_HUMANIZE=0 时退化为精确等待，且不更换指纹内核 */
  pause(minMs: number): Promise<void>
  evaluate<T>(expression: string): Promise<T>
  exists(selector: string): Promise<boolean>
  waitFor(selector: string, timeoutMs?: number): Promise<void>
  /** 等待 URL 满足条件 */
  waitForUrl(test: (url: string) => boolean, timeoutMs?: number): Promise<void>
  /** 用真实鼠标事件点击元素；text 不为空时点第一个文字包含 text 的可见元素 */
  click(selector: string, text?: string): Promise<void>
  /** 需要扫码时把同一个浏览器窗口从屏幕外移回来并切到前台 */
  reveal(): Promise<void>
  /** 鼠标移到元素上（触发只在悬停时出现的操作按钮） */
  hover(selector: string): Promise<void>
  /** 点击 host 影子树（含 closed shadow root）里文字等于 text 的元素 */
  clickInShadow(host: string, text: string): Promise<void>
  /** 聚焦元素后用真实输入事件输入文字 */
  type(selector: string, text: string): Promise<void>
  /** 在当前焦点处输入 */
  insertText(text: string): Promise<void>
  press(key: 'Enter' | 'Backspace' | 'Escape' | 'ArrowDown' | 'Space'): Promise<void>
  /** 对页面或嵌套滚动容器发送真实滚轮事件。定位失败会在超时后抛出 */
  scroll(selector: string, deltaY: number): Promise<void>
  /** 给第 index 个匹配的 <input type=file> 设置本地文件 */
  setFiles(selector: string, files: string[], index?: number): Promise<void>
  /** 执行 action，同时等待 URL 包含 urlPart 的请求返回。默认解析 JSON；parse 可读取原始文本，保留长数字 id 等信息 */
  captureResponse<T = unknown>(urlPart: string, action: () => Promise<void>, timeoutMs?: number, parse?: (body: string) => T): Promise<T>
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
  remoteId?: string | number
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
