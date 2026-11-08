// Black-box tests for the UserPromptSubmit session cost line
// (plugins/house/hooks/session-cost-line.mjs).
//
// Each case builds its own config dir (baselines in house/cost-check.json), its
// own transcript under projects/<dir>/, and its own TMPDIR (where the hook
// keeps its once-per-session marker), pipes a UserPromptSubmit payload in, and
// asserts exit 0 plus the stdout contract: a line is {systemMessage}, silence
// is empty stdout. Dollars are Opus 5.5 input at $4 per million tokens, so a
// fixture's cost reads directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, '..', 'plugins', 'house', 'hooks', 'session-cost-line.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'house-line-'));
let seq = 0;

function assistant(usd, over = {}) {
  seq++;
  const usage = { input_tokens: Math.round(usd * 250000), cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  return JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), requestId: `r${seq}`, message: { id: `m${seq}`, model: 'claude-opus-5-5', usage }, ...over });
}

const account = (sessions, p95) => ({ sessions, p50: p95 / 2, p90: p95 * 0.9, p95 });

function setup({ lines, baselines, stateBody, project = 'proj' }) {
  const cfg = tmp();
  const dir = join(cfg, 'projects', project);
  mkdirSync(dir, { recursive: true });
  const transcript = join(dir, 'session.jsonl');
  if (lines) writeFileSync(transcript, lines.join('\n') + '\n');
  mkdirSync(join(cfg, 'house'), { recursive: true });
  writeFileSync(join(cfg, 'house', 'cost-check.json'), stateBody ?? JSON.stringify({ checkedAt: new Date().toISOString(), baselines }));
  return { cfg, transcript, temp: tmp() };
}

function run({ cfg, transcript, temp }, env = {}, session = 's-1') {
  const e = { ...process.env, CLAUDE_CONFIG_DIR: cfg, TMPDIR: temp };
  delete e.HOUSE_COST_ADVISOR;
  delete e.HOUSE_COST_ADVISOR_USD;
  delete e.HOUSE_COST_CHECK;
  delete e.HOUSE_COST_CHECK_USD;
  Object.assign(e, env);
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'next step', session_id: session, transcript_path: transcript, cwd: cfg }), encoding: 'utf8', env: e });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

const fires = (out) => assert.ok(out && typeof out.systemMessage === 'string' && out.systemMessage.length > 0, 'expected a line');

test('fires at p95 and not a cent below it', () => {
  const baselines = { account: account(40, 20), projects: {} };
  fires(run(setup({ lines: [assistant(20)], baselines })));
  assert.equal(run(setup({ lines: [assistant(19.99)], baselines })), null);
});

test('the limit wins when it is above p95', () => {
  const baselines = { account: account(40, 20), projects: {} };
  const env = { HOUSE_COST_ADVISOR_USD: '30' };
  assert.equal(run(setup({ lines: [assistant(25)], baselines }), env), null);
  fires(run(setup({ lines: [assistant(30)], baselines }), env));
});

test('the default limit of 5 holds even when p95 is lower', () => {
  const baselines = { account: account(40, 1), projects: {} };
  assert.equal(run(setup({ lines: [assistant(4.99)], baselines })), null);
  fires(run(setup({ lines: [assistant(5)], baselines })));
});

test('HOUSE_COST_CHECK_USD moves only the weekly notice, not the session line', () => {
  const baselines = { account: account(40, 1), projects: {} };
  fires(run(setup({ lines: [assistant(6)], baselines }), { HOUSE_COST_CHECK_USD: '100' }));
});

test('says the dollars, the scope, the next step, the skill and the off switch, and only as systemMessage', () => {
  const out = run(setup({ lines: [assistant(62)], baselines: { account: account(40, 49), projects: {} } }));
  fires(out);
  assert.deepEqual(Object.keys(out), ['systemMessage']);
  const m = out.systemMessage;
  assert.ok(!m.includes('\n'));
  assert.match(m, /\$62/);
  assert.match(m, /unusual for this account/);
  assert.match(m, /\/house-rules:handoff/);
  assert.match(m, /\/clear/);
  assert.match(m, /\/house-rules:cost-advisor/);
  assert.match(m, /HOUSE_COST_ADVISOR=off/);
});

