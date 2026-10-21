// Per-phase tokens, list-price cost and wall time for one workflow run's agent transcripts.
// usage: node cost.mjs <run-dir> [<exclude-dir>]   (exclude: agents already in a prior snapshot)
import fs from 'node:fs'; import path from 'node:path'
const [dir, excl] = process.argv.slice(2)
const skip = new Set(excl ? fs.readdirSync(excl).filter(f => f.endsWith('.jsonl') && f.startsWith('agent-')) : [])
// $/MTok: input, cache write 5m, cache write 1h, cache read, output
const P = {
  opus: [4, 5, 8, 0.2, 20], sonnet: [2, 2.5, 4, 0.1, 10],
  haiku: [0.1, 0.125, 0.2, 0.01, 0.5], haikuLong: [0.5, 0.625, 1, 0.05, 2.5],
}
const fam = m => m.includes('opus') ? 'opus' : m.includes('sonnet') ? 'sonnet' : m.includes('haiku') ? 'haiku' : m
const out = {}
for (const f of fs.readdirSync(dir)) {
  if (!f.startsWith('agent-') || !f.endsWith('.jsonl') || skip.has(f)) continue
  const meta = JSON.parse(fs.readFileSync(path.join(dir, f.replace('.jsonl', '.meta.json')), 'utf8'))
  const seen = new Map(); let t0 = Infinity, t1 = 0
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line) continue; let r; try { r = JSON.parse(line) } catch { continue }
    if (r.timestamp) { const t = Date.parse(r.timestamp); t0 = Math.min(t0, t); t1 = Math.max(t1, t) }
    const m = r.message; if (r.type !== 'assistant' || !m?.usage) continue
    seen.set(m.id || r.uuid, { model: m.model, u: m.usage })  // last record per message id carries final usage
  }
  const k = meta.workflowPhase + ':' + fam(meta.model || '')
  const o = out[k] ||= { agents: 0, inTok: 0, outTok: 0, usd: 0, maxSec: 0, sumSec: 0, longReq: 0 }
  o.agents++; const sec = (t1 - t0) / 1000; o.maxSec = Math.max(o.maxSec, sec); o.sumSec += sec
  for (const { model, u } of seen.values()) {
    const cw5 = u.cache_creation?.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0
    const cw1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
    const tot = (u.input_tokens || 0) + cw5 + cw1 + (u.cache_read_input_tokens || 0)
    let fm = fam(model || meta.model); if (fm === 'haiku' && tot > 100000) { fm = 'haikuLong'; o.longReq++ }
    const p = P[fm]; if (!p) continue
    o.inTok += tot; o.outTok += u.output_tokens || 0
    o.usd += ((u.input_tokens || 0) * p[0] + cw5 * p[1] + cw1 * p[2] + (u.cache_read_input_tokens || 0) * p[3] + (u.output_tokens || 0) * p[4]) / 1e6
  }
}
let total = 0
for (const [k, o] of Object.entries(out).sort()) {
  total += o.usd
  console.log(`${k.padEnd(18)} agents=${o.agents} in=${o.inTok} out=${o.outTok} usd=${o.usd.toFixed(3)} maxSec=${o.maxSec.toFixed(0)} meanSec=${(o.sumSec / o.agents).toFixed(0)}${o.longReq ? ' haiku>100K reqs=' + o.longReq : ''}`)
}
console.log('TOTAL usd=' + total.toFixed(3))
