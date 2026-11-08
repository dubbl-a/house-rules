// Tests for scripts/dependabot-actions-merge.mjs: the CLI end to end, given
// the pr.json and runs.json files the dependabot-actions-merge workflow
// writes. The fixtures copy the shape of `gh pr view --json ...` and the
// Actions runs API as read from a real Dependabot actions PR. Each planted
// failure changes only one rule's input from the passing case, and asserts the
// rule and the reason it gives, so a test goes red when the check it names is
// removed, not merely when some other check also skips the PR. That was
// proved by mutating a scratch copy of the script: dropping each `if (...)
// return '...'` check, and each of the four bump parsers (title, Bumps,
// Updates, table), fails at least one test here.

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
const MERGE = `merge ${SHA}`;
const skipped = (r, rule, reason) => {
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp(`^skip: ${rule}: `));
  assert.match(r.out, reason, `the ${rule} skip gave another reason: ${r.out}`);
};

test('the passing case merges, pinned to the head commit', () => {
  assert.deepEqual(decide(basePr(), baseRuns()), { code: 0, out: MERGE });
});

// author
test('a human author is skipped', () => {
  skipped(withPr({ author: { is_bot: false, login: 'dubbl-a' } }), 'author', /not the Dependabot bot/);
});
test('a user named dependabot who is not a bot is skipped', () => {
  skipped(withPr({ author: { is_bot: false, login: 'dependabot' } }), 'author', /not the Dependabot bot/);
});
test('another bot is skipped', () => {
  skipped(withPr({ author: { is_bot: true, login: 'app/renovate' } }), 'author', /not the Dependabot bot/);
});
test('a missing author is skipped', () => {
  const pr = basePr();
  delete pr.author;
  skipped(decide(pr, baseRuns()), 'author', /not the Dependabot bot/);
});

// files
test('a changed file outside .github/workflows is skipped', () => {
  const files = [...basePr().files, { path: 'package.json' }];
  skipped(withPr({ files }), 'files', /outside \.github\/workflows/);
});
test('a file that only looks like a workflows path is skipped', () => {
  skipped(withPr({ files: [{ path: '.github/workflows-extra/x.yml' }] }), 'files', /outside \.github\/workflows/);
  skipped(withPr({ files: [{ path: '.github/workflows/../../package.json' }] }), 'files', /outside \.github\/workflows/);
});
test('an empty file list is skipped', () => {
  skipped(withPr({ files: [] }), 'files', /unreadable or empty/);
});
test('a file list that may be cut short is skipped', () => {
  const files = Array.from({ length: 100 }, (_, i) => ({ path: `.github/workflows/w${i}.yml` }));
  skipped(withPr({ files }), 'files', /cut short/);
});
test('several workflow files all under .github/workflows merge', () => {
  const files = [{ path: '.github/workflows/a.yml' }, { path: '.github/workflows/b.yaml' }];
  assert.equal(withPr({ files }).out, MERGE);
});

// commits
test('a commit by a human is skipped', () => {
  const human = { authors: [{ login: 'dubbl-a', name: 'Aaron' }], oid: SHA };
  skipped(withPr({ commits: [{ authors: BOT_COMMIT.authors, oid: 'a'.repeat(40) }, human] }), 'commits', /not authored by Dependabot/);
});
test('a commit by another bot is skipped', () => {
  const bot = { authors: [{ login: 'github-actions[bot]' }], oid: SHA };
  skipped(withPr({ commits: [bot] }), 'commits', /not authored by Dependabot/);
});
test('a commit co-authored by a human is skipped', () => {
  const co = { authors: [...BOT_COMMIT.authors, { login: 'dubbl-a' }], oid: SHA };
  skipped(withPr({ commits: [co] }), 'commits', /not authored by Dependabot/);
});
test('a commit with no readable author is skipped', () => {
  skipped(withPr({ commits: [{ authors: [], oid: SHA }] }), 'commits', /no readable author/);
});
test('a commit list that does not end at the head is skipped', () => {
  skipped(withPr({ commits: [{ ...BOT_COMMIT, oid: 'b'.repeat(40) }] }), 'commits', /does not end at the head/);
});
test('a commit list of 100 may be cut short and is skipped', () => {
  const commits = Array.from({ length: 100 }, (_, i) => ({ ...BOT_COMMIT, oid: i === 99 ? SHA : String(i).padStart(40, '0') }));
  skipped(withPr({ commits }), 'commits', /cut short/);
});
test('an empty commit list is skipped', () => {
  skipped(withPr({ commits: [] }), 'commits', /unreadable or empty/);
});
test('two Dependabot commits merge', () => {
  const first = { ...BOT_COMMIT, oid: 'c'.repeat(40) };
  assert.equal(withPr({ commits: [first, BOT_COMMIT] }).out, MERGE);
});

