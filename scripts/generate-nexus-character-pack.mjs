/**
 * Renders the Nexus character pack — "NEXUS-7", the backbox's neon android.
 *
 *   public/backbox/nexus/{idle,reach,fever,jackpot}.png  1000×600 RGBA posters
 *   public/backbox/nexus/idle.webm                       800×480 opaque VP9 loop
 *
 * The mascot is parametric SVG; puppeteer rasterises it (as generate-pwa-icons
 * does) and ffmpeg encodes the loop. Everything is deterministic: poses come
 * from a periodic phase `t`, sparkles from a seeded PRNG.
 *
 * Posters composite over the reels. In REACH and FEVER the reels stay visible,
 * so those posters keep the reel window (x 8–92 %, y 18–70 %) transparent and
 * put the character in the bottom band and side strips. The LCD overlay owns
 * the state captions (REACH / FEVER! / JACKPOT), so posters carry no text
 * beyond the IDLE nameplate.
 *
 * Run: npm run assets:nexus   (needs ffmpeg with libvpx-vp9 on PATH)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '../public/backbox/nexus')

export const POSTER_W = 1000
export const POSTER_H = 600
/** Reel window that REACH/FEVER posters leave transparent (fractions of W/H). */
export const REEL_WINDOW = { x0: 0.08, x1: 0.92, y0: 0.18, y1: 0.7 }
const LOOP_W = 800
const LOOP_H = 480
const LOOP_FRAMES = 48
const LOOP_FPS = 24

const PALETTES = {
  idle: { neon: '#00ffd9', core: '#00d9ff', accent: '#ff00aa' },
  reach: { neon: '#ff0055', core: '#ff3377', accent: '#ffd700' },
  fever: { neon: '#ffd700', core: '#ffb300', accent: '#ff0055' },
  jackpot: { neon: '#ff00ff', core: '#ff44ff', accent: '#ffd700' },
}

/** mulberry32 — deterministic sparkle placement. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = (n) => Number(n.toFixed(2))
const TAU = Math.PI * 2

function defs(p, id) {
  return `
    <linearGradient id="metal-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b6478"/>
      <stop offset="0.45" stop-color="#2a3142"/>
      <stop offset="1" stop-color="#141824"/>
    </linearGradient>
    <linearGradient id="visor-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1022"/>
      <stop offset="1" stop-color="#03050c"/>
    </linearGradient>
    <radialGradient id="core-${id}">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.35" stop-color="${p.core}"/>
      <stop offset="1" stop-color="${p.core}" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow-${id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="haze-${id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>`
}

/** Shoulder at (side·82, −88); angles in degrees, SVG y-down, right-side frame. */
function arm(side, shoulderDeg, elbowDeg, p, id, point = false) {
  const sx = 82
  const sy = -88
  const a = (shoulderDeg * Math.PI) / 180
  const e = ((shoulderDeg + elbowDeg) * Math.PI) / 180
  const ex = sx + 62 * Math.cos(a)
  const ey = sy + 62 * Math.sin(a)
  const hx = ex + 58 * Math.cos(e)
  const hy = ey + 58 * Math.sin(e)
  const X = (x) => f(side * x)
  const finger = point
    ? `<line x1="${X(hx)}" y1="${f(hy)}" x2="${X(hx + 26 * Math.cos(e))}" y2="${f(hy + 26 * Math.sin(e))}"
         stroke="#d9e2f0" stroke-width="9" stroke-linecap="round"/>`
    : ''
  return `
    <path d="M${X(sx)} ${sy} L${X(ex)} ${f(ey)} L${X(hx)} ${f(hy)}" fill="none"
          stroke="url(#metal-${id})" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M${X(sx)} ${sy} L${X(ex)} ${f(ey)} L${X(hx)} ${f(hy)}" fill="none"
          stroke="${p.neon}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"
          filter="url(#glow-${id})"/>
    <circle cx="${X(sx)}" cy="${sy}" r="17" fill="#1b2130" stroke="${p.neon}" stroke-width="3"/>
    <circle cx="${X(ex)}" cy="${f(ey)}" r="12" fill="#1b2130" stroke="${p.neon}" stroke-width="3"/>
    ${finger}
    <circle cx="${X(hx)}" cy="${f(hy)}" r="17" fill="#d9e2f0" stroke="${p.neon}" stroke-width="3"/>`
}

