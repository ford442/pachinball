#!/usr/bin/env node
/**
 * "State of the App" capture (release sequence 1/5): boots a URL in headless Chromium on a desktop and a
 * phone viewport and records what a reviewer needs to judge the build, nothing more.
 *
 *   - `<out>/report.json`  per viewport: console messages (every type), page errors, failed requests,
 *                          `crossOriginIsolated`, the physics engine and renderer that booted, the
 *                          page's `build-info.json`, and the game state reached after START
 *   - `<out>/desktop-menu.png`, `desktop-play.png`, `mobile-menu.png`, `mobile-play.png`
 *
 * Read-only: GET requests plus clicking START in a throwaway browser profile. It never writes to the site.
 *
 *   node scripts/state-of-app.mjs --url https://host/pachinball-staging/ --out state-of-app
 *   node scripts/state-of-app.mjs --url http://localhost:4174/ --out /tmp/x --executable /opt/pw-browsers/chromium
 *
 * `--executable` (or $CHROMIUM_PATH) points at a Chromium when Playwright's own download is absent.
 * `--only desktop|mobile` captures one viewport (and rewrites report.json with just that one); a host
 * that rate-limits per client (HTTP 429) is easier on one boot at a time.
 * The renderer is whatever the browser negotiates (WebGPU, else WebGL2); `--renderer webgl2` forces one.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, devices } from '@playwright/test'

function parseArgs(argv) {
  const opts = { url: '', out: 'state-of-app', executable: process.env.CHROMIUM_PATH || undefined, renderer: '', playMs: 5000, only: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') opts.url = argv[++i] ?? ''
    else if (a === '--out') opts.out = argv[++i] ?? opts.out
    else if (a === '--executable') opts.executable = argv[++i]
    else if (a === '--renderer') opts.renderer = argv[++i] ?? ''
    else if (a === '--play-ms') opts.playMs = Number(argv[++i])
    else if (a === '--only') opts.only = argv[++i] ?? ''
    else throw new Error(`unknown argument ${a}`)
  }
  if (!opts.url) throw new Error('--url is required')
  if (!opts.url.endsWith('/')) opts.url += '/'
  return opts
}

const VIEWPORTS = [
  { name: 'desktop', context: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  { name: 'mobile', context: { ...devices['Pixel 7'], hasTouch: true, isMobile: true } },
]

async function capture(browser, viewport, opts) {
  const context = await browser.newContext(viewport.context)
  const page = await context.newPage()
  const result = { viewport: viewport.name, console: [], pageErrors: [], failedRequests: [] }
  page.on('console', (msg) => result.console.push({ type: msg.type(), text: msg.text() }))
  page.on('pageerror', (err) => result.pageErrors.push(err.message))
  page.on('requestfailed', (req) => result.failedRequests.push({ url: req.url(), error: req.failure()?.errorText ?? '' }))
  page.on('response', (res) => {
    if (res.status() >= 400) result.failedRequests.push({ url: res.url(), error: `HTTP ${res.status()}` })
  })

  try {
    await bootAndPlay(page, viewport, opts, result)
  } catch (err) {
    // Keep what was observed up to the failure: the console of a page that never booted is the evidence.
    result.error = err instanceof Error ? err.message : String(err)
    await page.screenshot({ path: path.join(opts.out, `${viewport.name}-failed.png`) }).catch(() => {})
  }
  await context.close()
  return result
}

async function bootAndPlay(page, viewport, opts, result) {
  const target = new URL(opts.url)
  if (opts.renderer) target.searchParams.set('renderer', opts.renderer)
  await page.goto(target.href, { waitUntil: 'load', timeout: 90_000 })
  await page.locator('#start-btn').waitFor({ state: 'visible', timeout: 90_000 })
  await page.waitForFunction(() => !!window.game?.ready, undefined, { timeout: 90_000 })
  result.boot = await page.evaluate(() => ({
    isolated: window.crossOriginIsolated,
    engine: window.currentPhysicsEngine ?? null,
    renderer: document.getElementById('pachinball-canvas')?.dataset.renderer ?? null,
    degradeReason: window.physicsDegradeReason ?? null,
    userAgent: navigator.userAgent,
  }))
  await page.screenshot({ path: path.join(opts.out, `${viewport.name}-menu.png`) })

  await page.locator('#start-btn').click()
  await page.waitForFunction(() => window.game?.stateManager?.isPlaying?.() === true, undefined, { timeout: 60_000 })
  await page.waitForTimeout(opts.playMs)
  result.play = await page.evaluate(() => ({
    playing: window.game?.stateManager?.isPlaying?.() ?? false,
    menuHidden: document.getElementById('menu-overlay')?.classList.contains('hidden') ?? false,
  }))
  await page.screenshot({ path: path.join(opts.out, `${viewport.name}-play.png`) })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  mkdirSync(opts.out, { recursive: true })
  const report = { url: opts.url, capturedAt: new Date().toISOString(), viewports: [] }

  try {
    const res = await fetch(new URL('build-info.json', opts.url), { cache: 'no-store' })
    report.buildInfo = res.ok ? await res.json() : { error: `HTTP ${res.status}` }
  } catch (err) {
    report.buildInfo = { error: err instanceof Error ? err.message : String(err) }
  }

  const browser = await chromium.launch({
    executablePath: opts.executable,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  let failed = false
  try {
    for (const viewport of VIEWPORTS.filter((v) => !opts.only || v.name === opts.only)) {
      const result = await capture(browser, viewport, opts)
      if (result.error) failed = true
      report.viewports.push(result)
    }
  } finally {
    await browser.close()
  }

  writeFileSync(path.join(opts.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  for (const v of report.viewports) {
    const warnings = v.console?.filter((m) => m.type === 'warning' || m.type === 'warn').length ?? 0
    const errors = (v.console?.filter((m) => m.type === 'error').length ?? 0) + (v.pageErrors?.length ?? 0)
    console.log(
      `${v.viewport}: ${v.error ? `FAILED ${v.error.split('\n')[0]}` : `engine=${v.boot.engine} renderer=${v.boot.renderer} isolated=${v.boot.isolated} playing=${v.play.playing} errors=${errors} warnings=${warnings}`}`,
    )
  }
  console.log(`wrote ${path.join(opts.out, 'report.json')}`)
  if (failed || report.viewports.some((v) => v.play && !v.play.playing)) process.exit(1)
}

main().catch((err) => {
  console.error(`state-of-app FAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
