#!/usr/bin/env node
// Runs the three long, independent suites of `npm run verify` side by side:
// npm test, the guard hook tests, the git-hook floor tests. None reads what
// another writes (each builds its fixtures under its own mktemp directory), so
// the only cost of overlapping them is that their output cannot stream. Each
// suite's output is held and printed whole, in a fixed order, when all three
// have finished; a line on stderr says when each one ends. Every suite runs to
// the end even when another fails, and the exit is 1 if any did.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = ['test', 'test:hooks', 'test:githooks'];

const run = (script) => new Promise((resolve) => {
  const started = Date.now();
  const chunks = [];
  const child = spawn('npm', ['run', script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => chunks.push(c));
  const done = (code, note = '') => {
    const secs = Math.round((Date.now() - started) / 1000);
    process.stderr.write(`finished npm run ${script}: exit ${code}, ${secs}s${note}\n`);
    resolve({ script, code, secs, out: Buffer.concat(chunks).toString('utf8') });
  };
  child.on('error', (e) => { chunks.push(Buffer.from(`${e.message}\n`)); done(1, ' (did not start)'); });
  child.on('close', (code, signal) => done(code ?? (signal ? 1 : 0), signal ? ` (${signal})` : ''));
});

const results = await Promise.all(SUITES.map(run));
for (const r of results) {
  process.stdout.write(`\n===== npm run ${r.script} (exit ${r.code}, ${r.secs}s) =====\n${r.out}`);
}
const failed = results.filter((r) => r.code !== 0).map((r) => r.script);
if (failed.length > 0) {
  console.error(`\nverify: failed: ${failed.join(', ')}`);
  process.exit(1);
}
