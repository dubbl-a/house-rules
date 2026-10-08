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
  mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, existsSync,
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

test('deploy-guards: evaluateCiGreen counts neutral as passing, and nothing else beside success', async () => {
  const { evaluateCiGreen } = await import(DEPLOY_GUARDS_URL);
  const neutral = evaluateCiGreen([{ name: 'a', conclusion: 'success' }, { name: 'review', conclusion: 'neutral' }]);
  assert.equal(neutral.ok, true, 'GitHub defines neutral as non-failing');
  assert.equal(neutral.passing, 2);
  const withFailure = evaluateCiGreen([{ name: 'review', conclusion: 'neutral' }, { name: 'b', conclusion: 'failure' }]);
  assert.equal(withFailure.ok, false);
  assert.deepEqual(withFailure.failing.map((f) => f.name), ['b']);
  const skipped = evaluateCiGreen([{ name: 'a', conclusion: 'skipped' }]);
  assert.equal(skipped.ok, false, 'skipped is not a pass');
  const pending = evaluateCiGreen([{ name: 'a', conclusion: 'success' }, { name: 'b', conclusion: null }]);
  assert.equal(pending.ok, false, 'a run still in progress (null conclusion) is not a pass');
  assert.equal(pending.failing[0].conclusion, null);
});

test('deploy-guards: evaluateCiGreen fails stale, action_required, cancelled, and an upper-case NEUTRAL', async () => {
  const { evaluateCiGreen } = await import(DEPLOY_GUARDS_URL);
  for (const conclusion of ['stale', 'action_required', 'cancelled', 'NEUTRAL']) {
    const result = evaluateCiGreen([{ name: 'a', conclusion: 'success' }, { name: 'b', conclusion }]);
    assert.equal(result.ok, false, `${conclusion} is not a pass`);
    assert.deepEqual(result.failing, [{ name: 'b', conclusion }]);
  }
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

test('assert-main-at-origin: the wrong-branch refusal names the npm script, not a scripts/house path (#179)', () => {
  const { work } = makeRepoWithOrigin('main');
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); m.assertMainAtOrigin('deploy'); });`,
  );
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^ +npm run deploy \.\.\.$/m);
  assert.doesNotMatch(res.stderr, /scripts\/house\//);
});

test('assert-main-at-origin: DEPLOY_FROM=any without DEPLOY_FROM_REASON proceeds and prints a plain notice', () => {
  const { work } = makeRepoWithOrigin('main');
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); m.assertMainAtOrigin('t'); console.log('OK'); });`,
    { env: { DEPLOY_FROM: 'any', DEPLOY_FROM_REASON: '' } },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /OK/);
  assert.match(res.stderr, /guard bypassed \(DEPLOY_FROM=any\), no reason given/);
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

/** A fake `gh` on PATH: `answers` maps an api path suffix to a JSON body; any other path exits 1. */
function fakeGhEnv(answers) {
  const dir = mktemp('house-fake-gh-');
  const script = `#!/usr/bin/env node
const answers = ${JSON.stringify(answers)};
const p = process.argv[3];
for (const [suffix, body] of Object.entries(answers)) {
  if (p.endsWith(suffix)) { process.stdout.write(JSON.stringify(body)); process.exit(0); }
}
process.stderr.write('HTTP 403: Upgrade to GitHub Pro');
process.exit(1);
`;
  writeFileSync(join(dir, 'gh'), script, { mode: 0o755 });
  return { PATH: `${dir}:${process.env.PATH}` };
}

function runProvenance(answers) {
  return runNode(
    `import(${JSON.stringify(DEPLOY_GUARDS_URL)}).then((m) => { m.assertPrProvenance('t', { sha: 'abcdef1234567890', branch: 'main', repo: 'o/r' }); console.log('OK'); });`,
    { env: fakeGhEnv(answers) },
  );
}

test('deploy-guards: evaluateBranchProtection counts only a pull-request requirement, and any failure as none', async () => {
  const { evaluateBranchProtection } = await import(DEPLOY_GUARDS_URL);
  const pr = { required_pull_request_reviews: { required_approving_review_count: 1 } };
  assert.deepEqual(evaluateBranchProtection(pr, null), { requiresPr: true, via: 'branch protection' });
  assert.deepEqual(evaluateBranchProtection(null, [{ type: 'pull_request' }]), { requiresPr: true, via: 'ruleset' });
  assert.equal(evaluateBranchProtection({ required_status_checks: {} }, null).requiresPr, false);
  assert.equal(evaluateBranchProtection(null, [{ type: 'deletion' }, { type: 'non_fast_forward' }]).requiresPr, false);
  assert.equal(evaluateBranchProtection(null, null).requiresPr, false);
  assert.equal(evaluateBranchProtection({ message: 'Upgrade to GitHub Pro' }, []).requiresPr, false);
});

test('deploy-guards: assertPrProvenance skips the PR check when branch protection requires a pull request', () => {
  // No /pulls answer: if the guard asked for provenance, the fake gh would fail and the guard would refuse.
  const res = runProvenance({ '/branches/main/protection': { required_pull_request_reviews: {} } });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /PR provenance skipped, main requires a pull request at the remote \(branch protection\)/);
});

