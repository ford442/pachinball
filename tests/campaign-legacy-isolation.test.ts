import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const campaignSources = [
  'src/adventure/adventure-track-progression.ts',
  'src/adventure/adventure-progression-supervisor.ts',
  'src/adventure/campaign-rewards-manager.ts',
  'src/adventure/adventure-track-goals.ts',
]

describe('campaign legacy isolation', () => {
  it('TRACK_CATALOG / supervisor / campaign rewards do not read adventure-state', () => {
    for (const rel of campaignSources) {
      const src = readFileSync(resolve(rel), 'utf8')
      expect(src, `${rel} must not import adventure-state`).not.toMatch(/adventure-state/)
    }
  })
})
