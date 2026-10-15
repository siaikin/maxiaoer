/** 保留平台错误含义，去掉系统异常中夹带的本机文件路径。 */
export function publicMessage(message: string) {
  return message
    .replace(/(['"])(?:\/(?!\/)|[A-Za-z]:[\\/])[^'"\r\n]*\1/g, '「本机文件」')
    .replace(/file:\/\/[^\s'"<>]+/gi, '「本机文件」')
    .replace(/(^|[\s(=：:，；（])(?:\/(?!\/)[^\s'"<>，；）。]+|[A-Za-z]:[\\/][^\s'"<>，；）。]+)/g, '$1「本机文件」')
}
