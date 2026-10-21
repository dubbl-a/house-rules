// Tests for plugins/house/scripts/cost-report.mjs and the weekly cost notice
// in plugins/house/hooks/session-start.mjs. Fixture transcripts live in temp
// dirs; nothing here reads the real ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'plugins/house/scripts/cost-report.mjs');
const HOOK = join(ROOT, 'plugins/house/hooks/session-start.mjs');

const tmp = () => mkdtempSync(join(tmpdir(), 'house-cost-'));
const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();
let seq = 0;

function entry({ model = 'claude-opus-5', ts, id, req, inTok = 0, w5 = 0, w1 = 0, read = 0, out = 0, speed, geo, sidechain }) {
  seq++;
  const usage = { input_tokens: inTok, cache_creation_input_tokens: w5 + w1, cache_creation: { ephemeral_1h_input_tokens: w1 }, cache_read_input_tokens: read, output_tokens: out };
  if (speed) usage.speed = speed;
  if (geo) usage.inference_geo = geo;
  const e = { type: 'assistant', timestamp: ts, requestId: req || `r${seq}`, message: { id: id || `m${seq}`, model, usage } };
  if (sidechain) e.isSidechain = true;
  return JSON.stringify(e);
}

function put(dir, rel, lines) {
  const f = join(dir, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

function report(dir, extra = []) {
  const r = spawnSync(process.execPath, [CLI, '--dir', dir, '--json', ...extra], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('dedupes a response split over entries, keeping the max output', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [
    entry({ id: 'a', req: 'x', ts: ago(60), inTok: 1e6, out: 10 }),
    entry({ id: 'a', req: 'x', ts: ago(59), inTok: 1e6, out: 1000000 }),
    '{"usage": not json',
    'no usage here',
  ]);
  const r = report(d);
  assert.equal(r.byModel['claude-opus-5'].requests, 1);
  near(r.totalUsd, 5 + 25);
});

test('two requests sharing a message id but with different requestIds count twice', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [
    entry({ id: 'same', req: 'x', ts: ago(60), inTok: 1e6 }),
    entry({ id: 'same', req: 'y', ts: ago(59), inTok: 1e6 }),
  ]);
  const r = report(d);
  assert.equal(r.byModel['claude-opus-5'].requests, 2);
  near(r.totalUsd, 10);
});

test('haiku long tier counts cache tokens toward the 100k threshold', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [
    entry({ model: 'claude-haiku-5-5', ts: ago(60), inTok: 50000, read: 60000, out: 1e6 }),
  ]);
  // input alone is under 100k, input plus reads is 110k: long tier (0.50 in, 0.05 read, 2.50 out).
  near(report(d).totalUsd, 0.05 * 0.5 + 0.06 * 0.05 + 2.5);
});

test('fast and us multipliers apply to cache writes and reads too', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [
    entry({ model: 'claude-opus-5-5', ts: ago(90), w5: 1e6, w1: 1e6, read: 1e6, speed: 'fast' }),
    entry({ model: 'claude-opus-5', ts: ago(80), w5: 1e6, w1: 1e6, read: 1e6, geo: 'us' }),
  ]);
  const r = report(d);
  near(r.byModel['claude-opus-5-5'].mainUsd, (5 + 8 + 0.2) * 2);
  near(r.byModel['claude-opus-5'].mainUsd, (6.25 + 10 + 0.5) * 1.1);
});

test('runs when invoked through a symlink', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  const link = join(tmp(), 'cost-report-link.mjs');
  symlinkSync(CLI, link);
  const r = spawnSync(process.execPath, [link, '--dir', d, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  near(JSON.parse(r.stdout).totalUsd, 5);
});

test('skips <synthetic>', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ model: '<synthetic>', ts: ago(60), inTok: 1e6 })]);
  assert.deepEqual(report(d).byModel, {});
});

