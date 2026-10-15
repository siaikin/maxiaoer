import { build } from 'esbuild'
import { zipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'plugins/maxiaoer')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
// 生成目录随 Git 发布，市场安装无需下载依赖或运行安装脚本。
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const built = await build({
  absWorkingDir: root, entryPoints: ['scripts/mcp-stdio.mjs'],
  outfile: join(output, 'server.cjs'), bundle: true, platform: 'node',
  target: 'node22', format: 'cjs', minify: true, legalComments: 'external', metafile: true,
})
const json = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n')
await json('plugin.json', {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name: 'maxiaoer', version,
  description: '通过本机蚂小儿导入图片素材、预览图文并发布到指定的平台账号。需要先运行蚂小儿桌面应用和 Node.js 22+。',
  author: { name: 'siaikin', url: 'https://github.com/siaikin' },
  homepage: 'https://github.com/siaikin/maxiaoer',
  repository: 'https://github.com/siaikin/maxiaoer',
  extensions: { 'com.openai': {
    requires_local_executor: true,
    interface: {
      displayName: '蚂小儿', shortDescription: '本机图片素材管理与多平台图文发布',
      developerName: 'siaikin', category: 'Productivity',
      capabilities: ['Read', 'Write'],
      defaultPrompt: ['用蚂小儿列出已绑定的账号。', '用蚂小儿准备这些图片和文案，先给我发布预览。'],
    },
  } },
})
await json('mcp.json', {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
  mcpServers: { maxiaoer: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server.cjs'], cwd: '${PLUGIN_ROOT}' } },
})
// 兼容仍读取 Codex 旧清单格式的桌面端和 CLI。
const manifest = JSON.parse(await readFile(join(output, 'plugin.json'), 'utf8'))
await mkdir(join(output, '.codex-plugin'))
await json('.codex-plugin/plugin.json', {
  name: manifest.name, version, description: manifest.description, author: manifest.author,
  skills: './skills/', mcpServers: './.mcp.json',
  requires_local_executor: true, interface: manifest.extensions['com.openai'].interface,
})
await json('.mcp.json', {
  mcpServers: { maxiaoer: { command: 'node', args: ['./server.cjs'], cwd: '.', startup_timeout_sec: 20, tool_timeout_sec: 120 } },
})
await cp(join(root, 'skills'), join(output, 'skills'), { recursive: true })
await cp(join(root, 'docs/plugin-install.md'), join(output, 'README.md'))

// 为所有打包进桥接程序的第三方模块保留许可证。
const packages = new Map()
for (const input of Object.keys(built.metafile.inputs).filter((file) => file.includes('node_modules/'))) {
  let directory = dirname(resolve(root, input))
  while (directory !== root && dirname(directory) !== directory) {
    try {
      const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      if (pkg.name && pkg.version) { packages.set(`${pkg.name}@${pkg.version}`, directory); break }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    directory = dirname(directory)
  }
}
const notices = []
for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const files = (await readdir(directory)).filter((file) => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(file))
  if (!files.length) throw new Error(`缺少第三方许可证：${name}`)
  notices.push(name, ...(await Promise.all(files.sort().map((file) => readFile(join(directory, file), 'utf8')))))
}
await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'))

async function zipDirectory(directory, prefix = '', entries = {}) {
  for (const file of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, file.name)
    if (file.isDirectory()) await zipDirectory(path, prefix + file.name + '/', entries)
    else if (file.isFile()) entries[prefix + file.name] = [await readFile(path), { mtime: new Date('2020-01-01T00:00:00Z') }]
    else throw new Error(`发布包中不能包含链接：${path}`)
  }
  return entries
}
const release = join(root, 'release/plugins')
await mkdir(release, { recursive: true })
const artifacts = [
  [`maxiaoer-plugin-${version}.zip`, await zipDirectory(output)],
  [`maxiaoer-publish-skill-${version}.zip`, await zipDirectory(join(root, 'skills/maxiaoer-publish'), 'maxiaoer-publish/')],
]
const checksums = []
for (const [name, entries] of artifacts) {
  const bytes = zipSync(entries, { level: 9 })
  await writeFile(join(release, name), bytes)
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
}
await writeFile(join(release, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
console.log(`插件 ${version} 已生成：plugins/maxiaoer；下载包：release/plugins`)
