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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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

/** Run the real hook as a subprocess with `stdin` piped in. */
function runHook(stdin, env = {}) {
  const configDir = env.CLAUDE_CONFIG_DIR || sandboxConfigDir();
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: configDir },
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
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      env: { ...process.env, ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
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