test('prices each model, including the haiku long-prompt tier', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [
    entry({ model: 'claude-sonnet-5-5', ts: ago(90), inTok: 1e6, w5: 1e6, w1: 1e6, read: 1e6, out: 1e6 }),
    entry({ model: 'claude-haiku-5-5', ts: ago(80), inTok: 1e5, out: 1e6 }),
    entry({ model: 'claude-haiku-5-5', ts: ago(70), inTok: 100001, out: 1e6 }),
  ]);
  const r = report(d);
  near(r.byModel['claude-sonnet-5-5'].mainUsd, 2 + 2.5 + 4 + 0.1 + 10);
  // 100,000 input is the short tier (0.10 in, 0.50 out); 100,001 is the long tier (0.50 in, 2.50 out).
  near(r.byModel['claude-haiku-5-5'].mainUsd, 0.1 * 0.1 + 0.5 + 0.100001 * 0.5 + 2.5);
});

test('fast mode doubles a listed model; us geo adds 10%; fast on an unlisted model does not scale', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [
    entry({ model: 'claude-opus-5-5', ts: ago(90), inTok: 1e6, out: 1e6, speed: 'fast' }),
    entry({ model: 'claude-opus-5', ts: ago(80), inTok: 1e6, geo: 'us' }),
    entry({ model: 'claude-sonnet-5', ts: ago(70), inTok: 1e6, speed: 'fast' }),
  ]);
  const r = report(d);
  near(r.byModel['claude-opus-5-5'].mainUsd, 8 + 40);
  near(r.byModel['claude-opus-5'].mainUsd, 5.5);
  near(r.byModel['claude-sonnet-5'].mainUsd, 2);
  assert.equal(r.fastRequests, 1);
});

test('lists an unknown model as unpriced and counts it at zero', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ model: 'claude-mystery-9', ts: ago(60), inTok: 1e6 })]);
  const r = report(d);
  assert.deepEqual(r.unpriced, ['claude-mystery-9']);
  assert.equal(r.totalUsd, 0);
});

test('splits main thread from subagent by path and by isSidechain', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 }), entry({ ts: ago(50), inTok: 1e6, sidechain: true })]);
  put(d, 'p/s/subagents/agent-1.jsonl', [entry({ ts: ago(40), inTok: 1e6 })]);
  const b = report(d).byModel['claude-opus-5'];
  near(b.mainUsd, 5);
  near(b.subUsd, 10);
  assert.equal(b.requests, 3);
});

test('classifies each rebuild cause and costs it at the cache-write price', () => {
  const d = tmp();
  const big = { w5: 60000 };
  put(d, 'p/s.jsonl', [
    entry({ ts: ago(20000), inTok: 1, ...big }), // first in file: not a rebuild
    entry({ ts: ago(19990), inTok: 1, ...big }), // 10 s: no idle gap
    entry({ ts: ago(19000), inTok: 1, ...big }), // 990 s: idle 5m-1h
    entry({ ts: ago(10000), inTok: 1, ...big }), // 9000 s: idle >1h
    entry({ ts: ago(9990), inTok: 1, model: 'claude-sonnet-5', ...big }), // model switch beats a short gap
    entry({ ts: ago(9980), inTok: 1, model: 'claude-sonnet-5', w5: 40000 }), // under 50k: not a rebuild
  ]);
  const r = report(d);
  const c = r.byCause;
  assert.equal(c['no idle gap'].count, 1);
  assert.equal(c['idle 5m-1h'].count, 1);
  assert.equal(c['idle >1h'].count, 1);
  assert.equal(c['model switch'].count, 1);
  near(c['idle >1h'].usd, 60000 * 6.25 / 1e6);
  near(c['model switch'].usd, 60000 * 2.5 / 1e6);
  assert.equal(r.avoidableCount, 3);
  near(r.avoidableUsd, 60000 * (6.25 + 6.25 + 2.5) / 1e6);
});

test('--since keeps old requests out of the totals but uses them to sequence rebuilds', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [
    entry({ ts: ago(10 * 86400), inTok: 1e6 }),
    entry({ ts: ago(60), inTok: 1, w5: 60000 }),
  ]);
  const r = report(d, ['--since', '7d']);
  assert.equal(r.byModel['claude-opus-5'].requests, 1);
  assert.equal(r.byCause['idle >1h'].count, 1);
  assert.equal(report(d, ['--since', '30d']).byModel['claude-opus-5'].requests, 2);
});

