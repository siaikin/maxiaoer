import type { PlatformId } from '@maxiaoer/core'

/** 平台品牌色和简称，用于头像角标、筛选标签 */
export const platformMeta: Record<PlatformId, { name: string; color: string; short: string }> = {
  xiaohongshu: { name: '小红书', color: '#ff2442', short: '红' },
  weibo: { name: '微博', color: '#e6162d', short: '微' },
  'wechat-mp': { name: '微信公众号', color: '#07c160', short: '公' },
  x: { name: 'X', color: '#000000', short: 'X' },
  facebook: { name: 'Facebook', color: '#1877f2', short: 'f' },
}

export const localFileUrl = (path: string) => `local-file://${encodeURI(path)}`
