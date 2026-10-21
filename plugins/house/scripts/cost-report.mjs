#!/usr/bin/env node
// Cost report over Claude Code transcripts: list-price cost split by model
// (main thread vs subagent), the cause of each main-thread cache rebuild, how
// much fast mode, US-only inference and legacy models added to the price,
// main-thread requests by context size, and the idle 5m-1h rebuilds a
// one-hour cache would likely have saved.
// Other tools cover the rest: /session-report for where tokens went,
// `npx -y @rixtay/mcp-usage` for MCP servers never called, /usage for plan use.
//
//   node cost-report.mjs [--since 7d|24h|ISO] [--dir <projects dir>]
//                        [--project <substring>] [--json] [--state <file>]
//
// --state writes a small JSON summary atomically and prints nothing; the
// SessionStart hook uses it to run the scan detached once a week. The hook's
// spawn lock is removed only after the result is written, so a scan that dies
// is retried once the lock goes stale.
import { createReadStream, readdirSync, statSync, mkdirSync, writeFileSync, renameSync, realpathSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Per MTok: [input, 5m cache write, 1h cache write, cache read, output].
// Source: https://platform.claude.com/docs/en/about-claude/pricing (verified 2026-10-20).
export const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
export const PRICES_DATE = '2026-10-20';
export const PRICES = {
  'claude-fable-5-1': [10, 12.5, 20, 0.25, 50],
  'claude-fable-5': [10, 12.5, 20, 1, 50],
  'claude-opus-5-5': [4, 5, 8, 0.2, 20],
  'claude-opus-5': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-8': [5, 6.25, 10, 0.5, 25],
  'claude-sonnet-5-5': [2, 2.5, 4, 0.1, 10],
  'claude-sonnet-5': [2, 2.5, 4, 0.2, 10],
  'claude-haiku-5-5': [0.1, 0.125, 0.2, 0.01, 0.5],
};
// Haiku 5.5 prices rise when a request's total input exceeds 100,000 tokens.
const HAIKU_LONG = { model: 'claude-haiku-5-5', over: 100000, prices: [0.5, 0.625, 1, 0.05, 2.5] };
// Fast mode is 2x for these models (input and output; cache scaled the same, an estimate).
const FAST_FACTOR = { 'claude-opus-5-5': 2, 'claude-opus-5': 2, 'claude-opus-4-8': 2 };
const US_FACTOR = 1.1;
// Current successor of each legacy model, for the legacy-model premium.
const SUCCESSOR = { 'claude-opus-5': 'claude-opus-5-5', 'claude-opus-4-8': 'claude-opus-5-5', 'claude-fable-5': 'claude-fable-5-1', 'claude-sonnet-5': 'claude-sonnet-5-5' };
const BANDS = [['under 200k', 0], ['200k-500k', 200000], ['500k and over', 500000]];
const REBUILD_TOKENS = 50000;
const CAUSES = ['model switch', 'idle >1h', 'idle 5m-1h', 'no idle gap'];
const AVOIDABLE = ['idle >1h', 'idle 5m-1h', 'model switch'];

// `drop` removes one price factor: 'fast', 'us' or 'legacy' (price at the successor model), or 'all' for all three.
function priceRow(r, drop) {
  const off = (f) => drop === f || drop === 'all';
  const model = (off('legacy') && SUCCESSOR[r.model]) || r.model;
  let p = PRICES[model];
  if (!p) return null;
  if (model === HAIKU_LONG.model && r.inTok + r.w5 + r.w1 + r.read > HAIKU_LONG.over) p = HAIKU_LONG.prices;
  let f = r.speed === 'fast' && !off('fast') ? FAST_FACTOR[model] || 1 : 1;
  if (r.geo === 'us' && !off('us')) f *= US_FACTOR;
  return p.map((x) => x * f);
}

function costOf(r, drop) {
  const p = priceRow(r, drop);
  return p ? (r.inTok * p[0] + r.w5 * p[1] + r.w1 * p[2] + r.read * p[3] + r.out * p[4]) / 1e6 : 0;
}

function writeCostOf(r) {
  const p = priceRow(r);
  return p ? (r.w5 * p[1] + r.w1 * p[2]) / 1e6 : 0;
}

export function parseSince(spec, now = Date.now()) {
  const m = /^(\d+(?:\.\d+)?)([dh])$/.exec(spec);
  if (m) return now - Number(m[1]) * (m[2] === 'd' ? 86400000 : 3600000);
  const t = Date.parse(spec);
  if (!Number.isFinite(t)) throw new Error(`bad --since: ${spec}`);
  return t;
}

function* walk(dir) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

async function readFile(file, sub, seen) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const m = e && e.message;
    if (!e || e.type !== 'assistant' || !m || typeof m !== 'object' || !m.usage || m.model === '<synthetic>') continue;
    const u = m.usage;
    const cw = u.cache_creation_input_tokens || 0;
    const w1 = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
    const rec = {
      file, sub: sub || e.isSidechain === true, model: m.model, ts: Date.parse(e.timestamp),
      out: u.output_tokens || 0, inTok: u.input_tokens || 0, w5: cw - w1, w1, read: u.cache_read_input_tokens || 0,
      speed: u.speed, geo: u.inference_geo,
    };
    const key = m.id || e.requestId ? `${m.id}\u0000${e.requestId}` : `${file}\u0000${n++}`;
    const old = seen.get(key);
    if (!old || rec.out > old.out) seen.set(key, rec);
  }
}

