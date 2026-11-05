# Replay verifier (storage host)

The live arcade's anti-cheat (#444 Slice C). A Node + headless Chromium
service that takes pending leaderboard scores from Supabase, replays each
run's tape in the real game — the production build, the in-process C++
engine, one fixed physics step per tape frame — and marks the score
**verified** when the tape replays to the submitted score, **rejected** with
the reason when it does not. Rejected runs never show on the default board;
runs still unverified after 24 hours drop off it.

```
Supabase ──claim_score_verifications──▶ verifier ──Chromium──▶ dist/ (the game)
         ◀─record_score_verification──
```

A run is rejected when:

| Reason | Meaning |
|--------|---------|
| `no replay` | The score cites no tape. |
| `unverifiable engine …` | Recorded on `wasm-worker` / Rapier: only the in-process `wasm-owner` (the default) replays step-exactly. |
| `no frame-0 snapshot on the tape` | The recorder could not snapshot the world. |
| `submitted to X, but the tape was played on Y` | The tape's table (map, or cascade seed) belongs to another board. |
| `table not recognised …` | The tape's table descriptor hash is not a table this build builds. |
| `replay rejected …` / `played N of M tape frames` | The tape does not run to its end on this table. |
| `score mismatch: the tape replays to A, B was submitted` | The forged-score case. |
| `verifier error after 3 attempts …` | The verifier itself kept failing on this run. |

| `not played on the challenge's table …` | A challenge run whose session seed, cascade table or board is not the challenge's. |
| `… (the tape was played on PhysicsModule.wasm …, which this verifier does not hold)` | The run did not replay on another binary, and its own was still not archived after 3 attempts (#490 Slice B). |

A rejection names the build the run was recorded on when it differs from
the verifier's (`(recorded on build …)`).

A verified run also leaves its **race ghost**: while replaying, the
verifier samples the primary ball every 2 fixed steps and writes the track
to `ghost_tracks` (the challenge ghost players race; `docs/API_CONTRACT.md`).

## Install

On the storage host (Linux, Node 20+, ~1 GB free):

```bash
git clone https://github.com/ford442/pachinball.git /srv/pachinball && cd /srv/pachinball
npm ci
npx playwright install --with-deps chromium

# The build players run. `npm run build` also writes dist/build-info.json
# (the build id stamped into every tape).
npm run build
npm run test:verifier            # self-test against a fake backend: 12 cases ok

sudo mkdir -p /etc/pachinball
sudo cp services/replay-verifier/replay-verifier.env.example /etc/pachinball/replay-verifier.env
sudo chmod 600 /etc/pachinball/replay-verifier.env
# Set ARCADE_SECRET_KEY: Supabase dashboard → Project Settings → API Keys →
# Secret keys → Add new ("replay-verifier"). Never put it in the repo.

sudo useradd --system --home /srv/pachinball --shell /usr/sbin/nologin pachinball || true
sudo chown -R pachinball: /srv/pachinball
sudo cp services/replay-verifier/replay-verifier.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now replay-verifier
journalctl -u replay-verifier -f   # one JSON line per verdict
```

Try one round by hand first:
`sudo -u pachinball env $(cat /etc/pachinball/replay-verifier.env | xargs) node services/replay-verifier/verifier.mjs --once`.

## Builds

A tape records the build it was played on (`buildId`) and the SHA-256 of
that build's physics binary (`wasmSha256`, #490 Slice B). A gameplay or
solver change between builds can make an honest old run replay differently,
so keep every build players actually ran: point `VERIFIER_BUILDS` at a
directory with one build per build id, archived after each deploy with

```bash
npm run release:archive -- --to /srv/pachinball-builds
```

It copies `dist/` to `/srv/pachinball-builds/<buildId>/` with the golden
tapes (`tests/replays/*.json` at that commit, in `release-tapes/`), replays
every tape on the copy and keeps it only when each lands on its golden. It
refuses a dirty tree, a build without `wasm/PhysicsModule.wasm`, a binary
that is not the one `build-info.json` declares, and a build id already
archived with another binary.

A run then replays on a build shipping its own binary — its own build when
held — else on its build id's, else on `VERIFIER_DIST` (judge.mjs
`selectBuild`). The verifier hashes each build's binary at start and skips
any whose binary does not match its `build-info.json` (`build-skipped` in the
log). `verifier_version` on the score row is the build that replayed it,
`verify_wasm_sha256` its binary.

After a Chromium / Playwright upgrade on the host, check that every release
still reproduces its own goldens:

```bash
npm run verify:replay -- --releases /srv/pachinball-builds
```

Deploy order for this change: apply the migration
(`20261105190000_wasm_pin_tournaments.sql`, which adds
`record_score_verification … p_wasm_sha256`) **before** restarting the
verifier on the new code.

## Operation

- One run takes 20–60 s (boot ~10 s, then ~5–10 ms per physics step); a full
  three-ball game is a few minutes of tape. `VERIFIER_BATCH` scores are
  claimed at a time; when the queue is empty the service sleeps
  `VERIFIER_POLL_MS`.
- A claim is held for 15 minutes. If the service dies mid-run, the score is
  handed out again after that; each claim counts an attempt, and after 3
  failed attempts of the verifier's own the run is rejected with the error.
- `SIGTERM` finishes the current run and exits.
- Several instances can run side by side: claims use `FOR UPDATE SKIP LOCKED`.
- The verifier opens the game with `navigator.webdriver` set, so the page
  never writes to the arcade service itself.
