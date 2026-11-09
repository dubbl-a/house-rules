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
//                        [--project <substring>] [--json | --state <file> | --advise]
//   node cost-report.mjs --workflow-estimate <agents> [--dir <projects dir>]
//
// --state writes a small JSON summary atomically and prints nothing; the
// SessionStart hook uses it to run the scan detached once a week. The hook's
// spawn lock is removed only after the result is written, so a scan that dies
// is retried once the lock goes stale. The same scan records 30-day session-cost
// baselines (read by hooks/session-cost-line.mjs) and keeps the previous scan's
// figures, so the weekly notice can say how a row moved.
//
// --advise prints the pattern table (advise()) with the active limit and the
// baseline; --workflow-estimate prices a planned workflow from this account's
// past workflow agents. Both are read by the cost-advisor skill or a session,
// never by a hook, and neither writes anything.
import { createReadStream, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, renameSync, realpathSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Per MTok: [input, 5m cache write, 1h cache write, cache read, output].
// Source: https://platform.claude.com/docs/en/about-claude/pricing (verified 2026-11-09).
export const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
export const PRICES_DATE = '2026-11-09';
export const PRICES = {
  'claude-fable-5-2': [8, 10, 16, 0.2, 40],
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
const FAST_FACTOR = { 'claude-fable-5-2': 2, 'claude-opus-5-5': 2, 'claude-opus-5': 2, 'claude-opus-4-8': 2 };
const US_FACTOR = 1.1;
// Current successor of each legacy model, for the legacy-model premium.
const SUCCESSOR = { 'claude-opus-5': 'claude-opus-5-5', 'claude-opus-4-8': 'claude-opus-5-5', 'claude-fable-5': 'claude-fable-5-2', 'claude-fable-5-1': 'claude-fable-5-2', 'claude-sonnet-5': 'claude-sonnet-5-5' };
const BANDS = [['under 200k', 0], ['200k-500k', 200000], ['500k and over', 500000]];
const REBUILD_TOKENS = 50000;
const CAUSES = ['model switch', 'idle >1h', 'idle 5m-1h', 'no idle gap'];
const AVOIDABLE = ['idle >1h', 'idle 5m-1h', 'model switch'];
const BASELINE_DAYS = 30;
const DEFAULT_ADVISOR_USD = 5;
// A session is unusual past its baseline's p95, once that baseline has 20
// sessions. Why p95 and not a flat dollar test: on the maintainer machine's 122
// sessions a plain $5 test would fire in 45% of them, while past $5 and over p95
// fires in about 6%, which hold 36% of main-thread cost
// (research/token-cost/2026-11-08.md, addendum). Why 20: with 20 sessions the
// interpolated p95 sits 5% of the way from the second-highest session to the
// highest, so one outlier barely moves it; at 10 sessions it sits 55% of the
// way, and the single largest session sets the line. A judgment call, not a
// measured optimum.
export const BASELINE_PERCENTILE = 'p95';
export const MIN_BASELINE_SESSIONS = 20;
// A mean over heavy-tailed agent costs needs more than one or two runs behind
// it: a single deep-research run alone is tens of agents.
const MIN_WORKFLOW_AGENTS = 50;

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

async function readFile(file, origin, seen) {
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
      file, sub: origin.sub || e.isSidechain === true, workflow: origin.workflow, project: origin.project, model: m.model, ts: Date.parse(e.timestamp),
      out: u.output_tokens || 0, inTok: u.input_tokens || 0, w5: cw - w1, w1, read: u.cache_read_input_tokens || 0,
      speed: u.speed, geo: u.inference_geo,
    };
    const key = m.id || e.requestId ? `${m.id}\u0000${e.requestId}` : `${file}\u0000${n++}`;
    const old = seen.get(key);
    if (!old || rec.out > old.out) seen.set(key, rec);
  }
}

// The same parsing and dedupe as the scan, for one main-thread transcript.
export async function sessionMainUsd(file) {
  const seen = new Map();
  await readFile(file, { sub: false }, seen);
  let total = 0;
  for (const r of seen.values()) if (!r.sub) total += costOf(r);
  return total;
}

function percentile(sorted, q) {
  const k = (sorted.length - 1) * q, f = Math.floor(k), c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

function summarize(costs) {
  if (!costs.length) return { sessions: 0 };
  const sorted = [...costs].sort((a, b) => a - b);
  return { sessions: sorted.length, p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), p95: percentile(sorted, 0.95) };
}

