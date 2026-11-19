# Rules (#556)

A machine's **rules** say what a run is worth: the ball economy, the fever
threshold, and — since rules v2 — the scoring **program**. Rules are data
(`MachineDescriptor.rules`, schema `src/schemas/rules.ts` +
`src/schemas/rules-program.ts`, editor completion from
`public/schemas/rules.json`), every run plays them, and every tape names them.

| Part | What | Since |
|------|------|-------|
| `balls.weights` / `balls.points` | spawn weights and collect points per ball type | v1 |
| `balls.feverMultipliers` | gold-ball multiplier while the backbox is in FEVER | v1 |
| `fever.threshold` | `rules.feverThreshold` in a program | v1 |
| `cascade.weekly` | the weekly machine's seeded table (not scoring: not in the hash) | v1 |
| `program` | counters, timers, modes and event handlers; absent → the vanilla program | v2 |

A v1 rules object is a valid v2 one: without `program` a machine plays the
vanilla program (`src/rules/vanilla.ts`) — the scoring the game has always
had, written as data. The golden tapes replay bit-identical under it
(`npm run verify:replay`, `npm run verify:replay:node`), which is what proves
the port faithful.

## The program

```json
{
  "counters": { "lanes": { "initial": 0 } },
  "timers": { "window": { "ticks": 300 } },
  "modes": { "onFire": { "ticks": 1200, "multiplier": 2 } },
  "handlers": [
    { "on": "lane", "do": [{ "add": { "counter": "lanes", "value": 1 } }, { "startTimer": "window" }] },
    { "on": "lane", "if": [{ "gte": ["counter.lanes", 3] }], "do": [{ "startMode": "onFire" }, { "set": { "counter": "lanes", "value": 0 } }] },
    { "on": "timer", "id": "window", "do": [{ "set": { "counter": "lanes", "value": 0 } }] }
  ]
}
```

A handler names an event (`on`), optionally narrows it (`id`, `kind`), tests
conditions (`if`, all must hold) and runs actions (`do`) in order. Handlers
for one event run in declaration order, and each one's conditions are read
when it is reached — after the earlier handlers' actions. Order is behaviour.

### Events

| `on` | Raised when | `id` / `kind` | `event.<field>` |
|------|-------------|---------------|-----------------|
| `bumper` | a ball hits a pop bumper (low; a high ball is a hologram catch) | — | `combo`, `chainMultiplier`, `chainBonus` |
| `target` | a target goes down | — | — |
| `spinner` | a ball hits a spinner | — | — |
| `lane` | a ball rolls over a lane (once per lane per launch) | lane id / lane kind | — |
| `drain` | a ball drains | — | `primary` (1 / 0) |
| `saucer` | a ball trap catches a ball | — | — |
| `gate`, `launcher` | a moving gate opens / a launcher fires | — | — |
| `goldCollect` | a gold ball is collected at the drain | — / ball type | `goldBalls` (session total), `jackpot` (1 / 0) |
| `jackpot` | a jackpot starts (any source) | — | — |
| `comboExpire` | the combo window runs out (not on a drain) | — | `finalCombo` |
| `timer` | a program timer reaches zero | timer name | — |
| `modeEnd` | a program mode ends (its ticks, or `endMode`) | mode name | — |

