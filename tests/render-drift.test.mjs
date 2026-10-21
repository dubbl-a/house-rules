// Self-host render-drift gate (#343). This repo vendors its own modules into
// .claude/rules/house/, scripts/house/, .githooks/, .house/check.mjs and
// AGENTS.md. `check:house` cannot see a module edit that was never rendered:
// the lock records the hash of the vendored copy, so a stale copy still
// matches its own lock, and the one check that compares against module source
// (tamper behind-text) needs a newer installed plugin and only warns. An
// adopter has no module sources to compare, so the gate lives here, in the
// package's own suite, and runs under `npm test` (verify and CI).
//
// It reuses render itself instead of re-deriving its output: the tracked
// files, as they are on disk, are copied into a throwaway repo, `render
// --apply` runs there, and every file render touched must still equal this
// repo's copy. render's own dry-run plan cannot serve: its `clean` status only
// says the file matches the lock, which a stale copy does.
//
// Every sandbox is a throwaway dir under the OS tmpdir. No network calls.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'plugins/house/scripts/house');
// render --apply arms core.hooksPath in the repo it renders; this copy's
// commit must not run the floor, so every git call here uses an empty hooks dir.
const NO_HOOKS_DIR = mkdtempSync(join(tmpdir(), 'house-no-hooks-'));
const git = (cwd, ...a) => execFileSync('git', ['-c', `core.hooksPath=${NO_HOOKS_DIR}`, ...a], { cwd, encoding: 'utf8' });

const made = [NO_HOOKS_DIR];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

test('every managed file in this repo equals what render would write', () => {
  const copy = mkdtempSync(join(tmpdir(), 'house-render-drift-'));
  made.push(copy);
  const tracked = git(ROOT, 'ls-files', '-z').split('\0').filter((p) => p && existsSync(join(ROOT, p)));
  for (const p of tracked) {
    mkdirSync(dirname(join(copy, p)), { recursive: true });
    copyFileSync(join(ROOT, p), join(copy, p));
  }
  git(copy, 'init', '-q');
  git(copy, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(copy, 'config', 'user.email', 't@t');
  git(copy, 'config', 'user.name', 't');
  git(copy, 'add', '-A');
  git(copy, 'commit', '-q', '-m', 'copy');

  const r = spawnSync('node', [CLI, 'render', '--repo', copy, '--apply'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `render --apply failed in the copy: ${r.stdout}${r.stderr}`);

  // The copy was committed from this repo's files, so anything render changed
  // or created shows up here.
  const stale = git(copy, 'status', '--porcelain', '-z').split('\0').filter(Boolean).map((l) => l.slice(3));
  assert.ok(existsSync(join(copy, '.claude/rules/house/claude-code.md')), 'the copy holds the vendored rules');
  assert.deepEqual(
    stale,
    [],
    'a module source changed without a re-render; run `node plugins/house/scripts/house render --apply` and commit the result',
  );
});