// Each main transcript file is a session. A session with no priced request has
// no cost to report, so it is left out rather than counted at $0.
function sessionBaselines(recs, sinceMs) {
  const byFile = new Map();
  for (const r of recs) {
    if (r.sub || !(r.ts >= sinceMs) || !PRICES[r.model]) continue;
    const s = byFile.get(r.file) || byFile.set(r.file, { project: r.project, usd: 0 }).get(r.file);
    s.usd += costOf(r);
  }
  const byProject = new Map();
  for (const s of byFile.values()) (byProject.get(s.project) || byProject.set(s.project, []).get(s.project)).push(s.usd);
  const projects = {};
  for (const [k, costs] of byProject) projects[k] = summarize(costs);
  return { days: BASELINE_DAYS, account: summarize([...byFile.values()].map((s) => s.usd)), projects };
}

function workflowAgentCost(recs, sinceMs) {
  const byFile = new Map();
  for (const r of recs) {
    if (!r.workflow || !(r.ts >= sinceMs) || !PRICES[r.model]) continue;
    byFile.set(r.file, (byFile.get(r.file) || 0) + costOf(r));
  }
  let usd = 0;
  for (const v of byFile.values()) usd += v;
  return { agents: byFile.size, usd };
}

export async function scan({ dir, sinceMs, project, baselineSinceMs } = {}) {
  const root = dir || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const seen = new Map();
  // One pass over the files: the wider window, when baselines are asked for.
  const filesSinceMs = baselineSinceMs === undefined ? sinceMs : Math.min(sinceMs, baselineSinceMs);
  for (const file of walk(root)) {
    const parts = relative(root, file).split(sep);
    if (project && !parts[0].includes(project)) continue;
    try { if (statSync(file).mtimeMs < filesSinceMs) continue; } catch { continue; }
    const at = parts.indexOf('subagents');
    await readFile(file, { sub: at >= 0, workflow: at >= 0 && parts.slice(at + 1).includes('workflows'), project: parts[0] }, seen);
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
  const out = { totalUsd, avoidableUsd, avoidableCount, byCause, byModel, unpriced: [...unpriced].sort(), fastRequests, premiums, contextBands, shortTtl };
  if (baselineSinceMs !== undefined) {
    out.baselines = sessionBaselines(recs, baselineSinceMs);
    out.workflowAgents = workflowAgentCost(recs, baselineSinceMs);
    // The same agents over the report window, for --advise; --workflow-estimate keeps the 30 days above.
    out.workflowAgentsInWindow = workflowAgentCost(recs, sinceMs);
  }
  return out;
}

// The advisor's limit, from one place. Only the weekly notice and --advise, which
// lists the notice's rows, honour the older HOUSE_COST_CHECK_USD, so a limit set for it keeps meaning what it meant.
export function advisorLimit({ notice = false, env = process.env } = {}) {
  for (const key of notice ? ['HOUSE_COST_ADVISOR_USD', 'HOUSE_COST_CHECK_USD'] : ['HOUSE_COST_ADVISOR_USD']) {
    const v = Number.parseFloat(env[key]);
    if (Number.isFinite(v) && v >= 0) return { usd: v, source: key };
  }
  return { usd: DEFAULT_ADVISOR_USD, source: 'default' };
}

export const advisorOff = (env = process.env) => String(env.HOUSE_COST_ADVISOR || '').toLowerCase() === 'off';

export const NEXT_CLEAR = 'Run /house-rules:handoff then /clear when most of it is finished work.';
const PREMIUM_NEXT = {
  'fast mode': 'Run /fast to turn fast mode off when nothing is waiting on the answer.',
  'US-only inference': 'Turn off US-only inference unless a data-residency requirement needs it.',
  'legacy models': 'Move pinned model IDs to the current version of the same tier.',
};

// The pattern table: every row above $0, largest first. Every row keeps the
// work unchanged, so none suggests a cheaper model or a lower effort. A field
// that is missing or not a number is no row, never a $0 row.
export function patternRows(d) {
  if (!d || typeof d !== 'object') return [];
  const rows = [];
  const add = (id, usd, text, next) => { if (Number.isFinite(usd) && usd > 0) rows.push({ id, usd, text, next }); };
  const bands = d.contextBands || {};
  const over = [bands['200k-500k'], bands['500k and over']].map((b) => b && b.usd);
  add('context-over-200k', over.every(Number.isFinite) ? over[0] + over[1] : NaN, 'main-thread turns over 200k context', NEXT_CLEAR);
  add('avoidable-rebuilds', d.avoidableUsd, `cache rebuilds after idle gaps or model switches${Number.isFinite(d.avoidableCount) ? ` (${d.avoidableCount} rebuilds)` : ''}`,
    'Before a break longer than the cache lifetime, run /house-rules:handoff then /clear, and settle on a model before the context grows.');
  const prem = d.premiums || {};
  const largest = [['fast mode', prem.fastUsd], ['US-only inference', prem.usOnlyUsd], ['legacy models', prem.legacyModelUsd]]
    .filter(([, v]) => Number.isFinite(v)).reduce((a, b) => (!a || b[1] > a[1] ? b : a), null);
  add('price-premiums', prem.totalUsd, largest ? `price premiums (mostly ${largest[0]}, $${largest[1].toFixed(0)})` : 'price premiums',
    largest ? PREMIUM_NEXT[largest[0]] : 'Check the fast mode, US-only inference and pinned model settings.');
  const ttl = d.shortTtl || {};
  add('short-ttl-rebuilds', ttl.usd, `idle rebuilds written to the 5-minute cache${Number.isFinite(ttl.count) ? ` (${ttl.count}, part of the rebuild total)` : ''}`,
    'Set promptCacheTtl: "1h" (Claude Code 2.1.242+) if such gaps are common; one-hour writes cost more per token.');
  return rows.sort((a, b) => b.usd - a.usd);
}

// The rows at or over the limit, read by the weekly notice and the session line.
export function advise(d, limitUsd) {
  return patternRows(d).filter((r) => r.usd >= limitUsd);
}

// The recent split behind the table, for --advise. A field that is missing or
// not a number is left out, never shown as $0, and a model with no price is
// marked unpriced and carries no dollars, since its $0 is a gap and not a cost.
// Subagent dollars include the workflow agents, which is why they are reported
// as "of which".
export function usageSummary(d) {
  const s = {};
  if (!d || typeof d !== 'object') return s;
  const num = Number.isFinite;
  const models = [];
  const unpriced = new Set(Array.isArray(d.unpriced) ? d.unpriced : []);
  if (d.byModel && typeof d.byModel === 'object') {
    for (const [model, v] of Object.entries(d.byModel)) {
      if (!v || typeof v !== 'object' || !(num(v.mainUsd) || num(v.subUsd))) continue;
      const m = { model };
      if (unpriced.has(model)) { m.unpriced = true; models.push(m); continue; }
      if (num(v.mainUsd)) m.mainUsd = v.mainUsd;
      if (num(v.subUsd)) m.subUsd = v.subUsd;
      if (num(m.mainUsd) && num(m.subUsd) && num(d.totalUsd) && d.totalUsd > 0) m.share = (m.mainUsd + m.subUsd) / d.totalUsd;
      models.push(m);
    }
    models.sort((a, b) => (a.unpriced ? 1 : 0) - (b.unpriced ? 1 : 0) || (b.mainUsd || 0) + (b.subUsd || 0) - (a.mainUsd || 0) - (a.subUsd || 0));
  }
  if (models.length) {
    s.models = models;
    const priced = models.filter((m) => !m.unpriced);
    if (priced.length && priced.every((m) => num(m.mainUsd))) s.mainUsd = priced.reduce((t, m) => t + m.mainUsd, 0);
    if (priced.length && priced.every((m) => num(m.subUsd))) s.subUsd = priced.reduce((t, m) => t + m.subUsd, 0);
  }
  const bands = d.contextBands && typeof d.contextBands === 'object' ? d.contextBands : {};
  const listed = BANDS.map(([k]) => ({ band: k, requests: bands[k] && bands[k].requests, usd: bands[k] && bands[k].usd })).filter((b) => num(b.requests) && num(b.usd));
  if (listed.length) s.bands = listed;
  const wf = d.workflowAgentsInWindow;
  if (wf && num(wf.agents) && num(wf.usd)) s.workflow = { agents: wf.agents, usd: wf.usd };
  const causes = d.byCause && typeof d.byCause === 'object' ? CAUSES.filter((k) => d.byCause[k] && num(d.byCause[k].count) && num(d.byCause[k].usd)).map((k) => ({ cause: k, count: d.byCause[k].count, usd: d.byCause[k].usd })) : [];
  if (causes.length || (num(d.avoidableCount) && num(d.avoidableUsd))) {
    s.rebuilds = { causes };
    if (num(d.avoidableCount) && num(d.avoidableUsd)) Object.assign(s.rebuilds, { avoidableCount: d.avoidableCount, avoidableUsd: d.avoidableUsd });
  }
  return s;
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
    '  - Subagent usage logged by Claude Code before 2.1.307 can be a placeholder for streamed responses, so the subagent column can be wrong.',
    `  - Prices dated ${PRICES_DATE}, from ${PRICES_SOURCE}`,
    '', 'Next:',
    '  /session-report                  where tokens went (cache breaks, subagents, skills)',
    '  npx -y @rixtay/mcp-usage         MCP servers loaded but never called',
    '  /usage                           plan usage');
  return L.join('\n') + '\n';
}

