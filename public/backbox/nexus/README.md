# Nexus character pack

Per-state character / drum takes for the backbox character plane (`StateMediaConfig.characterLayer`, drawn by `src/display/display-character.ts` over the reels / video / image stack, under the LCD).

| File | DisplayState |
|------|----------------|
| `idle.png` | IDLE / attract |
| `reach.png` | REACH |
| `fever.png` | FEVER |
| `jackpot.png` | JACKPOT |

Optional loops: `idle.webm`, `reach.webm`, `fever.webm`, `jackpot.webm` (same stem). `HTMLVideoElement` loads `.webm`/`.mp4`; posters are the Canvas/image fallback. LCD emoji walk-bys run when `characterLayer` is empty or fails to load. The plane covers the right third of the screen, so a poster may be opaque without hiding the attract video.

These PNGs are color-field placeholders — replace with authored character takes.