function legs(p, id) {
  const leg = (s) => `
    <path d="M${s * 34} 38 L${s * 39} 108 L${s * 44} 168" fill="none" stroke="url(#metal-${id})"
          stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${s * 39}" cy="108" r="12" fill="#1b2130" stroke="${p.neon}" stroke-width="3"/>
    <rect x="${s * 44 - 30}" y="164" width="60" height="22" rx="11" fill="#1b2130" stroke="${p.neon}" stroke-width="3"/>`
  return leg(-1) + leg(1)
}

/**
 * NEXUS-7 in its local frame: torso centre at the origin, antenna tip at
 * y ≈ −282, feet at y ≈ +186.
 */
function mascot({ pose, palette: p, t, id, showLegs = true }) {
  const wave = Math.sin(TAU * t)
  const scanY = f(-176 + 18 * Math.sin(TAU * t))
  const pulse = f(0.75 + 0.25 * Math.sin(TAU * t))
  const arms = {
    idle: [arm(1, -34, -58 + 24 * wave, p, id), arm(-1, 78, 14, p, id)],
    reach: [arm(1, -24, -4, p, id, true), arm(-1, 70, 24, p, id)],
    fever: [arm(1, -58, -16 + 8 * wave, p, id), arm(-1, -58, -16 - 8 * wave, p, id)],
    jackpot: [arm(1, -36, -40, p, id), arm(-1, -36, -40, p, id)],
  }[pose]
  const traces = [
    'M-52 -70 L-30 -70 L-22 -58 L-22 -20',
    'M52 -70 L30 -70 L22 -58 L22 -20',
    'M-44 10 L-14 10 L-6 22',
    'M44 10 L14 10 L6 22',
  ]
    .map((d) => `<path d="${d}" fill="none" stroke="${p.neon}" stroke-width="2.5" opacity="0.85"/>`)
    .join('')
  return `
  <g>
    <ellipse cx="0" cy="-40" rx="150" ry="190" fill="${p.neon}" opacity="0.10" filter="url(#haze-${id})"/>
    ${showLegs ? legs(p, id) : ''}
    ${arms[1]}
    <path d="M-84 -104 Q0 -122 84 -104 L64 34 Q0 50 -64 34 Z" fill="url(#metal-${id})"
          stroke="${p.neon}" stroke-width="3.5"/>
    ${traces}
    <circle cx="0" cy="-42" r="34" fill="url(#core-${id})" opacity="${pulse}"/>
    <circle cx="0" cy="-42" r="16" fill="#ffffff" stroke="${p.core}" stroke-width="4" filter="url(#glow-${id})"/>
    <rect x="-17" y="-128" width="34" height="26" rx="6" fill="#1b2130"/>
    ${arms[0]}
    <line x1="0" y1="-232" x2="0" y2="-272" stroke="#8a93a8" stroke-width="5" stroke-linecap="round"/>
    <circle cx="0" cy="-278" r="10" fill="${p.accent}" opacity="${pulse}" filter="url(#glow-${id})"/>
    <circle cx="-76" cy="-178" r="15" fill="#1b2130" stroke="${p.neon}" stroke-width="3"/>
    <circle cx="76" cy="-178" r="15" fill="#1b2130" stroke="${p.neon}" stroke-width="3"/>
    <rect x="-72" y="-236" width="144" height="112" rx="46" fill="url(#metal-${id})"
          stroke="${p.neon}" stroke-width="3.5"/>
    <rect x="-56" y="-206" width="112" height="56" rx="26" fill="url(#visor-${id})"
          stroke="${p.neon}" stroke-width="2"/>
    <clipPath id="visorclip-${id}"><rect x="-56" y="-206" width="112" height="56" rx="26"/></clipPath>
    <g clip-path="url(#visorclip-${id})">
      <rect x="-56" y="${scanY}" width="112" height="5" fill="${p.neon}" opacity="0.35"/>
    </g>
    <ellipse cx="-22" cy="-178" rx="11" ry="${pose === 'jackpot' ? 5 : 12}" fill="${p.neon}" filter="url(#glow-${id})"/>
    <ellipse cx="22" cy="-178" rx="11" ry="${pose === 'jackpot' ? 5 : 12}" fill="${p.neon}" filter="url(#glow-${id})"/>
    <path d="M-16 -160 Q0 ${pose === 'idle' ? -154 : -148} 16 -160" fill="none" stroke="${p.neon}"
          stroke-width="3" stroke-linecap="round" opacity="0.8"/>
  </g>`
}

