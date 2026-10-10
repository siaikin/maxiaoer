import type { ApiAdapter, ApiContext } from '@maxiaoer/core'

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Facebook 公共主页，Graph API。个人主页不允许 API 发帖，这里只支持 Page。
 * 需要 Page Access Token（pages_manage_posts, pages_read_engagement）。
 */
export const facebook: ApiAdapter = {
  id: 'facebook',
  name: 'Facebook',
  icon: 'facebook',
  mode: 'api',
  credentialFields: [
    { key: 'pageId', label: 'Page ID' },
    { key: 'pageAccessToken', label: 'Page Access Token', secret: true },
  ],
  limits: { contentMax: 63206, minImages: 0, maxImages: 10, requiresTitle: false },

  async checkLogin(ctx) {
    const res = await graph(ctx, `/${ctx.credentials.pageId}?fields=name,picture`)
    if (!res.ok) return null
    const page = (await res.json()) as { id: string; name: string; picture?: { data?: { url?: string } } }
    return { nickname: page.name, avatar: page.picture?.data?.url, uid: page.id }
  },

  async publish(ctx, post, { onProgress }) {
    const { pageId } = ctx.credentials
    const attached: { media_fbid: string }[] = []
    for (const [i, image] of post.images.entries()) {
      onProgress?.(`上传图片 ${i + 1}/${post.images.length}`)
      const form = new FormData()
      form.append('source', await ctx.readFile(image.path))
      form.append('published', 'false')
      const res = await graph(ctx, `/${pageId}/photos`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`图片上传失败：${res.status} ${await res.text()}`)
      attached.push({ media_fbid: ((await res.json()) as { id: string }).id })
    }
    onProgress?.('发布帖子')
    const message = [post.title, post.content, post.topics.map((t) => `#${t}`).join(' ')].filter(Boolean).join('\n\n')
    const res = await graph(ctx, `/${pageId}/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, attached_media: attached }),
    })
    if (!res.ok) throw new Error(`发布失败：${res.status} ${await res.text()}`)
    const { id } = (await res.json()) as { id: string }
    return { remoteId: id, url: `https://www.facebook.com/${id}` }
  },
}

function graph(ctx: ApiContext, path: string, init: RequestInit = {}) {
  return ctx.fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${ctx.credentials.pageAccessToken}` },
  })
}
