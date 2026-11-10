// Privacy codes for the researched devices that support PPD (example declarations).
// Each code carries the declaration itself: every data flow's PPD terms, who handles it and its title, as JSON,
// compressed to fit ("ppd1:" + base64url(zlib deflate(JSON)); the format is in src/lib/declarationCode.ts). Error
// correction is level L (7%) to keep the code small enough for a phone camera: about 1.3 KB, QR version 25-27.
// The app's Scan screen reads it and opens the privacy viewer, with no lookup.
//
//   node tools/make_qr_codes.mjs      writes public/qr/<device>.png, <device>.svg (a labelled card), <device>.json and index.html
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import QRCode from 'qrcode'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mock = join(root, 'public', 'mock')
const out = join(root, 'public', 'qr')

// LG OLED C6 doesn't support PPD, so it has no privacy code.
const RESEARCH = ['reolink-e1-zoom', 'aqara-w200', 'level-lock']

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])


await mkdir(out, { recursive: true })
const cards = []
for (const id of RESEARCH) {
  const device = JSON.parse(await readFile(join(mock, 'devices', `${id}.json`), 'utf8'))
  const decl = {
    ppd: 1, device: id, id: device.declaration_id_example, name: device.short_name, cat: device.category,
    cat_label: device.category_label, icon: device.icon, matter: device.matter,
    flows: device.flows.map((f) => {
      const t = f.taxonomy
      const row = [t.data_type, t.purpose, t.action, t.source, t.handling_context, f.display.handled_by, f.title]
      return Object.keys(t.constraints ?? {}).length ? [...row, t.constraints] : row
    }),
  }
  const json = JSON.stringify(decl)
  const payload = 'ppd1:' + deflateSync(Buffer.from(json), { level: 9 }).toString('base64url')
  await writeFile(join(out, `${id}.json`), JSON.stringify(decl, null, 1) + '\n')

  const flows = device.flows
  const origin = 'Supports PPD · example declaration'

  await QRCode.toFile(join(out, `${id}.png`), payload, { margin: 2, width: 900, errorCorrectionLevel: 'L' })
  const qrSvg = await QRCode.toString(payload, { type: 'svg', margin: 0, errorCorrectionLevel: 'L' })

  // A labelled card: 300 x 380.
  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="380" viewBox="0 0 300 380" font-family="Roboto, system-ui, sans-serif">
  <rect x="1" y="1" width="298" height="378" rx="18" fill="#fff" stroke="#c4c7cc" stroke-width="2"/>
  <text x="150" y="34" text-anchor="middle" font-size="12" font-weight="700" fill="#0066cc" letter-spacing="1.5">PPD QR CODE</text>
  <svg x="40" y="48" width="220" height="220">${qrSvg.replace(/^<\?xml[^>]*>/, '').replace(/<svg /, '<svg width="220" height="220" ')}</svg>
  <text x="150" y="298" text-anchor="middle" font-size="17" font-weight="500" fill="#1d2024">${esc(device.short_name)}</text>
  <text x="150" y="318" text-anchor="middle" font-size="12" fill="#5f6368">${esc(device.category_label)} · ${flows.length} data flows</text>
  <text x="150" y="344" text-anchor="middle" font-size="11" fill="#5f6368">${esc(origin)}</text>
  <text x="150" y="362" text-anchor="middle" font-size="11" fill="#9aa0a6">Scan in the PPD app to see where its data goes</text>
</svg>
`
  await writeFile(join(out, `${id}.svg`), card)
  cards.push({ id, name: device.short_name, payload, flows: decl.flows.length, bytes: json.length })
  const version = QRCode.create(payload, { errorCorrectionLevel: 'L' }).version
  console.log(`${id}: ${decl.flows.length} flows, JSON ${json.length} B -> code ${payload.length} chars, QR version ${version}`)
}

// A printable sheet with all the cards.
await writeFile(join(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PPD QR codes</title>
<style>
  body { margin: 0; padding: 24px; background: #f4f5f7; font-family: Roboto, system-ui, sans-serif; color: #1d2024; }
  h1 { font-size: 20px; font-weight: 500; margin: 0 0 4px; } p { margin: 0 0 20px; color: #5f6368; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
  figure { margin: 0; text-align: center; } figure img { width: 100%; max-width: 300px; }
  figcaption { font: 11px ui-monospace, Menlo, monospace; color: #5f6368; word-break: break-all; }
  @media print { body { background: #fff; padding: 0; } p { display: none; } .grid { grid-template-columns: repeat(2, 1fr); } figure { break-inside: avoid; } }
</style></head><body>
<h1>PPD QR codes</h1>
<p>Each code carries the device’s declared data flows as JSON. Scan it with the app’s Scan tab to open the privacy viewer.</p>
<div class="grid">
${cards.map((c) => `  <figure><img src="${c.id}.svg" alt="PPD QR code for ${esc(c.name)}"><figcaption>${c.flows} data flows · ${(c.bytes / 1024).toFixed(1)} KB of JSON · <a href="${c.id}.json">JSON</a></figcaption></figure>`).join('\n')}
</div>
</body></html>
`)
console.log(`Wrote ${cards.length} codes to ${out}`)
