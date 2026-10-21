// Black-box tests for the UserPromptSubmit idle-cache hold hook
// (plugins/house/hooks/idle-cache-hold.mjs).
//
// Each case writes its own transcript and its own TMPDIR (where the hook
// keeps its once-per-gap state), pipes a UserPromptSubmit payload in, and
// asserts exit 0 plus the stdout contract: a hold is {decision: "block",
// reason}, a warning is {systemMessage}, silence is empty stdout. Payloads
// follow the UserPromptSubmit input documented at code.claude.com/docs/en/hooks;
// transcript entries copy the field names of real Claude Code transcripts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HERE, '..', 'plugins', 'house', 'hooks', 'idle-cache-hold.mjs');

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

// A main-conversation response on the 1 h cache: 400,000 tokens of context
// (2,000 + 1,000 + 395,000 + 2,000), so a 1 h rewrite on Opus 5.5 at $8 per
// million is $3.20, and on the 5 min cache at $5 it is $2.00.
function assistant({ minutesAgo = 120, ttl = '1h', model = 'claude-opus-5-5', uuid = 'a-1', entrypoint = 'cli', extra = {} } = {}) {
  const write = 1000;
  return {
    type: 'assistant',
    uuid,
    timestamp: ago(minutesAgo),
    entrypoint,
    isSidechain: false,
    message: {
      model,
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      usage: {
        input_tokens: 2000,
        cache_creation_input_tokens: write,
        cache_read_input_tokens: 395000,
        output_tokens: 2000,
        cache_creation: { ephemeral_1h_input_tokens: ttl === '1h' ? write : 0, ephemeral_5m_input_tokens: ttl === '5m' ? write : 0 },
      },
    },
    ...extra,
  };
}

const user = (text) => ({ type: 'user', uuid: 'u-1', timestamp: ago(130), message: { role: 'user', content: text } });

function sandbox(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'idle-cache-hold-'));
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  const transcript = join(dir, 'session.jsonl');
  writeFileSync(transcript, entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n');
  return { dir, tmp, transcript };
}

// An ambient override from the session running this suite must not leak in.
function run(box, { prompt = 'carry on with the refactor', env = {}, raw } = {}) {
  const childEnv = { ...process.env, TMPDIR: box.tmp };
  delete childEnv.HOUSE_IDLE_CACHE_HOLD;
  delete childEnv.HOUSE_IDLE_CACHE_HOLD_USD;
  Object.assign(childEnv, env);
  const payload = raw ?? JSON.stringify({
    session_id: 'abc123',
    transcript_path: box.transcript,
    cwd: box.dir,
    permission_mode: 'default',
    hook_event_name: 'UserPromptSubmit',
    prompt,
  });
  const res = spawnSync(process.execPath, [HOOK_PATH], { input: payload, encoding: 'utf8', env: childEnv });
  return { status: res.status, stdout: res.stdout };
}

const parsed = (r) => (r.stdout ? JSON.parse(r.stdout) : null);

test('holds the first prompt after a 1 h cache expired, naming gap, lifetime, size and cost', () => {
  const box = sandbox([user('start'), assistant()]);
  const r = run(box);
  assert.equal(r.status, 0);
  const out = parsed(r);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /2 h ago/);
  assert.match(out.reason, /cache lifetime 1 h/);
  assert.match(out.reason, /400,000 tokens/);
  assert.match(out.reason, /\$3\.20/);
  assert.match(out.reason, /submit it again/);
  assert.match(out.reason, /\/clear/);
  assert.match(out.reason, /HOUSE_IDLE_CACHE_HOLD/);
});

test('lets the same prompt through on the second submit, once per gap', () => {
  const box = sandbox([user('start'), assistant()]);
  assert.equal(parsed(run(box)).decision, 'block');
  const again = run(box);
  assert.equal(again.status, 0);
  assert.equal(again.stdout, '');
});

test('holds again after the next idle gap', () => {
  const box = sandbox([user('start'), assistant()]);
  assert.equal(parsed(run(box)).decision, 'block');
  writeFileSync(box.transcript, [user('start'), assistant(), user('next'), assistant({ uuid: 'a-2', minutesAgo: 90 })].map((e) => JSON.stringify(e)).join('\n') + '\n');
  assert.equal(parsed(run(box)).decision, 'block');
});

test('stays silent while a 1 h cache is warm', () => {
  const box = sandbox([assistant({ minutesAgo: 50 })]);
  assert.equal(run(box).stdout, '');
});

test('holds after 6 min on the 5 min cache, priced at the 5 min write rate', () => {
  const box = sandbox([assistant({ minutesAgo: 6, ttl: '5m' })]);
  const out = parsed(run(box));
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /cache lifetime 5 min/);
  assert.match(out.reason, /\$2\.00/);
});

test('reads the lifetime from the last main response, not an older or sidechain one', () => {
  const box = sandbox([
    assistant({ uuid: 'old', ttl: '5m', minutesAgo: 200 }),
    assistant({ uuid: 'main', ttl: '1h', minutesAgo: 30 }),
    assistant({ uuid: 'side', ttl: '5m', minutesAgo: 20, extra: { isSidechain: true } }),
  ]);
  assert.equal(run(box).stdout, '');
});