function banner(text, x, y, size, p, id, anchor = 'middle') {
  return `
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="'Arial Black', Impact, 'DejaVu Sans', sans-serif"
        font-weight="900" font-size="${size}" letter-spacing="6" fill="none" stroke="${p.neon}"
        stroke-width="10" opacity="0.55" filter="url(#haze-${id})">${text}</text>
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="'Arial Black', Impact, 'DejaVu Sans', sans-serif"
        font-weight="900" font-size="${size}" letter-spacing="6" fill="#ffffff" stroke="${p.neon}"
        stroke-width="3">${text}</text>`
}

/** Side strips (outside the reel window): stacked chevrons pointing inward. */
function sideChevrons(p, id) {
  let out = ''
  for (let i = 0; i < 5; i++) {
    const y = 140 + i * 58
    out += `<path d="M18 ${y} L44 ${y + 20} L18 ${y + 40}" fill="none" stroke="${p.neon}" stroke-width="7"
                 stroke-linecap="round" stroke-linejoin="round" opacity="${f(0.35 + i * 0.13)}" filter="url(#glow-${id})"/>`
    out += `<path d="M982 ${y} L956 ${y + 20} L982 ${y + 40}" fill="none" stroke="${p.neon}" stroke-width="7"
                 stroke-linecap="round" stroke-linejoin="round" opacity="${f(0.35 + i * 0.13)}" filter="url(#glow-${id})"/>`
  }
  return out
}

function sparkles(seed, count, region, color) {
  const r = rng(seed)
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = f(region.x0 + r() * (region.x1 - region.x0))
    const y = f(region.y0 + r() * (region.y1 - region.y0))
    const s = f(4 + r() * 8)
    out += `<path d="M${x} ${f(y - s)} L${f(x + s * 0.3)} ${f(y - s * 0.3)} L${f(x + s)} ${y} L${f(x + s * 0.3)} ${f(y + s * 0.3)}
                    L${x} ${f(y + s)} L${f(x - s * 0.3)} ${f(y + s * 0.3)} L${f(x - s)} ${y} L${f(x - s * 0.3)} ${f(y - s * 0.3)} Z"
                 fill="${color}" opacity="${f(0.55 + r() * 0.45)}"/>`
  }
  return out
}

function sunburst(cx, cy, p) {
  let out = ''
  const rays = 18
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * TAU
    const a1 = a0 + TAU / rays / 2
    const R = 700
    out += `<path d="M${cx} ${cy} L${f(cx + R * Math.cos(a0))} ${f(cy + R * Math.sin(a0))} L${f(cx + R * Math.cos(a1))} ${f(cy + R * Math.sin(a1))} Z"
                 fill="${i % 2 ? p.accent : p.neon}" opacity="0.22"/>`
  }
  return `<g>${out}</g><circle cx="${cx}" cy="${cy}" r="170" fill="${p.neon}" opacity="0.25" filter="url(#haze-jackpot)"/>`
}

