// Tests for scripts/dependabot-actions-merge.mjs: the CLI end to end, given
// the pr.json and runs.json files the dependabot-actions-merge workflow
// writes. The fixtures copy the shape of `gh pr view --json ...` and the
// Actions runs API as read from a real Dependabot actions PR. Every
// eligibility rule has a planted failure that changes only that rule's input
// from the passing case, so removing the rule turns its test red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'dependabot-actions-merge.mjs');

const SHA = '6f9afc4606dc3e2074be3a312ae21c9b905bbef3';
const BOT_COMMIT = { authors: [{ login: 'dependabot[bot]', name: 'dependabot[bot]' }], oid: SHA };

const basePr = () => ({
  author: { is_bot: true, login: 'app/dependabot' },
  title: 'build(deps): bump actions/setup-node from 7.0.0 to 7.1.0',
  body: 'Bumps [actions/setup-node](https://github.com/actions/setup-node) from 7.0.0 to 7.1.0.\n<details>\n<summary>Release notes</summary>\n',
  files: [{ path: '.github/workflows/pr-checks.yml', additions: 3, deletions: 3 }],
  commits: [BOT_COMMIT],
  headRefOid: SHA,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
});

const run = (status, conclusion, sha = SHA) => ({ status, conclusion, head_sha: sha, name: 'pr-checks' });
const baseRuns = () => ({ total_count: 1, workflow_runs: [run('completed', 'success')] });

