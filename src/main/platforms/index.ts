import type { PlatformId, PlatformInfo } from '../../shared/types'
import { facebook } from './facebook'
import type { PlatformAdapter } from './types'
import { wechatMp } from './wechat-mp'
import { weibo } from './weibo'
import { x } from './x'
import { xiaohongshu } from './xiaohongshu'

export const adapters: Record<PlatformId, PlatformAdapter> = {
  xiaohongshu,
  weibo,
  'wechat-mp': wechatMp,
  x,
  facebook,
}

export const getAdapter = (id: PlatformId) => adapters[id]

export function platformInfo(a: PlatformAdapter): PlatformInfo {
  return { id: a.id, name: a.name, color: a.color, limits: a.limits, settings: a.settings, canDelete: !!a.deleteRemote }
}
