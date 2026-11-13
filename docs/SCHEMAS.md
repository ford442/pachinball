# Schemas (#505 §A)

Every piece of data the game reads from outside its own code is parsed with
one Valibot schema in `src/schemas/`. That covers track and machine files,
share links, the weekly descriptor, arcade responses, `apiFetch` bodies,
replay tapes and `localStorage`. The types come from `v.InferOutput`, so
there is no second hand-written description, and nothing is cast
(`JSON.parse(…) as T`, `response.json() as T`).

| Module | What it parses | Loads with |
|--------|----------------|------------|
| `record-kit.ts` | Boot helpers for stored records: `parseJsonWith`, `lenient`, `pickDefined`, `isRecord` | boot |
| `schema-kit.ts` | The authoring kit: `strict` / `loose` objects, `num` / `intInRange` / `u32`, `withCrossCheck`, `parseWith`, issue → `{ path, message }`, `canonicalJson` (re-exports `record-kit`) | with the lazy schemas |
| `track.ts` | `TrackDefinition` and every segment type; `validateTrackDefinition` | the adventure track loader |
| `weekly.ts` | `WeeklyMachineDescriptor` shape and envelope (`validateWeeklyMachine` adds the layout checks) | the cascade / machine loaders |
| `rules.ts` | Machine rules v1 (ball weights / points / fever multipliers, fever threshold, `cascade.weekly`) | the machine loader |
| `machine.ts` | `MachineDescriptor`; `validateMachine` | the machine loader (`?machine=`, share links) |
| `profile.ts` | The versioned player `Profile` (export / import); `parseProfile` | not yet used at runtime (slice 5) |
| `arcade.ts` | Every arcade response body; the stored arcade session and offline queue | `arcade-api.ts` (lazy) |
| `settings.ts` | The stored `GameSettings` | boot |
| `storage.ts` | Small stored records: unseen rewards, scoring breakdown, campaign save, legacy adventure progress, LCD map list / cache | boot |
| `replay.ts` | A replay tape as stored or uploaded (`ReplayRecorder.fromJSON`) | the replay recorder |

## Conventions

- **Errors are `{ path, message }`.** `parseWith` turns Valibot issues into the
  paths the HUD, the CLIs and the machine editor show: `segments[3].offset.x`,
  `rules.balls.weights.standard`, and `''` for the root. Each value reports one
  message, however many bounds it breaks.
- **Authored files are strict.** A track, machine, weekly descriptor or profile
  rejects a key it does not declare (`unknown field`). A missing key reports
  the message of the field that is missing, never Valibot's "Invalid key".
  Authored files may carry a `$schema` key for editor completion; it is ignored.
- **Stored records are lenient.** In `lenient(schema)`, a field an older build
  wrote with another type reads as absent and takes its default. One bad field
  never costs the player the whole record. A list (unseen rewards, LCD maps)
  drops the entries that do not parse and keeps the rest.
- **Responses keep only what they name.** Arcade responses use `v.object`, so a
  column the service adds later is ignored. A field the client reads that is
  missing or mistyped fails the request as a 502. `apiFetch(url, schema)`
  returns null for a body that does not match, as it does for a 4xx.
- **Cross-field rules** use `withCrossCheck(schema, check)`. Examples: lattice
  placement on its ramp, weights summing to 1, a weekly machine carrying its
  table. The check sees the raw value, so it can report next to field errors.
  Its `clean` flag says whether everything else parsed.
- **Numbers are finite.** `num(message, { min, max, gt, lt })` checks bounds as
  Valibot actions, not closures, so the generated JSON Schema carries them.

## Entry chunk

Only `record-kit.ts`, `settings.ts`, `storage.ts` and `replay.ts`, plus the
Valibot functions they use, are on the boot path. Track, machine, weekly,
rules, profile and arcade schemas load with their loaders; the track JSON
files are one lazy chunk each (precached: all 29 are ~34 KiB).

Valibot ships as one ES module, and Rollup puts a module in one chunk with
every export any chunk uses. If nothing intervened, the functions only the lazy
schemas need (`variant`, `tuple`, `lazy`, `strictObject`, the bound checks)
would ride in the entry. The `lazySchemaValibot` plugin in `vite.config.ts`
prevents that. A lazy schema module (anything in `src/schemas/` but the four
boot modules above, plus `src/arcade/`) resolves `valibot` to a second module
instance, tree-shaken on its own into `valibot-lazy-*.js`. Valibot schemas are
plain objects, so schemas from the two instances compose. Keep boot code
importing `record-kit.ts`, never `schema-kit.ts`. `npm run check:bundle` holds
the entry inside `bundle-budget.json`.

## JSON Schema

`scripts/json-schemas.ts` converts the schemas with `@valibot/to-json-schema`
(a dev dependency only) into `public/schemas/{track,machine,rules,weekly,profile,arcade}.json`,
as draft-07. Rewrite them after a schema change:

```bash
npm run schemas:json
```

`tests/json-schemas.test.ts` checks four things:
- every file matches its schema (drift fails the run);
- ajv accepts every shipped machine and track against these files;
- every arcade response schema reads only fields `docs/api/arcade.openapi.yaml`
  documents;
- every arcade response schema requires only fields that contract promises.

A JSON Schema cannot express closures or cross-field rules, so the files leave
those out. Editors get completion and shape errors from them; the Valibot
schema stays the validator. `.vscode/settings.json` maps the track and machine
files to them, and any file can name one in `$schema`.

## Adding a schema

1. Write it in `src/schemas/<name>.ts` with the `schema-kit` helpers, export
   its type as `v.InferOutput<typeof …>`, and parse with `parseWith` /
   `parseJsonWith`.
2. If people write the data by hand, add it to `buildJsonSchemas()` and run
   `npm run schemas:json`.
3. Keep it off the boot path unless boot reads it.
