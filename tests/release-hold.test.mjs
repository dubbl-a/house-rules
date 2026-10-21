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

test('no PR for the commit is unread, not sync', () => {
  assert.deepEqual(verdict(pulls()), { code: 0, out: 'unread' });
});

test('a labelled PR that merged as another commit is unread', () => {
  assert.equal(verdict(pulls(pr({ merge_commit_sha: 'b'.repeat(40), labels: [{ name: LABEL }] }))).out, 'unread');
});

test('a labelled PR that is not merged is unread', () => {
  assert.equal(verdict(pulls(pr({ merged_at: null, labels: [{ name: LABEL }] }))).out, 'unread');
});

test('an unlabelled merged PR beside an unrelated one syncs', () => {
  assert.equal(verdict(pulls(pr({ merge_commit_sha: 'b'.repeat(40), labels: [{ name: LABEL }] }), pr())).out, 'sync');
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

test('an unread label holds the sync, retried before it gives up', () => {
  const j = job('release');
  assert.match(j, /unread\) echo "hold=true"/);
  assert.match(j, /for TRY in 1 2 3/);
  assert.match(j, /sleep 10/);
});

test('a manual sync refuses anything but the latest release', () => {
  const j = job('sync');
  assert.match(j, /releases\/latest/);
  assert.match(j, /"v\$\{VERSION\}" != "\$LATEST"/);
});

test('the held-sync note says a held sync only runs while it is the latest', () => {
  assert.match(job('hold-note'), /still the latest release/);
});

test('a successful manual sync closes the held-sync issue', () => {
  const j = job('close-hold');
  assert.match(j, /!cancelled\(\)/);
  assert.match(j, /needs\.sync\.result == 'success'/);
  assert.match(j, /workflow_dispatch/);
  assert.match(j, /issues: write/);
});

test('the sync job sets no concurrency: one pending slot per group would drop a newer leg', () => {
  assert.doesNotMatch(job('sync'), /^    concurrency:/m);
});

test('an empty latest-release tag fails the leg at both re-checks', () => {
  const j = job('sync');
  const empties = [...j.matchAll(/if \[ -z "\$LATEST" \]; then\n\s+echo "::error::[^\n]*\n\s+exit 1/g)];
  assert.equal(empties.length, 2);
});

test('every sync leg re-checks the latest release right before it pushes and before it merges', () => {
  const j = job('sync');
  const checks = [...j.matchAll(/no longer the latest release/g)].map((m) => m.index);
  assert.equal(checks.length, 2, 'one re-check before the push, one before the merge');
  assert.ok(checks[0] < j.indexOf('git push --force'), 'first re-check precedes the push');
  assert.ok(checks[0] > j.indexOf('Push and open the pull request'), 'first re-check is inside the push step');
  assert.ok(checks[1] < j.indexOf('gh pr merge'), 'second re-check precedes the merge');
  assert.ok(checks[1] > j.indexOf('Wait for checks, then merge'), 'second re-check is inside the merge step');
});

test('a stale leg skips with a notice, not a failure, and the wait step needs the pushed PR', () => {
  const j = job('sync');
  assert.match(j, /::notice::[^\n]*no longer the latest release[^\n]*not syncing"\n\s+exit 0/);
  assert.match(j, /steps\.pr\.outputs\.url != ''/);
});

test('a stale merge-time leg closes its pull request and branch, and fails if it cannot', () => {
  const j = job('sync');
  const at = j.indexOf('closing ${URL}, not merging');
  assert.ok(at > j.indexOf('Wait for checks, then merge'), 'inside the merge step');
  const tail = j.slice(at, j.indexOf('gh pr merge'));
  assert.match(tail, /gh pr close "\$URL" --repo "\$REPO" --delete-branch --comment "Superseded: \$\{LATEST\} was released/);
  assert.match(tail, /::error::[^\n]*could not close \$\{URL\}[^\n]*\n\s+exit 1\n\s+fi\n\s+exit 0/);
  assert.doesNotMatch(tail, /::warning::/);
});

test('the close-hold comment claims a finished run, not a sync every leg completed', () => {
  const j = job('close-hold');
  assert.match(j, /The manual sync run for v\$\{VERSION\} finished: /);
  assert.match(j, /Legs skip when a newer release exists; see the run summary/);
  assert.doesNotMatch(j, /Synced the adopters/);
});

test('the re-check reads the version from env only, never from an expression in run', () => {
  const lines = job('sync').split('\n').filter((l) => /releases\/latest|no longer the latest/.test(l));
  assert.ok(lines.length >= 4, 'both re-checks present');
  for (const l of lines) assert.doesNotMatch(l, /\$\{\{/, l);
});