test('--since skips files whose mtime is outside the window, and --project filters by directory', () => {
  const d = tmp();
  const old = put(d, 'alpha/old.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  const past = new Date(Date.now() - 30 * 86400000);
  utimesSync(old, past, past);
  put(d, 'beta/new.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  assert.equal(report(d).byModel['claude-opus-5'].requests, 1);
  assert.equal(report(d, ['--project', 'alpha', '--since', '60d']).byModel['claude-opus-5'].requests, 1);
  assert.deepEqual(report(d, ['--project', 'gamma']).byModel, {});
});

test('--state writes the summary atomically, prints nothing, and creates the directory', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  const state = join(tmp(), 'a', 'b', 'cost-check.json');
  const r = spawnSync(process.execPath, [CLI, '--dir', d, '--state', state], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  const s = JSON.parse(readFileSync(state, 'utf8'));
  assert.equal(s.since, '7d');
  near(s.totalUsd, 5);
  for (const k of ['checkedAt', 'avoidableUsd', 'avoidableCount', 'byCause', 'byModel']) assert.ok(k in s, k);
  assert.deepEqual(readdirSync(dirname(state)), ['cost-check.json']);
});

test('text output carries the totals, caveats and pointers; bad flags exit non-zero', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  const r = spawnSync(process.execPath, [CLI, '--dir', d], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  for (const re of [/\$5\.00 at list price/, /claude-opus-5/, /Avoidable rebuilds/, /undercounted/, /2026-10-20/, /platform\.claude\.com/, /\/session-report/, /@rixtay\/mcp-usage/, /\/usage/]) assert.match(r.stdout, re);
  const bad = spawnSync(process.execPath, [CLI, '--bogus'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);
});

// ---- session-start weekly notice ----

function hook(cfg, { source = 'startup', env = {}, stdin } = {}) {
  const e = { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOUSE_COST_CHECK_PROJECTS_DIR: join(cfg, 'projects') };
  delete e.HOUSE_COST_CHECK;
  delete e.HOUSE_COST_CHECK_USD;
  Object.assign(e, env);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HOOK], { input: stdin ?? JSON.stringify({ source }), encoding: 'utf8', env: e });
  assert.equal(r.status, 0, r.stderr);
  return { out: r.stdout ? JSON.parse(r.stdout) : null, ms: Date.now() - t0 };
}

const stateFile = (cfg) => join(cfg, 'house', 'cost-check.json');
function seed(cfg, over = {}) {
  mkdirSync(join(cfg, 'house'), { recursive: true });
  writeFileSync(stateFile(cfg), JSON.stringify({ checkedAt: ago(3600), since: '7d', totalUsd: 120.4, avoidableUsd: 34.6, avoidableCount: 5, byCause: {}, byModel: {}, ...over }));
}

test('hook: fresh state under threshold is silent about cost and keeps additionalContext', () => {
  const cfg = tmp();
  seed(cfg, { avoidableUsd: 2 });
  const { out } = hook(cfg);
  assert.equal(out.systemMessage, undefined);
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith('<house-orchestration>'));
});

test('hook: over threshold prints one line once, then marks it shown', () => {
  const cfg = tmp();
  seed(cfg);
  const first = hook(cfg).out;
  assert.ok(!first.systemMessage.includes('\n'));
  assert.match(first.systemMessage, /\$35 of \$120 at list price \(5 rebuilds\)/);
  assert.match(first.systemMessage, /\/session-report/);
  assert.match(first.systemMessage, /cost-report\.mjs/);
  assert.match(first.systemMessage, /HOUSE_COST_CHECK=off/);
  assert.ok(first.hookSpecificOutput.additionalContext);
  assert.ok(JSON.parse(readFileSync(stateFile(cfg), 'utf8')).shownAt);
  assert.equal(hook(cfg).out.systemMessage, undefined);
});

test('hook: HOUSE_COST_CHECK_USD moves the threshold; a source other than startup is ignored', () => {
  const cfg = tmp();
  seed(cfg);
  assert.equal(hook(cfg, { env: { HOUSE_COST_CHECK_USD: '100' } }).out.systemMessage, undefined);
  assert.equal(hook(cfg, { source: 'compact' }).out.systemMessage, undefined);
  assert.match(hook(cfg, { env: { HOUSE_COST_CHECK_USD: '30' } }).out.systemMessage, /house:/);
});

