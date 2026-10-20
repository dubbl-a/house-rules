// Black-box tests for the SessionStart resume-cost hook
// (plugins/house/hooks/resume-cost.mjs).
//
// The hook is advisory: every case asserts exit 0, and a warning is a JSON
// systemMessage on stdout. Silence is empty stdout. The payloads follow the
// SessionStart input documented at code.claude.com/docs/en/hooks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HERE, '..', 'plugins', 'house', 'hooks', 'resume-cost.mjs');

// The docs' example payload for a resume after a cache expiry.
const DOCS_PAYLOAD = {
  session_id: 'abc123',
  transcript_path: '/Users/example/.claude/projects/p/abc123.jsonl',
  cwd: '/Users/example/p',
  hook_event_name: 'SessionStart',
  source: 'resume',
  model: 'claude-opus-5',
  seconds_since_last_response: 5400,
  context_tokens: 182340,
  prompt_cache_likely_expired: true,
  estimated_cache_write_usd: 1.1396,
};

// An ambient override from the session running this suite must not leak in.
function run(stdin, env = {}) {
  const childEnv = { ...process.env };
  delete childEnv.HOUSE_RESUME_COST_WARN;
  delete childEnv.HOUSE_RESUME_COST_WARN_USD;
  Object.assign(childEnv, env);
  const res = spawnSync(process.execPath, [HOOK_PATH], { input: stdin, encoding: 'utf8', env: childEnv });
  return { status: res.status, stdout: res.stdout };
}

const runPayload = (over = {}, env = {}) => run(JSON.stringify({ ...DOCS_PAYLOAD, ...over }), env);

test('warns on the docs example payload, naming size, idle time and cost', () => {
  const r = runPayload();
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(typeof out.systemMessage, 'string');
  assert.match(out.systemMessage, /182,340/);
  assert.match(out.systemMessage, /1\.5 h/);
  assert.match(out.systemMessage, /\$1\.14/);
  assert.match(out.systemMessage, /\/clear/);
  assert.match(out.systemMessage, /HOUSE_RESUME_COST_WARN/);
});

test('stays silent when the cache is warm', () => {
  const r = runPayload({ prompt_cache_likely_expired: false });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stays silent when the fields are absent', () => {
  const bare = { ...DOCS_PAYLOAD };
  for (const k of ['seconds_since_last_response', 'context_tokens', 'prompt_cache_likely_expired', 'estimated_cache_write_usd']) delete bare[k];
  const r = run(JSON.stringify(bare));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stays silent below the default threshold', () => {
  const r = runPayload({ estimated_cache_write_usd: 0.2 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('warns at exactly the default threshold', () => {
  const r = runPayload({ estimated_cache_write_usd: 0.25 });
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(r.stdout).systemMessage);
});

test('HOUSE_RESUME_COST_WARN=off silences the hook', () => {
  const r = runPayload({}, { HOUSE_RESUME_COST_WARN: 'off' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('HOUSE_RESUME_COST_WARN_USD raises the threshold', () => {
  const r = runPayload({}, { HOUSE_RESUME_COST_WARN_USD: '5' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('HOUSE_RESUME_COST_WARN_USD lowers the threshold', () => {
  const r = runPayload({ estimated_cache_write_usd: 0.1 }, { HOUSE_RESUME_COST_WARN_USD: '0.05' });
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(r.stdout).systemMessage);
});

test('an unparseable threshold falls back to the default', () => {
  const r = runPayload({}, { HOUSE_RESUME_COST_WARN_USD: 'lots' });
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(r.stdout).systemMessage);
});

test('wrongly typed fields stay silent', () => {
  const r = runPayload({ estimated_cache_write_usd: '1.14', prompt_cache_likely_expired: 'true' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('malformed stdin stays silent and exits 0', () => {
  for (const input of ['not json', '', '{"prompt_cache_likely_expired":', 'null', '[]']) {
    const r = run(input);
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '', input);
  }
});