function formatSummary(s) {
  const L = ['Recent usage (list price; model figures are descriptive):'];
  if (s.models) {
    L.push('  By model:');
    for (const m of s.models) {
      if (m.unpriced) { L.push(`    ${m.model}: unpriced (not in the price table)`); continue; }
      const parts = [Number.isFinite(m.mainUsd) && `${usd(m.mainUsd)} main thread`, Number.isFinite(m.subUsd) && `${usd(m.subUsd)} subagent`].filter(Boolean);
      L.push(`    ${m.model}: ${parts.join(', ')}${m.share === undefined ? '' : ` (${Math.round(m.share * 100)}% of total)`}`);
    }
  }
  const wf = s.workflow ? `workflow agents ${usd(s.workflow.usd)}, ${s.workflow.agents} ${s.workflow.agents === 1 ? 'agent' : 'agents'}` : '';
  const split = [Number.isFinite(s.mainUsd) && `Main thread ${usd(s.mainUsd)}`, Number.isFinite(s.subUsd) && `${s.mainUsd === undefined ? 'Subagents' : 'subagents'} ${usd(s.subUsd)}${wf ? ` (of which ${wf})` : ''}`].filter(Boolean);
  if (split.length) L.push(`  ${split.join(', ')}`);
  if (wf && !Number.isFinite(s.subUsd)) L.push(`  ${wf[0].toUpperCase()}${wf.slice(1)}`);
  if (s.bands) {
    L.push('  Main-thread requests by context size, requests / cost:');
    for (const b of s.bands) L.push(`    ${b.band}: ${b.requests} / ${usd(b.usd)}`);
  }
  if (s.rebuilds) {
    L.push('  Main-thread cache rebuilds, by cause:');
    for (const c of s.rebuilds.causes) L.push(`    ${c.cause}: ${c.count} (${usd(c.usd)})`);
    if (s.rebuilds.avoidableCount !== undefined) L.push(`    avoidable (idle >1h + idle 5m-1h + model switch): ${s.rebuilds.avoidableCount} (${usd(s.rebuilds.avoidableUsd)})`);
  }
  return L;
}

