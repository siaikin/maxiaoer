import { normalizeTopics } from './validate'

/** 合集里的话题是否都已选上 */
export function presetSelected(current: string[], preset: string[]) {
  return preset.length > 0 && preset.every((t) => current.includes(t))
}

/**
 * 一键选择话题合集：没全选上就补齐（超出上限的丢掉，返回丢掉的个数），已全选上再点就取消这组。
 * 和其他合集重复的话题取消时一并去掉。
 */
export function togglePreset(current: string[], preset: string[], max?: number): { topics: string[]; dropped: number } {
  if (presetSelected(current, preset)) return { topics: current.filter((t) => !preset.includes(t)), dropped: 0 }
  const merged = normalizeTopics([...current, ...preset])
  if (!max || merged.length <= max) return { topics: merged, dropped: 0 }
  return { topics: merged.slice(0, Math.max(max, current.length)), dropped: merged.length - Math.max(max, current.length) }
}
