// Tests for scripts/verify-suites.mjs: the runner end to end, with stub suites
// in place of the real three (VERIFY_SUITES_JSON), so a hang can be staged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'verify-suites.mjs');

const stub = (name, code) => ({ name, argv: ['node', '-e', code] });

function verify(suites, env = {}) {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, VERIFY_SUITES_JSON: JSON.stringify(suites), ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('suites that pass leave verify green', () => {
  const r = verify([stub('a', 'console.log("alpha")'), stub('b', 'console.log("beta")')]);
  assert.equal(r.code, 0);
  assert.match(r.out, /alpha/);
  assert.match(r.out, /beta/);
  assert.doesNotMatch(r.err, /verify: failed/);
});

test('a failing suite is named and the others still run to the end', () => {
  const r = verify([stub('bad', 'console.log("bad ran"); process.exit(3)'), stub('good', 'console.log("good ran")')]);
  assert.equal(r.code, 1);
  assert.match(r.out, /bad ran/);
  assert.match(r.out, /good ran/);
  assert.match(r.err, /verify: failed: bad$/m);
});

test('a hung suite is killed, named, its output printed, and verify fails', () => {
  const hang = 'console.log("before the hang"); setTimeout(() => {}, 600000)';
  const started = Date.now();
  const r = verify([stub('hung', hang), stub('fine', 'console.log("fine ran")')], { VERIFY_SUITE_TIMEOUT_S: '1' });
  assert.ok(Date.now() - started < 30000, 'the stub was not left to run its 600 s');
  assert.equal(r.code, 1);
  assert.match(r.out, /TIMED OUT/);
  assert.match(r.out, /before the hang/);
  assert.match(r.out, /fine ran/);
  assert.match(r.err, /verify: failed: hung \(timed out\)$/m);
});

test('a suite still running is named on stderr', () => {
  const r = verify([stub('slow', 'setTimeout(() => {}, 2500)')], { VERIFY_PROGRESS_S: '1' });
  assert.equal(r.code, 0);
  assert.match(r.err, /still running: slow \(\d+s\)/);
});
