// Tests for scripts/release-run-state.mjs: the CLI end to end, piping the
// Actions runs API JSON on stdin, since the release workflow runs it that way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'release-run-state.mjs');

function classify(input) {
  const r = spawnSync('node', [SCRIPT], { input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
}

const runs = (...rs) => JSON.stringify({ total_count: rs.length, workflow_runs: rs });
const done = (conclusion) => ({ status: 'completed', conclusion });

test('empty run list is none', () => {
  assert.deepEqual(classify(runs()), { code: 0, out: 'none' });
});

test('in_progress is pending', () => {
  assert.equal(classify(runs({ status: 'in_progress', conclusion: null })).out, 'pending');
});

test('queued is pending', () => {
  assert.equal(classify(runs({ status: 'queued', conclusion: null })).out, 'pending');
});

for (const c of ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']) {
  test(`completed ${c} is fail`, () => {
    assert.equal(classify(runs(done('success'), done(c))).out, 'fail');
  });
}

test('success, skipped, and neutral is green', () => {
  assert.equal(classify(runs(done('success'), done('skipped'), done('neutral'))).out, 'green');
});

test('success mixed with in_progress is pending', () => {
  assert.equal(classify(runs(done('success'), { status: 'in_progress', conclusion: null })).out, 'pending');
});

test('a failure beside a pending run is fail', () => {
  assert.equal(classify(runs(done('failure'), { status: 'queued', conclusion: null })).out, 'fail');
});

test('malformed JSON exits non-zero with no verdict', () => {
  const r = classify('{not json');
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});

test('JSON without a workflow_runs array exits non-zero', () => {
  const r = classify('{"message":"Not Found"}');
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});
