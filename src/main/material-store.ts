import { app } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { MaterialPreview } from '../shared/api'
import type { Material } from '../shared/materials'
import { MAX_IMAGE_BYTES } from '../shared/materials'
import { toLocalFileUrl } from '../shared/localFile'
import { MaterialLibrary } from './materials'

let library: MaterialLibrary | undefined
export function getMaterialLibrary() {
  return library ??= new MaterialLibrary(join(app.getPath('userData'), 'materials'))
}

export async function materialPreview(material: Material): Promise<MaterialPreview> {
  const image = await getMaterialLibrary().resolve(material.id)
  return { ...material, previewUrl: toLocalFileUrl(image.path) }
}

/** 桌面文件选择器也复制入库，后续发布不依赖用户原文件。 */
export async function importSelectedFile(file: string) {
  const info = await stat(file)
  if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new Error('请选择不超过 25 MiB 的图片文件')
  return getMaterialLibrary().importBytes(await readFile(file), basename(file))
}
