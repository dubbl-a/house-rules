// The upstream ledger's machine-readable pins (scripts/upstream-pins.json),
// held to the ledger they key into, and the checker that walks them
// (scripts/check-upstreams.mjs). Network-free: the live remotes are only read
// by `npm run check:upstreams` and the weekly upstream-watch workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = join(ROOT, 'scripts/check-upstreams.mjs');
const PINS = join(ROOT, 'scripts/upstream-pins.json');
const LEDGER = join(ROOT, 'docs/handbook/upstreams.md');
const KIT_CHECK = join(ROOT, 'scripts/check-orchestration-kit-upstream.mjs');

const mod = () => import(pathToFileURL(CHECK).href);

/** Ledger rows as { upstream, relationship } read from the markdown table. */
function ledgerRows() {
  const rows = [];
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| Upstream ') || line.startsWith('| ---')) continue;
    const cells = line.slice(1, -1).split(' | ').map((c) => c.trim());
    rows.push({ upstream: cells[0], relationship: cells[3], recheck: cells[5] });
  }
  return rows;
}

const pinsFile = () => JSON.parse(readFileSync(PINS, 'utf8'));
const pinned = (rel) => /^(REUSE|BORROW)\b/.test(rel);

test('pins: the file loads through the checker\'s own validator', async () => {
  const { loadPins } = await mod();
  const { pins } = loadPins(readFileSync(PINS, 'utf8'));
  assert.ok(pins.length > 0);
});

test('pins: every pinned entry names a ledger row with the same relationship', () => {
  const rows = new Map(ledgerRows().map((r) => [r.upstream, r]));
  for (const p of pinsFile().pins) {
    const row = rows.get(p.upstream);
    assert.ok(row, `pin "${p.upstream}" names no row in the ledger`);
    assert.equal(row.relationship.split(' ')[0], p.relationship, `relationship of "${p.upstream}"`);
  }
});

test('pins: every REUSE or BORROW row is pinned or listed as unpinned with a reason (planted-missing-member control)', () => {
  const { pins, unpinned } = pinsFile();
  const names = new Set([...pins.map((p) => p.upstream), ...unpinned.map((u) => u.upstream)]);
  const rows = ledgerRows().filter((r) => pinned(r.relationship));
  assert.ok(rows.length >= 10, `ledger parse found only ${rows.length} REUSE or BORROW rows`);
  for (const r of rows) assert.ok(names.has(r.upstream), `ledger row "${r.upstream}" (${r.relationship}) has no pin and no unpinned reason`);
  for (const u of unpinned) {
    assert.ok(u.reason && u.reason.length > 10, `unpinned "${u.upstream}" needs a reason`);
    assert.ok(rows.some((r) => r.upstream === u.upstream), `unpinned "${u.upstream}" names no REUSE or BORROW row`);
  }
  // The control: drop one pin and the same walk must name it.
  const dropped = pins[0].upstream;
  const fewer = new Set([...names].filter((n) => n !== dropped));
  assert.ok(rows.some((r) => !fewer.has(r.upstream)), 'removing a pin is caught');
});

test('pins: the orchestration-kit entry equals the kit checker\'s PINNED, so the two cannot drift', async () => {
  const { PINNED } = await import(pathToFileURL(KIT_CHECK).href);
  const kit = pinsFile().pins.filter((p) => p.remote === PINNED.remote);
  assert.equal(kit.length, 1, 'exactly one pin on the kit remote');
  assert.equal(kit[0].sha, PINNED.sha);
  assert.equal(kit[0].ref.branch, PINNED.branch);
  assert.equal(kit[0].consulted, PINNED.consulted);
  assert.deepEqual(kit[0].paths, PINNED.ported);
});

test('pins: the plugin-cache rows are pinned to the marketplace repo on their plugin path, and the ledger says so', () => {
  const rows = new Map(ledgerRows().map((r) => [r.upstream, r]));
  for (const name of ['claude-md-management', 'plugin-dev', 'skill-creator']) {
    const p = pinsFile().pins.find((x) => x.upstream === `anthropics/claude-plugins-official \`${name}\``);
    assert.ok(p, name);
    assert.equal(p.remote, 'https://github.com/anthropics/claude-plugins-official');
    assert.deepEqual(p.paths, [`plugins/${name}/`]);
    const recheck = rows.get(p.upstream).recheck;
    assert.ok(!/cache/.test(recheck), `${name}: Re-check still points at the local cache`);
    assert.match(recheck, /check:upstreams/);
  }
});

