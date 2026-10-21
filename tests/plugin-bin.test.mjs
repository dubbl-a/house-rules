// plugins/house/bin/house: Claude Code puts a plugin's bin/ on the Bash tool's
// PATH while the plugin is enabled, so the wrapper is what makes `house <cmd>`
// work inside a session. It must be executable in the git index, forward every
// argument, return the CLI's exit code, and work from any cwd and via a symlink.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER = join(ROOT, 'plugins/house/bin/house');
const CLI = join(ROOT, 'plugins/house/scripts/house');
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });

test('the wrapper is executable on disk and in the git index', () => {
  accessSync(WRAPPER, constants.X_OK);
  const mode = execFileSync('git', ['ls-files', '-s', 'plugins/house/bin/house'], { cwd: ROOT, encoding: 'utf8' }).split(' ')[0];
  assert.equal(mode, '100755');
});

test('doctor through the wrapper from another cwd matches the script, output and exit code', () => {
  const cwd = join(ROOT, 'plugins');
  const args = ['doctor', '--repo', ROOT];
  const direct = run('node', [CLI, ...args], cwd);
  const wrapped = run(WRAPPER, args, cwd);
  assert.equal(wrapped.status, direct.status);
  assert.equal(wrapped.stdout, direct.stdout);
});

test('the wrapper passes the exit code through for an unknown command', () => {
  const direct = run('node', [CLI, 'no-such-command'], tmpdir());
  const wrapped = run(WRAPPER, ['no-such-command'], tmpdir());
  assert.notEqual(direct.status, 0);
  assert.equal(wrapped.status, direct.status);
});

test('the wrapper still finds the CLI when run through a symlink', () => {
  const link = join(mkdtempSync(join(tmpdir(), 'house-bin-')), 'house');
  symlinkSync(WRAPPER, link);
  const direct = run('node', [CLI, '--help'], tmpdir());
  const linked = run(link, ['--help'], tmpdir());
  assert.equal(linked.status, direct.status);
  assert.equal(linked.stdout, direct.stdout);
});
