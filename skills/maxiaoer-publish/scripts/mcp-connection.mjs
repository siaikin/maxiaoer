import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export async function loadConnection(connectionPath = process.env.MAXIAOER_CONNECTION_FILE || join(homedir(), '.maxiaoer', 'mcp.json')) {
  let connection
  try {
    connection = JSON.parse(await readFile(connectionPath, 'utf8'))
  } catch {
    throw new Error('无法读取蚂小儿连接信息，请先启动蚂小儿桌面应用。')
  }
  try {
    const url = new URL(connection.url)
    if (connection.version !== 1 || typeof connection.token !== 'string' || !/^[a-f0-9]{64}$/.test(connection.token)
      || url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !url.port || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid')
    }
    const uploadUrl = new URL('/materials/upload', url).href
    if (connection.uploadUrl !== uploadUrl) throw new Error('invalid')
    return { version: 1, url: url.href, uploadUrl, token: connection.token, pid: connection.pid }
  } catch {
    throw new Error('蚂小儿连接信息无效，请重新启动桌面应用。')
  }
}

export function parseConnectionArgument(args) {
  const parsed = [...args]
  const position = parsed.indexOf('--connection')
  let connectionPath
  if (position !== -1) {
    if (!parsed[position + 1] || parsed[position + 1].startsWith('--')) throw new Error('--connection 需要连接文件路径。')
    connectionPath = parsed[position + 1]
    parsed.splice(position, 2)
  }
  return { args: parsed, connectionPath }
}
