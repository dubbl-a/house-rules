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

/** Ledger-to-pins assertion: throws naming the first REUSE or BORROW row with no pin and no unpinned reason, or an unpinned entry that is bare or names no such row. */
function assertLedgerCovered(rows, { pins, unpinned }) {
  const names = new Set([...pins.map((p) => p.upstream), ...unpinned.map((u) => u.upstream)]);
  const walked = rows.filter((r) => pinned(r.relationship));
  assert.ok(walked.length >= 10, `ledger parse found only ${walked.length} REUSE or BORROW rows`);
  for (const r of walked) assert.ok(names.has(r.upstream), `ledger row "${r.upstream}" (${r.relationship}) has no pin and no unpinned reason`);
  for (const u of unpinned) {
    assert.ok(u.reason && u.reason.length > 10, `unpinned "${u.upstream}" needs a reason`);
    assert.ok(walked.some((r) => r.upstream === u.upstream), `unpinned "${u.upstream}" names no REUSE or BORROW row`);
  }
}

test('pins: every REUSE or BORROW row is pinned or listed as unpinned with a reason (planted-missing-member control)', () => {
  const file = pinsFile();
  assertLedgerCovered(ledgerRows(), file);
  // The control: the same assertion, run against a pins file with one row removed, must fail naming it.
  const dropped = file.pins[0].upstream;
  assert.throws(() => assertLedgerCovered(ledgerRows(), { ...file, pins: file.pins.slice(1) }), (e) => e.message.includes(`ledger row "${dropped}"`));
});

