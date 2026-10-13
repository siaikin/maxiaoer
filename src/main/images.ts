import { stat } from 'node:fs/promises'
import { nativeImage } from 'electron'
import type { ImageAsset } from '../shared/types'

/** 读出图片的像素尺寸和文件大小；读不出尺寸时只带大小 */
export async function imageInfo(path: string): Promise<ImageAsset> {
  const { size } = await stat(path)
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return { path, bytes: size }
  const { width, height } = image.getSize()
  return { path, width, height, bytes: size }
}
