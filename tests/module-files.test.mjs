// Tests for the vendored guard scripts under plugins/house/modules/*/files/
// (engineering/is-main.mjs, data-pipelines/retro.mjs,
// deployment/{deploy-guards,assert-main-at-origin}.mjs,
// github/{scan-dist-secrets.mjs,cleanup-worktree.sh}).
//
// These are the literal files a consuming repo gets copied into
// scripts/house/** by `house render` (module.json's files[] entries) — they
// are tested here directly at their files/ source path, not through the
// render pipeline (that's tests/cli-house.test.mjs's job).
//
// Every sandbox is a throwaway dir under the OS tmpdir. No network calls.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const IS_MAIN = join(ROOT, 'plugins/house/modules/engineering/files/is-main.mjs');
const RETRO = join(ROOT, 'plugins/house/modules/data-pipelines/files/retro.mjs');
const ASSERT_MAIN = join(ROOT, 'plugins/house/modules/deployment/files/assert-main-at-origin.mjs');
const DEPLOY_GUARDS = join(ROOT, 'plugins/house/modules/deployment/files/deploy-guards.mjs');
const SCAN_SECRETS = join(ROOT, 'plugins/house/modules/github/files/scan-dist-secrets.mjs');
const CLEANUP_SH = join(ROOT, 'plugins/house/modules/github/files/cleanup-worktree.sh');

const RETRO_URL = pathToFileURL(RETRO).href;
const ASSERT_MAIN_URL = pathToFileURL(ASSERT_MAIN).href;
const DEPLOY_GUARDS_URL = pathToFileURL(DEPLOY_GUARDS).href;

