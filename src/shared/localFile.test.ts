import { describe, expect, it } from 'vitest'
import { fromLocalFileUrl, toLocalFileUrl } from './localFile'

describe('local-file 地址', () => {
  it.each(['/Users/me/图片/a b#1?.jpg', '/private/tmp/x.png', 'C:\\Users\\me\\a.jpg'])('往返不丢路径：%s', (path) => {
    expect(fromLocalFileUrl(toLocalFileUrl(path))).toBe(path.replace(/\\/g, '/'))
  })

  it('主机名固定，路径第一段不会被当成主机名', () => {
    expect(new URL(toLocalFileUrl('/Users/me/a.jpg')).host).toBe('file')
  })
})
