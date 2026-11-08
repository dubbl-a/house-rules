// Tests for plugins/house/scripts/cost-report.mjs and the weekly cost notice
// in plugins/house/hooks/session-start.mjs. Fixture transcripts live in temp
// dirs; nothing here reads the real ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, symlinkSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnCpuSync } from './spawn-cpu.mjs';
import { advise } from '../plugins/house/scripts/cost-report.mjs';

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
  for (const re of [/\$5\.00 at list price/, /claude-opus-5/, /Avoidable rebuilds/, /undercounted/, /before 2\.1\.307/, /2026-10-20/, /platform\.claude\.com/, /\/session-report/, /@rixtay\/mcp-usage/, /\/usage/]) assert.match(r.stdout, re);
  const bad = spawnSync(process.execPath, [CLI, '--bogus'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);
});

// ---- session-start weekly notice ----

function hook(cfg, { source = 'startup', env = {}, stdin } = {}) {
  const e = { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOUSE_COST_CHECK_PROJECTS_DIR: join(cfg, 'projects') };
  delete e.HOUSE_COST_CHECK;
  delete e.HOUSE_COST_CHECK_USD;
  delete e.HOUSE_COST_ADVISOR;
  delete e.HOUSE_COST_ADVISOR_USD;
  Object.assign(e, env);
  const r = spawnCpuSync(process.execPath, [HOOK], { input: stdin ?? JSON.stringify({ source }), encoding: 'utf8', env: e });
  assert.equal(r.status, 0, r.stderr);
  return { out: r.stdout ? JSON.parse(r.stdout) : null, cpuMs: r.cpuMs };
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
  assert.match(first.systemMessage, /cache rebuilds after idle gaps or model switches \(5 rebuilds\) cost about \$35 at list price/);
  assert.match(first.systemMessage, /\/house-rules:handoff/);
  assert.match(first.systemMessage, /\/house-rules:cost-advisor/);
  assert.match(first.systemMessage, /HOUSE_COST_ADVISOR=off/);
  assert.ok(first.hookSpecificOutput.additionalContext);
  assert.ok(JSON.parse(readFileSync(stateFile(cfg), 'utf8')).shownAt);
  assert.deepEqual(readdirSync(join(cfg, 'house')).filter((f) => f.endsWith('.tmp')), [], 'the shown-at write leaves no temp file');
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
    const { out, cpuMs } = hook(cfg);
    // CPU time, not wall (#422): `npm run verify` runs suites side by side, and on
    // a loaded machine a hook that needs 100 ms of CPU waits past a wall bound with
    // nothing wrong. A hook that ran or awaited the scan itself burns that CPU in
    // its own process tree, so it moves this bound as much as a wall one.
    assert.ok(cpuMs < 4000, `hook used ${cpuMs} ms of CPU`);
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

test('hook: a scan that finishes between the due check and the lock acquire is not repeated', async () => {
  const cfg = tmp();
  const log = join(cfg, 'spawns.log');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOUSE_COST_CHECK_PROJECTS_DIR: join(cfg, 'projects'), HOUSE_COST_CHECK_SPAWN_LOG: log, HOUSE_COST_CHECK_LOCK_DELAY_MS: '2000' };
  delete env.HOUSE_COST_CHECK;
  const closed = new Promise((resolve) => {
    const c = spawn(process.execPath, [HOOK], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    c.on('close', resolve);
    c.stdin.end(JSON.stringify({ source: 'startup' }));
  });
  // The hook has read no state and sleeps before taking the lock; a scan finishing now
  // leaves a fresh result and no lock, exactly as the real scan does.
  await new Promise((r) => setTimeout(r, 700));
  seed(cfg, { avoidableUsd: 2 });
  await closed;
  assert.ok(!existsSync(log), 'no second scan after a fresh result landed');
  assert.ok(!existsSync(join(cfg, 'house', 'cost-check.lock')), 'the lock the hook took is released');
});

test('hook: two hooks that both judge a lock stale do not each take it', async () => {
  // A copy of the hook beside a stub scan that outlives the test body, so the scan never
  // finishes and removes the lock mid-test.
  const plugin = tmp();
  mkdirSync(join(plugin, 'hooks'));
  mkdirSync(join(plugin, 'scripts'));
  writeFileSync(join(plugin, 'hooks', 'session-start.mjs'), readFileSync(HOOK));
  writeFileSync(join(plugin, 'scripts', 'cost-report.mjs'), 'setTimeout(() => {}, 4000);\n');
  const cfg = tmp();
  const lock = join(cfg, 'house', 'cost-check.lock');
  mkdirSync(join(cfg, 'house'), { recursive: true });
  writeFileSync(lock, '1');
  const old = new Date(Date.now() - 2 * 3600000);
  utimesSync(lock, old, old);
  const log = join(cfg, 'spawns.log');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOUSE_COST_CHECK_SPAWN_LOG: log };
  delete env.HOUSE_COST_CHECK;
  const run = (extra) => new Promise((resolve) => {
    const c = spawn(process.execPath, [join(plugin, 'hooks', 'session-start.mjs')], { env: { ...env, ...extra }, stdio: ['pipe', 'ignore', 'ignore'] });
    c.on('close', resolve);
    c.stdin.end(JSON.stringify({ source: 'startup' }));
  });
  // The first hook judges the lock stale and sleeps; the second takes it meanwhile; the
  // first then wakes holding a stale judgement about a lock that is now fresh.
  const first = run({ HOUSE_COST_CHECK_STALE_DELAY_MS: '2000' });
  await new Promise((r) => setTimeout(r, 600));
  await run({});
  await first;
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
  assert.ok(existsSync(lock), "the second hook's fresh lock is still in place");
  assert.deepEqual(readdirSync(join(cfg, 'house')), ['cost-check.lock']);
});

