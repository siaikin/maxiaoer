# 安装蚂小儿 MCP 与发布 Skill

插件同时包含本地 MCP 桥接程序和 `maxiaoer-publish` Skill。使用前需要 **Node.js 22 或更新版本**，并在同一台电脑上启动带 MCP 功能的蚂小儿应用、登录需要发布的平台账号。桥接程序已包含依赖，无需在插件目录运行 `npm install`。

## ChatGPT 桌面端 / Codex

安装 Codex CLI 后运行：

```bash
codex plugin marketplace add siaikin/maxiaoer
codex plugin add maxiaoer@maxiaoer-plugins
```

重新打开桌面客户端，在本地对话中输入“用蚂小儿列出已绑定的账号”。也可以在插件目录中选择“蚂小儿插件”来源并安装“蚂小儿”。若未显示，完全退出并重新打开客户端。macOS/Linux 插件使用 `/bin/sh` 启动器，依次检查 `MAXIAOER_NODE_PATH`（显式指定）、Codex 提供的 `CODEX_MCP_NODE_PATH`、PATH，以及 Homebrew、Volta、nvm、fnm 的常见安装位置，要求 Node.js 22+。不会加载 shell 配置文件。

插件通过本地连接文件 `~/.maxiaoer/mcp.json` 读取随机端口与令牌；配置和发布包不包含用户令牌、登录信息、素材或发布记录。蚂小儿重启后需重连 MCP。已有手工注册的 `maxiaoer` MCP 或独立 Skill 时，安装插件后可以移除旧配置，避免重复工具和技能。

本版本使用本机 STDIO MCP，只能在有本机执行能力的客户端使用。ChatGPT 网页云端不能直接连接这台电脑的回环地址。GitHub Marketplace 分发不等于上架 OpenAI 公共插件目录；公共本地 MCP 插件提交另有资格和审核要求。

## 直接下载

在 [GitHub Releases](https://github.com/siaikin/maxiaoer/releases/latest) 下载：

- `maxiaoer-plugin-版本.zip`：完整插件，解压后根目录有 `plugin.json`、`mcp.json`、`server.cjs` 和 `skills/`。
- `maxiaoer-publish-skill-版本.zip`：仅 Skill，解压后将 `maxiaoer-publish` 放入 `~/.codex/skills/`；MCP 需要另行配置。
- `SHA256SUMS.txt`：下载包校验值。

支持导入本地插件目录的客户端可以选择完整插件目录。其他支持 STDIO MCP 的客户端可以使用以下配置，将路径替换为解压目录的绝对路径：

```json
{
  "mcpServers": {
    "maxiaoer": {
      "command": "/bin/sh",
      "args": ["/absolute/path/to/maxiaoer-plugin/launch-mcp.sh"]
    }
  }
}
```

Codex 手工配置等价命令为 `codex mcp add maxiaoer -- /bin/sh /absolute/path/to/maxiaoer-plugin/launch-mcp.sh`。不要同时使用插件和手工方式注册同一个 MCP。

## 启动蚂小儿与使用

当前发布包提供 MCP 与 Skill，不包含 Electron 应用或浏览器内核。尚未安装新版蚂小儿时，可从源码运行：

```bash
git clone https://github.com/siaikin/maxiaoer.git
cd maxiaoer
pnpm install --frozen-lockfile
pnpm browser:prepare
pnpm dev
```

让 AI 查询账号、导入图片、准备预览并按你的授权提交发布。图片先保存原图副本到素材库，再按目标平台过滤超限图片；预览会列出跳过原因。定时发布需要电脑和蚂小儿持续运行。上传助手位于插件的 `skills/maxiaoer-publish/scripts/maxiaoer-client.mjs`。

## 更新与开发

更新市场：`codex plugin marketplace upgrade maxiaoer-plugins`，然后在客户端更新或重新安装插件。插件目录 `plugins/maxiaoer` 由 `pnpm plugin:build` 生成，请修改原始 `scripts/`、`skills/` 和本安装说明后重新生成。发布前运行项目检查与 `pnpm plugin:test`。

格式与安装方式参考 [OpenAI 插件打包文档](https://developers.openai.com/plugins/build/plugins)；公共目录限制参考 [桌面插件提交要求](https://developers.openai.com/plugins/deploy/desktop-only)。

## 桌面端提示“找不到文件”

若 MCP 在启动阶段报 `No such file or directory (os error 2)`，但终端中 `node --version` 正常，可能是桌面客户端没有继承 nvm 等工具设置的 PATH，尚未执行桥接程序就找不到 `node`。这与蚂小儿账号、令牌或端口无关。升级后的启动器会查找常见安装位置；非标准位置可在 MCP 配置的 `env` 中添加 `MAXIAOER_NODE_PATH`，值为本机 Node.js 22+ 可执行文件的绝对路径。指定的路径无效时会明确报错，不会静默换用其他版本。

不要将开发者机器的 Node 绝对路径写进发布包。Windows 原生客户端不使用此 POSIX 启动器，请手动配置 `command` 为本机 `node.exe` 的完整路径，`args` 为插件 `server.cjs` 的完整路径。配置修改后重新连接 MCP。