test('loadPins: a malformed file or entry throws, naming the problem', async () => {
  const { loadPins } = await mod();
  assert.throws(() => loadPins('{ nope'), /parse/);
  assert.throws(() => loadPins('{"pins": []}'), /no pins/);
  const base = { upstream: 'x', relationship: 'BORROW', remote: 'https://e/x', ref: { branch: 'main' }, sha: 'a'.repeat(40), consulted: '2026-01-01', paths: ['a'], recheck: 'r' };
  assert.doesNotThrow(() => loadPins(JSON.stringify({ pins: [base] })));
  assert.throws(() => loadPins(JSON.stringify({ pins: [{ ...base, sha: 'abc' }] })), /sha/);
  assert.throws(() => loadPins(JSON.stringify({ pins: [{ ...base, relationship: 'CITED' }] })), /relationship/);
  assert.throws(() => loadPins(JSON.stringify({ pins: [{ ...base, ref: { branch: 'main', tag: '1.0' } }] })), /ref/);
  assert.throws(() => loadPins(JSON.stringify({ pins: [{ ...base, paths: [] }] })), /paths/);
  assert.throws(() => loadPins(JSON.stringify({ pins: [{ ...base, consulted: 'last week' }] })), /consulted/);
});

test('versions: numeric ordering, a v prefix, prereleases, and non-version tags', async () => {
  const { compareVersions, newerTags } = await mod();
  assert.ok(compareVersions('v0.25.0', 'v0.24.1') > 0);
  assert.ok(compareVersions('v0.9.0', 'v0.24.1') < 0, '9 sorts below 24 by number, not by string');
  assert.ok(compareVersions('4.0.0-beta', '4.0.0') < 0);
  assert.equal(compareVersions('2.1', '2.1.0'), 0);
  assert.equal(compareVersions('latest', '1.0'), null);
  assert.deepEqual(newerTags(['1.4', '2.0', '2.1', 'latest', '2.1-rc1', '3.0-beta', '10.0'], '2.1'), ['10.0', '3.0-beta']);
  assert.deepEqual(newerTags(['4.0.0', '4.0.0-beta', '3.0.0'], '4.0.0'), []);
});

test('parseTagRefs: peeled refs win, so an annotated tag maps to its commit', async () => {
  const { parseTagRefs } = await mod();
  const out = `${'1'.repeat(40)}\trefs/tags/4.0.0\n${'2'.repeat(40)}\trefs/tags/4.0.0^{}\n${'3'.repeat(40)}\trefs/tags/v1\n`;
  assert.deepEqual(Object.fromEntries(parseTagRefs(out)), { '4.0.0': '2'.repeat(40), v1: '3'.repeat(40) });
});

