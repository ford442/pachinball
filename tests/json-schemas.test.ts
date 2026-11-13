/**
 * `public/schemas/*.json` is generated from the Valibot schemas
 * (`scripts/json-schemas.ts`). This fails when a file has drifted;
 * `npm run schemas:json` rewrites them. It also checks that the generated
 * JSON Schema accepts every shipped machine and track, and that the arcade
 * response schemas only require what docs/api/arcade.openapi.yaml promises.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Ajv from 'ajv'
import { load } from 'js-yaml'
import { buildJsonSchemas, jsonSchemaText } from '../scripts/json-schemas'

const SCHEMA_DIR = resolve(__dirname, '../public/schemas')
const UPDATE = process.env.UPDATE_JSON_SCHEMAS === '1'
const schemas = buildJsonSchemas()

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const jsonIn = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => join(dir, f))

describe('public/schemas', () => {
  it.each(Object.keys(schemas))('%s matches its Valibot schema', (file) => {
    const path = join(SCHEMA_DIR, file)
    const text = jsonSchemaText(schemas[file] as Record<string, unknown>)
    if (UPDATE) writeFileSync(path, text)
    expect(existsSync(path), `${file} is missing: npm run schemas:json`).toBe(true)
    expect(readFileSync(path, 'utf8'), `${file} drifted: npm run schemas:json`).toBe(text)
  })

  it('holds no stale file', () => {
    expect(readdirSync(SCHEMA_DIR).sort()).toEqual(Object.keys(schemas).sort())
  })

  const ajv = new Ajv({ allErrors: true })
  const checkAll = (schemaFile: string, files: string[]) => {
    const validate = ajv.compile(schemas[schemaFile] as object)
    for (const file of files) {
      expect(validate(readJson(file)), `${file}: ${ajv.errorsText(validate.errors)}`).toBe(true)
    }
  }

  it('the machine JSON Schema accepts every shipped machine', () => {
    checkAll('machine.json', jsonIn(resolve(__dirname, '../public/machines')))
  })

  it('the track JSON Schema accepts every shipped track', () => {
    checkAll('track.json', jsonIn(resolve(__dirname, '../src/adventure/track-data')))
  })

  it('the track JSON Schema refuses a segment the Valibot schema refuses', () => {
    const validate = ajv.compile(schemas['track.json'] as object)
    expect(validate({ schemaVersion: 1, id: 'NEON_HELIX', segments: [{ type: 'straight', width: 0, length: 1, inclineDeg: 0 }] })).toBe(false)
    expect(validate({ schemaVersion: 1, id: 'NEON_HELIX', segments: [{ type: 'loop' }] })).toBe(false)
  })
})

describe('arcade response schemas vs the OpenAPI contract', () => {
  type ObjectSchema = { properties?: Record<string, unknown>; required?: string[] }
  const spec = load(readFileSync(resolve(__dirname, '../docs/api/arcade.openapi.yaml'), 'utf8')) as {
    components: { schemas: Record<string, ObjectSchema> }
  }
  const client = (schemas['arcade.json'] as { definitions: Record<string, ObjectSchema> }).definitions
  // Client name → OpenAPI component (CloudSave has no component: its row is the saves table).
  const pairs = Object.keys(client).filter((name) => name in spec.components.schemas)

  it('covers the documented response components', () => {
    expect(pairs).toEqual(expect.arrayContaining(['LeaderboardEntry', 'Challenge', 'GhostTrack', 'Tournament', 'TournamentStanding', 'TournamentGhost', 'LiveRun', 'LiveChunk']))
  })

  it.each(pairs)('%s reads only documented fields and requires only promised ones', (name) => {
    const ours = client[name] as ObjectSchema
    const theirs = spec.components.schemas[name] as ObjectSchema
    const documented = Object.keys(theirs.properties ?? {})
    expect(Object.keys(ours.properties ?? {}).filter((key) => !documented.includes(key))).toEqual([])
    const promised = theirs.required ?? []
    expect((ours.required ?? []).filter((key) => !promised.includes(key))).toEqual([])
  })
})
