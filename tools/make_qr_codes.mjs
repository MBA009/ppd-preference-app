// Privacy codes for the four researched devices, to print or show on a second screen and scan with the app's camera.
// Each code carries the payload from public/mock/codes.json; the Scan screen resolves it to the device, and the
// device preview opens the privacy viewer (where its data goes).
//
//   node tools/make_qr_codes.mjs            writes public/qr/<device>.png, <device>.svg (a labelled card) and index.html
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mock = join(root, 'public', 'mock')
const out = join(root, 'public', 'qr')

const RESEARCH = ['reolink-e1-zoom', 'aqara-w200', 'level-lock', 'lg-oled65c6pua-c6']

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const { codes } = JSON.parse(await readFile(join(mock, 'codes.json'), 'utf8'))
const payloadOf = (id) => Object.entries(codes).find(([, dev]) => dev === id)?.[0]

await mkdir(out, { recursive: true })
const cards = []
for (const id of RESEARCH) {
  const device = JSON.parse(await readFile(join(mock, 'devices', `${id}.json`), 'utf8'))
  const payload = payloadOf(id)
  if (!payload) throw new Error(`No privacy code for ${id} in codes.json`)

  const flows = device.flows
  const n = (ctx) => flows.filter((f) => f.taxonomy.handling_context === ctx).length
  const split = [
    [n('ppd:householdContext'), 'stay home'],
    [n('ppd:vendorContext'), 'to the maker'],
    [n('ppd:thirdPartyContext'), 'to others'],
  ].filter(([k]) => k)
  const origin = device.source === 'declared' ? 'Example declaration (research)' : 'Researched: not declared by the maker'

  await QRCode.toFile(join(out, `${id}.png`), payload, { margin: 2, width: 600, errorCorrectionLevel: 'M' })
  const qrSvg = await QRCode.toString(payload, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })

  // A labelled card: 300 x 400.
  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400" font-family="Roboto, system-ui, sans-serif">
  <rect x="1" y="1" width="298" height="398" rx="18" fill="#fff" stroke="#c4c7cc" stroke-width="2"/>
  <text x="150" y="34" text-anchor="middle" font-size="12" font-weight="700" fill="#0066cc" letter-spacing="1.5">PPD PRIVACY CODE</text>
  <svg x="40" y="48" width="220" height="220">${qrSvg.replace(/^<\?xml[^>]*>/, '').replace(/<svg /, '<svg width="220" height="220" ')}</svg>
  <text x="150" y="298" text-anchor="middle" font-size="17" font-weight="500" fill="#1d2024">${esc(device.short_name)}</text>
  <text x="150" y="318" text-anchor="middle" font-size="12" fill="#5f6368">${esc(device.category_label)} · ${flows.length} data flows</text>
  <text x="150" y="338" text-anchor="middle" font-size="12" fill="#5f6368">${esc(split.map(([k, l]) => `${k} ${l}`).join(' · '))}</text>
  <text x="150" y="364" text-anchor="middle" font-size="11" fill="#5f6368">${esc(origin)}</text>
  <text x="150" y="382" text-anchor="middle" font-size="11" fill="#9aa0a6">Scan in the app to open the privacy viewer</text>
</svg>
`
  await writeFile(join(out, `${id}.svg`), card)
  cards.push({ id, name: device.short_name, payload })
  console.log(`${id}: ${payload}`)
}

// A printable sheet with all four cards.
await writeFile(join(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PPD privacy codes</title>
<style>
  body { margin: 0; padding: 24px; background: #f4f5f7; font-family: Roboto, system-ui, sans-serif; color: #1d2024; }
  h1 { font-size: 20px; font-weight: 500; margin: 0 0 4px; } p { margin: 0 0 20px; color: #5f6368; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
  figure { margin: 0; text-align: center; } figure img { width: 100%; max-width: 300px; }
  figcaption { font: 11px ui-monospace, Menlo, monospace; color: #5f6368; word-break: break-all; }
  @media print { body { background: #fff; padding: 0; } p { display: none; } .grid { grid-template-columns: repeat(2, 1fr); } figure { break-inside: avoid; } }
</style></head><body>
<h1>PPD privacy codes: researched devices</h1>
<p>Open the app’s Scan tab and point the camera at a code. The device preview shows where its data goes; tap it for the privacy viewer.</p>
<div class="grid">
${cards.map((c) => `  <figure><img src="${c.id}.svg" alt="Privacy code for ${esc(c.name)}"><figcaption>${esc(c.payload)}</figcaption></figure>`).join('\n')}
</div>
</body></html>
`)
console.log(`Wrote ${cards.length} codes to ${out}`)
