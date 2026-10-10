import { describe, expect, it } from 'vitest'
import { withLastSettings, type PlatformSettingField } from './types'

const fields: PlatformSettingField[] = [
  { key: 'visibility', label: '谁可以看', type: 'select', options: ['公开', '粉丝'], default: '公开' },
  { key: 'original', label: '原创', type: 'switch', default: false },
]

describe('withLastSettings', () => {
  it('没有上次选择时用默认值', () => {
    expect(withLastSettings(fields)).toEqual({ visibility: '公开', original: false })
  })

  it('带出上次的选择', () => {
    expect(withLastSettings(fields, { visibility: '粉丝', original: true })).toEqual({ visibility: '粉丝', original: true })
  })

  it('平台已经没有的选项回到默认值', () => {
    expect(withLastSettings(fields, { visibility: '仅自己', original: 'x', removed: 1 } as never)).toEqual({ visibility: '公开', original: false })
  })
})
