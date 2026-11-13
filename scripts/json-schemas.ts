/**
 * JSON Schema for the data files a person writes by hand (#505 §A): tracks,
 * machines, the weekly descriptor, the player profile, plus the arcade
 * response shapes. Generated from the Valibot schemas in `src/schemas/`, so
 * there is one source; written to `public/schemas/*.json` by
 * `npm run schemas:json`, and `tests/json-schemas.test.ts` fails when a file
 * has drifted from its schema.
 *
 * Draft-07, so the repo's ajv@6 can check shipped files against them. Rules a
 * JSON Schema cannot say (`v.check`, cross-field checks, finite numbers) are
 * left out: the files give completion and shape errors in an editor; the
 * Valibot schema stays the validator.
 *
 * Dev only: nothing in `src/` imports this file or `@valibot/to-json-schema`.
 */

import * as v from 'valibot'
import { toJsonSchema, toJsonSchemaDefs, type ConversionConfig } from '@valibot/to-json-schema'
import {
  ArcadeChallengeSchema,
  CloudSaveSchema,
  GhostTrackSchema,
  LeaderboardEntrySchema,
  LiveChunkSchema,
  LiveRunSchema,
  TournamentGhostSchema,
  TournamentSchema,
  TournamentStandingSchema,
} from '../src/schemas/arcade'
import { MachineDescriptorSchema, TrackRefSchema } from '../src/schemas/machine'
import { ProfileSchema } from '../src/schemas/profile'
import { MachineRulesSchema } from '../src/schemas/rules'
import { TrackDefinitionSchema } from '../src/schemas/track'
import { WeeklyMachineSchema } from '../src/schemas/weekly'

const BASE: ConversionConfig = {
  target: 'draft-07',
  // Input types: what a person writes, before any `v.transform`.
  typeMode: 'input',
  // Checks JSON Schema cannot express (closures, cross-field rules) are the Valibot schema's job.
  errorMode: 'ignore',
}

type JsonObject = Record<string, unknown>

function document(title: string, description: string, schema: v.GenericSchema, definitions: Record<string, v.GenericSchema> = {}): JsonObject {
  const converted = toJsonSchema(schema, { ...BASE, definitions }) as JsonObject
  const { $schema, ...rest } = converted
  return { $schema, title, description, ...rest }
}

/** Published file name → JSON Schema document. */
export function buildJsonSchemas(): Record<string, JsonObject> {
  const machineDefs = { TrackRef: TrackRefSchema, TrackDefinition: TrackDefinitionSchema, WeeklyMachine: WeeklyMachineSchema }
  return {
    'track.json': document(
      'Pachinball adventure track',
      'A declarative track (src/adventure/track-data/*.json; docs/TRACK_SCHEMA.md).',
      TrackDefinitionSchema,
    ),
    'machine.json': document(
      'Pachinball machine',
      'A machine: cabinet, tracks, backbox, audio, rules, seed policy (public/machines/*.json, .machine.json exports; docs/MACHINES.md).',
      MachineDescriptorSchema,
      machineDefs,
    ),
    'rules.json': document('Pachinball machine rules', 'MachineDescriptor.rules (v1).', MachineRulesSchema, { WeeklyMachine: WeeklyMachineSchema }),
    'weekly.json': document('Pachinball weekly machine', 'A weekly machine descriptor (rules.cascade.weekly; docs/DAILY_CASCADE.md).', WeeklyMachineSchema),
    'profile.json': document(
      'Pachinball player profile',
      'An exported player profile: settings, key bindings, campaign, bests, achievements, drafts.',
      ProfileSchema,
      { Machine: MachineDescriptorSchema, ...machineDefs },
    ),
    'arcade.json': {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Pachinball arcade responses',
      description: 'What the client reads from the arcade service (src/schemas/arcade.ts); docs/api/arcade.openapi.yaml is the contract.',
      definitions: toJsonSchemaDefs(
        {
          LeaderboardEntry: LeaderboardEntrySchema,
          CloudSave: CloudSaveSchema,
          Challenge: ArcadeChallengeSchema,
          GhostTrack: GhostTrackSchema,
          Tournament: TournamentSchema,
          TournamentStanding: TournamentStandingSchema,
          TournamentGhost: TournamentGhostSchema,
          LiveRun: LiveRunSchema,
          LiveChunk: LiveChunkSchema,
        },
        BASE,
      ),
    },
  }
}

/** A file's text: two-space JSON and a trailing newline, like the shipped JSON. */
export function jsonSchemaText(schema: JsonObject): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}
