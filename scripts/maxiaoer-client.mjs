#!/usr/bin/env node
// 上传逻辑由可独立安装的技能维护，此处保留仓库命令和模块导出的兼容入口。
import { runCliIfMain } from '../skills/maxiaoer-publish/scripts/maxiaoer-client.mjs'
export * from '../skills/maxiaoer-publish/scripts/maxiaoer-client.mjs'

runCliIfMain(import.meta.url)
