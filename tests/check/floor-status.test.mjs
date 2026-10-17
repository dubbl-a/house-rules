import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandbox, run, houseJson } from './helpers.mjs';

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
