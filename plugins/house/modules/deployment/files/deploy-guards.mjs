/**
 * scripts/house/deploy-guards.mjs
 *
 * Shared pre-flight guards for any script that pushes effects to a live
 * system (a site deploy, a console/admin deploy, a broadcast send). Re-
 * exports assertMainAtOrigin (assert-main-at-origin.mjs) so callers have one
 * import, and adds two checks. Every one honors the shared DEPLOY_FROM=any
 * escape hatch (see assert-main-at-origin.mjs) — a bypass requires and
 * prints a reason, so it's auditable after the fact instead of silent:
 *
 *   assertCiGreen — origin/<branch>'s tip commit must have at least one CI
 *     check run and every one must have concluded 'success'. Fails CLOSED on
 *     zero runs — a commit nothing has checked yet is not "passing".
 *   assertPrProvenance — origin/<branch>'s tip commit must belong to a
 *     merged pull request.
 *
 * assertPrProvenance exists as application code, not server-side branch
 * protection, because a private repo on a free GitHub plan cannot enforce
 * "this branch only moves via a merged PR" server-side (classic branch
 * protection and the newer rulesets API both refuse with a 403 upgrade
 * message on that tier). Where the target repo DOES have branch protection
 * or rulesets available, prefer configuring it there — this guard is the
 * fallback for when that isn't an option.
 *
 * The repo slug used for the GitHub API calls is resolved automatically
 * (`gh repo view`, falling back to parsing `git remote get-url origin`) — it
 * is never hardcoded, so this file is safe to vendor into any repo as-is.
 */

import { execFileSync } from 'node:child_process';
import {
  assertMainAtOrigin,
  resolveDefaultBranch,
  requireEscapeHatchReason,
} from './assert-main-at-origin.mjs';

export { assertMainAtOrigin, resolveDefaultBranch };

function fail(scriptName, lines) {
  process.stderr.write(`\nERROR: ${scriptName} ${lines[0]}\n`);
  for (const line of lines.slice(1)) process.stderr.write(`${line}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

function escapeHatchLines(scriptName) {
  return [``, `Override (rare; only when you know the state is right):`, `  DEPLOY_FROM=any DEPLOY_FROM_REASON="<why>" npm run ${scriptName}`];
}

function git(cmd) {
  return execFileSync('git', cmd.split(' '), { encoding: 'utf8' }).trim();
}

function originRefSha(branch) {
  return execFileSync('git', ['rev-parse', `origin/${branch}`], { encoding: 'utf8' }).trim();
}

/** Resolve `owner/repo` for the GitHub API calls below. No hardcoded slug. */
function resolveRepoSlug(scriptName) {
  try {
    return execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    // gh not installed/authenticated, or not a GitHub remote — fall back to
    // parsing `origin`'s URL (handles both git@github.com:owner/repo.git and
    // https://github.com/owner/repo.git).
  }
  try {
    const url = git('remote get-url origin');
    const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/);
    if (m) return m[1];
  } catch {
    // no origin remote at all
  }
  fail(scriptName, [
    `could not resolve a GitHub owner/repo slug (origin isn't a GitHub remote, or \`gh\` isn't available).`,
    ``,
    `Pass one explicitly via opts.repo, or fix \`gh repo view\` / \`git remote -v\`.`,
  ]);
  return undefined; // unreachable (fail() exits), keeps control-flow analysis honest
}

/** Run `gh api <path>`, JSON-parsed. On any failure (missing gh, not authenticated, API error), fail closed. */
function ghApiJson(scriptName, apiPath, purpose) {
  try {
    return JSON.parse(execFileSync('gh', ['api', apiPath], { encoding: 'utf8' }));
  } catch (err) {
    const notInstalled = err.code === 'ENOENT';
    const detail = String(err.stderr || err.message || err)
      .trim()
      .split('\n')
      .slice(0, 3);
    fail(scriptName, [
      notInstalled
        ? `refuses: the GitHub CLI (gh) is not installed — can't check ${purpose}.`
        : `refuses: \`gh api\` failed while checking ${purpose} — is gh authenticated?`,
      ``,
      notInstalled ? `Install it:  brew install gh && gh auth login` : `Authenticate:  gh auth login`,
      ...detail,
      ...escapeHatchLines(scriptName),
    ]);
    throw err; // unreachable (fail() exits), keeps control-flow analysis honest
  }
}