test('hook: an unshown over-threshold result is shown before a rescan replaces it', async () => {
  const cfg = tmp();
  put(join(cfg, 'projects'), 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  seed(cfg, { checkedAt: ago(8 * 86400) });
  const { out } = hook(cfg);
  assert.match(out.systemMessage, /about \$35 at list price/);
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

// ---- price premiums, context bands, short-TTL rebuilds ----

test('premiums: each factor is the extra cost over the same tokens without it', () => {
  const fast = tmp();
  put(fast, 'p/s.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 1e6, out: 1e6, speed: 'fast' })]);
  assert.deepEqual(report(fast).premiums, { fastUsd: 24, usOnlyUsd: 0, legacyModelUsd: 0, totalUsd: 24 });
  const us = tmp();
  put(us, 'p/s.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 1e6, geo: 'us' })]);
  const p = report(us).premiums;
  near(p.usOnlyUsd, 0.4);
  assert.equal(p.fastUsd, 0);
  assert.equal(p.legacyModelUsd, 0);
  const legacy = tmp();
  put(legacy, 'p/s.jsonl', [
    entry({ model: 'claude-opus-5', ts: ago(60), inTok: 1e6, out: 1e6 }),
    entry({ model: 'claude-fable-5', ts: ago(50), read: 1e6 }),
    entry({ model: 'claude-sonnet-5', ts: ago(40), read: 1e6, sidechain: true }),
  ]);
  const l = report(legacy).premiums;
  near(l.legacyModelUsd, 6 + 0.75 + 0.1);
  assert.equal(l.fastUsd, 0);
  assert.equal(l.usOnlyUsd, 0);
});

test('premiums: totalUsd is the cost minus the standard price, not the sum of the overlapping factors', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ model: 'claude-opus-5', ts: ago(60), inTok: 1e6, speed: 'fast', geo: 'us' })]);
  const p = report(d).premiums;
  near(p.fastUsd, 11 - 5.5);
  near(p.usOnlyUsd, 11 - 10);
  near(p.legacyModelUsd, 11 - 8.8);
  near(p.totalUsd, 11 - 4);
  assert.ok(p.fastUsd + p.usOnlyUsd + p.legacyModelUsd > p.totalUsd);
  const out = spawnSync(process.execPath, [CLI, '--dir', d], { encoding: 'utf8' }).stdout;
  assert.match(out, /all three together: \$7\.00/);
});