test('deploy-guards: assertPrProvenance skips the PR check when a ruleset has a pull_request rule', () => {
  const res = runProvenance({ '/rules/branches/main': [{ type: 'pull_request' }] });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /\(ruleset\)/);
});

test('deploy-guards: assertPrProvenance runs the PR check when protection or rules do not require a pull request', () => {
  const statusOnly = runProvenance({ '/branches/main/protection': { required_status_checks: {} }, '/pulls': [] });
  assert.equal(statusOnly.status, 1);
  assert.match(statusOnly.stderr, /does not belong to a merged pull request/);
  const deletionOnly = runProvenance({ '/rules/branches/main': [{ type: 'deletion' }], '/pulls': [] });
  assert.equal(deletionOnly.status, 1);
  assert.match(deletionOnly.stderr, /does not belong to a merged pull request/);
});

test('deploy-guards: assertPrProvenance still runs the PR check when protection is unavailable', () => {
  const refused = runProvenance({ '/pulls': [] });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /checking PR provenance/);
  assert.match(refused.stderr, /does not belong to a merged pull request/);
  const passed = runProvenance({ '/pulls': [{ number: 7, merged_at: '2026-01-01T00:00:00Z' }] });
  assert.equal(passed.status, 0, passed.stderr);
});

const TIP = 'abcdef1234567890';
const HEAD = '1234567890abcdef';
const mergedPr = { number: 7, merged_at: '2026-01-01T00:00:00Z', merge_commit_sha: TIP, head: { sha: HEAD } };
const okRun = { name: 'ci', conclusion: 'success' };

function runCiGreen(answers) {
  return runNode(
    `import(${JSON.stringify(DEPLOY_GUARDS_URL)}).then((m) => { m.assertCiGreen('t', { sha: ${JSON.stringify(TIP)}, branch: 'main', repo: 'o/r' }); console.log('OK'); });`,
    { env: fakeGhEnv(answers) },
  );
}

function ciAnswers({ tipRuns = [], pulls = [mergedPr], headRuns = [okRun], headTree = 'tree1', tipTree = 'tree1' } = {}) {
  return {
    [`/commits/${TIP}/check-runs`]: { check_runs: tipRuns },
    [`/commits/${TIP}/pulls`]: pulls,
    [`/commits/${HEAD}/check-runs`]: { check_runs: headRuns },
    [`/git/commits/${TIP}`]: { tree: { sha: tipTree } },
    [`/git/commits/${HEAD}`]: { tree: { sha: headTree } },
  };
}

test('deploy-guards: assertCiGreen certifies a zero-run tip by the merged PR head when the trees match', () => {
  const res = runCiGreen(ciAnswers());
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /tip has no check runs; certified by PR #7 head 12345678, same tree/);
});

test('deploy-guards: assertCiGreen refuses a zero-run tip whose tree differs from the PR head, naming both shas', () => {
  const res = runCiGreen(ciAnswers({ headTree: 'tree2' }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /abcdef12/);
  assert.match(res.stderr, /12345678/);
  assert.match(res.stderr, /tree/);
});

test('deploy-guards: assertCiGreen refuses a zero-run tip when the PR head has zero runs or a failure', () => {
  const none = runCiGreen(ciAnswers({ headRuns: [] }));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /zero CI check runs/);
  const failed = runCiGreen(ciAnswers({ headRuns: [okRun, { name: 'test', conclusion: 'failure' }] }));
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /test: failure/);
});

test('deploy-guards: assertCiGreen refuses a zero-run tip with no merged PR whose merge commit is the tip', () => {
  const noPulls = runCiGreen(ciAnswers({ pulls: [] }));
  assert.equal(noPulls.status, 1);
  assert.match(noPulls.stderr, /zero CI check runs/);
  const otherMerge = runCiGreen(ciAnswers({ pulls: [{ ...mergedPr, merge_commit_sha: 'ffffffff' }] }));
  assert.equal(otherMerge.status, 1);
  const unmerged = runCiGreen(ciAnswers({ pulls: [{ ...mergedPr, merged_at: null }] }));
  assert.equal(unmerged.status, 1);
});