The playfield primitives (#556 Slice 2) add `magnetCapture`, `bankComplete`,
`launch`, and spinner revolutions.

### Values

A value is a number or a reference: `event.<field>`, `counter.<name>`,
`timer.<name>` (ticks left), `rules.feverThreshold`. The schema rejects a
reference to an undeclared counter / timer and an `event.<field>` the
handler's event does not carry.

### Conditions

One-key objects: `eq` / `ne` / `gt` / `gte` / `lt` / `lte` `[value, value]`,
`in` `[value, [numbers]]`, `flag` / `notFlag`, `lit` / `unlit` (lamps),
`mode` / `notMode`, `display` / `notDisplay` (`idle` | `reach` | `fever` | `jackpot`).

### Actions

| Action | Does |
|--------|------|
| `award { points, scale?, source, tally? }` | `round(points × Π scale)` base points; the game then applies multiball × combo × the program's multiplier. A factor is a value or `{ tier: { of, per } }` = `floor(of / per) + 1`. `source` may use `{id}` / `{kind}`. `tally` also counts the base toward the end-of-ball bonus. |
| `comboHit` | count a hit toward the rolling combo multiplier (an award after it sees the new multiplier) |
| `add` / `set { counter, value }` | counters |
| `setFlag` / `clearFlag`, `light` / `unlight` | flags; lamps (a lamp change is also a cue) |
| `startMode` / `endMode` | push a mode (restart its clock if running) / pop it (raises `modeEnd`) |
| `startTimer` / `stopTimer` | arm a timer for its `ticks` / disarm it |
| `multiplier` | the playfield multiplier (× every active mode's) |
| `multiball { balls, reason }`, `addBalls` | start a chain multiball / add balls |
| `ballSave { ticks }` | one ball save, good for `ticks` fixed steps |
| `kickback { impulse }` | push the event's ball |
| `display` | set the backbox state |
| `emit` | `fever:start` / `fever:end` / `reach:start` / `jackpot:start` on the EventBus |
| `cue` | presentation only: `lighting`, `atmosphere`, `beep`, `bloom`, `goldPulse`, `haptic`, `message` |

### Determinism

`RulesEngine` (`src/rules/rules-engine.ts`) is pure TypeScript — no Babylon,
no DOM, no wall clock. Timers and modes count **fixed steps**
(`ScoringBridge.tickRules`, once per tick in `StepGameplay`), named state is
iterated in sorted-name order (never insertion order, so two rulesets with
the same canonical JSON behave the same), and cues go out as `rules:cue`,
which only the rendered game's `GamePhysicsController` draws: a cue can never
move a ball or a score. The headless replay runner runs the same engine, so
`verify:replay:node` covers it.

An action that raises an event (`endMode`, an `emit: jackpot:start` the game
routes back as `jackpot`) runs that event's handlers at once, nested. Nesting
deeper than 16 throws: a looping ruleset is a broken machine, and the throw is
a sim fault (the run goes unranked; a strict playback rejects it).

## `rulesHash`

`rulesHash` = SHA-256 (hex) of the run rules — `{ balls, fever, program }`
with the program resolved, `cascade` left out — as canonical JSON (keys
sorted at every level; `src/rules/rules-digest.ts`, a lazy chunk). Key order
never changes it; any scoring field does. The vanilla rules' hash is pinned
(`VANILLA_RULES_HASH` in `src/rules/rules-hash.ts`), so a vanilla run never
hashes; `tests/rules-hash.test.ts` recomputes it.

- **Tape.** Replay schema 4 records `rulesHash`, and the rules themselves
  (`rules`) when they are not the recording build's vanilla rules. A tape
  older than schema 4 reads as `LEGACY_RULES_HASH` — the vanilla rules of
  #556, frozen: when the vanilla rules change, old tapes are refused
  (`rules-mismatch`) rather than replayed under rules they never saw.
- **Replay.** `resolveRunRules` (`src/game/run-start.ts`, shared by the game
  and the headless host) plays a tape under its inline rules — validated —
  or the vanilla ones, and refuses it (`ReplayRunner.reject('rules-mismatch')`)
  when they do not hash to what the tape names.
- **Submission and boards.** `submit-replay` requires a well-formed
  `rulesHash` from schema 4; `submit-score` takes `rules_hash`. A board is
  `(map_id, rules_hash)`: the same table under other rules is another board.
  The database refuses a score naming other rules than its replay's or its
  challenge's (docs/API_CONTRACT.md).
- **Verifier.** `judge.mjs` `precheck` rejects a run whose score, challenge
  and tape do not name the same rules; the replay itself rejects a tape whose
  rules do not hash to its `rulesHash`.

If `tests/rules-hash.test.ts` fails on the pinned `VANILLA_RULES_HASH`, the
vanilla rules changed (a tuning number, a handler). In the same PR: set
`VANILLA_RULES_HASH` to the new hash and re-record the golden tapes under the
new rules (`npm run record:replay`; they are schema 4 and name it). Old tapes
were played under the old rules, so `LEGACY_RULES_HASH` never changes; drop
the assertion that it equals the vanilla hash.
