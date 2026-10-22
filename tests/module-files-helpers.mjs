// Helpers shared by the tests/module-files-<module>.test.mjs files, one per
// house module whose files/ scripts they test. Not a test file itself: the
// npm test glob matches *.test.mjs only.
//
// Every sandbox is a throwaway dir under the OS tmpdir, removed when the
// importing test file finishes.

import { after } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CLEANUP_DIRS = [];
after(() => {
  for (const d of CLEANUP_DIRS) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

export function mktemp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  CLEANUP_DIRS.push(d);
  return d;
}

export function runNode(code, opts = {}) {
  return spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
}

/** A tiny local repo pushed to a local bare "origin", both under a temp dir. */
export function makeRepoWithOrigin(defaultBranch = 'main') {
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
