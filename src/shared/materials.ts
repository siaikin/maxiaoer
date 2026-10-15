/** 一次导入允许的原始图片大小，上传入口与素材库共用。 */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** 对外仅暴露素材标识；发布文件的本地路径只在主进程内部解析。 */
export interface Material {
  id: string
  name: string
  mimeType: string
  bytes: number
  width: number
  height: number
  createdAt: number
  /** 原图经过格式转换时保留其类型，素材库同时保存原始文件。 */
  originalMimeType?: string
}

/** 三种来源任选一种。上传文件由接收方读出字节后调用 importBytes。 */
export interface MaterialSourceInput {
  url?: string
  base64?: string
  dataUrl?: string
  filename?: string
}
