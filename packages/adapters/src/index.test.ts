import { PLATFORM_IDS } from '@maxiaoer/core'
import { describe, expect, it } from 'vitest'
import { adapters } from './index'

describe('adapters registry', () => {
  it('has one adapter per platform with a matching id', () => {
    for (const id of PLATFORM_IDS) expect(adapters[id].id).toBe(id)
  })
})