test('deploy-guards: assertCiGreen still passes on a green tip without asking for the PR', () => {
  const res = runCiGreen({ [`/commits/${TIP}/check-runs`]: { check_runs: [okRun] } });
  assert.equal(res.status, 0, res.stderr);
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

// #115: the remote delete can be refused by the harness's classifier, and the
// setting that makes the step unnecessary is the owner's. Both are reported in
// words the user can act on; the network calls themselves are not exercised
// here (no gh, no remote), so this pins the text the script prints.
test('cleanup-worktree.sh: reports head-branch deletion off and hands a refused remote delete to the user', () => {
  const src = readFileSync(CLEANUP_SH, 'utf8');
  assert.match(src, /deleteBranchOnMerge/);
  assert.match(src, /automatic head-branch deletion OFF/);
  assert.match(src, /gh repo edit \$REPO --delete-branch-on-merge/);
  assert.match(src, /run this yourself/);
  assert.match(src, /gh api -X DELETE repos\/\$REPO\/git\/refs\/heads\/\$BRANCH"$/m);
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

// resolve_kill_list is defined before the script's teardown body and the
// script returns early when sourced (BASH_SOURCE[0] != $0), so a test can
// source it and call the function directly without triggering the teardown.
function sourceAndResolveKillList(cwd, env, bashBin) {
  // spawnSync resolves the executable itself against `env.PATH` when `env`
  // is overridden, so a test that strips PATH down to a single directory
  // must give the bash binary's absolute path rather than the bare name.
  return spawnSync(bashBin || 'bash', ['-c', `source "${CLEANUP_SH}"; resolve_kill_list`], {
    encoding: 'utf8',
    cwd,
    env: env || process.env,
  });
}

test('cleanup-worktree.sh: resolve_kill_list defaults to node and npm without a worktreeKillProcesses slot', () => {
  const { work } = makeRepoWithOrigin('main');
  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'node\nnpm\n');
});

test('cleanup-worktree.sh: resolve_kill_list honors house.json worktreeKillProcesses slot', () => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: ['deno', 'vite'] } } },
  }));

  const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0;
  if (!hasJq) {
    console.log('  (jq not installed, skipping house.json-driven kill-list resolution check)');
    return;
  }

  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'deno\nvite\n');
});

test('cleanup-worktree.sh: resolve_kill_list falls back to the default without jq on PATH', () => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: ['deno', 'vite'] } } },
  }));

  // A PATH containing only git (via a symlink), so `command -v jq` fails
  // inside the script the same way it would on a machine without jq
  // installed, while `git rev-parse --show-toplevel` still resolves.
  const gitPath = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const binDir = mktemp('house-nobin-');
  execFileSync('ln', ['-s', gitPath, join(binDir, 'git')]);

  const res = sourceAndResolveKillList(work, { ...process.env, PATH: binDir }, '/bin/bash');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'node\nnpm\n');
});

test('cleanup-worktree.sh: resolve_kill_list falls back to the default and warns when the slot is not an array', () => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: { not: 'an array' } } } },
  }));

  const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0;
  if (!hasJq) {
    console.log('  (jq not installed, skipping non-array kill-list resolution check)');
    return;
  }

  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'node\nnpm\n');
  assert.match(res.stderr, /worktreeKillProcesses/);
});

test('cleanup-worktree.sh: resolve_kill_list honors an explicit empty array as "kill nothing"', () => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: [] } } },
  }));

  const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0;
  if (!hasJq) {
    console.log('  (jq not installed, skipping empty-array kill-list resolution check)');
    return;
  }

  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  // Empty output, not the default: an explicit [] is not overridden, and
  // the scan loop's read-loop then has nothing to match, so the kill step
  // is a no-op.
  assert.equal(res.stdout, '');
});

test('cleanup-worktree.sh: resolve_kill_list keeps only the string entries of a mixed-type array', () => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: ['node', 123, 'npm', false] } } },
  }));

  const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0;
  if (!hasJq) {
    console.log('  (jq not installed, skipping mixed-type kill-list resolution check)');
    return;
  }

  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'node\nnpm\n');
});

// ── claude-code/check-deep-research-upstream.mjs ────────────────────────────
// No installed Claude Code binary is required: each test plants a fake binary
// holding a template-literal-escaped copy of a minimal deep-research body.

const DR_CHECK = join(ROOT, 'plugins/house/modules/claude-code/files/check-deep-research-upstream.mjs');

