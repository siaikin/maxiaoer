import { describe, expect, it } from 'vitest'
import { defaultSettings, PLATFORM_IDS } from '../../shared/types'
import { adapters } from './index'

describe('adapters', () => {
  it('has one adapter per platform with a matching id', () => {
    for (const id of PLATFORM_IDS) expect(adapters[id].id).toBe(id)
  })

  it('every select default is one of its options', () => {
    for (const a of Object.values(adapters)) {
      for (const f of a.settings) if (f.type === 'select') expect(f.options).toContain(f.default)
      expect(Object.keys(defaultSettings(a.settings))).toHaveLength(a.settings.length)
    }
  })
})
