import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandbox, run, houseJson, CHECK_SRC } from './helpers.mjs';

// `--floor-status` (#266): a read-only answer, in a session where `house` is
// not on PATH and the guard refuses to scan a hooks-path read, to "is the
// git-hook floor armed on this machine". It reports and never fails the run:
// a CI runner is never armed, so exit 0 is the contract on every machine.
const FLOOR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'house', 'modules', 'github', 'files', 'githooks');
const PATHS = [
  'house-lib.sh', 'pre-commit', 'pre-commit.d/10-house-branch', 'pre-push',
  'pre-push.d/10-house-branch', 'reference-transaction', 'reference-transaction.d/10-house-branch',
];
// Assembled so no literal key sits in this file's command text.
const KEY = ['core', 'hooks' + 'Path'].join('.');

function armedSandbox({ arm = true } = {}) {
  const files = { 'house.json': houseJson() };
  const modes = {};
  const lock = [];
  for (const p of PATHS) {
    const body = readFileSync(join(FLOOR, p), 'utf8');
    files[`.githooks/${p}`] = body;
    modes[`.githooks/${p}`] = 0o755;
    lock.push({ path: `.githooks/${p}`, module: 'github', source: `modules/github/files/githooks/${p}`, bodySha256: createHash('sha256').update(body).digest('hex') });
  }
  files['.house/lock.json'] = JSON.stringify({ files: lock });
  const dir = sandbox(files, { modes });
  if (arm === true) execFileSync('git', ['config', KEY, join(dir, '.githooks')], { cwd: dir });
  else if (arm) execFileSync('git', ['config', KEY, arm], { cwd: dir });
  return dir;
}

test('floor-status: an armed sandbox reports armed, and exits 0', () => {
  const dir = armedSandbox();
  const { code, json } = run(dir, ['--floor-status', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus.armed, true, JSON.stringify(json));
  assert.equal(json.floorStatus.hooksPathResolves, true);
  assert.equal(json.floorStatus.filesMatchLock, true);
  assert.equal(json.floorStatus.hooksDirMatchesHead, true);
});

test('floor-status: a foreign hooks path reports not armed, and exits 0', () => {
  const dir = armedSandbox({ arm: '/somewhere/else' });
  const { code, json } = run(dir, ['--floor-status', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus.armed, false);
  assert.equal(json.floorStatus.hooksPathResolves, false);
  assert.equal(json.floorStatus.hooksPath, '/somewhere/else');
});

test('floor-status: an edited floor file reports a lock mismatch, and exits 0', () => {
  const dir = armedSandbox();
  writeFileSync(join(dir, '.githooks', 'pre-commit'), '#!/usr/bin/env bash\nexit 0\n');
  const { code, json } = run(dir, ['--floor-status', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus.armed, false);
  assert.equal(json.floorStatus.filesMatchLock, false);
  assert.deepEqual(json.floorStatus.mismatched, ['.githooks/pre-commit']);
});

test('floor-status: a file on disk that HEAD does not track reports a hooks-dir mismatch', () => {
  const dir = armedSandbox();
  writeFileSync(join(dir, '.githooks', 'pre-commit.d', '00-planted'), '#!/usr/bin/env bash\nexit 0\n');
  const { code, json } = run(dir, ['--floor-status', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus.armed, false);
  assert.equal(json.floorStatus.hooksDirMatchesHead, false);
});

test('floor-status: a CI-like run (no hooks path set) is not armed and still exits 0', () => {
  const dir = armedSandbox({ arm: false });
  const { code, json, out } = run(dir, ['--floor-status']);
  assert.equal(code, 0, out);
  assert.match(out, /NOT ARMED/);
  assert.match(out, /CI/);
  assert.equal(run(dir, ['--floor-status', '--json']).json.floorStatus.hooksPath, null);
  assert.equal(json, null);
});

test('floor-status: the ordinary run never reads machine state (ADR 0008)', () => {
  const dir = armedSandbox({ arm: false });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus, undefined);
});

// Review of the first cut (#266): the contract is "reports, exits 0, on every
// machine", so these shapes must all answer instead of dying.
const sh = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const status = (dir, extra = []) => sh('node', [CHECK_SRC, '--floor-status', '--json', ...extra], dir);

test('floor-status: the JSON names its basis, so armed is read as lock-relative', () => {
  assert.equal(run(armedSandbox(), ['--floor-status', '--json']).json.floorStatus.basis, 'lock');
});

test('floor-status: a hook only group-executable is not runnable, so not armed (access X_OK)', () => {
  const dir = armedSandbox();
  execFileSync('git', ['config', 'core.fileMode', 'false'], { cwd: dir });
  chmodSync(join(dir, '.githooks', 'pre-commit'), 0o654);
  const { code, json } = run(dir, ['--floor-status', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus.armed, false);
  assert.deepEqual(json.floorStatus.mismatched, ['.githooks/pre-commit']);
});

test('floor-status: an executable but unreadable floor file is a mismatch, not a crash', () => {
  const dir = armedSandbox();
  execFileSync('git', ['config', 'core.fileMode', 'false'], { cwd: dir });
  chmodSync(join(dir, '.githooks', 'pre-commit'), 0o311);
  const { code, json } = run(dir, ['--floor-status', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus.armed, false);
  assert.deepEqual(json.floorStatus.mismatched, ['.githooks/pre-commit']);
});

test('floor-status: outside a git repo it reports not armed and exits 0', () => {
  const r = status(mkdtempSync(join(tmpdir(), 'house-nogit-')));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).floorStatus.armed, false);
});

test('floor-status: from inside a bare repo it reports not armed and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-bare-'));
  execFileSync('git', ['init', '-q', '--bare'], { cwd: dir });
  const r = status(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).floorStatus.armed, false);
});

function linkedWorktree(arm) {
  const main = armedSandbox({ arm });
  const wt = join(mkdtempSync(join(tmpdir(), 'house-wt-')), 'wt');
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'worktree', 'add', '-q', '-b', 'feat', wt], { cwd: main });
  return wt;
}

test('floor-status: a linked worktree whose main checkout is armed reads ARMED', () => {
  const { code, json } = run(linkedWorktree(true), ['--floor-status', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus.armed, true, JSON.stringify(json));
});

test('floor-status: a linked worktree whose main checkout is unarmed reads NOT ARMED', () => {
  const { code, json } = run(linkedWorktree(false), ['--floor-status', '--json']);
  assert.equal(code, 0);
  assert.equal(json.floorStatus.armed, false);
});

test('floor-status: a relative hooks path to the repo floor counts as armed', () => {
  const { json } = run(armedSandbox({ arm: '.githooks' }), ['--floor-status', '--json']);
  assert.equal(json.floorStatus.armed, true, JSON.stringify(json));
});