/** A minimal native body carrying every anchor the fork's pins rely on. */
function fakeNativeBody(overrides = {}) {
  const questionLine = overrides.questionLine ?? 'const QUESTION = (typeof args === "string" && args.trim()) || ""';
  const scope = overrides.scope ?? '{ label: "scope", schema: SCOPE_SCHEMA }';
  // The four fan-out constants and the fetch budget's bypass, the anchors the
  // depth-scaled budget replaces. `budget: false` drops them, for the refusal.
  const budgetLines = overrides.budget === false ? [] : [
    'const VOTES_PER_CLAIM = 3',
    'const REFUTATIONS_REQUIRED = 2',
    'const MAX_FETCH = 15',
    'const MAX_VERIFY_CLAIMS = 25',
  ];
  const bypassLines = overrides.budget === false ? [] : [
    '      if (fetchSlots <= 0 && relRank[r.relevance] >= 1) {',
    '        return false',
    '      }',
  ];
  // The native global top-N verify selection the fork replaces with a
  // round-robin across search angles. `selection: false` drops it.
  const selectionLines = overrides.selection === false ? [] : [
    'const rankedClaims = [...allClaims]',
    '  .sort((a, b) => (impRank[a.importance] - impRank[b.importance]) || (qualRank[a.sourceQuality] - qualRank[b.sourceQuality]))',
    '  .slice(0, MAX_VERIFY_CLAIMS)',
  ];
  const lines = [
    '// deep-research: Scope \\u2192 pipeline(Search)',
    ...budgetLines,
    'const URL_HOST_PATTERN = /^[a-z][a-z0-9+.-]*:\\\\/\\\\/(?:www\\\\.)?([^/:?#@\\\\\\\\]+)/i',
    questionLine,
    ...bypassLines,
  ];
  // A prose mention of "model:" living outside any agent() option object
  // (e.g. inside a prompt string), for the negative control on trigger 1.
  if (overrides.prose) lines.push(overrides.prose);
  lines.push(
    // The scope and synthesize prompts end as the native ones do (the body is
    // stored template-escaped, so `\n` is written doubled here). `prompts:
    // false` drops that ending, for the refusal.
    `const scope = await agent("Avoid redundancy.${overrides.prompts === false ? '' : '\\\\n\\\\nStructured output only.'}",`,
    `  ${scope}`,
    ')',
    'agent(SEARCH_PROMPT(angle), {',
    '    label: "search:" + angle.label, phase: "Search", schema: SEARCH_SCHEMA',
    '  })',
    'agent(FETCH_PROMPT(source, a), {',
    '          schema: EXTRACT_SCHEMA,',
    '        })',
    'agent(VERIFY_PROMPT(claim, v), {',
    '          schema: VERDICT_SCHEMA,',
    '        })',
    ...selectionLines,
    `const report = await agent("6. List 2-4 open questions that emerged but weren't answered.${overrides.prompts === false ? '' : '\\\\n\\\\nStructured output only.'}",`,
    '  { label: "synthesize", schema: REPORT_SCHEMA }',
    ')',
    ...(overrides.selection === false || overrides.note === false ? [] : [
      'if (killed.length > 0) return {',
      '    stats: { angles: scope.angles.length, sources: allSources.length, claims: allClaims.length, verified: voted.length, confirmed: 0 },',
      '  }',
      'if (!report) return {',
      '    stats: { angles: scope.angles.length, sources: allSources.length, claims: allClaims.length, verified: voted.length, confirmed: 1 },',
      '  }',
    ]),
    'return {',
    '  question: QUESTION,',
    '  ...report,',
    '    agentCalls: 1 + scope.angles.length,',
    '  },',
    '}',
  );
  return lines.join('\n');
}

function fakeBinary(dir, body) {
  const p = join(dir, '2.1.999');
  writeFileSync(p, Buffer.concat([Buffer.from('\x00junk before `'), Buffer.from(body), Buffer.from('`\x00junk after')]));
  return p;
}

async function unescapedShaOf(body) {
  const mod = await import(pathToFileURL(DR_CHECK).href);
  return mod.sha256(mod.extractNativeBody(Buffer.from(body)));
}

function runDrCheck(args) {
  return spawnSync(process.execPath, [DR_CHECK, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_BINARY: '' } });
}

test('deep-research check: unchanged native body against its own baseline exits 0 (negative control)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.equal(j.version, '2.1.999');
  assert.match(j.verdict, /unchanged/);
});

test('deep-research check: a drifted native body exits 1 and names --rebuild (positive control)', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody());
  const res = runDrCheck([`--binary=${bin}`, '--baseline=0000000000000000000000000000000000000000000000000000000000000000']);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /drifted/);
  assert.match(res.stdout, /--rebuild/);
});

test('deep-research check: native agent() calls carrying a model reach the sunset and exit 2', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody({ scope: '{ label: "scope", schema: SCOPE_SCHEMA, model: "sonnet" }' });
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stdout, /SUNSET/);
  assert.match(res.stdout, /carry a model/);
});

test('deep-research check: native args reading a per-stage model map reach the sunset and exit 2', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody({
    questionLine: 'const QUESTION = (typeof args === "object" && args.question) || ""\nconst modelOverrides = args.models || {}',
  });
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stdout, /model map/);
});

test('deep-research check: object args alone, with no model-map read, does NOT sunset (negative control)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody({ questionLine: 'const QUESTION = (typeof args === "object" && args.question) || ""' });
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.match(j.verdict, /unchanged/);
});

test('deep-research check: a prose "model:" mention in a prompt string does NOT sunset (negative control)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody({ prose: '"Explain the target model: pick the one that fits the audience.",' });
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.match(j.verdict, /unchanged/);
});

test('deep-research check: --rebuild writes a fork with five model pins, a MODELS map, and unescaped regex', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  assert.equal((fork.match(/model: MODELS\./g) || []).length, 5);
  assert.match(fork, /name: 'deep-research-pinned'/);
  assert.match(fork, /ARGS_OBJ\.models/);
  assert.ok(fork.includes(':\\/\\/(?:www\\.)?'), 'template-literal escaping undone');
  assert.ok(!fork.includes('\\\\/'), 'no doubled backslashes remain');
});

