// Tests for scripts/release-hold.mjs: the CLI end to end, piping the
// commit-pulls API JSON on stdin, since the release workflow runs it that way.
// The last group reads release.yml itself for the hold and dispatch wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'release-hold.mjs');
const SHA = 'a'.repeat(40);
const LABEL = 'hold-sync';

function verdict(input, args = [SHA, LABEL]) {
  const r = spawnSync('node', [SCRIPT, ...args], { input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
}

const pr = (o) => ({ merged_at: '2026-10-21T00:00:00Z', merge_commit_sha: SHA, labels: [], ...o });
const pulls = (...ps) => JSON.stringify(ps);

test('the merged PR carrying the label holds the sync', () => {
  assert.deepEqual(verdict(pulls(pr({ labels: [{ name: LABEL }] }))), { code: 0, out: 'hold' });
});

test('the merged PR without the label syncs', () => {
  assert.deepEqual(verdict(pulls(pr({ labels: [{ name: 'other' }] }))), { code: 0, out: 'sync' });
});

test('no PR for the commit (a direct push) syncs', () => {
  assert.deepEqual(verdict(pulls()), { code: 0, out: 'sync' });
});

test('a labelled PR that merged as another commit does not hold', () => {
  assert.equal(verdict(pulls(pr({ merge_commit_sha: 'b'.repeat(40), labels: [{ name: LABEL }] }))).out, 'sync');
});

test('a labelled PR that is not merged does not hold', () => {
  assert.equal(verdict(pulls(pr({ merged_at: null, labels: [{ name: LABEL }] }))).out, 'sync');
});

test('one labelled PR among several holds', () => {
  assert.equal(verdict(pulls(pr({ merge_commit_sha: 'b'.repeat(40) }), pr({ labels: [{ name: LABEL }] }))).out, 'hold');
});

test('malformed JSON exits non-zero with no verdict', () => {
  const r = verdict('{not json');
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});

test('a response that is not an array exits non-zero', () => {
  const r = verdict('{"message":"Not Found"}');
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});

test('a missing label argument exits non-zero', () => {
  const r = verdict(pulls(), [SHA]);
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});

// release.yml wiring: text checks, since the workflow cannot run in a test.
const WORKFLOW = readFileSync(join(HERE, '..', '.github', 'workflows', 'release.yml'), 'utf8');
const job = (name) => {
  const m = WORKFLOW.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|(?![\\s\\S]))`, 'm'));
  assert.ok(m, `job ${name} exists`);
  return m[1];
};

test('workflow_dispatch takes a required version input', () => {
  assert.match(WORKFLOW, /workflow_dispatch:\n    inputs:\n      version:\n(?:        .*\n)*?        required: true/);
});

test('the release job runs on a push to main only, never on dispatch', () => {
  assert.match(job('release'), /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
});

test('the release job reads the hold label before it tags', () => {
  const j = job('release');
  assert.match(j, /release-hold\.mjs/);
  assert.ok(j.indexOf('release-hold.mjs') < j.indexOf('git tag -a'), 'hold is read before the tag');
});

test('sync skips on hold, and runs on dispatch from main', () => {
  const j = job('sync');
  assert.match(j, /needs\.release\.outputs\.hold != 'true'/);
  assert.match(j, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
});

test('the note job opens the held-sync issue with issues: write and nothing wider', () => {
  const j = job('hold-note');
  assert.match(j, /issues: write/);
  assert.doesNotMatch(j, /contents: write/);
  assert.match(j, /Adopter sync held for v/);
  assert.match(j, /GITHUB_STEP_SUMMARY/);
});

test('a successful manual sync closes the held-sync issue', () => {
  const j = job('close-hold');
  assert.match(j, /needs\.sync\.result == 'success'/);
  assert.match(j, /workflow_dispatch/);
  assert.match(j, /issues: write/);
});