export function formatAdvice(d, sinceLabel, limit, project) {
  const rows = patternRows(d);
  const over = rows.filter((r) => r.usd >= limit.usd), below = rows.filter((r) => r.usd < limit.usd);
  const s = usageSummary(d);
  const L = [`Cost advisor, ${sinceLabel}: ${usd(d.totalUsd)} at list price`, `Limit: ${usd(limit.usd)} (${limit.source})`, '', ...formatSummary(s)];
  if (Array.isArray(d.unpriced) && d.unpriced.length) L.push(`  Unpriced models (counted as $0): ${d.unpriced.join(', ')}`);
  L.push('');
  if (over.length) {
    L.push('Patterns at or over the limit, largest first:');
    for (const r of over) L.push(`  ${r.id}: ${usd(r.usd)}  ${r.text}`, `    Next: ${r.next}`);
  } else L.push('No pattern at or over the limit.');
  if (below.length) {
    L.push('', 'Patterns below the limit, largest first:');
    for (const r of below) L.push(`  ${r.id}: ${usd(r.usd)}  ${r.text} (below the limit)`, `    Next: ${r.next}`);
  }
  // Two large areas have no pattern row. These notes are descriptive and live here, never in the table the notice reads.
  const notes = [];
  if (s.workflow && s.workflow.usd > 0) notes.push('  workflows: `--workflow-estimate <agents>` gives a dollar estimate before a launch; it recommends no setting.');
  if (s.subUsd > 0) notes.push("  subagents: measured on the maintainer's transcripts only, where nothing (first-request and mid-run cache writes included) pointed to a change that leaves the work unchanged.");
  if (notes.length) L.push('', 'Areas with no pattern row:', ...notes);
  const line = (b) => (b.sessions ? `${b.sessions} sessions, p50 ${usd(b.p50)}, p90 ${usd(b.p90)}, p95 ${usd(b.p95)}` : '0 sessions');
  L.push('', `Baseline, main-thread cost per session over the last ${d.baselines.days} days:`, `  ${project ? 'project filter' : 'account'}: ${line(d.baselines.account)}`);
  for (const [k, b] of Object.entries(d.baselines.projects).filter(([, b]) => b.sessions >= MIN_BASELINE_SESSIONS).sort((a, b) => b[1].sessions - a[1].sessions)) L.push(`  ${k}: ${line(b)}`);
  L.push('', 'Dollars are list price, not your bill. How a plan\'s limits weight cache reads and writes is unknown.');
  return L.join('\n') + '\n';
}

