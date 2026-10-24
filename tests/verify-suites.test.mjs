// Tests for scripts/verify-suites.mjs: the runner end to end, with stub suites
// in place of the real three (VERIFY_SUITES_JSON), so a hang can be staged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // Wall time is the point: the kill must fire at the 1 s cap, not at the stub's own 600 s. 120 s leaves
  // a loaded machine room and still fails a kill that never came.
  assert.ok(Date.now() - started < 120000, 'the stub was not left to run its 600 s');
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

test('SIGINT to verify takes its running suites down with it', async () => {
  const pidFile = join(mkdtempSync(join(tmpdir(), 'verify-sig-')), 'pid');
  const stubCode = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 600000)`;
  const child = spawn('node', [SCRIPT], {
    stdio: 'ignore',
    env: { ...process.env, VERIFY_SUITES_JSON: JSON.stringify([stub('sleeper', stubCode)]) },
  });
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let stubPid = 0;
  try {
    // Bounds are generous because verify itself runs this under load (#374): a
    // pass returns as soon as the condition holds, so only a failure waits them out.
    for (let i = 0; i < 300 && !stubPid; i++) {
      await sleep(100);
      if (existsSync(pidFile)) stubPid = Number(readFileSync(pidFile, 'utf8')) || 0;
    }
    assert.ok(stubPid > 0, 'the stub suite started');
    child.kill('SIGINT');
    assert.equal((await exited).code, 130);
    // The stub leads its own process group (detached), so -pid reaches the group.
    // Only ESRCH means gone: while the killed stub waits to be reaped, macOS
    // answers EPERM (#425), so every other answer waits and asks again.
    let gone = false;
    for (let i = 0; i < 150 && !gone; i++) {
      try { process.kill(-stubPid, 0); } catch (e) { gone = e.code === 'ESRCH'; }
      if (!gone) await sleep(100);
    }
    assert.ok(gone, 'the stub suite process group is gone');
  } finally {
    // Only the pids this test started.
    if (stubPid > 0) { try { process.kill(-stubPid, 'SIGKILL'); } catch { /* gone */ } }
    child.kill('SIGKILL');
  }
});
