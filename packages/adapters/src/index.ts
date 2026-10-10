import type { PlatformAdapter, PlatformId } from '@maxiaoer/core'
import { facebook } from './platforms/facebook'
import { wechatMp } from './platforms/wechat-mp'
import { weibo } from './platforms/weibo'
import { x } from './platforms/x'
import { xiaohongshu } from './platforms/xiaohongshu'

export const adapters: Record<PlatformId, PlatformAdapter> = {
  xiaohongshu,
  weibo,
  'wechat-mp': wechatMp,
  x,
  facebook,
}

export function getAdapter(id: PlatformId): PlatformAdapter {
  return adapters[id]
}

export { facebook, wechatMp, weibo, x, xiaohongshu }
