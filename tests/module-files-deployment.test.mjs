// Tests for the vendored deployment module files under plugins/house/modules/
// (deployment/{deploy-guards,assert-main-at-origin}.mjs).
//
// These are the literal files a consuming repo gets copied into
// scripts/house/** by `house render` (module.json's files[] entries) — they
// are tested here directly at their files/ source path, not through the
// render pipeline (that's tests/cli-house.test.mjs's job). One file per
// module; the helpers they share are in module-files-helpers.mjs.
//
// Every sandbox is a throwaway dir under the OS tmpdir. No network calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, mktemp, runNode, makeRepoWithOrigin } from './module-files-helpers.mjs';

const ASSERT_MAIN = join(ROOT, 'plugins/house/modules/deployment/files/assert-main-at-origin.mjs');
const DEPLOY_GUARDS = join(ROOT, 'plugins/house/modules/deployment/files/deploy-guards.mjs');

const ASSERT_MAIN_URL = pathToFileURL(ASSERT_MAIN).href;
const DEPLOY_GUARDS_URL = pathToFileURL(DEPLOY_GUARDS).href;

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

test('assert-main-at-origin: the wrong-branch refusal names the npm script, not a scripts/house path (#179)', () => {
  const { work } = makeRepoWithOrigin('main');
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const res = runNode(
    `import(${JSON.stringify(ASSERT_MAIN_URL)}).then((m) => { process.chdir(${JSON.stringify(work)}); m.assertMainAtOrigin('deploy'); });`,
  );
  assert.equal(res.status, 1);
  assert.match(res.stderr, /must run from main at origin\/main/);
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
