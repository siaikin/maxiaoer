import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

test('下载包脱离源码和 node_modules 后仍可初始化、发现和调用 MCP 工具', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'maxiaoer-plugin-test-'))
  let client
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${'a'.repeat(64)}`) { res.writeHead(401).end(); return }
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const message = JSON.parse(Buffer.concat(chunks).toString())
    if (message.id === undefined) { res.writeHead(202).end(); return }
    const result = message.method === 'initialize'
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' }, instructions: '测试说明' }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'probe', description: '只读测试', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }
        : { content: [{ type: 'text', text: '连接成功' }] }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  try {
    const files = unzipSync(await readFile(join(root, `release/plugins/maxiaoer-plugin-${version}.zip`)))
    for (const [name, data] of Object.entries(files)) {
      const path = resolve(temp, name)
      assert.ok(path.startsWith(temp + '/'))
      assert.ok(!/node_modules|mcp\.json\.local|\.env|\.sqlite/.test(name))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    }
    const manifest = JSON.parse(Buffer.from(files['plugin.json']).toString())
    assert.equal(manifest.version, version)
    assert.ok(files['skills/maxiaoer-publish/SKILL.md'])
    assert.ok(files['THIRD_PARTY_NOTICES.txt'])
    const mcp = JSON.parse(Buffer.from(files['mcp.json']).toString()).mcpServers.maxiaoer
    const legacy = JSON.parse(Buffer.from(files['.mcp.json']).toString()).mcpServers.maxiaoer
    assert.equal(JSON.parse(Buffer.from(files['.codex-plugin/plugin.json']).toString()).version, version)
    assert.equal(mcp.type, 'stdio')
    await new Promise((done) => http.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${http.address().port}`
    const connection = join(temp, 'connection.json')
    await writeFile(connection, JSON.stringify({ version: 1, url: `${url}/mcp`, uploadUrl: `${url}/materials/upload`, token: 'a'.repeat(64) }))
    // Exercise the actual packaged command instead of substituting process.execPath.
    const fakeHome = join(temp, 'home with spaces')
    const nvmBin = join(fakeHome, '.nvm/versions/node/v22.0.0/bin')
    await mkdir(nvmBin, { recursive: true })
    await symlink(process.execPath, join(nvmBin, 'node'))
    for (const entry of [mcp, legacy]) {
      assert.equal(entry.command, '/bin/sh')
      for (const runtime of [
        { MAXIAOER_NODE_PATH: process.execPath },
        { CODEX_MCP_NODE_PATH: process.execPath },
        {}, // GUI-style PATH: discover a supported runtime in common install locations.
      ]) {
        client = new Client({ name: 'distribution-test', version: '1.0.0' })
        const transport = new StdioClientTransport({
          command: entry.command, args: entry.args.map((arg) => arg.replaceAll('${PLUGIN_ROOT}', temp)),
          cwd: temp, env: {
            PATH: '/usr/bin:/bin', HOME: fakeHome, NVM_DIR: '', FNM_DIR: '', VOLTA_HOME: '',
            MAXIAOER_NODE_PATH: '', CODEX_MCP_NODE_PATH: '',
            MAXIAOER_CONNECTION_FILE: connection, ...runtime,
          }, stderr: 'pipe',
      })
      await client.connect(transport)
      assert.equal(client.getInstructions(), '测试说明')
      const result = await client.listTools()
      assert.equal(result.tools[0].name, 'probe')
      assert.equal(result.tools[0].annotations.readOnlyHint, true)
      assert.deepEqual((await client.callTool({ name: 'probe', arguments: {} })).content, [{ type: 'text', text: '连接成功' }])
      await client.close()
      }
    }
  } finally {
    await client?.close()
    http.closeAllConnections()
    await new Promise((done) => http.close(done))
    await rm(temp, { recursive: true, force: true })
  }
})

test('独立 Skill 下载包与源文件一致', async () => {
  const files = unzipSync(await readFile(join(root, `release/plugins/maxiaoer-publish-skill-${version}.zip`)))
  for (const [name, data] of Object.entries(files)) {
    assert.deepEqual(Buffer.from(data), await readFile(join(root, 'skills', name)))
  }
  assert.ok(files['maxiaoer-publish/SKILL.md'])
  assert.ok(files['maxiaoer-publish/scripts/maxiaoer-client.mjs'])
})

test('显式 Node 路径无效时给出可操作错误，不污染 MCP stdout', () => {
  const result = spawnSync('/bin/sh', [join(root, 'plugins/maxiaoer/launch-mcp.sh')], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', MAXIAOER_NODE_PATH: '/missing/node' },
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /MAXIAOER_NODE_PATH.*Node.js 22/)
})