const CLEANUP_DIRS = [];
after(() => {
  for (const d of CLEANUP_DIRS) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function mktemp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  CLEANUP_DIRS.push(d);
  return d;
}

function runNode(code, opts = {}) {
  return spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
}

/** A tiny local repo pushed to a local bare "origin", both under a temp dir. */
function makeRepoWithOrigin(defaultBranch = 'main') {
  const base = mktemp('house-repo-');
  const work = join(base, 'work');
  const origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['init', '-q', work]);
  execFileSync('git', ['-C', work, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', work, 'config', 'user.name', 'House Test']);
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', defaultBranch]);
  writeFileSync(join(work, 'f'), 'x\n');
  execFileSync('git', ['-C', work, 'add', 'f']);
  execFileSync('git', ['-C', work, 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['-C', work, 'remote', 'add', 'origin', origin]);
  execFileSync('git', ['-C', work, 'push', '-q', 'origin', defaultBranch]);
  return { base, work, origin };
}

// ===========================================================================
// engineering/is-main.mjs
// ===========================================================================

test('is-main: isMain is truthy when the caller is the process entry point, including under a spaced path', () => {
  const dir = mktemp('house-is-main-');
  const spaced = join(dir, 'a spaced dir');
  mkdirSync(spaced, { recursive: true });
  copyFileSync(IS_MAIN, join(spaced, 'is-main.mjs'));
  const entry = join(spaced, 'entry.mjs');
  writeFileSync(entry, "import { isMain } from './is-main.mjs';\nconsole.log(isMain(import.meta.url));\n");
  const out = execFileSync('node', [entry], { encoding: 'utf8' }).trim();
  assert.equal(out, 'true', 'a spaced path is the exact failure mode is-main.mjs exists to fix');
});

test('is-main: isMain is falsy when the caller was only imported, not run directly', () => {
  const dir = mktemp('house-is-main-');
  copyFileSync(IS_MAIN, join(dir, 'is-main.mjs'));
  writeFileSync(
    join(dir, 'lib.mjs'),
    "import { isMain } from './is-main.mjs';\nexport const result = isMain(import.meta.url);\n",
  );
  writeFileSync(join(dir, 'entry.mjs'), "import { result } from './lib.mjs';\nconsole.log(result);\n");
  const out = execFileSync('node', [join(dir, 'entry.mjs')], { encoding: 'utf8' }).trim();
  assert.equal(out, 'false');
});

// ===========================================================================
// data-pipelines/retro.mjs
// ===========================================================================

test('retro: evaluateDomain throws (rejects) when an invariant is missing "why"', async () => {
  const { evaluateDomain } = await import(RETRO_URL);
  const domain = {
    domain: 'nowhy',
    title: 'No why',
    invariants: [{ key: 'k', severity: 'hard', title: 'T', remedy: 'fix it', check: async () => [] }],
  };
  await assert.rejects(() => evaluateDomain(domain, {}), /missing "why"/);
});

test('retro: evaluateDomain throws (rejects) when an invariant is missing "remedy"', async () => {
  const { evaluateDomain } = await import(RETRO_URL);
  const domain = {
    domain: 'noremedy',
    title: 'No remedy',
    invariants: [{ key: 'k', severity: 'hard', title: 'T', why: 'because', check: async () => [] }],
  };
  await assert.rejects(() => evaluateDomain(domain, {}), /missing "remedy"/);
});

test('retro: evaluateDomain runs cleanly when why and remedy are both present', async () => {
  const { evaluateDomain } = await import(RETRO_URL);
  const domain = {
    domain: 'ok',
    title: 'OK domain',
    invariants: [{ key: 'k', severity: 'hard', title: 'T', why: 'because', remedy: 'fix it', check: async () => [] }],
    counts: async () => ({ rows: 3 }),
  };
  const state = await evaluateDomain(domain, {});
  assert.equal(state.skipped, null);
  assert.equal(state.invariants.length, 1);
  assert.deepEqual(state.invariants[0].violations, []);
  assert.deepEqual(state.counts, { rows: 3 });
});

test('retro: hard-severity violation exits nonzero via exitCode() (the run() return); soft and clean do not', async () => {
  const { exitCode, hasHardFailure } = await import(RETRO_URL);

  const hardViolated = [{
    domain: 'x', skipped: null,
    invariants: [{ severity: 'hard', violations: [{ key: 'k', detail: 'bad' }] }],
  }];
  assert.equal(hasHardFailure(hardViolated[0]), true);
  assert.equal(exitCode(hardViolated), 1);

  const softViolated = [{
    domain: 'y', skipped: null,
    invariants: [{ severity: 'soft', violations: [{ key: 'k', detail: 'meh' }] }],
  }];
  assert.equal(hasHardFailure(softViolated[0]), false);
  assert.equal(exitCode(softViolated), 0);

  const clean = [{ domain: 'z', skipped: null, invariants: [{ severity: 'hard', violations: [] }] }];
  assert.equal(exitCode(clean), 0);

  // noFail always reports 0, even with a hard violation present.
  assert.equal(exitCode(hardViolated, { noFail: true }), 0);
});

test('retro: diffCounts reports NOT_MEASURED with a null delta for a key measured on only one side (positive control: a fabricated zero would fail this)', async () => {
  const { diffCounts, NOT_MEASURED } = await import(RETRO_URL);

  // Simulates two runs of a domain whose counts() disagree on which keys
  // exist -- e.g. code that used to compute `chunks_embedded` no longer
  // does. 218 real rows still sit in the underlying table; nothing was lost.
  const previous = { chunks_embedded: 218 };
  const current = {}; // this run's counts() doesn't measure that key at all

  const deltas = diffCounts(previous, current);
  const d = deltas.find((x) => x.metric === 'chunks_embedded');
  assert.ok(d, 'expected a delta entry for the one-sided key');
  assert.equal(d.from, 218);
  assert.equal(d.to, NOT_MEASURED);
  assert.equal(d.delta, null);

  // Positive control: the bug this guards against is coercing the missing
  // side to 0, which reads as "218 -> 0" data loss. Assert that did NOT
  // happen.
  assert.notEqual(d.to, 0);
  assert.notEqual(d.delta, -218);

  // A key present and equal on both sides produces no delta entry at all.
  assert.deepEqual(diffCounts({ a: 5 }, { a: 5 }), []);
});

test('retro: jsonFileStore round-trips a snapshot through loadPrevious()/save(), scoped by run_kind', async () => {
  const { jsonFileStore } = await import(RETRO_URL);
  const dir = mktemp('house-retro-store-');
  const store = jsonFileStore(join(dir, 'snapshots.json'));

  const before = await store('demo_retro').loadPrevious();
  assert.equal(before, null);

  await store('demo_retro').save({ rows: 10 });
  const after1 = await store('demo_retro').loadPrevious();
  assert.equal(after1.counts.rows, 10);

  // A different run_kind in the same file is independent.
  const otherDomain = await store('other_retro').loadPrevious();
  assert.equal(otherDomain, null);
});

test('retro: evaluateDomain uses ctx.store when supplied and falls back to the default JSON-file store otherwise', async () => {
  const { evaluateDomain, jsonFileStore } = await import(RETRO_URL);
  const dir = mktemp('house-retro-store-');
  const store = jsonFileStore(join(dir, 'snapshots.json'));
  const domain = {
    domain: 'd', title: 'D',
    invariants: [{ key: 'k', severity: 'soft', title: 'T', why: 'w', remedy: 'r', check: async () => [] }],
    counts: async () => ({ n: 1 }),
  };

  const first = await evaluateDomain(domain, { store });
  assert.equal(first.previous, null);

  await store('d_retro').save(first.counts);
  const second = await evaluateDomain(domain, { store });
  assert.ok(second.previous);
  assert.equal(second.previous.counts.n, 1);
});

// ===========================================================================
// deployment/assert-main-at-origin.mjs + deployment/deploy-guards.mjs
// ===========================================================================

test('assert-main-at-origin: syntax-imports cleanly and exports the documented surface', async () => {
  const mod = await import(ASSERT_MAIN_URL);
  assert.equal(typeof mod.resolveDefaultBranch, 'function');
  assert.equal(typeof mod.requireEscapeHatchReason, 'function');
  assert.equal(typeof mod.assertMainAtOrigin, 'function');
});

test('deploy-guards: syntax-imports cleanly (including its relative import of assert-main-at-origin.mjs)', async () => {
  const mod = await import(DEPLOY_GUARDS_URL);
  assert.equal(typeof mod.assertMainAtOrigin, 'function');
  assert.equal(typeof mod.resolveDefaultBranch, 'function');
  assert.equal(typeof mod.assertCiGreen, 'function');
  assert.equal(typeof mod.assertPrProvenance, 'function');
});

test('deploy-guards: evaluateCiGreen fails CLOSED on zero check runs (pure helper, no gh/git needed)', async () => {
  const { evaluateCiGreen } = await import(DEPLOY_GUARDS_URL);
  const result = evaluateCiGreen([]);
  assert.equal(result.ok, false, 'zero runs must never read as passing');
  assert.equal(result.total, 0);
  assert.deepEqual(result.failing, []);
});

test('deploy-guards: evaluateCiGreen passes only when every run concluded success', async () => {
  const { evaluateCiGreen } = await import(DEPLOY_GUARDS_URL);
  assert.equal(evaluateCiGreen([{ name: 'a', conclusion: 'success' }]).ok, true);
  const mixed = evaluateCiGreen([{ name: 'a', conclusion: 'success' }, { name: 'b', conclusion: 'failure' }]);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.failing.length, 1);
  assert.equal(mixed.failing[0].name, 'b');
});

test('deploy-guards: evaluatePrProvenance requires at least one merged PR', async () => {
  const { evaluatePrProvenance } = await import(DEPLOY_GUARDS_URL);
  assert.equal(evaluatePrProvenance([]).ok, false);
  assert.equal(evaluatePrProvenance([{ number: 1, merged_at: null }]).ok, false);
  const ok = evaluatePrProvenance([{ number: 1, merged_at: null }, { number: 2, merged_at: '2026-01-01T00:00:00Z' }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.mergedPulls, [2]);
});

test('assert-main-at-origin: resolveDefaultBranch prefers house.json defaultBranch over autodetection', () => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({ defaultBranch: 'custom-branch' }));
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); console.log(m.resolveDefaultBranch()); });`,
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'custom-branch');
});

test('assert-main-at-origin: resolveDefaultBranch autodetects the local main/master when house.json and DEPLOY_BRANCH are both absent', () => {
  const { work } = makeRepoWithOrigin('main');
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); console.log(m.resolveDefaultBranch()); });`,
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'main');
});

