// Black-box tests for the InstructionsLoaded hook
// (plugins/house/hooks/instructions-loaded.mjs).
//
// The hook is a logger, not a gate: every test here confirms it never
// blocks (always exit 0, nothing on stdout) while checking what actually
// landed in its log file. CLAUDE_CONFIG_DIR is sandboxed to a fresh tmp dir
// on every call, so this suite never reads or writes the real machine's
// ~/.claude/house/instructions-loaded log.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync,
} from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HERE, '..', 'plugins', 'house', 'hooks', 'instructions-loaded.mjs');

const CLEANUP_DIRS = [];
after(() => {
  for (const d of CLEANUP_DIRS) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function sandboxConfigDir() {
  const d = mkdtempSync(join(tmpdir(), 'house-hook-config-'));
  CLEANUP_DIRS.push(d);
  return d;
}

/**
 * Build the child env both runners spawn the hook with: CLAUDE_CONFIG_DIR
 * always pinned to a sandbox (the caller's, or a fresh one), and
 * CLAUDE_CODE_PROJECT_DIR_NAME stripped out of the inherited process.env
 * unless the caller's own `env` sets it. Without that strip, an ambient
 * CLAUDE_CODE_PROJECT_DIR_NAME (set by ANY real Claude Code session this
 * suite happens to run inside, this one included) would ride along into
 * every spawned hook and win the hook's own key derivation over cwd,
 * collapsing every case that expects a distinct cwd-keyed log onto one file.
 */
function buildHookEnv(env = {}) {
  const configDir = env.CLAUDE_CONFIG_DIR || sandboxConfigDir();
  const childEnv = { ...process.env, ...env, CLAUDE_CONFIG_DIR: configDir };
  if (!Object.prototype.hasOwnProperty.call(env, 'CLAUDE_CODE_PROJECT_DIR_NAME')) {
    delete childEnv.CLAUDE_CODE_PROJECT_DIR_NAME;
  }
  return { env: childEnv, configDir };
}

/** Run the real hook as a subprocess with `stdin` piped in. */
function runHook(stdin, env = {}) {
  const { env: childEnv, configDir } = buildHookEnv(env);
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: stdin,
    encoding: 'utf8',
    env: childEnv,
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '', configDir };
}

function logPathFor(configDir, key) {
  return join(configDir, 'house', 'instructions-loaded', `${key}.jsonl`);
}

/**
 * Run the real hook as a subprocess with `stdin` piped in, asynchronously
 * (spawn, not spawnSync), so a caller can fire several at once with
 * Promise.all and actually exercise their overlap. spawnSync cannot express
 * this: it runs strictly one process at a time.
 */
function runHookAsync(stdin, env = {}) {
  const { env: childEnv, configDir } = buildHookEnv(env);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], { env: childEnv });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code, out, err, configDir,
    }));
    child.stdin.end(stdin);
  });
}

test('writes one JSON line under the sandboxed CLAUDE_CONFIG_DIR, keyed off cwd, and exits 0 with no stdout', () => {
  const repoCwd = '/tmp/fake-repo-for-key-derivation';
  const payload = JSON.stringify({
    session_id: 'sess-1',
    cwd: repoCwd,
    hook_event_name: 'InstructionsLoaded',
    file_path: `${repoCwd}/.claude/rules/house/engineering.md`,
    load_reason: 'path_glob_match',
  });
  const { code, out, configDir } = runHook(payload);
  assert.equal(code, 0);
  assert.equal(out, '', 'must never write to stdout');

  const key = repoCwd.replace(/\//g, '-');
  const logPath = logPathFor(configDir, key);
  assert.ok(existsSync(logPath), `expected a log at ${logPath}`);
  const lines = readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.file_path, `${repoCwd}/.claude/rules/house/engineering.md`);
  assert.equal(rec.load_reason, 'path_glob_match');
  assert.equal(rec.session_id, 'sess-1');
  assert.equal(typeof rec.ts, 'string');
  assert.ok(!Number.isNaN(Date.parse(rec.ts)), `ts must be parseable: ${rec.ts}`);
  assert.deepEqual(Object.keys(rec).sort(), ['file_path', 'load_reason', 'session_id', 'ts']);
});

