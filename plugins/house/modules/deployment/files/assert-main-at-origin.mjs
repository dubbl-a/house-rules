/**
 * scripts/house/assert-main-at-origin.mjs
 *
 * Pre-flight check for scripts that push effects to a live system (a deploy,
 * an email send, a DB write). Aborts loudly if the current checkout isn't on
 * the repo's default branch at origin/<branch>, with a clean tree. Catches
 * the "stale checkout left on a feature branch" failure mode — running a
 * live-effect script from the wrong state ships stale or unintended content.
 *
 * Which branch is "the" branch is resolved in this order:
 *   1. house.json's `defaultBranch` at the repo root, if present.
 *   2. the `DEPLOY_BRANCH` environment variable.
 *   3. autodetection: origin/HEAD's target if the local clone recorded one,
 *      else whichever of `main`/`master` exists locally (preferring `main`,
 *      the modern `git init` default), else `main`.
 *
 * Usage:
 *   import { assertMainAtOrigin } from './assert-main-at-origin.mjs';
 *   assertMainAtOrigin('deploy', { allowUntracked: true });
 *
 * Skip (rare; only when you know the state is right — requires a reason,
 * printed so the bypass is auditable after the fact):
 *   DEPLOY_FROM=any DEPLOY_FROM_REASON="<why>" npm run deploy
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const ALWAYS_ALLOWED_DIRTY = [];

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

function repoRoot() {
  try {
    return git('rev-parse --show-toplevel');
  } catch {
    return process.cwd();
  }
}

function readHouseJsonDefaultBranch() {
  try {
    const p = join(repoRoot(), 'house.json');
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return typeof parsed.defaultBranch === 'string' && parsed.defaultBranch.trim()
      ? parsed.defaultBranch.trim()
      : null;
  } catch {
    // Missing, unreadable, or malformed house.json: fall through to the
    // next resolution step rather than fail a branch-name lookup.
    return null;
  }
}

function detectMainOrMaster() {
  try {
    const ref = git('symbolic-ref refs/remotes/origin/HEAD'); // e.g. refs/remotes/origin/main
    const branch = ref.split('/').pop();
    if (branch) return branch;
  } catch {
    // origin/HEAD isn't recorded locally (common unless something ran
    // `git remote set-head origin --auto`) — fall through to a local guess.
  }
  for (const candidate of ['main', 'master']) {
    try {
      git(`show-ref --verify --quiet refs/heads/${candidate}`);
      return candidate;
    } catch {
      // that candidate doesn't exist locally; try the next
    }
  }
  return 'main';
}

/** Resolve the repo's default/deploy branch name. See module header for order. */
export function resolveDefaultBranch() {
  return readHouseJsonDefaultBranch() ?? process.env.DEPLOY_BRANCH ?? detectMainOrMaster();
}

function escapeHatchLines(scriptName) {
  return [
    ``,
    `Override (rare; only when you know the state is right):`,
    `  DEPLOY_FROM=any DEPLOY_FROM_REASON="<why>" npm run ${scriptName}`,
  ];
}

/**
 * requireEscapeHatchReason(scriptName) — the single DEPLOY_FROM=any escape
 * hatch shared by every guard in this file and in deploy-guards.mjs. Returns
 * true (and prints the bypass + its reason to stderr, so it's auditable
 * after the fact) when the caller should skip its check entirely; returns
 * false when DEPLOY_FROM isn't 'any' and the caller should run its check
 * normally. Refuses — same as any other guard failure — when DEPLOY_FROM=any
 * is set but no reason was given: an unexplained bypass defeats the point of
 * the guard existing (same pattern as this project family's
 * EQUAL_TREATMENT_WAIVER="<reason>").
 */