test('assert-main-at-origin: assertMainAtOrigin passes on the default branch at origin with a clean tree', () => {
  const { work } = makeRepoWithOrigin('main');
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); m.assertMainAtOrigin('t'); console.log('OK'); });`,
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /OK/);
});

test('assert-main-at-origin: assertMainAtOrigin refuses on a feature branch', () => {
  const { work } = makeRepoWithOrigin('main');
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); m.assertMainAtOrigin('t'); });`,
  );
  assert.equal(res.status, 1);
  assert.match(res.stderr, /must run from main at origin\/main/);
});

test('assert-main-at-origin: DEPLOY_FROM=any without DEPLOY_FROM_REASON refuses (reason is required, not just a bare bypass)', () => {
  const { work } = makeRepoWithOrigin('main');
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); m.assertMainAtOrigin('t'); });`,
    { env: { DEPLOY_FROM: 'any' } },
  );
  assert.equal(res.status, 1);
  assert.match(res.stderr, /DEPLOY_FROM_REASON is empty/);
});

test('assert-main-at-origin: DEPLOY_FROM=any with a reason bypasses the check and prints the reason', () => {
  const { work } = makeRepoWithOrigin('main');
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); m.assertMainAtOrigin('t'); console.log('OK'); });`,
    { env: { DEPLOY_FROM: 'any', DEPLOY_FROM_REASON: 'testing the escape hatch' } },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /OK/);
  assert.match(res.stderr, /testing the escape hatch/);
});

