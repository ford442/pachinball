# Nexus character pack

Per-state character / drum takes for the backbox LCD overlay (`StateMediaConfig.characterLayer`).

| File | DisplayState |
|------|----------------|
| `idle.png` | IDLE / attract |
| `reach.png` | REACH |
| `fever.png` | FEVER |
| `jackpot.png` | JACKPOT |

Optional loops: `idle.webm`, `reach.webm`, `fever.webm`, `jackpot.webm` (same stem). `HTMLVideoElement` loads `.webm`/`.mp4`; posters are the Canvas/image fallback. LCD emoji walk-bys run when `characterLayer` is empty or fails to load.

These PNGs are color-field placeholders — replace with authored character takes.
