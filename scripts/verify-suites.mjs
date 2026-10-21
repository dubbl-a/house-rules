#!/usr/bin/env node
// Runs the three long, independent suites of `npm run verify` side by side:
// npm test, the guard hook tests, the git-hook floor tests. None reads what
// another writes (each builds its fixtures under its own mktemp directory), so
// the only cost of overlapping them is that their output cannot stream. Each
// suite's output is held and printed whole, in a fixed order, when all three
// have finished; a line on stderr says when each one ends. Every suite runs to
// the end even when another fails, and the exit is 1 if any did.
// A suite that hangs does not hold verify forever: past VERIFY_SUITE_TIMEOUT_S
// (default 1800, several times the slowest suite's normal run) it is killed,
// its output so far is printed, and verify names it as timed out. While suites
// run, a line on stderr every VERIFY_PROGRESS_S seconds (default 60) names the
// ones still going. VERIFY_SUITES_JSON, a JSON array of {name, argv}, replaces
// the suite list; the tests use it to run a stub that sleeps. Each suite is in
// its own process group, so on SIGINT, SIGTERM or SIGHUP verify signals every
// suite still running before it exits; without that, Ctrl-C leaves them going.
// The exit status is set, not forced, so a pipe reader still gets every byte.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const secsFromEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const TIMEOUT_S = secsFromEnv('VERIFY_SUITE_TIMEOUT_S', 1800);
const PROGRESS_S = secsFromEnv('VERIFY_PROGRESS_S', 60);
const SUITES = process.env.VERIFY_SUITES_JSON
  ? JSON.parse(process.env.VERIFY_SUITES_JSON)
  : ['test', 'test:hooks', 'test:githooks'].map((name) => ({ name, argv: ['npm', 'run', name] }));
const running = new Map();

const run = ({ name, argv }) => new Promise((resolve) => {
  const started = Date.now();
  const chunks = [];
  const label = argv.join(' ');
  // Its own process group, so a timeout reaches npm's children, not just npm.
  const child = spawn(argv[0], argv.slice(1), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => chunks.push(c));
  running.set(name, { started, pid: child.pid });
  let ended = false;
  let timedOut = false;
  const done = (code, note = '') => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    running.delete(name);
    const secs = Math.round((Date.now() - started) / 1000);
    process.stderr.write(`finished ${label}: exit ${code}, ${secs}s${note}\n`);
    resolve({ name, label, code, secs, timedOut, out: Buffer.concat(chunks).toString('utf8') });
  };
  const timer = setTimeout(() => {
    timedOut = true;
    chunks.push(Buffer.from(`\nverify: ${label} timed out after ${TIMEOUT_S}s and was killed\n`));
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    done(1, ` (timed out after ${TIMEOUT_S}s)`);
  }, TIMEOUT_S * 1000);
  child.on('error', (e) => { chunks.push(Buffer.from(`${e.message}\n`)); done(1, ' (did not start)'); });
  child.on('close', (code, signal) => done(code ?? (signal ? 1 : 0), signal ? ` (${signal})` : ''));
});

for (const [sig, code] of Object.entries({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 })) {
  process.on(sig, () => {
    for (const { pid } of running.values()) {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    process.exit(code);
  });
}

const progress = setInterval(() => {
  const now = Date.now();
  const names = [...running].map(([n, r]) => `${n} (${Math.round((now - r.started) / 1000)}s)`);
  if (names.length > 0) process.stderr.write(`still running: ${names.join(', ')}\n`);
}, PROGRESS_S * 1000);

const results = await Promise.all(SUITES.map(run));
clearInterval(progress);
for (const r of results) {
  const how = r.timedOut ? 'TIMED OUT' : `exit ${r.code}`;
  process.stdout.write(`\n===== ${r.label} (${how}, ${r.secs}s) =====\n${r.out}`);
}
const failed = results.filter((r) => r.code !== 0).map((r) => (r.timedOut ? `${r.name} (timed out)` : r.name));
if (failed.length > 0) {
  console.error(`\nverify: failed: ${failed.join(', ')}`);
  // Not process.exit: on a pipe it can cut off output still being flushed.
  process.exitCode = 1;
}