// ===========================================================================
// github/scan-dist-secrets.mjs
// ===========================================================================

test('scan-dist-secrets: --self-test passes (planted canary detected, no real secrets involved)', () => {
  const res = spawnSync(process.execPath, [SCAN_SECRETS, '--self-test'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /self-test OK/);
});

test('scan-dist-secrets: catches a planted real-looking token in a fixture dist/ (positive control)', () => {
  const dir = mktemp('house-scan-dist-');
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    join(distDir, 'index.html'),
    '<html>sk-ant-api03-FAKE0000000000000000000000000000000000000000</html>',
  );
  const res = spawnSync(process.execPath, [
    SCAN_SECRETS,
    `--dist-dir=${distDir}`,
    `--vars-file=${join(dir, 'does-not-exist.vars')}`,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /LEAK/);
  assert.match(res.stderr, /sk-ant-/);
});

test('scan-dist-secrets: a clean dist/ passes (negative control)', () => {
  const dir = mktemp('house-scan-dist-');
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<html>hello, nothing secret here</html>');
  const res = spawnSync(process.execPath, [
    SCAN_SECRETS,
    `--dist-dir=${distDir}`,
    `--vars-file=${join(dir, 'does-not-exist.vars')}`,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /clean/);
});

test('scan-dist-secrets: --patterns extends detection with a project-specific marker', () => {
  const dir = mktemp('house-scan-dist-');
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<html>zz_project_specific_marker_value</html>');
  const patternsFile = join(dir, 'patterns.json');
  writeFileSync(patternsFile, JSON.stringify(['zz_project_specific_marker_value']));
  const res = spawnSync(process.execPath, [
    SCAN_SECRETS,
    `--dist-dir=${distDir}`,
    `--vars-file=${join(dir, 'does-not-exist.vars')}`,
    `--patterns=${patternsFile}`,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /LEAK/);
});

// ===========================================================================
// github/cleanup-worktree.sh
// ===========================================================================

test('cleanup-worktree.sh: bash -n syntax check', () => {
  const res = spawnSync('bash', ['-n', CLEANUP_SH], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});

test('cleanup-worktree.sh: shellcheck, if available (informational when not installed)', () => {
  const has = spawnSync('sh', ['-c', 'command -v shellcheck']);
  if (has.status !== 0) {
    console.log('  (shellcheck not installed on this machine, skipping)');
    return;
  }
  const res = spawnSync('shellcheck', [CLEANUP_SH], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test('cleanup-worktree.sh: refuses to operate on the current (main) checkout', () => {
  const { work } = makeRepoWithOrigin('main');
  const res = spawnSync('bash', [CLEANUP_SH, work], { encoding: 'utf8', cwd: work });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /refusing to clean up the main worktree/);
});

test('cleanup-worktree.sh: refuses when the checkout is not on the (configured) default branch', () => {
  const { work } = makeRepoWithOrigin('main');
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const other = mktemp('house-not-a-worktree-');
  const res = spawnSync('bash', [CLEANUP_SH, other], { encoding: 'utf8', cwd: work });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /must run from the main checkout on main/);
});

test('cleanup-worktree.sh: refuses a path that is not a registered worktree of the repo', () => {
  const { work } = makeRepoWithOrigin('main');
  const other = mktemp('house-not-a-worktree-');
  const res = spawnSync('bash', [CLEANUP_SH, other], { encoding: 'utf8', cwd: work });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /is not a registered worktree/);
});

test('cleanup-worktree.sh: honors house.json defaultBranch for the preflight, not a hardcoded "master"', () => {
  const { work } = makeRepoWithOrigin('release');
  writeFileSync(join(work, 'house.json'), JSON.stringify({ defaultBranch: 'release' }));
  execFileSync('git', ['-C', work, 'add', 'house.json']);
  execFileSync('git', ['-C', work, 'commit', '-q', '-m', 'add house.json']);

  const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0;
  if (!hasJq) {
    console.log('  (jq not installed, skipping house.json-driven branch resolution check)');
    return;
  }

  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const other = mktemp('house-not-a-worktree-');
  const res = spawnSync('bash', [CLEANUP_SH, other], { encoding: 'utf8', cwd: work });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /must run from the release checkout on release/);
});