test('pins: the orchestration-kit entry equals the kit checker\'s PINNED, so the two cannot drift', async () => {
  const { PINNED } = await import(pathToFileURL(KIT_CHECK).href);
  assert.match(PINNED.remote, /^https:\/\/github\.com\//);
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

// #122 item 2: a bare date is not a version, a release- prefix is.
test('versions: a date-like number is no version; release-3.0, v2.1, and 2.1.3 are', async () => {
  const { compareVersions } = await mod();
  assert.equal(compareVersions('20260901', '1.0'), null);
  assert.equal(compareVersions('1.0', '20260901'), null);
  assert.ok(compareVersions('release-3.0', '2.9') > 0);
  assert.ok(compareVersions('v2.1', '2.0') > 0);
  assert.ok(compareVersions('2.1.3', '2.1.2') > 0);
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

// #122 item 1: a tag force-moved onto a new commit has no newer version to
// find, so only comparing the tag's own peeled target with the pin catches it,
// for an annotated tag (the peeled ^{} line) and a lightweight one alike.
test('check: a tag moved to a new commit exits 1 and names the tag; the same tag in place exits 0', () => {
  const env = { ...process.env, GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  for (const annotated of [true, false]) {
    const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }, { 'a.md': 'b\n' }], { '1.0.0': 0 });
    const pins = pinFixture([pin({ upstream: 'tagged', remote: bare, ref: { tag: '1.0.0' }, sha: shas[0] })]);
    const still = run([`--pins=${pins}`]);
    assert.equal(still.status, 0, still.stdout + still.stderr);
    execFileSync('git', ['-C', bare, 'tag', '-f', ...(annotated ? ['-a', '-m', 'moved'] : []), '1.0.0', shas[1]], { env, stdio: 'pipe' });
    const res = run([`--pins=${pins}`, '--json']);
    assert.equal(res.status, 1, `${annotated ? 'annotated' : 'lightweight'}: ${res.stdout}${res.stderr}`);
    const row = JSON.parse(res.stdout).rows[0];
    assert.equal(row.status, 'moved');
    assert.equal(row.head, shas[1]);
    const line = run([`--pins=${pins}`]).stdout.split('\n').find((l) => l.includes('tagged'));
    assert.match(line, /tag 1\.0\.0 moved/, line);
    assert.ok(line.includes(shas[1].slice(0, 7)), line);
  }
});

test('check: an unchanged lightweight tag exits 0', () => {
  const env = { ...process.env, GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }]);
  execFileSync('git', ['-C', bare, 'tag', '1.0.0', shas[0]], { env, stdio: 'pipe' });
  const res = run([`--pins=${pinFixture([pin({ remote: bare, ref: { tag: '1.0.0' }, sha: shas[0] })])}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

// A pin may record an annotated tag's own object sha rather than its commit;
// that must read as unchanged, not as a move.
test('check: a pin on an annotated tag\'s object sha is not a false move', () => {
  const { bare } = bareRepo([{ 'a.md': 'a\n' }], { '1.0.0': 0 });
  const obj = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/tags/1.0.0'], { encoding: 'utf8' }).trim();
  const res = run([`--pins=${pinFixture([pin({ remote: bare, ref: { tag: '1.0.0' }, sha: obj })])}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

// #199 option B: a moved row counts as moved only when a watched path changed.
// The GitHub compare call is injected, so these cases need no network. Every
// case that must stay `moved` is the fail-safe direction; the one that may go
// quiet is a compare that proves no watched path changed.
const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
const GH = 'https://github.com/o/r';
const compared = (files, truncated = false) => async () => ({ files, truncated });

/** A real local branch pin that has moved, so checkPin's git half runs for real; the compare is the injected half. */
function movedBranchPin(over = {}) {
  const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }, { 'a.md': 'b\n' }]);
  return pin({ remote: bare, sha: shas[0], paths: ['skills/x/'], ...over });
}

test('paths: a file matches its own path or lies under a directory, and a directory never matches a sibling prefix', async () => {
  const { pathMatches } = await mod();
  assert.ok(pathMatches('a/b/c.md', 'a/b'));
  assert.ok(pathMatches('a/b/c.md', 'a/b/'));
  assert.ok(pathMatches('a/b', 'a/b'));
  assert.ok(!pathMatches('a/bc/c.md', 'a/b'), 'a/bc is a sibling of a/b');
  assert.ok(!pathMatches('a/bc', 'a/b/'));
  assert.ok(pathMatches('README.md', 'README.md'));
  assert.ok(!pathMatches('docs/README.md', 'README.md'));
  assert.throws(() => pathMatches('a', 42));
});

test('checkPin: a change in a watched path stays moved and lists the changed files', async () => {
  const { checkPin, lineFor } = await mod();
  const row = await checkPin(movedBranchPin(), { compare: compared(['skills/x/SKILL.md', 'other.md']) });
  assert.equal(row.status, 'moved');
  assert.deepEqual(row.changed, ['skills/x/SKILL.md']);
  assert.equal(row.pathCheck, 'changed');
  assert.match(lineFor(row), /changed: skills\/x\/SKILL\.md/);
});

test('checkPin: a change only outside the watched paths is the quiet moved-unwatched verdict', async () => {
  const { checkPin, lineFor, summarize } = await mod();
  const row = await checkPin(movedBranchPin(), { compare: compared(['README.md', 'skills/xy/SKILL.md']) });
  assert.equal(row.status, 'moved-unwatched');
  assert.equal(row.otherFiles, 2);
  assert.match(lineFor(row), /^moved-unwatched .*no watched path changed \(2 other files did\)/);
  assert.equal(summarize([row]).status, 0, 'quiet rows do not set the moved exit status');
  assert.equal(summarize([row, { ...row, status: 'moved' }]).status, 1);
});

test('checkPin: a truncated compare stays moved, never quiet (planted-failure control)', async () => {
  const { checkPin } = await mod();
  const row = await checkPin(movedBranchPin(), { compare: compared(['README.md'], true) });
  assert.equal(row.status, 'moved');
  assert.equal(row.pathCheck, 'unprovable');
  assert.match(row.pathCheckDetail, /truncated/);
});

test('checkPin: an API failure, an empty file list, and a missing or unusable paths list all stay moved', async () => {
  const { checkPin } = await mod();
  const p = movedBranchPin();
  const failing = await checkPin(p, { compare: async () => { throw new Error('compare API answered HTTP 403 (rate limit or access)'); } });
  assert.equal(failing.status, 'moved');
  assert.match(failing.pathCheckDetail, /HTTP 403/);
  assert.equal((await checkPin(p, { compare: compared([]) })).status, 'moved');
  assert.equal((await checkPin(p, { compare: compared(undefined) })).status, 'moved');
  const noPaths = await checkPin({ ...p, paths: [] }, { compare: compared(['README.md']) });
  assert.equal(noPaths.status, 'moved');
  assert.match(noPaths.pathCheckDetail, /no watched paths/);
  assert.equal((await checkPin({ ...p, paths: undefined }, { compare: compared(['README.md']) })).status, 'moved');
  assert.equal((await checkPin({ ...p, paths: [7] }, { compare: compared(['README.md']) })).status, 'moved');
});

test('checkPin: a directory watched as a/b is not changed by a/bc, and is by a/b/x', async () => {
  const { checkPin } = await mod();
  const p = movedBranchPin({ paths: ['a/b'] });
  assert.equal((await checkPin(p, { compare: compared(['a/bc/x.md']) })).status, 'moved-unwatched');
  assert.equal((await checkPin(p, { compare: compared(['a/bc/x.md', 'a/b/x.md']) })).status, 'moved');
});

test('checkPin: a non-github remote has no compare API, so a moved row stays moved', async () => {
  const { checkPin } = await mod();
  const row = await checkPin(movedBranchPin());
  assert.equal(row.status, 'moved');
  assert.match(row.pathCheckDetail, /not a github\.com remote/);
});

test('checkPin: a moved tag pin is narrowed too, from the pin to the newer tag', async () => {
  const { checkPin } = await mod();
  const { bare, shas } = bareRepo([{ 'a.md': 'a\n' }, { 'a.md': 'b\n' }], { '1.0.0': 0, '1.1.0': 1 });
  const p = pin({ remote: bare, ref: { tag: '1.0.0' }, sha: shas[0], paths: ['docs/'] });
  const quiet = await checkPin(p, { compare: async (remote, base, head) => { assert.equal(base, shas[0]); assert.equal(head, shas[1]); return { files: ['a.md'], truncated: false }; } });
  assert.equal(quiet.status, 'moved-unwatched');
  assert.equal((await checkPin(p, { compare: compared(['docs/x.md']) })).status, 'moved');
});

/** A fetch double answering the given compare pages in order. */
const fakeFetch = (...pages) => {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url, init });
    const next = pages.shift();
    if (next instanceof Error) throw next;
    return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body };
  };
  fn.seen = seen;
  return fn;
};
const names = (n, prefix) => Array.from({ length: n }, (_, i) => ({ filename: `${prefix}${i}` }));

