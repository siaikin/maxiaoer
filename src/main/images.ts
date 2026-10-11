import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import { shrinkSteps } from '../shared/images'

/**
 * 把超过 maxBytes 的图片压成 JPEG 副本，返回发布用的路径和清理函数。原图不动。
 * 先降质量，不够再按比例缩小；长图宽度保留得越多，文字越清楚。
 */
export async function fitImages(paths: string[], maxBytes: number | undefined) {
  const dir = join(app.getPath('temp'), 'maxiaoer-images', randomUUID())
  let made = false
  const out: string[] = []
  for (const path of paths) {
    if (!maxBytes || (await stat(path)).size <= maxBytes) {
      out.push(path)
      continue
    }
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) throw new Error(`图片无法读取：${path}`)
    const { width } = image.getSize()
    let data: Buffer | undefined
    for (const step of shrinkSteps(width)) {
      const scaled = step.width === width ? image : image.resize({ width: step.width, quality: 'best' })
      data = scaled.toJPEG(step.quality)
      if (data.length <= maxBytes) break
    }
    if (!data || data.length > maxBytes) throw new Error(`图片压缩后仍超过 ${Math.round(maxBytes / 1e6)}MB：${path}`)
    if (!made) await mkdir(dir, { recursive: true })
    made = true
    const file = join(dir, `${out.length + 1}.jpg`)
    await writeFile(file, data)
    out.push(file)
  }
  return { paths: out, cleanup: () => (made ? rm(dir, { recursive: true, force: true }) : Promise.resolve()) }
}