test('stays silent when the last response wrote nothing to the cache', () => {
  const box = sandbox([assistant({ ttl: 'none' })]);
  assert.equal(run(box).stdout, '');
});

test('stays silent after a compaction that followed the last response', () => {
  const box = sandbox([assistant(), { type: 'system', subtype: 'compact_boundary', timestamp: ago(60) }]);
  assert.equal(run(box).stdout, '');
});

test('stays silent for an unpriced model', () => {
  const box = sandbox([assistant({ model: 'some-other-model' })]);
  assert.equal(run(box).stdout, '');
});

test('prices a suffixed model id by its base id', () => {
  const box = sandbox([assistant({ model: 'claude-opus-5-5[1m]' })]);
  assert.match(parsed(run(box)).reason, /\$3\.20/);
});

test('stays silent below the threshold, and HOUSE_IDLE_CACHE_HOLD_USD moves it', () => {
  const box = sandbox([assistant()]);
  assert.equal(run(box, { env: { HOUSE_IDLE_CACHE_HOLD_USD: '5' } }).stdout, '');
  const box2 = sandbox([assistant()]);
  assert.equal(parsed(run(box2, { env: { HOUSE_IDLE_CACHE_HOLD_USD: 'lots' } })).decision, 'block');
});

test('HOUSE_IDLE_CACHE_HOLD=off silences the hook', () => {
  const box = sandbox([assistant()]);
  assert.equal(run(box, { env: { HOUSE_IDLE_CACHE_HOLD: 'off' } }).stdout, '');
});

test('HOUSE_IDLE_CACHE_HOLD=warn warns without holding', () => {
  const box = sandbox([assistant()]);
  const out = parsed(run(box, { env: { HOUSE_IDLE_CACHE_HOLD: 'warn' } }));
  assert.equal(out.decision, undefined);
  assert.match(out.systemMessage, /\$3\.20/);
});

test('never holds a turn nobody typed: task reports and peer messages pass silently', () => {
  for (const prompt of ['<task-notification>\n<task-id>x</task-id>', 'Another Claude session sent a message:\n<agent-message from="a1">hi']) {
    const box = sandbox([assistant()]);
    const r = run(box, { prompt });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', prompt);
  }
});

test('warns instead of holding in a session with scheduled work', () => {
  const fire = { type: 'system', subtype: 'scheduled_task_fire', prompt: 'check the deploy', timestamp: ago(300) };
  const wakeup = { type: 'assistant', uuid: 'w', timestamp: ago(300), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'ScheduleWakeup', input: {} }] } };
  for (const marker of [fire, wakeup]) {
    const box = sandbox([marker, assistant()]);
    const out = parsed(run(box, { prompt: 'check the deploy' }));
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage, /expired/);
  }
});

test('a recorded tool definition is not scheduled work, so the hold stands', () => {
  // Real transcripts record every tool definition, ScheduleWakeup and
  // CronCreate included, in api-request-shape and prompt_snapshot entries.
  const shape = { type: 'api-request-shape', tools: [{ name: 'ScheduleWakeup' }, { name: 'CronCreate' }] };
  const snapshot = { type: 'attachment', attachment: { type: 'prompt_snapshot', tools: [{ name: 'ScheduleWakeup' }] } };
  const box = sandbox([shape, snapshot, assistant()]);
  assert.equal(parsed(run(box)).decision, 'block');
});

test('warns instead of holding in a non-interactive session', () => {
  const box = sandbox([assistant({ entrypoint: 'sdk-cli' })]);
  const out = parsed(run(box));
  assert.equal(out.decision, undefined);
  assert.ok(out.systemMessage);
});

test('never holds a slash command, so /clear always works', () => {
  const box = sandbox([assistant()]);
  assert.equal(run(box, { prompt: '/clear' }).stdout, '');
});

test('does not hold when the state file cannot be written', () => {
  const box = sandbox([assistant()]);
  writeFileSync(join(box.tmp, 'house-idle-cache-hold'), 'a file where the state dir should be');
  const out = parsed(run(box));
  assert.equal(out.decision, undefined);
  assert.ok(out.systemMessage);
});

test('skips malformed transcript lines and finds the response before them', () => {
  const box = sandbox([assistant(), '{"type":"assistant","usage": broken', 'not json at all']);
  assert.equal(parsed(run(box)).decision, 'block');
});

test('missing transcript, malformed stdin and odd payloads stay silent and exit 0', () => {
  const box = sandbox([assistant()]);
  const missing = JSON.stringify({ session_id: 'abc123', transcript_path: join(box.dir, 'nope.jsonl'), prompt: 'hi' });
  for (const raw of [missing, 'not json', '', 'null', '[]', '{"prompt":1}']) {
    const r = run(box, { raw });
    assert.equal(r.status, 0, raw);
    assert.equal(r.stdout, '', raw);
  }
});