export function requireEscapeHatchReason(scriptName) {
  if (process.env.DEPLOY_FROM !== 'any') return false;
  const reason = (process.env.DEPLOY_FROM_REASON || '').trim();
  if (!reason) {
    fail(scriptName, [
      `DEPLOY_FROM=any is set but DEPLOY_FROM_REASON is empty.`,
      ``,
      `The escape hatch requires a reason so a bypass is auditable after`,
      `the fact, not just silent:`,
      `  DEPLOY_FROM=any DEPLOY_FROM_REASON="<why>" npm run ${scriptName}`,
    ]);
  }
  process.stderr.write(`\n⚠ ${scriptName}: guard bypassed (DEPLOY_FROM=any) — ${reason}\n\n`);
  return true;
}

/**
 * @param {string} scriptName  — used in error output, e.g. 'deploy'
 * @param {{ branch?: string, allowedDirty?: string[], allowUntracked?: boolean }} [opts]
 *   branch — override the resolved default branch (mostly for tests).
 *   allowUntracked — ignore untracked files while still rejecting
 *     wrong-branch, behind-origin, and tracked/staged modifications. A
 *     deploy that builds from committed source is unaffected by transient
 *     untracked artifacts.
 */
export function assertMainAtOrigin(scriptName, opts = {}) {
  if (requireEscapeHatchReason(scriptName)) return;

  const branch = opts.branch ?? resolveDefaultBranch();
  const headRef = git('rev-parse --abbrev-ref HEAD');
  const headSha = git('rev-parse HEAD');

  let originSha;
  try {
    originSha = git(`rev-parse origin/${branch}`);
  } catch {
    fail(scriptName, [
      `no local ref for origin/${branch}.`,
      ``,
      `Run \`git fetch origin ${branch}\` first, then retry.`,
    ]);
  }

  if (headRef !== branch) {
    const repoName = basename(repoRoot());
    fail(scriptName, [
      `must run from ${branch} at origin/${branch}.`,
      ``,
      `  cwd:    ${process.cwd()}`,
      `  HEAD:   ${headSha.slice(0, 8)} (${headRef})`,
      `  origin: ${originSha.slice(0, 8)} (origin/${branch})`,
      ``,
      `Fix one of:`,
      `  (a) cd to your ${branch} checkout, then`,
      `      git checkout ${branch} && git pull --ff-only`,
      `  (b) Spin up a transient ${branch} worktree:`,
      `      git worktree add ../${repoName}-deploy ${branch}`,
      `      cd ../${repoName}-deploy`,
      `      ln -s ../${repoName}/node_modules node_modules`,
      `      node scripts/house/${scriptName} ...`,
      `      cd .. && git -C ${repoName} worktree remove ${repoName}-deploy`,
      ...escapeHatchLines(scriptName),
    ]);
  }

  if (headSha !== originSha) {
    fail(scriptName, [
      `${branch} HEAD does not match origin/${branch}.`,
      ``,
      `  HEAD:   ${headSha.slice(0, 8)}`,
      `  origin: ${originSha.slice(0, 8)}`,
      ``,
      `If you haven't pulled lately:  git pull --ff-only`,
      `If your fetch is stale:        git fetch origin ${branch} && git pull --ff-only`,
    ]);
  }

  const allowed = new Set([...ALWAYS_ALLOWED_DIRTY, ...(opts.allowedDirty ?? [])]);
  const status = git('status --porcelain');
  const dirty = status
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !(opts.allowUntracked && l.startsWith('??')))
    .filter((l) => !allowed.has(l.slice(3)));

  if (dirty.length > 0) {
    fail(scriptName, [
      `working tree has uncommitted changes:`,
      ``,
      ...dirty.map((l) => `  ${l}`),
      ``,
      `Stash or commit before running:`,
      `  git stash push -u -m "pre-deploy stash"`,
    ]);
  }
}

function fail(scriptName, lines) {
  process.stderr.write(`\nERROR: ${scriptName} ${lines[0]}\n`);
  for (const line of lines.slice(1)) process.stderr.write(`${line}\n`);
  process.stderr.write('\n');
  process.exit(1);
}