test('deep-research check: --rebuild pins an effort on all five agent() calls with an EFFORTS map (issue #230)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  assert.equal((fork.match(/effort: EFFORTS\./g) || []).length, 5);
  assert.match(fork, /synthesize: "high"/);
  assert.match(fork, /ARGS_OBJ\.efforts/);
  assert.match(fork, /log\("Efforts: /);
  assert.match(fork, /efforts: \{scope, search, fetch, verify, synthesize\}/);
});

test('deep-research check: --rebuild forbids tools in the scope and synthesize prompts, once each, before the closing line (issue #230)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  const scopeSentence = 'Do not call any tool (no ToolSearch, WebSearch or WebFetch): write the angles from the question text alone. The Search phase runs every query you return.';
  const synthSentence = 'Work only from the claims above. Do not call any tool (no ToolSearch, WebSearch or WebFetch).';
  assert.equal(fork.split(scopeSentence).length - 1, 1);
  assert.equal(fork.split(synthSentence).length - 1, 1);
  assert.ok(fork.includes(`${scopeSentence}\\n\\nStructured output only.",\n  { label: "scope"`));
  assert.ok(fork.includes(`${synthSentence}\\n\\nStructured output only.",\n  { label: "synthesize"`));
});

test('deep-research check: --rebuild refuses when a prompt anchor no longer matches exactly once (issue #230)', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ prompts: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /anchor not found exactly once: Avoid redundancy/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: --rebuild refuses when a pin anchor no longer matches exactly once', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ scope: '{ label: "scope", schema: SCOPE_SCHEMA, effort: "high" }' }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /SCOPE_SCHEMA/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: --rebuild replaces the fixed fan-out with depth presets and bounds the fetch bypass', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  assert.match(fork, /const DEPTH_PRESETS = \{/);
  assert.match(fork, /const VOTES_PER_CLAIM = BUDGET\.votes/);
  assert.match(fork, /const MAX_VERIFY_CLAIMS = BUDGET\.maxVerifyClaims/);
  assert.ok(!/const VOTES_PER_CLAIM = 3/.test(fork), 'native constant still present');
  assert.ok(!/const MAX_VERIFY_CLAIMS = 25/.test(fork), 'native constant still present');
  assert.match(fork, /fetchSlots <= -BUDGET\.fetchOverflow/);
  assert.ok(!fork.includes('if (fetchSlots <= 0 && relRank[r.relevance] >= 1) {'), 'unbounded bypass still present');
  assert.ok(fork.indexOf('const ARGS_OBJ') < fork.indexOf('const QUESTION ='), 'ARGS_OBJ must be defined before QUESTION reads it');
  assert.equal((fork.match(/const ARGS_OBJ/g) || []).length, 1, 'ARGS_OBJ defined exactly once');
  assert.match(fork, /args\.depth|depth: "light"/);
});

test('deep-research check: --rebuild refuses when the fan-out constants no longer match exactly once', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ budget: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /VOTES_PER_CLAIM/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: the rebuilt budget block resolves depth, overrides, and rejects a bad budget', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  // Run just the budget block the way the workflow runtime would: as a
  // function body with `args` and `log` in scope and a top-level return.
  const start = fork.indexOf('const ARGS_OBJ');
  const end = fork.indexOf('\n', fork.indexOf('log("Depth: '));
  const block = fork.slice(start, end);
  const run = (args) => {
    const logs = [];
    const r = new Function('args', 'log', `${block}\nreturn { DEPTH, BUDGET, VOTES_PER_CLAIM, REFUTATIONS_REQUIRED, MAX_FETCH, MAX_VERIFY_CLAIMS }`)(args, (m) => logs.push(m));
    return { ...r, logs };
  };
  const std = run('a plain question string');
  assert.equal(std.DEPTH, 'standard');
  assert.equal(std.VOTES_PER_CLAIM, 3);
  assert.equal(std.MAX_VERIFY_CLAIMS, 15);
  assert.match(std.logs[0], /^Depth: standard/);
  const light = run({ question: 'q', depth: 'light' });
  assert.equal(light.VOTES_PER_CLAIM, 2);
  assert.equal(light.MAX_FETCH, 8);
  const deep = run({ question: 'q', depth: 'deep' });
  assert.equal(deep.MAX_VERIFY_CLAIMS, 30);
  assert.ok(deep.MAX_VERIFY_CLAIMS * deep.VOTES_PER_CLAIM > std.MAX_VERIFY_CLAIMS * std.VOTES_PER_CLAIM, 'deep verifies more than standard');
  assert.equal(run({ question: 'q', depth: 'bogus' }).DEPTH, 'standard', 'unknown depth falls back to standard');
  assert.equal(run({ question: 'q', depth: 'constructor' }).DEPTH, 'standard', 'prototype key is not a preset');
  const over = run({ question: 'q', depth: 'light', budget: { maxVerifyClaims: 40 } });
  assert.equal(over.MAX_VERIFY_CLAIMS, 40, 'args.budget overrides a preset field');
  assert.equal(over.VOTES_PER_CLAIM, 2, 'unlisted fields keep the preset');
  assert.match(run({ question: 'q', budget: { votes: 1, refutationsRequired: 2 } }).error, /refutationsRequired <= votes/);
  assert.match(run({ question: 'q', budget: { maxFetch: -1 } }).error, /maxFetch/);
  assert.match(run({ question: 'q', budget: { votes: '3' } }).error, /votes/);
});