function formatWorkflowEstimate(agents, past) {
  if (past.agents < MIN_WORKFLOW_AGENTS) return `No dollar estimate: only ${past.agents} past workflow agents in the last ${BASELINE_DAYS} days, and an estimate needs at least ${MIN_WORKFLOW_AGENTS}.\n`;
  const mean = past.usd / past.agents;
  return `Rough list-price estimate for ${agents} workflow agents: about ${usd(agents * mean)} (this account's mean of ${usd(mean)} per agent, from ${past.agents} past workflow agents over the last ${BASELINE_DAYS} days). List price, not your bill; a real run can differ widely.\n`;
}

const USAGE = 'usage: cost-report.mjs [--since 7d|24h|ISO] [--dir <projects dir>] [--project <substring>] [--json | --state <file> | --advise]\n       cost-report.mjs --workflow-estimate <agents> [--dir <projects dir>]\n';

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--advise') o.advise = true;
    else if (['--since', '--dir', '--project', '--state', '--workflow-estimate'].includes(a)) {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument: ${a}`);
  }
  if ([o.json, o.state, o.advise, o['workflow-estimate']].filter((v) => v !== undefined).length > 1) throw new Error('--json, --state, --advise and --workflow-estimate are separate outputs: use one');
  if (o['workflow-estimate'] !== undefined) {
    if (!/^[1-9]\d*$/.test(o['workflow-estimate'])) throw new Error(`--workflow-estimate needs a whole number of agents above 0, got ${o['workflow-estimate']}`);
    if (o.since !== undefined || o.project !== undefined) throw new Error('--workflow-estimate reads the whole account over a fixed 30 days: drop --since and --project');
  }
  o.since ??= '7d';
  return o;
}

// The figures the next scan compares against, without the older scan's own previous.
function readPrevious(file) {
  let s;
  try { s = JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return undefined;
  const { checkedAt, avoidableUsd, avoidableCount, premiums, contextBands, shortTtl } = s;
  return { checkedAt, avoidableUsd, avoidableCount, premiums, contextBands, shortTtl };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(USAGE); return; }
  const now = Date.now();
  const baselineSinceMs = now - BASELINE_DAYS * 86400000;
  if (o['workflow-estimate'] !== undefined) {
    const past = (await scan({ dir: o.dir, sinceMs: baselineSinceMs, baselineSinceMs })).workflowAgents;
    process.stdout.write(formatWorkflowEstimate(Number(o['workflow-estimate']), past));
    return;
  }
  const d = await scan({ dir: o.dir, sinceMs: parseSince(o.since, now), project: o.project, baselineSinceMs: o.state || o.advise ? baselineSinceMs : undefined });
  if (o.state) {
    const out = { checkedAt: new Date(now).toISOString(), since: o.since, totalUsd: d.totalUsd, avoidableUsd: d.avoidableUsd, avoidableCount: d.avoidableCount, byCause: d.byCause, byModel: d.byModel, premiums: d.premiums, contextBands: d.contextBands, shortTtl: d.shortTtl, baselines: d.baselines, previous: readPrevious(o.state) };
    mkdirSync(dirname(o.state), { recursive: true });
    const tmp = `${o.state}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(out) + '\n');
    renameSync(tmp, o.state);
    // Release the hook's spawn lock (see session-start.mjs) now the result is in place.
    try { unlinkSync(join(dirname(o.state), 'cost-check.lock')); } catch { /* none */ }
  } else if (o.advise) {
    process.stdout.write(formatAdvice(d, `since ${o.since}`, advisorLimit({ notice: true }), o.project));
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
