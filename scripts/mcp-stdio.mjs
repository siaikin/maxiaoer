#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { loadConnection, parseConnectionArgument } from './mcp-connection.mjs'

async function main() {
  const { args, connectionPath } = parseConnectionArgument(process.argv.slice(2))
  if (args.length) throw new Error('用法：node scripts/mcp-stdio.mjs [--connection FILE]')
  const connection = await loadConnection(connectionPath)
  const client = new Client({ name: 'maxiaoer-local-bridge', version: '1.0.0' })
  const remote = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: { Authorization: `Bearer ${connection.token}` }, redirect: 'error' },
  })
  try {
    await client.connect(remote)
  } catch {
    await client.close().catch(() => {})
    throw new Error('无法连接蚂小儿，请先启动桌面应用。')
  }
  const server = new Server({ name: 'maxiaoer', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: client.getInstructions() })
  // 保留上游工具的完整定义，包括参数结构和工具标注。
  server.setRequestHandler(ListToolsRequestSchema, (request) => client.listTools(request.params))
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params, undefined, { timeout: 120_000 }))
  const stdio = new StdioServerTransport()
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await Promise.allSettled([client.close(), server.close()])
  }
  process.once('SIGINT', () => { void close().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void close().finally(() => process.exit(0)) })
  process.stdin.once('end', () => { void close() })
  server.onclose = () => { void close() }
  await server.connect(stdio)
}

main().catch((error) => {
  // 标准输出仅用于 MCP 消息；不得打印连接密钥。
  console.error(error instanceof Error ? error.message : '蚂小儿 MCP 桥接启动失败。')
  process.exitCode = 1
})