test('deep-research check: pickRoundRobin takes one claim per angle in turn, each angle in its own order, up to the cap', async () => {
  const { pickRoundRobin } = await import(pathToFileURL(DR_CHECK).href);
  const claims = [
    { id: 'a1', angle: 'A' }, { id: 'a2', angle: 'A' }, { id: 'b1', angle: 'B' },
    { id: 'a3', angle: 'A' }, { id: 'c1', angle: 'C' }, { id: 'a4', angle: 'A' },
    { id: 'c2', angle: 'C' }, { id: 'c3', angle: 'C' },
  ];
  const pick = (cap) => pickRoundRobin(claims, (c) => c.angle, cap).map((c) => c.id);
  assert.deepEqual(pick(5), ['a1', 'b1', 'c1', 'a2', 'c2']);
  assert.deepEqual(pick(100), ['a1', 'b1', 'c1', 'a2', 'c2', 'a3', 'c3', 'a4'], 'no cap: every claim, none twice');
  assert.deepEqual(pick(0), []);
});

test('deep-research check: pickRoundRobin with cap K is a prefix of the selection with a larger cap, so an extended run keeps its verify calls', async () => {
  const { pickRoundRobin } = await import(pathToFileURL(DR_CHECK).href);
  const claims = Array.from({ length: 40 }, (_, i) => ({ id: i, angle: 'abcde'[(i * 7) % 5] + (i % 3 ? '' : 'x') }));
  const full = pickRoundRobin(claims, (c) => c.angle, 40).map((c) => c.id);
  for (let k = 0; k <= 40; k++) {
    for (const n of [1, 5, 15]) {
      const small = pickRoundRobin(claims, (c) => c.angle, k).map((c) => c.id);
      const big = pickRoundRobin(claims, (c) => c.angle, k + n).map((c) => c.id);
      assert.deepEqual(big.slice(0, small.length), small, `cap ${k} is a prefix of cap ${k + n}`);
    }
  }
  assert.equal(new Set(full).size, 40);
});

test('deep-research check: verifyCap lets the preset win for few angles, the per-angle floor win for many, and the ceiling clamp both', async () => {
  const { verifyCap } = await import(pathToFileURL(DR_CHECK).href);
  const standard = { maxVerifyClaims: 15, minPerAngle: 3, maxVerifyCeiling: 25 };
  assert.equal(verifyCap(standard, 2), 15, 'few angles: 3 x 2 = 6 is under the preset 15');
  assert.equal(verifyCap(standard, 6), 18, 'many angles: 3 x 6 = 18 beats the preset');
  assert.equal(verifyCap({ ...standard, minPerAngle: 5 }, 6), 25, 'the ceiling clamps the floor');
  assert.equal(verifyCap({ ...standard, maxVerifyClaims: 40 }, 2), 25, 'the ceiling clamps the preset');
  assert.equal(verifyCap({ ...standard, maxVerifyClaims: 40, maxVerifyCeiling: 40 }, 2), 40, 'a budget override raises the ceiling');
  assert.equal(verifyCap(standard, 0), 15);
});