// The checker end to end, against local bare repos so no network is needed.
function bareRepo(commits, tags = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'house-upstreams-'));
  const work = join(dir, 'work');
  const bare = join(dir, 'bare.git');
  execFileSync('git', ['init', '-q', work]);
  execFileSync('git', ['-C', work, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const shas = [];
  for (const [i, files] of commits.entries()) {
    for (const [p, c] of Object.entries(files)) writeFileSync(join(work, p), c);
    execFileSync('git', ['-C', work, 'add', '-A'], { env });
    execFileSync('git', ['-C', work, 'commit', '-q', '-m', `c${i}`], { env });
    shas.push(execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
    for (const [tag, at] of Object.entries(tags)) if (at === i) execFileSync('git', ['-C', work, 'tag', '-a', '-m', tag, tag], { env });
  }
  execFileSync('git', ['clone', '-q', '--bare', work, bare]);
  return { bare, shas };
}

function pinFixture(pins) {
  const dir = mkdtempSync(join(tmpdir(), 'house-upstreams-'));
  const path = join(dir, 'pins.json');
  writeFileSync(path, JSON.stringify({ pins }));
  return path;
}

const pin = (over) => ({ upstream: 'fixture', relationship: 'BORROW', ref: { branch: 'main' }, consulted: '2026-01-01', paths: ['a.md'], recheck: 'r', ...over });
const run = (args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });

test('check: a branch head equal to the pin exits 0 (negative control)', () => {
  const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }]);
  const res = run([`--pins=${pinFixture([pin({ remote: bare, sha: shas[0] })])}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.equal(j.rows.length, 1);
  assert.equal(j.rows[0].status, 'unchanged');
});

test('check: a moved branch exits 1 and names the paths to review for BORROW, re-vendor for REUSE (positive control)', () => {
  const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }, { 'a.md': 'b\n' }]);
  const pins = [pin({ upstream: 'borrowed', remote: bare, sha: shas[0] }), pin({ upstream: 'reused', relationship: 'REUSE', remote: bare, sha: shas[0] })];
  const res = run([`--pins=${pinFixture(pins)}`]);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  const lines = res.stdout.trim().split('\n');
  const borrowed = lines.find((l) => l.includes('borrowed'));
  assert.match(borrowed, /moved/);
  assert.ok(borrowed.includes(shas[0].slice(0, 7)) && borrowed.includes(shas[1].slice(0, 7)), borrowed);
  assert.match(borrowed, /review these paths: a\.md/);
  assert.match(lines.find((l) => l.includes('reused')), /re-vendor at the new version/);
});

test('check: a tag pin reports a newer version tag and ignores older ones', () => {
  const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }, { 'a.md': 'b\n' }, { 'a.md': 'c\n' }], { '0.9.0': 0, '1.0.0': 1, '1.10.0': 2 });
  const older = run([`--pins=${pinFixture([pin({ remote: bare, ref: { tag: '1.10.0' }, sha: shas[2] })])}`, '--json']);
  assert.equal(older.status, 0, older.stdout + older.stderr);
  const moved = run([`--pins=${pinFixture([pin({ remote: bare, ref: { tag: '1.0.0' }, sha: shas[1] })])}`, '--json']);
  assert.equal(moved.status, 1, moved.stdout + moved.stderr);
  const row = JSON.parse(moved.stdout).rows[0];
  assert.equal(row.status, 'moved');
  assert.equal(row.current, '1.10.0');
});

test('check: an unreadable remote or a missing pinned tag exits 3, never 0', () => {
  const res = run([`--pins=${pinFixture([pin({ remote: '/definitely/not/a/repo', sha: 'a'.repeat(40) })])}`, '--json']);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.equal(JSON.parse(res.stdout).rows[0].status, 'unreadable');
  const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }], { '1.0.0': 0 });
  const gone = run([`--pins=${pinFixture([pin({ remote: bare, ref: { tag: '2.0.0' }, sha: shas[0] })])}`]);
  assert.equal(gone.status, 3, gone.stdout + gone.stderr);
  assert.match(gone.stdout, /unreadable/);
});

test('check: --only limits the walk to matching upstreams', () => {
  const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }, { 'a.md': 'b\n' }]);
  const pins = [pin({ upstream: 'still', remote: bare, sha: shas[1] }), pin({ upstream: 'moved-one', remote: bare, sha: shas[0] })];
  const res = run([`--pins=${pinFixture(pins)}`, '--only=still', '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).rows.map((r) => r.upstream), ['still']);
  const none = run([`--pins=${pinFixture(pins)}`, '--only=nothing-matches']);
  assert.equal(none.status, 3, 'an --only that matches nothing is not "unchanged"');
});

test('check: a pins file that does not parse, or an unknown argument, exits 3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-upstreams-'));
  writeFileSync(join(dir, 'bad.json'), '{ nope');
  const bad = run([`--pins=${join(dir, 'bad.json')}`, '--json']);
  assert.equal(bad.status, 3, bad.stdout + bad.stderr);
  assert.match(JSON.parse(bad.stdout).verdict, /pins file/);
  assert.equal(run(['--bogus']).status, 3);
});

test('wiring: package.json runs the checker outside verify, and the weekly workflow runs it beside the kit step', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:upstreams'], 'node scripts/check-upstreams.mjs');
  assert.ok(!pkg.scripts.verify.includes('check:upstreams'), 'needs network, so stays out of verify');
  const wf = readFileSync(join(ROOT, '.github/workflows/upstream-watch.yml'), 'utf8');
  assert.match(wf, /node scripts\/check-orchestration-kit-upstream\.mjs --json --diff/);
  assert.match(wf, /node scripts\/check-upstreams\.mjs --json/);
});