// bump
const bump = (from, to) => ({
  title: `build(deps): bump actions/x from ${from} to ${to}`,
  body: `Bumps [actions/x](https://github.com/actions/x) from ${from} to ${to}.\n`,
});
const GROUP_TITLE = 'build(deps): bump the actions group with 2 updates';
const table = (...rows) => ['Bumps the actions group with 2 updates:', '', '| Package | From | To |', '| --- | --- | --- |', ...rows, ''].join('\n');
const linkedRow = (name, from, to) => `| [${name}](https://github.com/${name}) | \`${from}\` | \`${to}\` |`;
const bareRow = (name, from, to) => `| ${name} | \`${from}\` | \`${to}\` |`;
const updatesLine = (name, from, to) => `Updates \`${name}\` from ${from} to ${to}`;

test('a patch bump merges', () => {
  assert.equal(withPr(bump('7.0.0', '7.0.1')).out, MERGE);
});
test('a minor bump merges, with or without a v prefix', () => {
  assert.equal(withPr(bump('7.0.0', '7.1.0')).out, MERGE);
  assert.equal(withPr(bump('v7.0.0', 'v7.1.0')).out, MERGE);
});
test('a major bump is skipped', () => {
  skipped(withPr(bump('7.1.0', '8.0.0')), 'bump', /major bump/);
  skipped(withPr(bump('v4', 'v5')), 'bump', /major bump/);
});

// Each parser has a case where it alone sees the major bump: with that parser
// removed the PR reads as having no bump at all, and the reason stops saying major.
test('the title parser alone sees a major bump', () => {
  skipped(withPr({ title: 'build(deps): bump actions/x from 1.0.0 to 2.0.0', body: 'nothing parseable here' }), 'bump', /major bump/);
});
test('the Bumps-line parser alone sees a major bump', () => {
  skipped(withPr({ title: 'build(deps): bump actions/x', body: bump('1.0.0', '2.0.0').body }), 'bump', /major bump/);
});
test('the Updates-line parser alone sees a major bump', () => {
  const body = ['Bumps the actions group with 1 update:', '', updatesLine('actions/b', '2.4.0', '3.0.0'), ''].join('\n');
  skipped(withPr({ title: 'build(deps): bump the actions group with 1 update', body }), 'bump', /major bump/);
});
test('the table parser alone sees a major bump in a linked row', () => {
  const body = table(linkedRow('actions/b', '2.4.0', '3.0.0'));
  skipped(withPr({ title: 'build(deps): bump the actions group with 1 update', body }), 'bump', /major bump/);
});
test('the table parser sees a major bump in a row with no package link', () => {
  const body = table(linkedRow('actions/a', '1.0.0', '1.0.1'), bareRow('actions/b', '2.0.0', '3.0.0'));
  skipped(withPr({ title: GROUP_TITLE, body }), 'bump', /major bump/);
});
test('a major in an Updates line of a group with minor and patch bumps is skipped', () => {
  const body = [updatesLine('actions/a', '1.0.0', '1.0.1'), updatesLine('actions/b', '2.0.0', '3.0.0'), ''].join('\n');
  skipped(withPr({ title: GROUP_TITLE, body }), 'bump', /major bump/);
});
test('a major bump in the body only is skipped', () => {
  skipped(withPr({ title: 'build(deps): bump the actions group', body: bump('1.0.0', '1.0.1').body + bump('2.0.0', '3.0.0').body }), 'bump', /major bump/);
});
test('a major bump hidden in a grouped PR table is skipped', () => {
  const body = table(linkedRow('actions/a', '1.0.0', '1.0.1'), linkedRow('actions/b', '2.4.0', '3.0.0'));
  skipped(withPr({ title: GROUP_TITLE, body }), 'bump', /major bump/);
});
test('a grouped PR of minor and patch bumps merges', () => {
  const body = [table(linkedRow('actions/a', '1.0.0', '1.0.1'), bareRow('actions/b', '2.4.0', '2.5.0')), updatesLine('actions/a', '1.0.0', '1.0.1'), updatesLine('actions/b', '2.4.0', '2.5.0'), ''].join('\n');
  assert.equal(withPr({ title: GROUP_TITLE, body }).out, MERGE);
});
test('a group title counting more updates than were parsed is skipped', () => {
  const body = [updatesLine('actions/a', '1.0.0', '1.0.1'), updatesLine('actions/b', '2.4.0', '2.5.0'), ''].join('\n');
  skipped(withPr({ title: 'build(deps): bump the actions group with 3 updates', body }), 'bump', /fewer packages parsed/);
});
test('the same package listed twice does not count as two updates', () => {
  const body = [updatesLine('actions/a', '1.0.0', '1.0.1'), updatesLine('actions/a', '1.0.1', '1.0.2'), ''].join('\n');
  skipped(withPr({ title: GROUP_TITLE, body }), 'bump', /fewer packages parsed/);
});
test('a truncated body is skipped even when the parsed bumps are minor and patch', () => {
  const body = [updatesLine('actions/a', '1.0.0', '1.0.1'), updatesLine('actions/b', '2.4.0', '2.5.0'), '', '_Description has been truncated_', ''].join('\n');
  skipped(withPr({ title: GROUP_TITLE, body }), 'bump', /truncated/);
});
test('release-note text that says from x to y does not count', () => {
  const body = bump('7.0.0', '7.0.1').body + '<li>Upgrade foo from 1.0.0 to 9.0.0</li>\n';
  assert.equal(withPr({ body }).out, MERGE);
});
test('a SHA version is unparseable and skipped', () => {
  skipped(withPr(bump('3d3c42e', '8e5e7e5')), 'bump', /could not be parsed/);
});
test('a pre-release version is skipped', () => {
  skipped(withPr(bump('7.0.0', '7.1.0-beta.1')), 'bump', /could not be parsed/);
});
test('no version in the title or body is skipped', () => {
  skipped(withPr({ title: 'build(deps): bump the actions group', body: 'nothing parseable here' }), 'bump', /no version bump found/);
});
test('an unchanged version is skipped', () => {
  skipped(withPr(bump('7.1.0', '7.1.0')), 'bump', /does not raise/);
});
test('a downgrade within a major is skipped', () => {
  skipped(withPr(bump('7.1.0', '7.0.0')), 'bump', /does not raise/);
});
test('a downgrade across a major is skipped', () => {
  skipped(withPr(bump('8.0.0', '7.9.0')), 'bump', /goes down/);
});
test('a 0.x minor bump is skipped', () => {
  skipped(withPr(bump('0.4.0', '0.5.0')), 'bump', /0\.x minor/);
});
test('a non-string title or body is skipped', () => {
  skipped(withPr({ title: null }), 'bump', /unreadable/);
  skipped(withPr({ body: 42 }), 'bump', /unreadable/);
});

