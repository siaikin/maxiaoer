import type { ApiAdapter, ApiContext } from '@maxiaoer/core'

const API = 'https://api.x.com/2'

/**
 * X 官方 API v2（OAuth 2.0 用户令牌，scope: tweet.write tweet.read users.read media.write offline.access）。
 * 注意：发帖需要付费的 API 套餐。令牌刷新留到账号管理里做。
 */
export const x: ApiAdapter = {
  id: 'x',
  name: 'X',
  icon: 'x',
  mode: 'api',
  credentialFields: [
    { key: 'accessToken', label: 'OAuth2 Access Token', secret: true },
    { key: 'refreshToken', label: 'Refresh Token', secret: true },
    { key: 'clientId', label: 'Client ID' },
  ],
  limits: { contentMax: 280, minImages: 0, maxImages: 4, requiresTitle: false },

  async checkLogin(ctx) {
    const res = await call(ctx, '/users/me?user.fields=profile_image_url')
    if (!res.ok) return null
    const { data } = (await res.json()) as { data: { id: string; name: string; profile_image_url?: string } }
    return { nickname: data.name, avatar: data.profile_image_url, uid: data.id }
  },

  async publish(ctx, post, { onProgress }) {
    const mediaIds: string[] = []
    for (const [i, image] of post.images.entries()) {
      onProgress?.(`上传图片 ${i + 1}/${post.images.length}`)
      const form = new FormData()
      form.append('media', await ctx.readFile(image.path))
      form.append('media_category', 'tweet_image')
      const res = await call(ctx, '/media/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`图片上传失败：${res.status} ${await res.text()}`)
      mediaIds.push(((await res.json()) as { data: { id: string } }).data.id)
    }
    onProgress?.('发布推文')
    const text = [post.content, post.topics.map((t) => `#${t}`).join(' ')].filter(Boolean).join('\n')
    const res = await call(ctx, '/tweets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
    })
    if (!res.ok) throw new Error(`发布失败：${res.status} ${await res.text()}`)
    const { data } = (await res.json()) as { data: { id: string } }
    return { remoteId: data.id, url: `https://x.com/i/web/status/${data.id}` }
  },
}

function call(ctx: ApiContext, path: string, init: RequestInit = {}) {
  return ctx.fetch(`${API}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${ctx.credentials.accessToken}` },
  })
}
