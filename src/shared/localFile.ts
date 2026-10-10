/**
 * 渲染进程用 local-file:// 预览本地图片。
 * local-file 注册成了 standard 协议，必须带主机名，否则路径第一段会被当成主机名吃掉，
 * 所以固定用 local-file://file/<路径>，每段单独编码（文件名里可能有 # ? 空格中文）。
 */
const PREFIX = 'local-file://file'

export function toLocalFileUrl(path: string) {
  const segments = path.replace(/\\/g, '/').split('/').map(encodeURIComponent)
  // Windows 盘符路径 C:/... 前面补一个 /
  return `${PREFIX}${path.startsWith('/') ? '' : '/'}${segments.join('/')}`
}

export function fromLocalFileUrl(url: string) {
  const path = decodeURIComponent(new URL(url).pathname)
  // /C:/... 去掉开头的 /
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
}