test('fires once per session, and a new session fires again', () => {
  const s = setup({ lines: [assistant(30)], baselines: { account: account(40, 20), projects: {} } });
  fires(run(s));
  assert.equal(run(s), null);
  fires(run(s, {}, 's-2'));
});

test('stays silent when the marker cannot be written', () => {
  const s = setup({ lines: [assistant(30)], baselines: { account: account(40, 20), projects: {} } });
  const asFile = join(tmp(), 'not-a-dir');
  writeFileSync(asFile, 'x');
  assert.equal(run({ ...s, temp: asFile }), null);
  fires(run(s));
});

test('the project p95 wins once the project has 20 sessions', () => {
  const baselines = { account: account(100, 10), projects: { proj: account(20, 50) } };
  const s = setup({ lines: [assistant(15)], baselines });
  assert.equal(run(s), null, 'over the account p95 but under the project p95');
  const m = run(setup({ lines: [assistant(50)], baselines })).systemMessage;
  assert.match(m, /unusual for this repo/);
});

test('a project under 20 sessions falls back to the account', () => {
  const baselines = { account: account(100, 10), projects: { proj: account(19, 50) } };
  const m = run(setup({ lines: [assistant(15)], baselines })).systemMessage;
  assert.match(m, /unusual for this account/);
});

test('another project\'s baseline is never used', () => {
  const baselines = { account: account(19, 1), projects: { other: account(500, 1) } };
  assert.equal(run(setup({ lines: [assistant(30)], baselines })), null);
});

test('silent below 20 sessions at both levels, and 20 at the account level is enough', () => {
  assert.equal(run(setup({ lines: [assistant(30)], baselines: { account: account(19, 1), projects: { proj: account(19, 1) } } })), null);
  fires(run(setup({ lines: [assistant(30)], baselines: { account: account(20, 1), projects: { proj: account(19, 1) } } })));
});

test('silent on a malformed or wrong-shaped baseline', () => {
  const lines = [assistant(30)];
  for (const stateBody of ['{not json', 'null', '[]', '{}', '{"baselines":null}', '{"baselines":{"account":{"sessions":40}}}', '{"baselines":{"account":{"sessions":"many","p95":1}}}', '{"baselines":{"account":{"sessions":40,"p95":"high"}}}',
    '{"baselines":{"account":{"sessions":40,"p95":1},"projects":{"proj":{"sessions":40}}}}']) {
    assert.equal(run(setup({ lines, stateBody })), null, stateBody);
  }
});

test('silent on a malformed, empty or missing transcript', () => {
  const baselines = { account: account(40, 1), projects: {} };
  assert.equal(run(setup({ lines: ['{not json', 'also not'], baselines })), null);
  assert.equal(run(setup({ lines: [''], baselines })), null);
  assert.equal(run(setup({ baselines })), null, 'no transcript file');
  fires(run(setup({ lines: ['{not json', assistant(30)], baselines })));
});

test('silent on a malformed payload', () => {
  const s = setup({ lines: [assistant(30)], baselines: { account: account(40, 1), projects: {} } });
  const e = { ...process.env, CLAUDE_CONFIG_DIR: s.cfg, TMPDIR: s.temp };
  delete e.HOUSE_COST_ADVISOR;
  for (const input of ['not json', '{}', 'null', '{"session_id":"x"}']) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: e });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', input);
  }
});

test('HOUSE_COST_ADVISOR=off is silent; the same fixture without it fires', () => {
  const s = setup({ lines: [assistant(30)], baselines: { account: account(40, 1), projects: {} } });
  assert.equal(run(s, { HOUSE_COST_ADVISOR: 'off' }), null);
  fires(run(s));
});

test('session cost dedupes split responses and leaves out sidechain entries', () => {
  const baselines = { account: account(40, 20), projects: {} };
  const dup = assistant(15);
  assert.equal(run(setup({ lines: [dup, dup], baselines })), null, 'one response logged twice is $15');
  assert.equal(run(setup({ lines: [assistant(1), assistant(100, { isSidechain: true })], baselines })), null);
  fires(run(setup({ lines: [assistant(15), assistant(15)], baselines })));
});