/**
 * evaluateCiGreen — given the check-runs GitHub reports for one commit,
 * decide whether CI is green. Fails CLOSED on zero runs: a commit nothing
 * has checked yet must never read as passing, so `ok` is false whenever
 * `total` is 0, not vacuously true. Pure (no network, no process exit) so
 * it's directly testable with plain fixtures.
 *
 * @param {Array<{name?: string|null, conclusion?: string|null}>} checkRuns
 * @returns {{ ok: boolean, total: number, passing: number, failing: Array<{name: string, conclusion: string|null}> }}
 */
export function evaluateCiGreen(checkRuns = []) {
  const runs = checkRuns ?? [];
  if (runs.length === 0) {
    return { ok: false, total: 0, passing: 0, failing: [] };
  }
  const failing = runs
    .filter((r) => r.conclusion !== 'success')
    .map((r) => ({ name: r.name ?? '(unnamed check)', conclusion: r.conclusion ?? null }));
  return { ok: failing.length === 0, total: runs.length, passing: runs.length - failing.length, failing };
}

/**
 * evaluatePrProvenance — given the pull requests GitHub associates with one
 * commit, decide whether that commit belongs to a merged PR. A commit can be
 * associated with multiple PRs (rebases, cherry-picks); any one merged entry
 * is enough. Pure, same testing rationale as evaluateCiGreen.
 *
 * @param {Array<{number?: number|null, merged_at?: string|null}>} pulls
 * @returns {{ ok: boolean, mergedPulls: number[] }}
 */
export function evaluatePrProvenance(pulls = []) {
  const merged = (pulls ?? []).filter((p) => p.merged_at != null);
  return { ok: merged.length > 0, mergedPulls: merged.map((p) => p.number).filter((n) => n != null) };
}

/**
 * assertCiGreen — require every CI check run on a commit (origin/<branch>'s
 * tip by default) to have concluded 'success'. Fails closed on zero runs.
 *
 * @param {string} scriptName
 * @param {{ sha?: string, branch?: string, repo?: string }} [opts] — sha
 *   defaults to origin/<branch>'s tip; branch defaults to resolveDefaultBranch();
 *   repo defaults to the auto-resolved GitHub slug. All overridable so
 *   callers (and tests) can point this at any commit/branch/repo.
 */
export function assertCiGreen(scriptName, opts = {}) {
  if (requireEscapeHatchReason(scriptName)) return;

  const branch = opts.branch ?? resolveDefaultBranch();
  const sha = opts.sha ?? originRefSha(branch);
  const repo = opts.repo ?? resolveRepoSlug(scriptName);
  const body = ghApiJson(scriptName, `repos/${repo}/commits/${sha}/check-runs`, 'CI status');
  const result = evaluateCiGreen(body.check_runs ?? []);

  if (!result.ok && result.total === 0) {
    fail(scriptName, [
      `refuses: ${sha.slice(0, 8)} has zero CI check runs.`,
      ``,
      `Zero runs is not success. Wait for the push run to finish:`,
      `  gh run watch`,
      ...escapeHatchLines(scriptName),
    ]);
  } else if (!result.ok) {
    fail(scriptName, [
      `refuses: ${sha.slice(0, 8)} is not CI-green.`,
      ``,
      ...result.failing.map((r) => `  ${r.name}: ${r.conclusion ?? '(pending)'}`),
      ``,
      `Wait for it to finish, or fix it:`,
      `  gh run watch`,
      ...escapeHatchLines(scriptName),
    ]);
  }
}

/**
 * assertPrProvenance — require a commit (origin/<branch>'s tip by default) to
 * belong to a merged pull request. See this module's header for when this
 * substitutes for server-side branch protection vs. duplicates it.
 *
 * @param {string} scriptName
 * @param {{ sha?: string, branch?: string, repo?: string }} [opts]
 */
export function assertPrProvenance(scriptName, opts = {}) {
  if (requireEscapeHatchReason(scriptName)) return;

  const branch = opts.branch ?? resolveDefaultBranch();
  const sha = opts.sha ?? originRefSha(branch);
  const repo = opts.repo ?? resolveRepoSlug(scriptName);
  const pulls = ghApiJson(scriptName, `repos/${repo}/commits/${sha}/pulls`, 'PR provenance');
  const result = evaluatePrProvenance(pulls);

  if (!result.ok) {
    fail(scriptName, [
      `refuses: ${sha.slice(0, 8)} does not belong to a merged pull request.`,
      ``,
      `Merge via a PR, or use the escape hatch below only when you know`,
      `the state is right.`,
      ...escapeHatchLines(scriptName),
    ]);
  }
}