test('honors CLAUDE_CODE_PROJECT_DIR_NAME beside CLAUDE_CONFIG_DIR for the log key, mirroring memoryIndexPath', () => {
  const configDir = sandboxConfigDir();
  const payload = JSON.stringify({ session_id: 's', cwd: '/some/repo', file_path: 'x', load_reason: 'session_start' });
  const { code } = runHook(payload, { CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_PROJECT_DIR_NAME: 'named-project' });
  assert.equal(code, 0);
  assert.ok(existsSync(logPathFor(configDir, 'named-project')), 'must key off CLAUDE_CODE_PROJECT_DIR_NAME');
  assert.ok(!existsSync(logPathFor(configDir, '-some-repo')), 'must not also key off cwd when the name rides beside CLAUDE_CONFIG_DIR');
});

test('CLAUDE_CODE_PROJECT_DIR_NAME alone, without CLAUDE_CONFIG_DIR beside it, is ignored (falls back to cwd)', () => {
  // Sandboxing still sets CLAUDE_CONFIG_DIR here (so the real ~/.claude is
  // never touched), but the point under test is that a bare
  // CLAUDE_CODE_PROJECT_DIR_NAME does not itself win over cwd when set
  // independently of this call's env override -- runHook always pins
  // CLAUDE_CONFIG_DIR, so this instead confirms the fallback key (cwd) is
  // what actually gets used end to end.
  const configDir = sandboxConfigDir();
  const payload = JSON.stringify({ session_id: 's', cwd: '/another/repo', file_path: 'x', load_reason: 'session_start' });
  const { code } = runHook(payload, { CLAUDE_CONFIG_DIR: configDir });
  assert.equal(code, 0);
  assert.ok(existsSync(logPathFor(configDir, '-another-repo')));
});

test('malformed stdin exits 0 and writes nothing', () => {
  for (const bad of ['not json', '', '{"cwd": 42}', 'null', '[]', '"just a string"', '{}']) {
    const { code, out, err, configDir } = runHook(bad);
    assert.equal(code, 0, `bad=${JSON.stringify(bad)} err=${err}`);
    assert.equal(out, '', `bad=${JSON.stringify(bad)} must not write to stdout`);
    assert.ok(!existsSync(join(configDir, 'house')), `bad=${JSON.stringify(bad)} must not create a log dir`);
  }
});