test('text output prints the premium block only when a premium is above zero', () => {
  const plain = tmp();
  put(plain, 'p/s.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 1e6 })]);
  assert.doesNotMatch(spawnSync(process.execPath, [CLI, '--dir', plain], { encoding: 'utf8' }).stdout, /Price premiums/);
  const fast = tmp();
  put(fast, 'p/s.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 1e6, speed: 'fast' })]);
  const out = spawnSync(process.execPath, [CLI, '--dir', fast], { encoding: 'utf8' }).stdout;
  assert.match(out, /Price premiums/);
  assert.match(out, /fast mode: \$4\.00/);
});

test('context bands: 199,999 is under 200k, 200,000 and 500,000 move up; subagents are left out', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [
    entry({ model: 'claude-opus-5-5', ts: ago(90), inTok: 199999 }),
    entry({ model: 'claude-opus-5-5', ts: ago(80), inTok: 100000, read: 100000 }),
    entry({ model: 'claude-opus-5-5', ts: ago(70), inTok: 1, read: 200000, w5: 299999 }),
    entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 500000, sidechain: true }),
  ]);
  put(d, 'p/t.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(50), inTok: 1, w1: 499999 })]);
  const b = report(d).contextBands;
  assert.equal(b['under 200k'].requests, 1);
  assert.equal(b['200k-500k'].requests, 1);
  assert.equal(b['500k and over'].requests, 2);
  near(b['under 200k'].usd, 199999 * 4 / 1e6);
});

test('short TTL: idle 5m-1h rebuilds written mostly at 5m count; 1h-written and other causes do not', () => {
  const d = tmp();
  put(d, 'p/five.jsonl', [
    entry({ ts: ago(20000), inTok: 1, w5: 60000 }),
    entry({ ts: ago(19000), inTok: 1, w5: 60000 }), // 990 s, 5m write: counted
    entry({ ts: ago(10000), inTok: 1, w5: 60000 }), // idle >1h: not counted
  ]);
  put(d, 'p/hour.jsonl', [
    entry({ ts: ago(20000), inTok: 1, w1: 60000 }),
    entry({ ts: ago(19000), inTok: 1, w1: 60000 }), // 990 s, 1h write: not counted
  ]);
  const t = report(d).shortTtl;
  assert.equal(t.count, 1);
  near(t.usd, 60000 * 6.25 / 1e6);
  const out = spawnSync(process.execPath, [CLI, '--dir', d], { encoding: 'utf8' }).stdout;
  assert.match(out, /promptCacheTtl: "1h"/);
  assert.match(out, /2\.1\.242/);
  assert.match(out, /2x input vs 1\.25x/);
  const none = tmp();
  put(none, 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  assert.doesNotMatch(spawnSync(process.execPath, [CLI, '--dir', none], { encoding: 'utf8' }).stdout, /promptCacheTtl/);
});

test('--state carries the premiums, bands and short-TTL figures', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 1e6, speed: 'fast' })]);
  const state = join(tmp(), 'cost-check.json');
  assert.equal(spawnSync(process.execPath, [CLI, '--dir', d, '--state', state]).status, 0);
  const s = JSON.parse(readFileSync(state, 'utf8'));
  near(s.premiums.fastUsd, 4);
  assert.ok(s.contextBands['500k and over']);
  assert.equal(s.shortTtl.count, 0);
});

// ---- weekly notice: premiums, and retry after a crashed scan ----

const premiums = (fastUsd, usOnlyUsd = 0, legacyModelUsd = 0) => ({ fastUsd, usOnlyUsd, legacyModelUsd, totalUsd: fastUsd + usOnlyUsd + legacyModelUsd });

