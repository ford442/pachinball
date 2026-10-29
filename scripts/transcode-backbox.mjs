#!/usr/bin/env node
/**
 * #486 A1 — transcode the backbox video sources in assets-src/backbox/ into the
 * shippable clips under public/backbox/ (H.264 High 720p30, no audio, faststart,
 * ≤ ~2.5 MB) plus one .webp poster per clip. maxrate is 1.4M, not 1.8M: the 15 clips must fit the
 * 40 MiB dist cap (bundle-budget.json) next to ~12 MiB of app. Driven by assets-src/backbox/manifest.json;
 * the outputs are committed, so this only reruns when a source changes.
 *
 * Usage:
 *   node scripts/transcode-backbox.mjs            # transcode every entry
 *   node scripts/transcode-backbox.mjs neon-helix # only the named slugs
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'assets-src', 'backbox')
const outDir = join(root, 'public', 'backbox')
const TARGET_MIB = 2.5

const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'))
const only = new Set(process.argv.slice(2))
const entries = manifest.entries.filter((e) => only.size === 0 || only.has(e.slug))
if (only.size > 0 && entries.length !== only.size) {
  console.error(`Unknown slug(s): ${[...only].filter((s) => !entries.some((e) => e.slug === s)).join(', ')}`)
  process.exit(1)
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
  if (r.error) throw new Error(`ffmpeg not runnable: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`ffmpeg exited ${r.status}`)
}

let oversize = 0
for (const entry of entries) {
  const input = join(srcDir, entry.source)
  const video = join(outDir, entry.output)
  const poster = join(outDir, entry.poster)
  mkdirSync(dirname(video), { recursive: true })
  mkdirSync(dirname(poster), { recursive: true })

  ffmpeg([
    '-i', input,
    '-map', '0:v:0', '-an',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '23',
    '-maxrate', '1.4M', '-bufsize', '2.8M',
    '-vf', 'scale=-2:720,fps=30', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    video,
  ])
  ffmpeg(['-ss', '0.5', '-i', input, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=-2:720', '-c:v', 'libwebp', '-quality', '80', poster])

  const mib = statSync(video).size / 1024 / 1024
  const flag = mib > TARGET_MIB ? '  OVER TARGET' : ''
  if (flag) oversize++
  console.log(`${entry.slug}: ${relative(root, video)} ${mib.toFixed(2)} MiB, poster ${(statSync(poster).size / 1024).toFixed(0)} KiB${flag}`)
}

if (oversize > 0) {
  console.error(`${oversize} clip(s) above the ${TARGET_MIB} MiB target`)
  process.exit(1)
}