function decide(pr, runs, { rawPr, rawRuns } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dam-'));
  try {
    const prFile = join(dir, 'pr.json');
    const runsFile = join(dir, 'runs.json');
    writeFileSync(prFile, rawPr ?? JSON.stringify(pr));
    writeFileSync(runsFile, rawRuns ?? JSON.stringify(runs));
    const r = spawnSync('node', [SCRIPT, prFile, runsFile], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const withPr = (patch, runs = baseRuns()) => decide({ ...basePr(), ...patch }, runs);
const skipped = (r, rule) => {
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp(`^skip: ${rule}: `));
};

test('the passing case merges, pinned to the head commit', () => {
  assert.deepEqual(decide(basePr(), baseRuns()), { code: 0, out: `merge ${SHA}` });
});

// author
test('a human author is skipped', () => {
  skipped(withPr({ author: { is_bot: false, login: 'dubbl-a' } }), 'author');
});
test('a user named dependabot who is not a bot is skipped', () => {
  skipped(withPr({ author: { is_bot: false, login: 'dependabot' } }), 'author');
});
test('another bot is skipped', () => {
  skipped(withPr({ author: { is_bot: true, login: 'app/renovate' } }), 'author');
});
test('a missing author is skipped', () => {
  const pr = basePr();
  delete pr.author;
  skipped(decide(pr, baseRuns()), 'author');
});

// files
test('a changed file outside .github/workflows is skipped', () => {
  const files = [...basePr().files, { path: 'package.json' }];
  skipped(withPr({ files }), 'files');
});
test('a file that only looks like a workflows path is skipped', () => {
  skipped(withPr({ files: [{ path: '.github/workflows-extra/x.yml' }] }), 'files');
  skipped(withPr({ files: [{ path: '.github/workflows/../../package.json' }] }), 'files');
});
test('an empty file list is skipped', () => {
  skipped(withPr({ files: [] }), 'files');
});
test('a file list that may be cut short is skipped', () => {
  const files = Array.from({ length: 100 }, (_, i) => ({ path: `.github/workflows/w${i}.yml` }));
  skipped(withPr({ files }), 'files');
});
test('several workflow files all under .github/workflows merge', () => {
  const files = [{ path: '.github/workflows/a.yml' }, { path: '.github/workflows/b.yaml' }];
  assert.equal(withPr({ files }).out, `merge ${SHA}`);
});

// commits
test('a commit by a human is skipped', () => {
  const human = { authors: [{ login: 'dubbl-a', name: 'Aaron' }], oid: SHA };
  skipped(withPr({ commits: [{ authors: BOT_COMMIT.authors, oid: 'a'.repeat(40) }, human] }), 'commits');
});
test('a commit by another bot is skipped', () => {
  const bot = { authors: [{ login: 'github-actions[bot]' }], oid: SHA };
  skipped(withPr({ commits: [bot] }), 'commits');
});
test('a commit co-authored by a human is skipped', () => {
  const co = { authors: [...BOT_COMMIT.authors, { login: 'dubbl-a' }], oid: SHA };
  skipped(withPr({ commits: [co] }), 'commits');
});
test('a commit with no readable author is skipped', () => {
  skipped(withPr({ commits: [{ authors: [], oid: SHA }] }), 'commits');
});
test('a commit list that does not end at the head is skipped', () => {
  skipped(withPr({ commits: [{ ...BOT_COMMIT, oid: 'b'.repeat(40) }] }), 'commits');
});
test('two Dependabot commits merge', () => {
  const first = { ...BOT_COMMIT, oid: 'c'.repeat(40) };
  assert.equal(withPr({ commits: [first, BOT_COMMIT] }).out, `merge ${SHA}`);
});

// bump
const bump = (from, to) => ({
  title: `build(deps): bump actions/x from ${from} to ${to}`,
  body: `Bumps [actions/x](https://github.com/actions/x) from ${from} to ${to}.\n`,
});
test('a patch bump merges', () => {
  assert.equal(withPr(bump('7.0.0', '7.0.1')).out, `merge ${SHA}`);
});
test('a minor bump merges, with or without a v prefix', () => {
  assert.equal(withPr(bump('7.0.0', '7.1.0')).out, `merge ${SHA}`);
  assert.equal(withPr(bump('v7.0.0', 'v7.1.0')).out, `merge ${SHA}`);
});
test('a major bump is skipped', () => {
  skipped(withPr(bump('7.1.0', '8.0.0')), 'bump');
  skipped(withPr(bump('v4', 'v5')), 'bump');
});
test('a major bump in the body only is skipped', () => {
  skipped(withPr({ title: 'build(deps): bump the actions group with 2 updates', body: bump('1.0.0', '1.0.1').body + bump('2.0.0', '3.0.0').body }), 'bump');
});
test('a major bump hidden in a grouped PR is skipped', () => {
  const body = [
    'Bumps the actions group with 2 updates:',
    '',
    '| Package | From | To |',
    '| --- | --- | --- |',
    '| [actions/a](https://github.com/actions/a) | `1.0.0` | `1.0.1` |',
    '| [actions/b](https://github.com/actions/b) | `2.4.0` | `3.0.0` |',
    '',
  ].join('\n');
  skipped(withPr({ title: 'build(deps): bump the actions group with 2 updates', body }), 'bump');
});
test('a grouped PR of minor and patch bumps merges', () => {
  const body = [
    'Bumps the actions group with 2 updates:',
    '',
    '| Package | From | To |',
    '| --- | --- | --- |',
    '| [actions/a](https://github.com/actions/a) | `1.0.0` | `1.0.1` |',
    '| [actions/b](https://github.com/actions/b) | `2.4.0` | `2.5.0` |',
    '',
    'Updates `actions/a` from 1.0.0 to 1.0.1',
    'Updates `actions/b` from 2.4.0 to 2.5.0',
    '',
  ].join('\n');
  assert.equal(withPr({ title: 'build(deps): bump the actions group with 2 updates', body }).out, `merge ${SHA}`);
});
test('release-note text that says from x to y does not count', () => {
  const body = bump('7.0.0', '7.0.1').body + '<li>Upgrade foo from 1.0.0 to 9.0.0</li>\n';
  assert.equal(withPr({ body }).out, `merge ${SHA}`);
});
test('a SHA version is unparseable and skipped', () => {
  skipped(withPr(bump('3d3c42e', '8e5e7e5')), 'bump');
});
test('a pre-release version is skipped', () => {
  skipped(withPr(bump('7.0.0', '7.1.0-beta.1')), 'bump');
});
test('no version in the title or body is skipped', () => {
  skipped(withPr({ title: 'build(deps): bump the actions group', body: 'nothing parseable here' }), 'bump');
});
test('a downgrade or an unchanged version is skipped', () => {
  skipped(withPr(bump('7.1.0', '7.0.0')), 'bump');
  skipped(withPr(bump('7.1.0', '7.1.0')), 'bump');
});
test('a 0.x minor bump is skipped', () => {
  skipped(withPr(bump('0.4.0', '0.5.0')), 'bump');
});
test('a non-string title or body is skipped', () => {
  skipped(withPr({ title: null }), 'bump');
  skipped(withPr({ body: 42 }), 'bump');
});

// merge state
test('a merge state other than CLEAN is skipped', () => {
  for (const s of ['BEHIND', 'BLOCKED', 'DIRTY', 'UNSTABLE', 'UNKNOWN', 'HAS_HOOKS']) {
    skipped(withPr({ mergeStateStatus: s }), 'merge-state');
  }
});
test('a mergeable value other than MERGEABLE is skipped', () => {
  for (const m of ['UNKNOWN', 'CONFLICTING']) skipped(withPr({ mergeable: m }), 'merge-state');
});
test('a missing merge state is skipped', () => {
  const pr = basePr();
  delete pr.mergeStateStatus;
  skipped(decide(pr, baseRuns()), 'merge-state');
});

// runs
test('a failed run is skipped', () => {
  skipped(decide(basePr(), { total_count: 2, workflow_runs: [run('completed', 'success'), run('completed', 'failure')] }), 'runs');
});
test('a pending run is skipped', () => {
  skipped(decide(basePr(), { total_count: 1, workflow_runs: [run('in_progress', null)] }), 'runs');
});
test('no runs at all is skipped', () => {
  const r = decide(basePr(), { total_count: 0, workflow_runs: [] });
  skipped(r, 'runs');
  assert.match(r.out, /none/);
});
test('success, skipped and neutral runs merge', () => {
  const runs = { total_count: 3, workflow_runs: [run('completed', 'success'), run('completed', 'skipped'), run('completed', 'neutral')] };
  assert.equal(decide(basePr(), runs).out, `merge ${SHA}`);
});
test('a run for another commit is skipped', () => {
  skipped(decide(basePr(), { total_count: 1, workflow_runs: [run('completed', 'success', 'd'.repeat(40))] }), 'runs');
});
test('a run list that may be cut short is skipped', () => {
  skipped(decide(basePr(), { total_count: 150, workflow_runs: [run('completed', 'success')] }), 'runs');
});
test('a runs response without a workflow_runs array is skipped', () => {
  skipped(decide(basePr(), { message: 'Not Found' }), 'runs');
});
test('an unreadable head commit is skipped', () => {
  skipped(withPr({ headRefOid: 'main', commits: [{ ...BOT_COMMIT, oid: 'main' }] }), 'runs');
});

// unreadable input
test('input that is not JSON is a skip with exit 1', () => {
  const r = decide(null, null, { rawPr: 'not json', rawRuns: '{}' });
  assert.equal(r.code, 1);
  assert.match(r.out, /^skip: unreadable input/);
});
test('a pull request that is not an object is skipped', () => {
  const r = decide(null, baseRuns(), { rawPr: '[]' });
  assert.deepEqual(r, { code: 0, out: 'skip: pull request unreadable' });
});
test('missing arguments are a skip with exit 1', () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^skip: unreadable input/);
});