// merge state
test('a merge state other than CLEAN is skipped', () => {
  for (const s of ['BEHIND', 'BLOCKED', 'DIRTY', 'UNSTABLE', 'UNKNOWN', 'HAS_HOOKS']) {
    skipped(withPr({ mergeStateStatus: s }), 'merge-state', /not CLEAN/);
  }
});
test('a mergeable value other than MERGEABLE is skipped', () => {
  for (const m of ['UNKNOWN', 'CONFLICTING']) skipped(withPr({ mergeable: m }), 'merge-state', /not MERGEABLE/);
});
test('a missing merge state is skipped', () => {
  const pr = basePr();
  delete pr.mergeStateStatus;
  skipped(decide(pr, baseRuns()), 'merge-state', /not CLEAN/);
});

// runs
test('a failed run is skipped', () => {
  skipped(decide(basePr(), { total_count: 2, workflow_runs: [run('completed', 'success'), run('completed', 'failure')] }), 'runs', /are fail/);
});
test('a pending run is skipped', () => {
  skipped(decide(basePr(), { total_count: 1, workflow_runs: [run('in_progress', null)] }), 'runs', /are pending/);
});
test('no runs at all is skipped', () => {
  skipped(decide(basePr(), { total_count: 0, workflow_runs: [] }), 'runs', /are none/);
});
test('success, skipped and neutral runs merge', () => {
  const runs = { total_count: 3, workflow_runs: [run('completed', 'success'), run('completed', 'skipped'), run('completed', 'neutral')] };
  assert.equal(decide(basePr(), runs).out, MERGE);
});
test('runs that were all skipped or neutral are skipped, since nothing ran', () => {
  skipped(decide(basePr(), { total_count: 1, workflow_runs: [run('completed', 'skipped')] }), 'runs', /no workflow run succeeded/);
  skipped(decide(basePr(), { total_count: 2, workflow_runs: [run('completed', 'skipped'), run('completed', 'neutral')] }), 'runs', /no workflow run succeeded/);
});
test('a run for another commit is skipped', () => {
  skipped(decide(basePr(), { total_count: 1, workflow_runs: [run('completed', 'success', 'd'.repeat(40))] }), 'runs', /another commit/);
});
test('a run list that may be cut short is skipped', () => {
  skipped(decide(basePr(), { total_count: 150, workflow_runs: [run('completed', 'success')] }), 'runs', /cut short/);
});
test('a runs response without a workflow_runs array is skipped', () => {
  skipped(decide(basePr(), { message: 'Not Found' }), 'runs', /unreadable/);
});
test('a head that is not a commit hash is skipped even when the runs name the same head', () => {
  const runs = { total_count: 1, workflow_runs: [run('completed', 'success', 'main')] };
  skipped(decide({ ...basePr(), headRefOid: 'main', commits: [{ ...BOT_COMMIT, oid: 'main' }] }, runs), 'runs', /head commit unreadable/);
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