test('hook: premiums alone trigger the notice at the threshold and not below it', () => {
  const env = { HOUSE_COST_CHECK_USD: '10' };
  const below = tmp();
  seed(below, { avoidableUsd: 2, premiums: premiums(4, 3, 2.99) });
  assert.equal(hook(below, { env }).out.systemMessage, undefined);
  const at = tmp();
  seed(at, { avoidableUsd: 2, premiums: premiums(4, 3, 3) });
  const msg = hook(at, { env }).out.systemMessage;
  assert.ok(!msg.includes('\n'));
  assert.match(msg, /cost about \$10 at list price/);
  assert.match(msg, /fast mode/);
  assert.match(msg, /HOUSE_COST_ADVISOR=off/);
  assert.ok(JSON.parse(readFileSync(stateFile(at), 'utf8')).shownAt);
  assert.equal(hook(at, { env }).out.systemMessage, undefined);
});

test('hook: the notice shows only the top row and names the largest premium', () => {
  const cfg = tmp();
  seed(cfg, { premiums: premiums(1, 2, 30) });
  const msg = hook(cfg).out.systemMessage;
  assert.ok(!msg.includes('\n'));
  assert.match(msg, /\$35 at list price/);
  assert.doesNotMatch(msg, /legacy models/, 'the smaller premium row is left out');
  const legacy = tmp();
  seed(legacy, { avoidableUsd: 2, premiums: premiums(1, 2, 30) });
  assert.match(hook(legacy).out.systemMessage, /legacy models/);
  const us = tmp();
  seed(us, { avoidableUsd: 2, premiums: premiums(1, 20, 2) });
  assert.match(hook(us).out.systemMessage, /US-only inference/);
});

test('hook: the notice threshold and figure use the combined premium, not the overlapping sum', () => {
  const state = { avoidableUsd: 0, premiums: { fastUsd: 5.5, usOnlyUsd: 1, legacyModelUsd: 2.2, totalUsd: 7 } };
  const under = tmp();
  seed(under, state);
  assert.equal(hook(under, { env: { HOUSE_COST_CHECK_USD: '8' } }).out.systemMessage, undefined);
  const at = tmp();
  seed(at, state);
  const msg = hook(at, { env: { HOUSE_COST_CHECK_USD: '7' } }).out.systemMessage;
  assert.match(msg, /mostly fast mode, \$6\) cost about \$7 at list price/);
  const old = tmp();
  seed(old, { avoidableUsd: 0, premiums: { fastUsd: 40, usOnlyUsd: 0, legacyModelUsd: 0 } });
  assert.equal(hook(old).out.systemMessage, undefined);
});

// ---- cost advisor: pattern table ----

const bands = (a, b) => ({ 'under 200k': { requests: 9, usd: 999 }, '200k-500k': { requests: 2, usd: a }, '500k and over': { requests: 1, usd: b } });
const advisable = () => ({ contextBands: bands(30, 20), avoidableUsd: 40, avoidableCount: 7, premiums: { fastUsd: 60, usOnlyUsd: 1, legacyModelUsd: 2, totalUsd: 62 }, shortTtl: { count: 3, usd: 10 } });

test('advise: rows at or over the limit come largest first, and a row under it is dropped', () => {
  assert.deepEqual(advise(advisable(), 5).map((r) => r.id), ['price-premiums', 'context-over-200k', 'avoidable-rebuilds', 'short-ttl-rebuilds']);
  assert.deepEqual(advise(advisable(), 50).map((r) => r.id), ['price-premiums', 'context-over-200k'], '50 is at the limit, 40 is under');
  assert.deepEqual(advise(advisable(), 50.01).map((r) => r.id), ['price-premiums']);
  assert.deepEqual(advise(advisable(), 62.01), []);
});

test('advise: context cost counts the two bands over 200k and never the band under it', () => {
  const [row] = advise({ contextBands: bands(30, 20) }, 5);
  assert.equal(row.id, 'context-over-200k');
  assert.equal(row.usd, 50);
  assert.deepEqual(advise({ contextBands: bands(1, 2) }, 5), [], 'the $999 under-200k band alone must not qualify');
});