test('deep-research check: verifyNote names the dropped claims and how to extend the same run', async () => {
  const { verifyNote } = await import(pathToFileURL(DR_CHECK).href);
  const note = verifyNote({ verified: 25, total: 77, angles: 5, votes: 3, deepCeiling: 40 });
  assert.match(note, /^Verified 25 of 77 claims \(5 angles\)\./);
  assert.match(note, /resumeFromRunId set to this run's id/);
  assert.match(note, /the same args as this call/);
  assert.match(note, /every budget field it passed/);
  assert.match(note, /budget\.maxVerifyClaims: 40\b/);
  assert.ok(!/maxVerifyCeiling/.test(note), 'an explicit maxVerifyClaims is enough on its own');
  assert.match(note, /about 46 more agents/, '(40 - 25) x 3 votes + 1 synthesis');
  assert.match(verifyNote({ verified: 40, total: 77, angles: 5, votes: 3, deepCeiling: 40 }), /maxVerifyClaims: 77\b.*about 112 more agents/, 'past the deep ceiling, offer every claim');
  assert.match(verifyNote({ verified: 25, total: 30, angles: 5, votes: 2, deepCeiling: 40 }), /maxVerifyClaims: 30\b.*about 11 more agents/, 'never more than the claims found');
  assert.equal(verifyNote({ verified: 30, total: 30, angles: 5, votes: 3, deepCeiling: 40 }), '', 'nothing dropped, no note');
});

test('deep-research check: the rebuilt depth presets carry the per-angle floor and ceiling, and the estimate uses the ceiling', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  const start = fork.indexOf('const ARGS_OBJ');
  const block = fork.slice(start, fork.indexOf('\n', fork.indexOf('log("Depth: ')));
  const run = (args) => {
    const logs = [];
    const r = new Function('args', 'log', `${block}\nreturn { BUDGET }`)(args, (m) => logs.push(m));
    return { ...r, logs };
  };
  const expect = { light: [2, 12], standard: [3, 25], deep: [4, 40] };
  for (const [depth, [floor, ceiling]] of Object.entries(expect)) {
    const r = run({ question: 'q', depth });
    assert.equal(r.BUDGET.minPerAngle, floor, depth);
    assert.equal(r.BUDGET.maxVerifyCeiling, ceiling, depth);
    assert.match(r.logs[0], new RegExp(`ceiling ${ceiling}\\b`), depth);
  }
  // standard: 7 + (15 + 5) fetched + 25 x 3 votes = 102 at the ceiling.
  assert.match(run('q').logs[0], /at most ~102 agents/);
  assert.equal(run({ question: 'q', budget: { maxVerifyCeiling: 50 } }).BUDGET.maxVerifyCeiling, 50);
  // An explicit maxVerifyClaims above the preset ceiling is honored, not clamped.
  assert.equal(run({ question: 'q', budget: { maxVerifyClaims: 40 } }).BUDGET.maxVerifyCeiling, 40);
  assert.equal(run({ question: 'q', budget: { maxVerifyClaims: 10 } }).BUDGET.maxVerifyCeiling, 25, 'a lower request leaves the ceiling');
  assert.equal(run({ question: 'q', depth: 'deep' }).BUDGET.maxVerifyCeiling, 40, 'no request, no change');
  assert.match(run({ question: 'q', budget: { minPerAngle: -1 } }).error, /minPerAngle/);
  assert.match(fork, /verifyNote: VERIFY_NOTE/);
  assert.equal((fork.match(/VERIFY_NOTE \? \{ verifyNote: VERIFY_NOTE \}/g) || []).length, 3, 'every result after verify carries the note');
});

test('deep-research check: --rebuild selects verify claims round-robin across angles, not the global top-N', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  assert.ok(!fork.includes('.slice(0, MAX_VERIFY_CLAIMS)'), 'global top-N slice still present');
  assert.match(fork, /function pickRoundRobin\(/);
  // Run the rebuilt selection block on synthetic sources: angle A holds
  // every central claim, so a global top-N would give it all three slots.
  const start = fork.indexOf('function pickRoundRobin(');
  const end = fork.indexOf('\n', fork.indexOf('log(VERIFY_NOTE)'));
  const block = fork.slice(start, end);
  const allSources = [
    { angle: 'A', claims: [{ id: 'a1', importance: 'central', sourceQuality: 'primary' }, { id: 'a2', importance: 'central', sourceQuality: 'primary' }] },
    { angle: 'A', claims: [{ id: 'a3', importance: 'central', sourceQuality: 'secondary' }] },
    { angle: 'B', claims: [{ id: 'b1', importance: 'tangential', sourceQuality: 'blog' }, { id: 'b2', importance: 'supporting', sourceQuality: 'blog' }] },
    { angle: 'C', claims: [{ id: 'c1', importance: 'supporting', sourceQuality: 'forum' }] },
  ];
  const select = (budget) => {
    const logs = [];
    const r = new Function('allSources', 'BUDGET', 'MAX_VERIFY_CLAIMS', 'VOTES_PER_CLAIM', 'DEPTH_PRESETS', 'log', `
      const allClaims = allSources.flatMap(s => s.claims)
      const impRank = { central: 0, supporting: 1, tangential: 2 }
      const qualRank = { primary: 0, secondary: 1, blog: 2, forum: 3, unreliable: 4 }
      ${block}
      return { rankedClaims, VERIFY_NOTE }`)(allSources, budget, budget.maxVerifyClaims, 3, { deep: { maxVerifyCeiling: 40 } }, (m) => logs.push(m));
    return { ids: r.rankedClaims.map((c) => c.id), note: r.VERIFY_NOTE, logs };
  };
  // minPerAngle 1 x 3 angles is below maxVerifyClaims 4, so the cap is 4.
  const four = select({ maxVerifyClaims: 4, minPerAngle: 1, maxVerifyCeiling: 10 });
  assert.deepEqual(four.ids, ['a1', 'b2', 'c1', 'a2']);
  assert.match(four.note, /^Verified 4 of 6 claims \(3 angles\)\./);
  assert.ok(four.logs.includes(four.note), 'the dropped-claims note is logged');
  // minPerAngle 2 x 3 angles lifts the cap to 6: every claim, no note.
  const all = select({ maxVerifyClaims: 4, minPerAngle: 2, maxVerifyCeiling: 10 });
  assert.equal(all.ids.length, 6);
  assert.equal(all.note, '');
});