function loopBackdrop() {
  let grid = ''
  for (let i = -10; i <= 10; i++) {
    grid += `<line x1="${500 + i * 18}" y1="380" x2="${500 + i * 120}" y2="600" stroke="#7b2fff" stroke-width="2" opacity="0.5"/>`
  }
  for (let j = 0; j < 7; j++) {
    const y = f(380 + Math.pow(j / 6, 1.8) * 220)
    grid += `<line x1="0" y1="${y}" x2="1000" y2="${y}" stroke="#7b2fff" stroke-width="2" opacity="0.5"/>`
  }
  return `
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#05070f"/><stop offset="0.62" stop-color="#1a0a2e"/><stop offset="1" stop-color="#0a0e1a"/>
  </linearGradient></defs>
  <rect width="1000" height="600" fill="url(#sky)"/>
  <circle cx="640" cy="330" r="150" fill="#ff00aa" opacity="0.18"/>
  ${grid}`
}

/** Full poster / frame SVG for a state. `opaque` bakes the loop backdrop. */
export function renderState(state, t = 0, opaque = false) {
  const p = PALETTES[state]
  const id = state
  let body = ''
  switch (state) {
    case 'idle':
      body = `<g transform="translate(190 392) scale(0.88)">${mascot({ pose: 'idle', palette: p, t, id })}</g>
              ${banner('NEXUS-7', 640, 560, 44, p, id)}`
      break
    case 'reach':
      // Head and shoulders rising from the bottom-left, pointing up at the reels.
      body = `${sideChevrons(p, id)}
              <g transform="translate(160 628) rotate(8) scale(0.66)">${mascot({ pose: 'reach', palette: p, t, id, showLegs: false })}</g>`
      break
    case 'fever':
      body = `${sparkles(424, 36, { x0: 260, x1: 740, y0: 440, y1: 590 }, p.neon)}
              ${sparkles(77, 10, { x0: 8, x1: 70, y0: 30, y1: 580 }, p.accent)}
              ${sparkles(78, 10, { x0: 930, x1: 992, y0: 30, y1: 580 }, p.accent)}
              <g transform="translate(120 618) scale(0.62)">${mascot({ pose: 'fever', palette: p, t, id, showLegs: false })}</g>
              <g transform="translate(880 618) scale(-0.62 0.62)">${mascot({ pose: 'fever', palette: p, t, id: `${id}`, showLegs: false })}</g>`
      break
    case 'jackpot':
      body = `${sunburst(500, 330, p)}
              ${sparkles(9001, 40, { x0: 40, x1: 960, y0: 40, y1: 560 }, p.accent)}
              <g transform="translate(500 372) scale(0.8)">${mascot({ pose: 'jackpot', palette: p, t, id })}</g>`
      break
    default:
      throw new Error(`unknown state ${state}`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${POSTER_W} ${POSTER_H}" width="100%" height="100%">
  <defs>${defs(p, id)}</defs>
  ${opaque ? loopBackdrop() : ''}
  ${body}
</svg>`
}

async function shoot(page, svg, w, h, path, transparent) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:${transparent ? 'transparent' : '#05070f'}}
     svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
    { waitUntil: 'load' },
  )
  await page.screenshot({ path, clip: { x: 0, y: 0, width: w, height: h }, omitBackground: transparent })
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()

  for (const state of Object.keys(PALETTES)) {
    const out = join(outDir, `${state}.png`)
    await shoot(page, renderState(state, 0), POSTER_W, POSTER_H, out, true)
    console.log(`Wrote ${state}.png (${statSync(out).size} B)`)
  }

  const frames = mkdtempSync(join(tmpdir(), 'nexus-loop-'))
  try {
    for (let i = 0; i < LOOP_FRAMES; i++) {
      const name = join(frames, `f${String(i).padStart(3, '0')}.png`)
      await shoot(page, renderState('idle', i / LOOP_FRAMES, true), LOOP_W, LOOP_H, name, false)
    }
    await browser.close()
    const webm = join(outDir, 'idle.webm')
    execFileSync(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        '-framerate', String(LOOP_FPS),
        '-i', join(frames, 'f%03d.png'),
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p',
        '-b:v', '0', '-crf', '38', '-row-mt', '1',
        '-an', webm,
      ],
      { stdio: 'inherit' },
    )
    console.log(`Wrote idle.webm (${statSync(webm).size} B)`)
  } finally {
    rmSync(frames, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
