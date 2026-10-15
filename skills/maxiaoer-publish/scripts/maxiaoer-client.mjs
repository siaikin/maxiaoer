#!/usr/bin/env node
import { open } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConnection, parseConnectionArgument } from './mcp-connection.mjs'

export { loadConnection }
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** 本地路径只用于在此读取文件；服务端只接收图片字节和显示名称。 */
export async function importFile(file, connectionPath) {
  const connection = await loadConnection(connectionPath)
  let bytes
  let handle
  try {
    handle = await open(file, 'r')
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) throw new Error('invalid')
    bytes = await handle.readFile()
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('invalid')
  } catch {
    throw new Error('无法读取图片；请选择不超过 25 MiB 的非空图片文件。')
  } finally {
    await handle?.close()
  }
  let response
  try {
    response = await fetch(connection.uploadUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(basename(file)) },
      body: bytes,
    })
  } catch {
    throw new Error('无法连接蚂小儿，请检查桌面应用是否正在运行。')
  }
  if (!response.ok) throw new Error(`图片导入失败（HTTP ${response.status}），请检查图片格式、大小和连接状态。`)
  return response.json()
}

async function main() {
  const { args, connectionPath } = parseConnectionArgument(process.argv.slice(2))
  if (args[0] === 'info' && args.length === 1) {
    const { token: _token, ...info } = await loadConnection(connectionPath)
    console.log(JSON.stringify(info))
    return
  }
  if (args[0] === 'import' && args.length > 1) {
    // 逐个输出已导入素材，后续文件失败时仍能保留先前的成功结果。
    for (const file of args.slice(1)) console.log(JSON.stringify(await importFile(file, connectionPath)))
    return
  }
  throw new Error('用法：node scripts/maxiaoer-client.mjs [--connection FILE] info | import FILE...')
}

/** 技能可独立运行；仓库兼容入口只需传入自己的模块地址。 */
export function runCliIfMain(moduleUrl) {
  try {
    if (!process.argv[1] || moduleUrl !== pathToFileURL(realpathSync(process.argv[1])).href) return
  } catch { return }
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : '蚂小儿客户端操作失败。')
    process.exitCode = 1
  })
}

runCliIfMain(import.meta.url)