test('advise: every row carries id, usd, text and next, and the next step is exact', () => {
  const rows = Object.fromEntries(advise(advisable(), 1).map((r) => [r.id, r]));
  for (const r of Object.values(rows)) for (const k of ['id', 'usd', 'text', 'next']) assert.ok(r[k], `${r.id}: ${k}`);
  assert.match(rows['context-over-200k'].next, /\/house-rules:handoff.*\/clear.*finished work/);
  assert.match(rows['price-premiums'].text, /fast mode/);
  assert.match(rows['short-ttl-rebuilds'].next, /promptCacheTtl: "1h"/);
  assert.match(rows['avoidable-rebuilds'].text, /7 rebuilds/);
});

test('advise: the premium next step follows the largest premium', () => {
  const next = (fastUsd, usOnlyUsd, legacyModelUsd) => advise({ premiums: premiums(fastUsd, usOnlyUsd, legacyModelUsd) }, 1)[0].next;
  assert.match(next(9, 1, 1), /\/fast/);
  assert.match(next(1, 9, 1), /US-only/);
  assert.match(next(1, 1, 9), /current version of the same tier/);
});

test('advise: never suggests a cheaper model or lower effort', () => {
  const words = /\b(sonnet|haiku|cheaper model|lower effort|smaller model|downgrade)\b/i;
  for (const p of [premiums(60, 1, 2), premiums(1, 60, 2), premiums(1, 2, 60)]) {
    for (const r of advise({ ...advisable(), premiums: p }, 1)) assert.doesNotMatch(`${r.text} ${r.next}`, words, r.id);
  }
});

test('advise: a missing or malformed field is no row, and a $0 row never qualifies', () => {
  assert.deepEqual(advise({}, 5), []);
  assert.deepEqual(advise(null, 5), []);
  assert.deepEqual(advise({ avoidableUsd: 'lots', premiums: { totalUsd: null }, contextBands: { '200k-500k': { usd: 90 } }, shortTtl: {} }, 5), [], 'one band of two is not a figure');
  assert.deepEqual(advise({ avoidableUsd: 0, contextBands: bands(0, 0) }, 0), []);
  assert.deepEqual(advise({ avoidableUsd: 0.01 }, 0).map((r) => r.id), ['avoidable-rebuilds'], 'a limit of 0 still passes a positive row');
});

// ---- cost advisor: weekly notice ----

test('hook: the notice says how a row moved since the previous scan', () => {
  const moved = (previous) => { const cfg = tmp(); seed(cfg, { previous }); return hook(cfg).out.systemMessage; };
  assert.match(moved({ avoidableUsd: 65.6, avoidableCount: 9 }), /\$35 at list price, down \$31 since last check\./);
  assert.match(moved({ avoidableUsd: 22.6, avoidableCount: 3 }), /\$35 at list price, up \$12 since last check\./);
});

test('hook: no movement is claimed without the same row in the previous state', () => {
  const quiet = (over) => { const cfg = tmp(); seed(cfg, over); return hook(cfg).out.systemMessage; };
  assert.doesNotMatch(quiet({}), /since last check/, 'no previous state');
  assert.doesNotMatch(quiet({ previous: { premiums: premiums(70) } }), /since last check/, 'previous held a different row');
  assert.doesNotMatch(quiet({ previous: { avoidableUsd: 2 } }), /since last check/, 'the row did not qualify last time');
  assert.doesNotMatch(quiet({ previous: { avoidableUsd: 34.4 } }), /since last check/, 'under a dollar of movement');
  assert.match(quiet({ previous: 'garbage' }), /\$35 at list price\./, 'a malformed previous is no previous');
});

test('hook: the default limit is 5, HOUSE_COST_ADVISOR_USD wins, and HOUSE_COST_CHECK_USD applies only when it is unset', () => {
  const run = (avoidableUsd, env) => { const cfg = tmp(); seed(cfg, { avoidableUsd }); return hook(cfg, { env }).out.systemMessage; };
  assert.match(run(5, {}), /about \$5 at list price/);
  assert.equal(run(4.99, {}), undefined);
  assert.equal(run(6, { HOUSE_COST_ADVISOR_USD: '7' }), undefined);
  assert.match(run(8, { HOUSE_COST_ADVISOR_USD: '7', HOUSE_COST_CHECK_USD: '100' }), /house:/);
  assert.equal(run(8, { HOUSE_COST_CHECK_USD: '9' }), undefined);
  assert.match(run(9, { HOUSE_COST_CHECK_USD: '9' }), /house:/);
});

