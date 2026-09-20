#!/usr/bin/env node
// check-orchestration-kit-upstream.mjs: watch the upstream orchestration kit
// this package's roster and session-start text were ported from, so staying
// current is a deliberate, diffable act (docs/handbook/upstreams.md, BORROW).
//
// The port: plugins/house/agents/*.md and plugins/house/orchestration/
// ORCHESTRATION.md, adapted from github.com/SirRuggie/claude-code-orchestration-kit
// (MIT) at the commit pinned below. Nothing here is vendored verbatim, so
// there is no hash of upstream text to compare; what moves is the upstream
// branch head, and the answer to "did it move" is `git ls-remote`.
//
// Usage:
//   node scripts/check-orchestration-kit-upstream.mjs [--remote=<url-or-path>] [--json]
//   node scripts/check-orchestration-kit-upstream.mjs --diff        (also shallow-clones and prints the stat of what changed under core/)
//
// Exit codes (read the verdict by name, never "non-zero = bad"):
//   0  upstream head unchanged since the pinned commit; nothing to re-port
//   1  upstream moved; review the diff, re-port what is worth taking, then record the new sha in PINNED
//   3  bad argument, or the remote could not be read (no network, wrong url); this is not "unchanged"
//
// Needs network for the default remote and a `git` on PATH. Not part of
// `npm run verify` for that reason; run it at the quarterly trim or before a release.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PINNED = {
  remote: 'https://github.com/SirRuggie/claude-code-orchestration-kit',
  branch: 'main',
  sha: '4416994bf730c8e9833984383daa58375c1ca6fd',
  consulted: '2026-09-20',
  ported: ['core/CLAUDE.md', 'core/agents/'],
};

export function parseArgs(argv) {
  const out = { remote: PINNED.remote, branch: PINNED.branch, json: false, diff: false };
  for (const a of argv) {
    if (a.startsWith('--remote=')) out.remote = a.slice(9);
    else if (a.startsWith('--branch=')) out.branch = a.slice(9);
    else if (a === '--json') out.json = true;
    else if (a === '--diff') out.diff = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.remote) throw new Error('--remote must not be empty');
  return out;
}

/** The sha the remote's branch head points at, or a thrown error. */
export function remoteHead(remote, branch) {
  const out = execFileSync('git', ['ls-remote', remote, `refs/heads/${branch}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  const line = out.split('\n').find((l) => l.trim().length > 0);
  if (!line) throw new Error(`no refs/heads/${branch} on ${remote}`);
  const sha = line.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`unreadable ls-remote line: ${line}`);
  return sha;
}

/** `git diff --stat` between the pinned sha and the head, over the ported paths. */
export function diffStat(remote, branch, fromSha, toSha, paths) {
  const dir = mkdtempSync(join(tmpdir(), 'house-kit-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--branch', branch, remote, dir], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    execFileSync('git', ['-C', dir, 'fetch', '--quiet', 'origin', fromSha], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    return execFileSync('git', ['-C', dir, 'diff', '--stat', fromSha, toSha, '--', ...paths], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const report = { remote: null, branch: null, pinned: PINNED.sha, consulted: PINNED.consulted };
  const emit = (status, verdict, detail) => {
    Object.assign(report, { status, verdict, detail });
    if (opts?.json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else process.stdout.write(`orchestration kit upstream: ${verdict}${detail ? ` (${detail})` : ''}\n`);
    process.exit(status);
  };
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { emit(3, 'bad argument', e.message); }
  report.remote = opts.remote;
  report.branch = opts.branch;
  let head;
  try { head = remoteHead(opts.remote, opts.branch); } catch (e) { emit(3, 'remote unreadable', (e.stderr?.toString() || e.message).trim().split('\n')[0]); }
  report.head = head;
  if (head === PINNED.sha) emit(0, `upstream unchanged since ${PINNED.consulted}`, `head ${head.slice(0, 7)}`);
  let stat = '';
  if (opts.diff) {
    try { stat = diffStat(opts.remote, opts.branch, PINNED.sha, head, PINNED.ported); } catch (e) { stat = `(diff unavailable: ${(e.stderr?.toString() || e.message).trim().split('\n')[0]})`; }
    report.diffStat = stat;
    if (!opts.json) process.stdout.write(stat.endsWith('\n') ? stat : `${stat}\n`);
  }
  emit(1, `upstream moved since ${PINNED.consulted}`, `pinned ${PINNED.sha.slice(0, 7)}, head ${head.slice(0, 7)}; review ${PINNED.ported.join(' ')} and record the new sha in PINNED${opts.diff ? '' : ' (rerun with --diff for the stat)'}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
