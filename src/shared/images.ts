import type { ImageAsset, PlatformLimits } from './types'

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1).replace(/\.0$/, '')}MB`

/** 图片超出平台限制的原因；没超出或还不知道尺寸、大小时返回 undefined */
export function imageProblem(image: ImageAsset, limits: Pick<PlatformLimits, 'maxImageBytes' | 'maxImageSide'>) {
  const { maxImageBytes, maxImageSide } = limits
  if (maxImageBytes && image.bytes && image.bytes > maxImageBytes) return `${mb(image.bytes)}，超过 ${mb(maxImageBytes)}`
  if (maxImageSide && image.width && image.height && Math.max(image.width, image.height) > maxImageSide) {
    return `${image.width}×${image.height}，边长超过 ${maxImageSide} 像素`
  }
  return undefined
}

/** 按平台限制分出要发的图片和要跳过的图片，顺序不变 */
export function splitImages(images: ImageAsset[], limits: Pick<PlatformLimits, 'maxImageBytes' | 'maxImageSide'>) {
  const kept: ImageAsset[] = []
  const skipped: { image: ImageAsset; index: number; reason: string }[] = []
  images.forEach((image, index) => {
    const reason = imageProblem(image, limits)
    if (reason) skipped.push({ image, index, reason })
    else kept.push(image)
  })
  return { kept, skipped }
}

/** 跳过图片的提示，例如「第 3 张（1968×17954，边长超过 16384 像素）超出限制，发布时跳过」 */
export function skippedText(skipped: { index: number; reason: string }[]) {
  if (!skipped.length) return ''
  return `${skipped.map((s) => `第 ${s.index + 1} 张（${s.reason}）`).join('、')}超出限制，发布时跳过`
}