test('hook: HOUSE_COST_ADVISOR=off silences the notice and spawns nothing; without it the same state speaks', () => {
  const cfg = tmp();
  seed(cfg);
  const log = join(cfg, 'spawns.log');
  assert.equal(hook(cfg, { env: { HOUSE_COST_ADVISOR: 'off', HOUSE_COST_CHECK_SPAWN_LOG: log } }).out.systemMessage, undefined);
  assert.ok(!existsSync(log));
  assert.equal(JSON.parse(readFileSync(stateFile(cfg), 'utf8')).shownAt, undefined);
  assert.match(hook(cfg).out.systemMessage, /house:/);
});

test('hook: a broken cost-report module costs the notice, not the orchestration text', () => {
  const plugin = tmp();
  mkdirSync(join(plugin, 'hooks'));
  mkdirSync(join(plugin, 'scripts'));
  mkdirSync(join(plugin, 'orchestration'));
  writeFileSync(join(plugin, 'hooks', 'session-start.mjs'), readFileSync(HOOK));
  writeFileSync(join(plugin, 'orchestration', 'ORCHESTRATION.md'), 'text');
  writeFileSync(join(plugin, 'scripts', 'cost-report.mjs'), 'this is not javascript (');
  const cfg = tmp();
  seed(cfg);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg };
  delete env.HOUSE_COST_CHECK;
  delete env.HOUSE_COST_ADVISOR;
  const r = spawnSync(process.execPath, [join(plugin, 'hooks', 'session-start.mjs')], { input: JSON.stringify({ source: 'startup' }), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.systemMessage, undefined);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('text'));
});

// ---- cost advisor: baselines, --advise, workflow estimate, strict args ----

// $1 of Opus 5.5 input per 250,000 tokens, so a fixture's dollars read directly.
const dollars = (usd, over = {}) => entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: usd * 250000, ...over });

function stateOf(d, args = []) {
  const state = join(tmp(), 'cost-check.json');
  const r = spawnSync(process.execPath, [CLI, '--dir', d, '--state', state, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(readFileSync(state, 'utf8'));
}

test('--state records 30-day session percentiles for the account and each project', () => {
  const d = tmp();
  for (const [i, usd] of [1, 2, 3, 4].entries()) put(d, `alpha/s${i}.jsonl`, [dollars(usd)]);
  put(d, 'beta/s.jsonl', [dollars(10)]);
  const { baselines } = stateOf(d);
  assert.equal(baselines.account.sessions, 5);
  near(baselines.account.p50, 3);
  near(baselines.account.p95, 8.8);
  assert.equal(baselines.projects.alpha.sessions, 4);
  near(baselines.projects.alpha.p50, 2.5);
  near(baselines.projects.alpha.p95, 3.85);
  assert.equal(baselines.projects.beta.sessions, 1);
  near(baselines.projects.beta.p95, 10);
});

test('baselines: subagent files and sidechain entries are not session cost', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [dollars(1), dollars(50, { sidechain: true })]);
  put(d, 'p/s/subagents/agent-1.jsonl', [dollars(100)]);
  put(d, 'p/s/subagents/workflows/run/agent-2.jsonl', [dollars(100)]);
  const { baselines } = stateOf(d);
  assert.equal(baselines.account.sessions, 1, 'subagent files are not sessions');
  near(baselines.account.p95, 1);
});

test('baselines cover 30 days while the advice figures stay on 7, in one scan', () => {
  const d = tmp();
  const f = put(d, 'p/recent.jsonl', [dollars(2, { ts: ago(20 * 86400) })]);
  const past = new Date(Date.now() - 20 * 86400000);
  utimesSync(f, past, past);
  const old = put(d, 'p/old.jsonl', [dollars(1000, { ts: ago(40 * 86400) })]);
  const older = new Date(Date.now() - 40 * 86400000);
  utimesSync(old, older, older);
  put(d, 'p/now.jsonl', [dollars(3)]);
  const s = stateOf(d);
  assert.equal(s.since, '7d');
  near(s.totalUsd, 3);
  assert.equal(s.baselines.account.sessions, 2, 'the 20-day file counts and the 40-day one does not');
  near(s.baselines.account.p95, 2.95);
});