test('compareFiles: reads the compare API, sends the token only to api.github.com, and lists renames under both names', async () => {
  const { compareFiles } = await mod();
  const f = fakeFetch({ body: { status: 'ahead', files: [{ filename: 'new.md', previous_filename: 'old.md' }] } });
  const out = await compareFiles(`${GH}.git`, HEAD_A, HEAD_B, { fetchFn: f, token: 'tok' });
  assert.deepEqual(out, { files: ['new.md', 'old.md'], truncated: false });
  assert.match(f.seen[0].url, new RegExp(`^https://api\\.github\\.com/repos/o/r/compare/${HEAD_A}\\.\\.\\.${HEAD_B}\\?`));
  assert.equal(f.seen[0].init.headers.Authorization, 'Bearer tok');
});

test('compareFiles: a full 300-file list is reported truncated after three pages; a short one is not', async () => {
  const { compareFiles } = await mod();
  const f = fakeFetch({ body: { status: 'ahead', files: names(100, 'a') } }, { body: { status: 'ahead', files: names(100, 'b') } }, { body: { status: 'ahead', files: names(100, 'c') } });
  const out = await compareFiles(GH, HEAD_A, HEAD_B, { fetchFn: f, token: '' });
  assert.equal(out.truncated, true);
  assert.equal(out.files.length, 300);
  assert.equal(f.seen.length, 3);
  assert.equal(f.seen[0].init.headers.Authorization, undefined);
  const under = await compareFiles(GH, HEAD_A, HEAD_B, { fetchFn: fakeFetch({ body: { status: 'ahead', files: names(100, 'a') } }, { body: { status: 'ahead', files: names(5, 'b') } }) });
  assert.deepEqual([under.truncated, under.files.length], [false, 105]);
});

test('compareFiles: an HTTP error, a rate limit, a diverged or behind pin, a network failure, and a non-github remote all throw', async () => {
  const { compareFiles } = await mod();
  await assert.rejects(compareFiles(GH, HEAD_A, HEAD_B, { fetchFn: fakeFetch({ ok: false, status: 404, body: {} }) }), /HTTP 404/);
  await assert.rejects(compareFiles(GH, HEAD_A, HEAD_B, { fetchFn: fakeFetch({ ok: false, status: 429, body: {} }) }), /rate limit/);
  await assert.rejects(compareFiles(GH, HEAD_A, HEAD_B, { fetchFn: fakeFetch({ body: { status: 'diverged', files: [] } }) }), /not a fast-forward/);
  await assert.rejects(compareFiles(GH, HEAD_A, HEAD_B, { fetchFn: fakeFetch({ body: { status: 'behind', files: [] } }) }), /not a fast-forward/);
  await assert.rejects(compareFiles(GH, HEAD_A, HEAD_B, { fetchFn: fakeFetch({ body: { status: 'ahead' } }) }), /no files list/);
  await assert.rejects(compareFiles(GH, HEAD_A, HEAD_B, { fetchFn: fakeFetch(new Error('fetch failed')) }), /fetch failed/);
  await assert.rejects(compareFiles('https://example.com/o/r', HEAD_A, HEAD_B, { fetchFn: fakeFetch() }), /not a github\.com remote/);
  await assert.rejects(compareFiles(GH, 'abc', HEAD_B, { fetchFn: fakeFetch() }), /full shas/);
});

test('summarize: unreadable outranks moved, moved-unwatched is neither, and a clean walk is exit 0', async () => {
  const { summarize } = await mod();
  const r = (status) => ({ status });
  assert.equal(summarize([r('unchanged'), r('moved-unwatched')]).status, 0);
  assert.equal(summarize([r('unchanged')]).verdict, 'every upstream unchanged since its pin');
  assert.equal(summarize([r('moved'), r('unreadable')]).status, 3);
  assert.equal(summarize([r('moved'), r('moved-unwatched')]).status, 1);
  assert.match(summarize([r('moved-unwatched'), r('moved')]).tally, /1 moved, 1 moved outside watched paths/);
});

test('wiring: the weekly workflow gives the pins step a token and files only moved rows with their changed files', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/upstream-watch.yml'), 'utf8');
  const step = wf.slice(wf.indexOf('- name: Run the pinned-upstreams check'), wf.indexOf('- name: File or update the one moved-upstreams issue'));
  assert.match(step, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(wf, /r\.status === 'moved' && !r\.watchedBy/);
  assert.match(wf, /r\.changed/);
  assert.match(wf, /r\.compareUrl/);
});