test('deep-research check: --rebuild refuses when the verify selection no longer matches exactly once', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ selection: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /rankedClaims/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: --rebuild refuses when the result anchors for the verify note no longer match', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ note: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /stats: \{ angles/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: the fork and the --install message say to copy the fork into the scratchpad first', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'fork.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--install=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /scratchpad/);
  const whenToUse = readFileSync(out, 'utf8').match(/whenToUse: '([^']*)'/)[1];
  assert.match(whenToUse, /scratchpad/);
  assert.ok(!/Run by scriptPath\./.test(whenToUse), 'whenToUse still says to run the stable path directly');
});

test('deep-research check: a binary without the bundled script exits 1, not 0', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, '// nothing here');
  const res = runDrCheck([`--binary=${bin}`]);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /not found in binary/);
});

test('deep-research check: running from a directory whose path contains a space does not crash (ENOENT regression)', async () => {
  const dir = mktemp('house dr with space-');
  assert.match(dir, / /, 'fixture sanity: the temp dir must actually contain a space');
  const copy = join(dir, 'check-deep-research-upstream.mjs');
  copyFileSync(DR_CHECK, copy);
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const res = spawnSync(process.execPath, [copy, `--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_BINARY: '' },
  });
  assert.ok(!/ENOENT/.test(res.stderr), `unexpected ENOENT crash:\n${res.stderr}`);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.match(j.verdict, /unchanged/);
});

test('deep-research check: --binary pointing at a missing path exits 3 and names the path, never silently falling back', () => {
  const missing = '/definitely/not/a/real/deep-research-fixture-path';
  const res = runDrCheck([`--binary=${missing}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /invalid --binary/);
  assert.ok(res.stdout.includes(missing), res.stdout);
});

test('deep-research check: --binary pointing at a directory exits 3 and names the path', () => {
  const dir = mktemp('house-dr-dir-');
  const res = runDrCheck([`--binary=${dir}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.ok(res.stdout.includes(dir), res.stdout);
});

test('deep-research check: --rebuild refuses to overwrite an existing file without --force', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'existing-fork.js');
  writeFileSync(out, 'PRIOR CONTENT');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /--force/);
  assert.equal(readFileSync(out, 'utf8'), 'PRIOR CONTENT', 'existing file must be left untouched');
});

test('deep-research check: --rebuild overwrites an existing file when --force is passed', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'existing-fork.js');
  writeFileSync(out, 'PRIOR CONTENT');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`, '--force']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  assert.notEqual(fork, 'PRIOR CONTENT');
  assert.match(fork, /name: 'deep-research-pinned'/);
});

test('deep-research check: --rebuild creates missing parent directories', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'nested', 'deeper', 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.ok(existsSync(out), 'rebuild must create the missing parent directory');
});

function runDrCheckHome(args, home) {
  return spawnSync(process.execPath, [DR_CHECK, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_BINARY: '', HOME: home, USERPROFILE: home } });
}

test('deep-research check: --install writes the fork to ~/.claude/workflows/deep-research-tiered.js', async () => {
  const dir = mktemp('house-dr-');
  const home = mktemp('house-dr-home-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const res = runDrCheckHome([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--install'], home);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const target = join(home, '.claude', 'workflows', 'deep-research-tiered.js');
  assert.match(readFileSync(target, 'utf8'), /name: 'deep-research-pinned'/);
});

test('deep-research check: --install=<path> writes to the given path', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'a', 'b', 'fork.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--install=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(readFileSync(out, 'utf8'), /name: 'deep-research-pinned'/);
});

test('deep-research check: --install overwrites an existing file without --force', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'fork.js');
  writeFileSync(out, 'PRIOR CONTENT');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--install=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(readFileSync(out, 'utf8'), /name: 'deep-research-pinned'/);
});

test('deep-research check: --install together with --rebuild exits 3 and writes nothing', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const a = join(dir, 'a.js');
  const b = join(dir, 'b.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--install=${a}`, `--rebuild=${b}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.ok(!existsSync(a) && !existsSync(b), 'neither file may be written');
});

test('deep-research check: an empty --install= or --rebuild= path exits 3 instead of silently skipping the write', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const sha = await unescapedShaOf(body);
  for (const flag of ['--install=', '--rebuild=']) {
    const res = runDrCheck([`--binary=${bin}`, `--baseline=${sha}`, flag]);
    assert.equal(res.status, 3, `${flag}: ${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /need a path/);
  }
});

test('deep-research check: --install on a drifted body installs, then exits 1 naming the installed path', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody());
  const out = join(dir, 'fork.js');
  const res = runDrCheck([`--binary=${bin}`, '--baseline=0000000000000000000000000000000000000000000000000000000000000000', `--install=${out}`]);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.ok(existsSync(out));
  assert.ok(res.stdout.includes(out), res.stdout);
});

test('deep-research check: --install does not install on SUNSET (exit 2)', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ scope: '{ label: "scope", schema: SCOPE_SCHEMA, model: "opus" }' }));
  const out = join(dir, 'fork.js');
  const res = runDrCheck([`--binary=${bin}`, `--install=${out}`]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.ok(!existsSync(out), 'a sunset must not install the fork');
});
