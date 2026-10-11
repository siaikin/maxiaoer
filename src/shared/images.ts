/** 压缩尝试顺序：原尺寸依次降质量，之后每次缩小到 80% 宽度，宽度不低于 minWidth */
export function shrinkSteps(width: number, minWidth = 640) {
  const steps = [90, 80, 70].map((quality) => ({ width, quality }))
  for (let w = Math.round(width * 0.8); w >= Math.min(minWidth, width); w = Math.round(w * 0.8)) steps.push({ width: w, quality: 75 })
  return steps
}
