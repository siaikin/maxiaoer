import { expect, it } from 'vitest'
import { publicMessage } from './public-message'
import { publicJob } from './service'

it('对外错误隐藏本机路径，同时保留平台 URL 和错误描述', () => {
  expect(publicMessage("ENOENT: stat '/Users/test/中文 图片.png'" )).toBe('ENOENT: stat 「本机文件」')
  expect(publicMessage('读取失败 C:\\Users\\test\\a.png')).toBe('读取失败 「本机文件」')
  expect(publicMessage('访问 https://weibo.com/path/post 失败，文件 /tmp/example.png')).toBe('访问 https://weibo.com/path/post 失败，文件 「本机文件」')
  expect(publicMessage('未找到指纹浏览器内核：/Users/name/browser。请重新准备')).toBe('未找到指纹浏览器内核：「本机文件」。请重新准备')
  const job = publicJob({ id: 'j', postId: 'p', title: '标题', createdAt: 1, cover: '/private/cover.png', tasks: [{ id: 't', accountId: 'a', platform: 'weibo', status: 'failed', error: "open '/Users/name/private.png'" }] })
  expect(JSON.stringify(job)).not.toContain('/Users/')
  expect(job).not.toHaveProperty('cover')
})