test('baselines: a request before the 30-day cut does not count toward its session', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [dollars(100, { ts: ago(40 * 86400) }), dollars(2)]);
  near(stateOf(d).baselines.account.p95, 2);
});

test('baselines: an unpriced session is left out rather than counted at $0', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ model: 'claude-mystery-9', ts: ago(60), inTok: 1e6 })]);
  put(d, 'p/t.jsonl', [dollars(2)]);
  const { baselines } = stateOf(d);
  assert.equal(baselines.account.sessions, 1);
  near(baselines.account.p50, 2);
});

test('--state with no sessions records a zero count and no percentile', () => {
  const { baselines } = stateOf(tmp());
  assert.equal(baselines.account.sessions, 0);
  assert.equal(baselines.account.p95, undefined);
  assert.deepEqual(baselines.projects, {});
});

test('--state keeps the previous scan\'s figures and does not chain them', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 1e6, speed: 'fast' })]);
  const state = join(tmp(), 'cost-check.json');
  const scanOnce = () => spawnSync(process.execPath, [CLI, '--dir', d, '--state', state], { encoding: 'utf8' });
  assert.equal(scanOnce().status, 0);
  assert.equal(JSON.parse(readFileSync(state, 'utf8')).previous, undefined, 'the first scan has nothing before it');
  put(d, 'p/t.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(50), inTok: 1e6, speed: 'fast' })]);
  assert.equal(scanOnce().status, 0);
  const second = JSON.parse(readFileSync(state, 'utf8'));
  near(second.previous.premiums.fastUsd, 4);
  near(second.premiums.fastUsd, 8);
  assert.equal(scanOnce().status, 0);
  const third = JSON.parse(readFileSync(state, 'utf8'));
  near(third.previous.premiums.fastUsd, 8);
  assert.equal(third.previous.previous, undefined);
});

function advised(d, args = [], env = {}) {
  const e = { ...process.env, ...env };
  if (!('HOUSE_COST_ADVISOR_USD' in env)) delete e.HOUSE_COST_ADVISOR_USD;
  return spawnSync(process.execPath, [CLI, '--dir', d, '--advise', ...args], { encoding: 'utf8', env: e });
}

test('--advise prints the qualifying rows, the limit with its source, the baseline, and the plain total', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 3e6 })]);
  const plain = spawnSync(process.execPath, [CLI, '--dir', d, '--since', '30d'], { encoding: 'utf8' }).stdout;
  const total = /\$(\d+\.\d\d) at list price/.exec(plain)[1];
  const r = advised(d, ['--since', '30d']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`\\$${total.replace('.', '\\.')} at list price`));
  assert.match(r.stdout, /context-over-200k: \$12\.00/);
  assert.match(r.stdout, /\/house-rules:handoff/);
  assert.match(r.stdout, /Limit: \$5\.00 \(default\)/);
  assert.match(r.stdout, /account: 1 sessions?, p50 \$12\.00/);
});

test('--advise names the environment as the limit source and reports no qualifying row', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [entry({ model: 'claude-opus-5-5', ts: ago(60), inTok: 3e6 })]);
  const r = advised(d, [], { HOUSE_COST_ADVISOR_USD: '50' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Limit: \$50\.00 \(HOUSE_COST_ADVISOR_USD\)/);
  assert.match(r.stdout, /No pattern at or over the limit/);
  assert.doesNotMatch(r.stdout, /context-over-200k/);
});

function workflowAgents(d, n, usd) {
  for (let i = 0; i < n; i++) put(d, `p/s/subagents/workflows/run/agent-${i}.jsonl`, [dollars(usd)]);
}

