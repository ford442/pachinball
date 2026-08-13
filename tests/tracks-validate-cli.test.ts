/**
 * CLI wrapper for `npm run tracks:validate` — validates every track-data JSON file.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateTrackDefinition } from '../src/adventure/track-schema'

const trackDataDir = join(import.meta.dirname, '../src/adventure/track-data')
const trackFiles = readdirSync(trackDataDir).filter((name) => name.endsWith('.json'))

describe('tracks:validate CLI', () => {
  it('has at least one JSON track file', () => {
    expect(trackFiles.length).toBeGreaterThan(0)
  })

  for (const file of trackFiles) {
    it(`validates ${file}`, () => {
      const raw = JSON.parse(readFileSync(join(trackDataDir, file), 'utf8'))
      const result = validateTrackDefinition(raw)
      expect(
        result.ok,
        result.ok ? '' : JSON.stringify('errors' in result ? result.errors : []),
      ).toBe(true)
    })
  }
})