test('hook: HOUSE_COST_CHECK=off is silent and spawns nothing', () => {
  const cfg = tmp();
  assert.equal(hook(cfg, { env: { HOUSE_COST_CHECK: 'off' } }).out.systemMessage, undefined);
  assert.ok(!existsSync(stateFile(cfg)));
  seed(cfg);
  assert.equal(hook(cfg, { env: { HOUSE_COST_CHECK: 'off' } }).out.systemMessage, undefined);
});

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test('hook: no state or stale state claims first, spawns the scan detached, and returns fast', async () => {
  for (const setup of [() => {}, (cfg) => seed(cfg, { checkedAt: ago(8 * 86400), avoidableUsd: 2 })]) {
    const cfg = tmp();
    put(join(cfg, 'projects'), 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
    setup(cfg);
    const { out, ms } = hook(cfg);
    assert.ok(ms < 4000, `hook took ${ms} ms`);
    assert.equal(out.systemMessage, undefined);
    assert.ok(out.hookSpecificOutput.additionalContext);
    const done = await waitFor(() => {
      try { return JSON.parse(readFileSync(stateFile(cfg), 'utf8')).totalUsd === 5; } catch { return false; }
    });
    assert.ok(done, 'child wrote the scan result');
  }
});

test('hook: parallel startups spawn exactly one scan, and the scan releases the lock', async () => {
  const cfg = tmp();
  put(join(cfg, 'projects'), 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  const log = join(cfg, 'spawns.log');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOUSE_COST_CHECK_PROJECTS_DIR: join(cfg, 'projects'), HOUSE_COST_CHECK_SPAWN_LOG: log };
  delete env.HOUSE_COST_CHECK;
  await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve) => {
    const c = spawn(process.execPath, [HOOK], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    c.on('close', resolve);
    c.stdin.end(JSON.stringify({ source: 'startup' }));
  })));
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
  const lock = join(cfg, 'house', 'cost-check.lock');
  const done = await waitFor(() => {
    try { return JSON.parse(readFileSync(stateFile(cfg), 'utf8')).totalUsd === 5 && !existsSync(lock); } catch { return false; }
  });
  assert.ok(done, 'scan wrote its result and removed the lock');
});

test('hook: a fresh lock blocks a spawn and a lock older than an hour does not', () => {
  const cfg = tmp();
  const lock = join(cfg, 'house', 'cost-check.lock');
  mkdirSync(join(cfg, 'house'), { recursive: true });
  writeFileSync(lock, '1');
  const log = join(cfg, 'spawns.log');
  hook(cfg, { env: { HOUSE_COST_CHECK_SPAWN_LOG: log } });
  assert.ok(!existsSync(log), 'fresh lock: no spawn');
  const old = new Date(Date.now() - 2 * 3600000);
  utimesSync(lock, old, old);
  hook(cfg, { env: { HOUSE_COST_CHECK_SPAWN_LOG: log } });
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
});

test('hook: an unshown over-threshold result is shown before a rescan replaces it', async () => {
  const cfg = tmp();
  put(join(cfg, 'projects'), 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  seed(cfg, { checkedAt: ago(8 * 86400) });
  const { out } = hook(cfg);
  assert.match(out.systemMessage, /\$35 of \$120/);
  const done = await waitFor(() => {
    try { return JSON.parse(readFileSync(stateFile(cfg), 'utf8')).totalUsd === 5; } catch { return false; }
  });
  assert.ok(done, 'rescan still ran');
});

test('hook: malformed or wrong-shaped state never fails and is treated as no state', () => {
  for (const body of ['{not json', '[]', 'null', '{"checkedAt":"x","avoidableUsd":"lots"}']) {
    const cfg = tmp();
    mkdirSync(join(cfg, 'house'), { recursive: true });
    writeFileSync(stateFile(cfg), body);
    const { out } = hook(cfg);
    assert.equal(out.systemMessage, undefined);
    assert.ok(out.hookSpecificOutput.additionalContext);
  }
  const cfg = tmp();
  assert.ok(hook(cfg, { stdin: 'not json' }).out.hookSpecificOutput.additionalContext);
});
