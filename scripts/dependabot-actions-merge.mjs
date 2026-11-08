#!/usr/bin/env node
// dependabot-actions-merge.mjs: decide whether one Dependabot pull request
// that bumps GitHub Actions may merge on its own. Used by the
// dependabot-actions-merge workflow, which merges only on a `merge` answer.
//
//   node scripts/dependabot-actions-merge.mjs <pr.json> <runs.json>
//
//   pr.json    gh pr view <n> --json author,files,commits,title,body,
//              mergeStateStatus,mergeable,headRefOid
//   runs.json  GET /repos/{owner}/{repo}/actions/runs?head_sha=<headRefOid>
//
// Prints one line: `merge <headRefOid>` or `skip: <reason>`. Every rule below
// must hold, and any failed rule or unreadable field is a skip (fail closed).
// The line never echoes pull request text, so it is safe to log. Exit 0 for
// either answer; exit 1, printing `skip: unreadable input` and the cause on
// stderr, when an input file cannot be read at all.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyRuns } from './release-run-state.mjs';

// gh prints the bot as app/dependabot with is_bot true; the commit author is
// the dependabot[bot] account. A human account named dependabot is not a bot.
const BOT_PR_LOGINS = new Set(['app/dependabot', 'dependabot[bot]']);
const BOT_COMMIT_LOGINS = new Set(['dependabot[bot]']);
const WORKFLOWS_DIR = '.github/workflows/';
// gh pr view lists at most 100 files and 100 commits; a full page may be cut.
const GH_PAGE = 100;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkAuthor(pr) {
  const a = pr.author;
  if (!isObj(a) || a.is_bot !== true || !BOT_PR_LOGINS.has(a.login)) return 'author is not the Dependabot bot';
  return null;
}

// Dependabot's github-actions ecosystem with directory / reads
// .github/workflows; this checker does not allow .github/actions, because the
// adopters' dependabot.yml files do not list it.
function checkFiles(pr) {
  const files = pr.files;
  if (!Array.isArray(files) || files.length === 0) return 'changed files unreadable or empty';
  if (files.length >= GH_PAGE) return 'changed file list may be cut short';
  for (const f of files) {
    const p = isObj(f) ? f.path : undefined;
    if (typeof p !== 'string' || !p.startsWith(WORKFLOWS_DIR) || p.split('/').includes('..')) {
      return 'a changed file is outside .github/workflows/';
    }
  }
  return null;
}

function checkCommits(pr) {
  const commits = pr.commits;
  if (!Array.isArray(commits) || commits.length === 0) return 'commits unreadable or empty';
  if (commits.length >= GH_PAGE) return 'commit list may be cut short';
  for (const c of commits) {
    const authors = isObj(c) ? c.authors : undefined;
    if (!Array.isArray(authors) || authors.length === 0) return 'a commit has no readable author';
    if (!authors.every((a) => isObj(a) && BOT_COMMIT_LOGINS.has(a.login))) return 'a commit is not authored by Dependabot';
  }
  if (commits[commits.length - 1].oid !== pr.headRefOid) return 'commit list does not end at the head commit';
  return null;
}

// "7.0.0" -> [7,0,0]; "v4" -> [4]; anything else (a SHA, a pre-release) -> null.
function parseVersion(s) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  return m.slice(1).filter((x) => x !== undefined).map(Number);
}

// Every "from A to B" statement Dependabot writes: the title of a single bump,
// the first body line of a single bump, and the table row and "Updates" line
// per package of a grouped one. Release notes sit in HTML lines and never
// start these ways.
function bumpStatements(pr) {
  const out = [];
  const t = / from (\S+) to (\S+)/.exec(pr.title);
  if (t) out.push([t[1], t[2]]);
  for (const line of pr.body.split(/\r?\n/)) {
    let m = /^Bumps \[[^\]]*\]\([^)]*\) from (\S+) to (\S+?)\.?$/.exec(line);
    if (!m) m = /^Updates `[^`]+` from (\S+) to (\S+)$/.exec(line);
    if (!m) m = /^\| \[[^\]]*\]\([^)]*\) \| `([^`]+)` \| `([^`]+)` \|$/.exec(line);
    if (m) out.push([m[1], m[2]]);
  }
  return out;
}

function checkBump(pr) {
  if (typeof pr.title !== 'string' || typeof pr.body !== 'string') return 'title or body unreadable';
  const stmts = bumpStatements(pr);
  if (stmts.length === 0) return 'no version bump found in the title or body';
  for (const [from, to] of stmts) {
    const a = parseVersion(from);
    const b = parseVersion(to);
    if (!a || !b) return 'a version could not be parsed; left for a person';
    if (b[0] > a[0]) return 'major bump; left for a person';
    if (b[0] < a[0]) return 'version goes down; left for a person';
    const [, aMinor = 0, aPatch = 0] = a;
    const [, bMinor = 0, bPatch = 0] = b;
    if (a[0] === 0 && bMinor !== aMinor) return '0.x minor bump may break; left for a person';
    if (bMinor < aMinor || (bMinor === aMinor && bPatch <= aPatch)) return 'bump does not raise the version';
  }
  return null;
}

function checkMergeState(pr) {
  if (pr.mergeStateStatus !== 'CLEAN') return 'merge state is not CLEAN';
  if (pr.mergeable !== 'MERGEABLE') return 'pull request is not MERGEABLE';
  return null;
}

function checkRuns(pr, runs) {
  if (!/^[0-9a-f]{40}$/.test(pr.headRefOid)) return 'head commit unreadable';
  if (!isObj(runs) || !Array.isArray(runs.workflow_runs)) return 'workflow runs unreadable';
  if (typeof runs.total_count === 'number' && runs.total_count > runs.workflow_runs.length) return 'workflow run list may be cut short';
  if (runs.workflow_runs.some((r) => !isObj(r) || r.head_sha !== pr.headRefOid)) return 'a workflow run is for another commit';
  const state = classifyRuns(runs);
  return state === 'green' ? null : `workflow runs at the head commit are ${state}`;
}

const RULES = [
  ['author', checkAuthor],
  ['files', checkFiles],
  ['commits', checkCommits],
  ['bump', checkBump],
  ['merge-state', checkMergeState],
  ['runs', checkRuns],
];

export function decide(pr, runs) {
  if (!isObj(pr)) return 'skip: pull request unreadable';
  for (const [name, rule] of RULES) {
    let reason;
    try {
      reason = rule(pr, runs);
    } catch {
      reason = 'a field could not be read';
    }
    if (reason) return `skip: ${name}: ${reason}`;
  }
  return `merge ${pr.headRefOid}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [prFile, runsFile] = process.argv.slice(2);
    if (!prFile || !runsFile) throw new Error('usage: dependabot-actions-merge.mjs <pr.json> <runs.json>');
    const pr = JSON.parse(readFileSync(prFile, 'utf8'));
    const runs = JSON.parse(readFileSync(runsFile, 'utf8'));
    console.log(decide(pr, runs));
  } catch (e) {
    console.log('skip: unreadable input');
    console.error(`dependabot-actions-merge: ${e.message}`);
    process.exit(1);
  }
}