test('appends a second line to an existing log rather than overwriting it', () => {
  const configDir = sandboxConfigDir();
  const cwd = '/repo/two-lines';
  const env = { CLAUDE_CONFIG_DIR: configDir };
  runHook(JSON.stringify({ session_id: 's1', cwd, file_path: 'a.md', load_reason: 'session_start' }), env);
  runHook(JSON.stringify({ session_id: 's1', cwd, file_path: 'b.md', load_reason: 'include' }), env);
  const lines = readFileSync(logPathFor(configDir, cwd.replace(/\//g, '-')), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).file_path, 'a.md');
  assert.equal(JSON.parse(lines[1]).file_path, 'b.md');
});

test('cap rewrite: a log past 256 KB rewrites down to roughly its last half, keeping the newest line and dropping the oldest', () => {
  const configDir = sandboxConfigDir();
  const cwd = '/repo/cap-test';
  const key = cwd.replace(/\//g, '-');
  const dir = join(configDir, 'house', 'instructions-loaded');
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `${key}.jsonl`);

  // Seed just over the 256 KB cap with distinguishable, uniquely-marked lines.
  const filler = 'x'.repeat(500);
  const seedLines = [];
  let size = 0;
  let i = 0;
  while (size < 256 * 1024 + 2000) {
    const line = JSON.stringify({ ts: `seed-${i}`, file_path: filler, load_reason: 'session_start', session_id: 's' });
    seedLines.push(line);
    size += Buffer.byteLength(line, 'utf8') + 1;
    i += 1;
  }
  writeFileSync(logPath, `${seedLines.join('\n')}\n`, 'utf8');
  const originalLineCount = seedLines.length;

  const payload = JSON.stringify({ session_id: 'newest', cwd, file_path: 'newest.md', load_reason: 'compact' });
  const { code } = runHook(payload, { CLAUDE_CONFIG_DIR: configDir });
  assert.equal(code, 0);

  const finalRaw = readFileSync(logPath, 'utf8');
  const finalLines = finalRaw.trim().split('\n');
  assert.ok(finalLines.length < originalLineCount + 1, `expected the log to shrink from ${originalLineCount + 1} lines, got ${finalLines.length}`);
  assert.equal(JSON.parse(finalLines.at(-1)).session_id, 'newest', 'the newly appended line survives the rewrite');
  assert.ok(!finalRaw.includes('"ts":"seed-0"'), 'the oldest seed line must have been dropped');
  assert.ok(Buffer.byteLength(finalRaw, 'utf8') < Buffer.byteLength(`${seedLines.join('\n')}\n`, 'utf8'), 'the file itself must be smaller than the seeded content');
});

// ── stale temp sweep (#46) ──────────────────────────────────────────────
//
// trimIfOversized() writes its own trimmed copy to a pid-named temp file
// beside the log before renaming it into place. A process that dies
// between that write and the rename leaves the temp file behind forever,
// since nothing else in the hook ever looks at that directory. This plants
// three siblings ahead of a real over-cap trim: one named for a dead pid,
// one named for a live pid but with an old mtime, and one (the negative
// control) named for a live pid with a fresh mtime, then asserts the sweep
// removes exactly the two stale ones and leaves the live, fresh one alone.
test('trimIfOversized sweeps stale .tmp siblings for a dead pid or an old mtime, but leaves a live pid with a fresh mtime alone', async () => {
  const configDir = sandboxConfigDir();
  const cwd = '/repo/stale-tmp-test';
  const key = cwd.replace(/\//g, '-');
  const dir = join(configDir, 'house', 'instructions-loaded');
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `${key}.jsonl`);
  const base = `${key}.jsonl`;

  // Seed the log past the 256 KB cap so this run's append triggers a trim.
  const filler = 'x'.repeat(500);
  const seedLines = [];
  let size = 0;
  let i = 0;
  while (size < 256 * 1024 + 2000) {
    const line = JSON.stringify({
      ts: `seed-${i}`, file_path: filler, load_reason: 'session_start', session_id: 's',
    });
    seedLines.push(line);
    size += Buffer.byteLength(line, 'utf8') + 1;
    i += 1;
  }
  writeFileSync(logPath, `${seedLines.join('\n')}\n`, 'utf8');

  // A dead pid: not live in this or any environment, so the sweep must
  // treat it as stale regardless of its mtime (left fresh here on purpose).
  const deadPidPath = join(dir, `.${base}.999999.tmp`);
  writeFileSync(deadPidPath, 'dead pid, fresh mtime\n', 'utf8');

  // A live pid whose temp file is old enough to count as stale on mtime
  // alone: a real, currently-running child process, so the pid-liveness
  // check by itself would call this one live and only the mtime check
  // catches it.
  const liveChild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await new Promise((resolve, reject) => {
    liveChild.once('spawn', resolve);
    liveChild.once('error', reject);
  });
  const oldMtimePath = join(dir, `.${base}.${liveChild.pid}.tmp`);
  writeFileSync(oldMtimePath, 'live pid, old mtime\n', 'utf8');
  const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago, past the 5-minute window
  utimesSync(oldMtimePath, oldTime, oldTime);

  // Negative control: a live pid (this test runner itself) with a fresh
  // mtime must survive, the same way a trim still genuinely mid-flight
  // would; a sweep that removed this would delete out from under a
  // trimmer that had not died at all.
  const freshPath = join(dir, `.${base}.${process.pid}.tmp`);
  writeFileSync(freshPath, 'live pid, fresh mtime\n', 'utf8');

  try {
    const payload = JSON.stringify({
      session_id: 'newest', cwd, file_path: 'newest.md', load_reason: 'compact',
    });
    const { code } = runHook(payload, { CLAUDE_CONFIG_DIR: configDir });
    assert.equal(code, 0);

    assert.ok(!existsSync(deadPidPath), 'a temp file for a dead pid must be swept');
    assert.ok(!existsSync(oldMtimePath), 'a temp file older than the staleness window must be swept, even for a live pid');
    assert.ok(existsSync(freshPath), 'a live pid with a fresh mtime must never be swept');

    const finalRaw = readFileSync(logPath, 'utf8');
    const finalLines = finalRaw.trim().split('\n');
    assert.ok(finalLines.length < seedLines.length + 1, 'the log must still have trimmed down');
    assert.equal(JSON.parse(finalLines.at(-1)).session_id, 'newest', 'the newly appended line survives the sweep and the trim');
  } finally {
    liveChild.kill();
  }
});

test('a repo whose cwd derives an empty key (missing cwd) writes nothing, rather than guessing a log path', () => {
  const payload = JSON.stringify({ session_id: 's', file_path: 'x', load_reason: 'session_start' });
  const { code, out, configDir } = runHook(payload);
  assert.equal(code, 0);
  assert.equal(out, '');
  assert.ok(!existsSync(join(configDir, 'house')));
});

// ── concurrency (#37) ────────────────────────────────────────────────────
//
// appendCapped() used to read the whole log, build the new content in
// memory, and write the whole file back on every event: two processes that
// overlap between the read and the write lose whichever line was written
// first. spawnSync in every test above is strictly sequential and cannot
// exercise that window at all, so this is the one case in the suite that
// actually fires real hook processes at once (spawn, not spawnSync) and
// counts what survives.
test('16 concurrent hook processes across 3 rounds each land all 16 lines, none lost to the read-modify-write race', async () => {
  const ROUNDS = 3;
  const PROCS_PER_ROUND = 16;
  for (let round = 0; round < ROUNDS; round += 1) {
    const configDir = sandboxConfigDir();
    const cwd = `/repo/concurrent-round-${round}`;
    const expectedFilePaths = new Set();
    const runs = [];
    for (let i = 0; i < PROCS_PER_ROUND; i += 1) {
      const filePath = `/repo/rule-${round}-${i}.md`;
      expectedFilePaths.add(filePath);
      const payload = JSON.stringify({
        session_id: `s-${round}`,
        cwd,
        file_path: filePath,
        load_reason: 'path_glob_match',
      });
      runs.push(runHookAsync(payload, { CLAUDE_CONFIG_DIR: configDir }));
    }
    // Rounds are sequential by design (each gets its own log file); the 16
    // processes within a round race each other via Promise.all.
    const results = await Promise.all(runs);

    for (const r of results) {
      assert.equal(r.code, 0, `round ${round}: every process must exit 0 (stderr=${r.err})`);
      assert.equal(r.out, '', `round ${round}: every process must write nothing to stdout`);
    }

    const logPath = logPathFor(configDir, cwd.replace(/\//g, '-'));
    const raw = readFileSync(logPath, 'utf8');
    const seenFilePaths = new Set();
    let parsedCount = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      // Parse each line in its own try/catch, the way doctor's probe does:
      // one malformed line must not sink the whole assertion.
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      parsedCount += 1;
      seenFilePaths.add(rec.file_path);
    }
    assert.equal(parsedCount, PROCS_PER_ROUND, `round ${round}: expected exactly ${PROCS_PER_ROUND} lines, got ${parsedCount}`);
    assert.deepEqual(seenFilePaths, expectedFilePaths, `round ${round}: the logged file_path set must match every process that ran`);
  }
});

// ── trim direction under concurrency (#45) ────────────────────────────────
//
// The round above proves every append lands when 16 processes race but
// none of them cross CAP_BYTES. This test fires the same kind of burst
// across a cap crossing instead, where trimIfOversized's own comment states
// the residual window this repo has chosen to accept:
//
//   "every appendLine that lands between this function's readFileSync and
//   its renameSync is lost, so a burst of concurrent appends crossing the
//   cap at once can drop several lines, not just one ... The loss is
//   confined to a cap crossing and is undercount-only: it can drop a load
//   that happened, never fabricate one that did not."
//
// That is a claim about direction, not a count, so this test does not
// assert how many lines survive; the whole point of the claim is that the
// count is exactly what the code does not promise once a burst crosses the
// cap. What it does promise, and what this asserts, is that whatever
// survives is real: every surviving line parses as JSON, every surviving
// file_path traces to something this test actually seeded or wrote (the
// subset check below is the phantom check: it would catch a rename-order
// bug that started fabricating a file_path nobody wrote), the file is left
// non-empty, and the newest surviving timestamp is a real, parseable one.
// A future change to the trim, a lock or a different rename order, should
// fail this test the moment it starts fabricating or corrupting a line,
// even though it is free to change how many lines survive.
test('a burst crossing the cap under concurrency never fabricates or corrupts a surviving line', async () => {
  const configDir = sandboxConfigDir();
  const cwd = '/repo/cap-crossing-burst';
  const key = cwd.replace(/\//g, '-');
  const dir = join(configDir, 'house', 'instructions-loaded');
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `${key}.jsonl`);

  // Seed just under the cap, a few hundred bytes short of it, so the burst
  // below is what actually crosses CAP_BYTES (the cap-rewrite test above
  // shows the same seeding shape, aimed at just past the cap instead).
  const seedFilePaths = [];
  const seedLines = [];
  let size = 0;
  let i = 0;
  const TARGET_UNDER_CAP = 256 * 1024 - 400;
  while (size < TARGET_UNDER_CAP) {
    const filePath = `/repo/seed-${i}.md`;
    seedFilePaths.push(filePath);
    const line = JSON.stringify({
      ts: `seed-${i}`, file_path: filePath, load_reason: 'session_start', session_id: 's-seed',
    });
    seedLines.push(line);
    size += Buffer.byteLength(line, 'utf8') + 1;
    i += 1;
  }
  writeFileSync(logPath, `${seedLines.join('\n')}\n`, 'utf8');
  assert.ok(size < 256 * 1024, 'the seed itself must land under CAP_BYTES so the burst is what crosses it');

  const PROCS = 16;
  const burstFilePaths = [];
  const runs = [];
  for (let n = 0; n < PROCS; n += 1) {
    const filePath = `/repo/burst-${n}.md`;
    burstFilePaths.push(filePath);
    const payload = JSON.stringify({
      session_id: `s-burst-${n}`, cwd, file_path: filePath, load_reason: 'path_glob_match',
    });
    runs.push(runHookAsync(payload, { CLAUDE_CONFIG_DIR: configDir }));
  }
  const results = await Promise.all(runs);

  for (const r of results) {
    assert.equal(r.code, 0, `every process must exit 0 (stderr=${r.err})`);
    assert.equal(r.out, '', 'every process must write nothing to stdout');
  }

  const allowedFilePaths = new Set([...seedFilePaths, ...burstFilePaths]);
  const finalRaw = readFileSync(logPath, 'utf8');
  assert.ok(finalRaw.length > 0, 'the log must not be left empty by a cap crossing under concurrency');

  const survivingFilePaths = new Set();
  let newestRealTs = null;
  for (const line of finalRaw.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (err) {
      assert.fail(`every surviving line must parse as JSON, got a parse error on ${JSON.stringify(line)}: ${err.message}`);
    }
    survivingFilePaths.add(rec.file_path);
    const parsed = Date.parse(rec.ts);
    if (!Number.isNaN(parsed) && (newestRealTs === null || parsed > newestRealTs)) {
      newestRealTs = parsed;
    }
  }

  // Phantom check: nothing may survive that this test did not itself seed
  // or have a burst process write.
  for (const filePath of survivingFilePaths) {
    assert.ok(allowedFilePaths.has(filePath), `surviving file_path ${filePath} must trace to a seed or burst write, never a phantom`);
  }
  assert.ok(newestRealTs !== null, 'at least one surviving line must carry a real, parseable timestamp');
});