test('--workflow-estimate multiplies the mean workflow-agent cost at 50 past agents and over', () => {
  const d = tmp();
  workflowAgents(d, 50, 2);
  put(d, 'p/s/subagents/agent-x.jsonl', [dollars(1000)]);
  put(d, 'p/main.jsonl', [dollars(1000)]);
  const r = spawnSync(process.execPath, [CLI, '--dir', d, '--workflow-estimate', '7'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /about \$14/);
  assert.match(r.stdout, /rough/i);
  assert.match(r.stdout, /list[- ]price/i);
  assert.match(r.stdout, /50 past workflow agents/);
});

test('--workflow-estimate below 50 past agents prints no dollars and says why', () => {
  const d = tmp();
  workflowAgents(d, 49, 2);
  const r = spawnSync(process.execPath, [CLI, '--dir', d, '--workflow-estimate', '7'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\$/);
  assert.match(r.stdout, /49 past workflow agents/);
  assert.match(r.stdout, /at least 50/);
});

test('--workflow-estimate counts only the last 30 days', () => {
  const d = tmp();
  workflowAgents(d, 50, 2);
  for (let i = 0; i < 10; i++) put(d, `p/old/subagents/workflows/run/a${i}.jsonl`, [dollars(500, { ts: ago(40 * 86400) })]);
  assert.match(spawnSync(process.execPath, [CLI, '--dir', d, '--workflow-estimate', '1'], { encoding: 'utf8' }).stdout, /about \$2\b/);
});

test('strict args: a bad flag or value exits non-zero before any scan, and --help prints usage', () => {
  const d = tmp();
  put(d, 'p/s.jsonl', [dollars(1)]);
  for (const args of [['--bogus'], ['--advise', 'stray'], ['--workflow-estimate'], ['--workflow-estimate', '0'], ['--workflow-estimate', '-3'], ['--workflow-estimate', '1.5'], ['--workflow-estimate', 'many'],
    ['--workflow-estimate', '5', '--since', '7d'], ['--workflow-estimate', '5', '--project', 'p'], ['--advise', '--json'], ['--advise', '--state', join(d, 'x.json')], ['--advise', '--workflow-estimate', '5'], ['--advise', '--since', 'never']]) {
    const r = spawnSync(process.execPath, [CLI, '--dir', d, ...args], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /usage: cost-report/, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
  }
  assert.ok(!existsSync(join(d, 'x.json')));
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--advise/);
  assert.match(help.stdout, /--workflow-estimate/);
});

test('house cost forwards its arguments and the exit code to cost-report', () => {
  const HOUSE = join(ROOT, 'plugins/house/scripts/house');
  const d = tmp();
  workflowAgents(d, 50, 2);
  const ok = spawnSync(process.execPath, [HOUSE, 'cost', '--dir', d, '--workflow-estimate', '3'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /about \$6/);
  const bad = spawnSync(process.execPath, [HOUSE, 'cost', '--workflow-estimate', 'many'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /usage: cost-report/);
});

test('hook: a scan that dies is respawned once its lock is over an hour old, and a finished result stays due a week out', () => {
  const cfg = tmp();
  const bad = put(join(cfg, 'projects'), 'p/s.jsonl', [entry({ ts: ago(60), inTok: 1e6 })]);
  chmodSync(bad, 0); // the scan cannot read it and exits non-zero without writing a result
  const log = join(cfg, 'spawns.log');
  const env = { HOUSE_COST_CHECK_SPAWN_LOG: log };
  const spawns = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0);
  hook(cfg, { env });
  assert.equal(spawns(), 1);
  hook(cfg, { env });
  assert.equal(spawns(), 1, 'fresh lock: no second spawn');
  const lock = join(cfg, 'house', 'cost-check.lock');
  const old = new Date(Date.now() - 2 * 3600000);
  utimesSync(lock, old, old);
  hook(cfg, { env });
  assert.equal(spawns(), 2, 'stale lock: retried');

  const done = tmp();
  seed(done, { checkedAt: ago(6 * 86400), avoidableUsd: 2 });
  hook(done, { env: { HOUSE_COST_CHECK_SPAWN_LOG: join(done, 'spawns.log') } });
  assert.ok(!existsSync(join(done, 'spawns.log')), 'a result six days old is not yet due');
});