export async function scan({ dir, sinceMs, project } = {}) {
  const root = dir || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const seen = new Map();
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (project && !rel.split(sep)[0].includes(project)) continue;
    try { if (statSync(file).mtimeMs < sinceMs) continue; } catch { continue; }
    await readFile(file, rel.split(sep).includes('subagents'), seen);
  }
  const recs = [...seen.values()];
  const byModel = {};
  const unpriced = new Set();
  const premiums = { fastUsd: 0, usOnlyUsd: 0, legacyModelUsd: 0, totalUsd: 0 };
  const contextBands = Object.fromEntries(BANDS.map(([k]) => [k, { requests: 0, usd: 0 }]));
  let totalUsd = 0, fastRequests = 0;
  for (const r of recs) {
    if (!(r.ts >= sinceMs)) continue;
    const c = costOf(r);
    premiums.fastUsd += c - costOf(r, 'fast');
    premiums.usOnlyUsd += c - costOf(r, 'us');
    premiums.legacyModelUsd += c - costOf(r, 'legacy');
    premiums.totalUsd += c - costOf(r, 'all');
    if (!r.sub) {
      const band = contextBands[BANDS.filter(([, min]) => r.inTok + r.read + r.w5 + r.w1 >= min).pop()[0]];
      band.requests++;
      band.usd += c;
    }
    if (!PRICES[r.model]) unpriced.add(r.model);
    if (r.speed === 'fast' && FAST_FACTOR[r.model]) fastRequests++;
    const b = (byModel[r.model] ||= { mainUsd: 0, subUsd: 0, requests: 0 });
    b[r.sub ? 'subUsd' : 'mainUsd'] += c;
    b.requests++;
    totalUsd += c;
  }
  // Rebuilds: a main-thread request writing over 50k tokens to the cache that
  // is not the first in its file. Sequencing uses every request in the file;
  // only those inside the window are counted.
  const byCause = Object.fromEntries(CAUSES.map((k) => [k, { count: 0, usd: 0 }]));
  const shortTtl = { count: 0, usd: 0 };
  const files = new Map();
  for (const r of recs) if (!r.sub && Number.isFinite(r.ts)) (files.get(r.file) || files.set(r.file, []).get(r.file)).push(r);
  for (const list of files.values()) {
    list.sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < list.length; i++) {
      const r = list[i], prev = list[i - 1];
      if (r.ts < sinceMs || r.w5 + r.w1 <= REBUILD_TOKENS || !PRICES[r.model]) continue;
      const dt = (r.ts - prev.ts) / 1000;
      const why = prev.model !== r.model ? 'model switch' : dt > 3600 ? 'idle >1h' : dt > 300 ? 'idle 5m-1h' : 'no idle gap';
      byCause[why].count++;
      byCause[why].usd += writeCostOf(r);
      if (why === 'idle 5m-1h' && r.w5 > r.w1) {
        shortTtl.count++;
        shortTtl.usd += writeCostOf(r);
      }
    }
  }
  const avoidableCount = AVOIDABLE.reduce((s, k) => s + byCause[k].count, 0);
  const avoidableUsd = AVOIDABLE.reduce((s, k) => s + byCause[k].usd, 0);
  return { totalUsd, avoidableUsd, avoidableCount, byCause, byModel, unpriced: [...unpriced].sort(), fastRequests, premiums, contextBands, shortTtl };
}

const usd = (n) => '$' + n.toFixed(2);

