import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Collection } from '../../shared/types'
import { publishInputSchema, PublishingService } from './service'
import { publicMessage } from './public-message'

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const localWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const publishWrite = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
const id = z.string().min(1).max(200)
const paging = { limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().nonnegative().default(0) }

async function result(run: () => Record<string, unknown> | Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    const value = await run()
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? publicMessage(error.message) : '操作失败' }] }
  }
}

export function createPublishingMcp(service: PublishingService, collections: (id: string, keyword: string, refresh?: boolean) => Promise<Collection[]>) {
  const server = new McpServer({ name: 'maxiaoer', version: '0.1.0' }, {
    instructions: '蚂小儿本机多平台发布。先读取账号和平台规则，图片必须先导入素材库，使用 materialIds。prepare_publish 只生成校验预览；用户已明确授权内容和目标账号时才调用 publish。publish 返回的是排队任务，必须用 get_publish_jobs 核对结果。网络重试复用 requestId 和 draftId。不确定是否已发出的任务先到平台核对，不盲目重试。',
  })
  server.registerTool('list_platforms', { description: '列出支持的平台、图文限制和发布配置选项。', inputSchema: z.strictObject({}), annotations: readOnly },
    () => result(() => ({ platforms: service.deps.platforms() })))
  server.registerTool('list_accounts', { description: '读取本机已绑定账号和已知登录状态；过期账号需在桌面应用重新登录。', inputSchema: z.strictObject({}), annotations: readOnly },
    () => result(() => ({ accounts: service.deps.db.listAccounts() })))
  server.registerTool('import_material', {
    description: '将图片链接、Base64 或 Data URL 保存到本机素材库，返回 material.id。三个来源只能选一个。不接受本地路径；上传文件请通过二进制上传助手。相同图片自动去重。',
    inputSchema: z.strictObject({ url: z.string().max(8192).optional(), base64: z.string().max(35_000_000).optional(), dataUrl: z.string().max(35_000_200).optional(), filename: z.string().max(300).optional() })
      .refine((v) => [v.url, v.base64, v.dataUrl].filter((s) => s !== undefined).length === 1, '请选择一种图片来源'),
    annotations: { ...localWrite, idempotentHint: true, openWorldHint: true },
  }, (input) => result(async () => ({ material: await service.deps.materials.importSource(input) })))
  server.registerTool('list_materials', { description: '分页读取已保存的图片素材。返回素材 ID 和尺寸等信息，不返回本地文件路径。', inputSchema: z.strictObject(paging), annotations: readOnly },
    ({ limit, offset }) => result(async () => {
      const materials = await service.deps.materials.list()
      return { materials: materials.slice(offset, offset + limit), total: materials.length }
    }))
  server.registerTool('prepare_publish', {
    description: '使用素材 ID 准备并校验稿件，不发布。按平台过滤超限图片，preview.materialIds 为将发布的图片，skippedMaterials 和 warning 说明跳过原因；原素材保留。返回各账号实际内容、配置及 draftId。修改内容需重新准备；定时需使用带时区的 ISO 时间。',
    inputSchema: publishInputSchema, annotations: localWrite,
  }, (input) => result(() => service.prepare(input)))
  server.registerTool('publish', {
    description: '提交用户已授权的准备稿件。每个 draftId 最多建一个发布任务；重试复用 requestId。返回任务不代表发布成功，请查询进度。',
    inputSchema: z.strictObject({ draftId: id, requestId: id.describe('本次发布的唯一编号，网络失败重试时必须复用') }), annotations: publishWrite,
  }, ({ draftId, requestId }) => result(() => service.publish(draftId, requestId)))
  server.registerTool('get_publish_jobs', {
    description: '查询发布任务和每个账号的进度、错误、最终作品链接。可按 jobId 查询或分页读取历史。',
    inputSchema: z.strictObject({ jobId: id.optional(), ...paging }), annotations: readOnly,
  }, ({ jobId, limit, offset }) => result(() => service.jobs(jobId, limit, offset)))
  server.registerTool('retry_publish_task', {
    description: '重试失败任务；只在用户确实要重复发布时设置 allowDuplicate。任务已经开始执行或结果不确定时，必须先核实平台未发布再设置 verifiedNotPublished。',
    inputSchema: z.strictObject({ jobId: id, taskId: id, allowDuplicate: z.boolean().default(false), verifiedNotPublished: z.boolean().default(false) }),
    annotations: { ...publishWrite, idempotentHint: false },
  }, ({ jobId, taskId, allowDuplicate, verifiedNotPublished }) => result(() => service.retry(jobId, taskId, allowDuplicate, verifiedNotPublished)))
  server.registerTool('get_account_collections', {
    description: '读取账号可用合集（如小红书合集）；refresh 可刷新缓存，必要时会访问登录态浏览器。',
    inputSchema: z.strictObject({ accountId: id, keyword: z.string().max(300).default(''), refresh: z.boolean().default(false) }),
    annotations: { ...readOnly, openWorldHint: true },
  }, ({ accountId, keyword, refresh }) => result(async () => ({ collections: await collections(accountId, keyword, refresh) })))
  server.registerTool('list_topic_presets', { description: '读取本机保存的话题合集。', inputSchema: z.strictObject({}), annotations: readOnly },
    () => result(() => ({ presets: service.deps.db.listTopicPresets() })))
  return server
}
