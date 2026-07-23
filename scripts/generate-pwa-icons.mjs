/**
 * Renders public/icons/icon.svg into PNG sizes required by the web app manifest.
 * Run manually after editing the SVG: node scripts/generate-pwa-icons.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const svgPath = join(root, 'public/icons/icon.svg')
const outDir = join(root, 'public/icons')
const sizes = [192, 512]

mkdirSync(outDir, { recursive: true })
const svg = readFileSync(svgPath, 'utf8')

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()

for (const size of sizes) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:#0a0e1a}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.screenshot({
    path: join(outDir, `icon-${size}.png`),
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: false,
  })
  console.log(`Wrote icon-${size}.png`)
}

await browser.close()