export function formatText(d, sinceLabel) {
  const L = [`Cost report, ${sinceLabel}: ${usd(d.totalUsd)} at list price`, '', 'By model (main thread / subagent / requests):'];
  const models = Object.entries(d.byModel).sort((a, b) => b[1].mainUsd + b[1].subUsd - a[1].mainUsd - a[1].subUsd);
  for (const [k, v] of models) L.push(`  ${k}: ${usd(v.mainUsd)} / ${usd(v.subUsd)} / ${v.requests}`);
  if (!models.length) L.push('  (no requests in the window)');
  if (d.unpriced.length) L.push(`Unpriced models (counted as $0): ${d.unpriced.join(', ')}`);
  if (d.fastRequests) L.push(`Fast-mode requests priced at 2x (estimate): ${d.fastRequests}`);
  const prem = d.premiums;
  if (prem.fastUsd > 0 || prem.usOnlyUsd > 0 || prem.legacyModelUsd > 0) {
    L.push('', 'Price premiums (extra list price over standard speed, global geo and the current model):',
      `  fast mode: ${usd(prem.fastUsd)}`, `  US-only inference: ${usd(prem.usOnlyUsd)}`, `  legacy models: ${usd(prem.legacyModelUsd)}`,
      `  all three together: ${usd(prem.totalUsd)}`);
  }
  if (Object.values(d.contextBands).some((b) => b.requests)) {
    L.push('', 'Main-thread requests by context size (input + cache read + cache write), requests / cost:');
    for (const [k] of BANDS) L.push(`  ${k}: ${d.contextBands[k].requests} / ${usd(d.contextBands[k].usd)}`);
  }
  L.push('', `Main-thread cache rebuilds (over ${REBUILD_TOKENS.toLocaleString('en-US')} tokens written), by cause, priced at the cache-write rate:`);
  for (const k of CAUSES) L.push(`  ${k}: ${d.byCause[k].count} (${usd(d.byCause[k].usd)})`);
  L.push(`Avoidable rebuilds (idle >1h + idle 5m-1h + model switch): ${d.avoidableCount} (${usd(d.avoidableUsd)})`);
  if (d.shortTtl.count) {
    L.push(`Of the idle 5m-1h rebuilds, ${d.shortTtl.count} (${usd(d.shortTtl.usd)}) wrote mostly to the 5-minute cache and would likely have been cache hits with a one-hour cache.`,
      '  promptCacheTtl: "1h" (Claude Code 2.1.242+) sets it; one-hour writes cost more per token (2x input vs 1.25x), so it pays only when such gaps are common.');
  }
  L.push('', 'Caveats:',
    '  - List price, not your bill: on a plan you pay a subscription, not these dollars.',
    '  - Output tokens can be undercounted: a per-step output_tokens can be a placeholder.',
    `  - Prices dated ${PRICES_DATE}, from ${PRICES_SOURCE}`,
    '', 'Next:',
    '  /session-report                  where tokens went (cache breaks, subagents, skills)',
    '  npx -y @rixtay/mcp-usage         MCP servers loaded but never called',
    '  /usage                           plan usage');
  return L.join('\n') + '\n';
}

const USAGE = 'usage: cost-report.mjs [--since 7d|24h|ISO] [--dir <projects dir>] [--project <substring>] [--json] [--state <file>]\n';

function parseArgs(argv) {
  const o = { since: '7d' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (['--since', '--dir', '--project', '--state'].includes(a)) {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(USAGE); return; }
  const now = Date.now();
  const d = await scan({ dir: o.dir, sinceMs: parseSince(o.since, now), project: o.project });
  if (o.state) {
    const out = { checkedAt: new Date(now).toISOString(), since: o.since, totalUsd: d.totalUsd, avoidableUsd: d.avoidableUsd, avoidableCount: d.avoidableCount, byCause: d.byCause, byModel: d.byModel, premiums: d.premiums, contextBands: d.contextBands, shortTtl: d.shortTtl };
    mkdirSync(dirname(o.state), { recursive: true });
    const tmp = `${o.state}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(out) + '\n');
    renameSync(tmp, o.state);
    // Release the hook's spawn lock (see session-start.mjs) now the result is in place.
    try { unlinkSync(join(dirname(o.state), 'cost-check.lock')); } catch { /* none */ }
  } else if (o.json) {
    process.stdout.write(JSON.stringify({ since: o.since, ...d }, null, 2) + '\n');
  } else {
    process.stdout.write(formatText(d, `since ${o.since}`));
  }
}

function isMain() {
  try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

if (isMain()) {
  main().catch((err) => { process.stderr.write(`cost-report: ${err.message}\n${USAGE}`); process.exit(1); });
}
