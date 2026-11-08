#!/usr/bin/env node
// SessionStart hook: inject the orchestration defaults into every session.
//
// The always-on text lives in ../orchestration/ORCHESTRATION.md, one copy in
// the plugin rather than a ~/.claude/CLAUDE.md the user has to keep in sync
// by hand. The roster it names ships in ../agents/. Together they are the
// house port of github.com/SirRuggie/claude-code-orchestration-kit, tracked
// by scripts/check-orchestration-kit-upstream.mjs in the package repo.
//
// On startup it also runs a weekly cost check: a detached scan
// (../scripts/cost-report.mjs) writes <config dir>/house/cost-check.json, and
// a later startup shows one systemMessage line, once per result, naming the
// top row of the advice table in cost-report.mjs (largest pattern at or over
// the limit) and, when the previous scan held that row, how it moved. The
// limit is HOUSE_COST_ADVISOR_USD, then HOUSE_COST_CHECK_USD, default 5.
// HOUSE_COST_ADVISOR=off or HOUSE_COST_CHECK=off disables it. The scan takes
// seconds, so the hook never waits for it. An exclusive lock file (cost-check.lock, stale after
// an hour, removed by the scan when it finishes) lets only one of several
// parallel sessions spawn it. The hook writes no claim at spawn, so a scan that
// dies without a result is retried at the first startup after the lock goes
// stale, while a finished result is due again a week after its checkedAt.
// A result not yet shown is shown before a rescan.
//
// A context hook must never cost a session anything: if the file is missing
// or unreadable, emit nothing and exit 0. Stdout is the only channel the
// harness reads, and only a JSON object is treated as hook output, so the
// text is carried under hookSpecificOutput.additionalContext (the field the
// docs require for Claude Code; a top-level additionalContext is ignored).
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync, unlinkSync, renameSync, linkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEEK_MS = 7 * 86400000;
const LOCK_STALE_MS = 3600000;
const isOff = (name) => String(process.env[name] || '').toLowerCase() === 'off';

// Same-directory temp file and rename, so a reader never sees a half-written state.
function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state) + '\n');
  renameSync(tmp, file);
}

// Test seam: sleeps for the milliseconds named by an env var (capped at 10 s) so a test can
// hold one hook between two steps while another runs.
function pause(name) {
  const ms = Math.min(Number.parseInt(process.env[name], 10), 10000);
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// True for the one caller that creates the lock. A lock older than an hour is moved aside
// under a unique name first, so only the caller whose rename succeeds clears it. If that
// rename caught a lock another hook had just created, it is linked back and this caller loses.
function takeLock(lock) {
  mkdirSync(dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
      try {
        if (Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) return false;
        pause('HOUSE_COST_CHECK_STALE_DELAY_MS');
        const aside = `${lock}.stale.${process.pid}.${Date.now()}`;
        renameSync(lock, aside);
        const fresh = Date.now() - statSync(aside).mtimeMs < LOCK_STALE_MS;
        if (fresh) {
          try { linkSync(aside, lock); } catch { /* a newer lock already stands */ }
        }
        unlinkSync(aside);
        if (fresh) return false;
      } catch { return false; }
    }
  }
  return false;
}

// True when the state file holds no usable checkedAt or the last scan is a week old.
function scanDue(file) {
  let state = null;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none or malformed: treat as no state */ }
  const checkedAt = state && typeof state === 'object' ? Date.parse(state.checkedAt) : NaN;
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt >= WEEK_MS;
}

// Returns the notice to show, or undefined; spawns the weekly scan when due.
async function costCheck(here) {
  if (isOff('HOUSE_COST_CHECK') || isOff('HOUSE_COST_ADVISOR')) return undefined;
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (!input || input.source !== 'startup') return undefined;
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const file = join(cfgDir, 'house', 'cost-check.json');
  const script = join(here, '..', 'scripts', 'cost-report.mjs');
  let state = null;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none or malformed: treat as no state */ }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) state = null;
  let notice;
  // Imported only when there is a result to show: the table is advice, so a
  // broken report module costs the notice and never the orchestration text.
  let lib = null;
  if (state && !state.shownAt && Number.isFinite(state.totalUsd)) {
    try { lib = await import('../scripts/cost-report.mjs'); } catch { /* no notice this time */ }
  }
  if (lib && lib.advise) {
    const limit = lib.advisorLimit({ notice: true }).usd;
    const [row] = lib.advise(state, limit);
    if (row) {
      state = { ...state, shownAt: new Date().toISOString() };
      writeState(file, state);
      const before = lib.advise(state.previous, limit).find((r) => r.id === row.id);
      const moved = before ? Math.round(row.usd - before.usd) : 0;
      const move = moved ? `, ${moved < 0 ? 'down' : 'up'} $${Math.abs(moved)} since last check` : '';
      notice = `house: in the last 7 days, ${row.text} cost about $${row.usd.toFixed(0)} at list price${move}. Next: ${row.next} /house-rules:cost-advisor explains it. Silence with HOUSE_COST_ADVISOR=off.`;
    }
  }
  // No claim is written at spawn: a scan that dies leaves no new checkedAt, and the
  // lock (stale after an hour) is what paces the retry.
  const lock = join(dirname(file), 'cost-check.lock');
  if (scanDue(file)) {
    // Test seam: widens the gap between the due check and the lock so a test can land a scan in it.
    pause('HOUSE_COST_CHECK_LOCK_DELAY_MS');
    if (!takeLock(lock)) return notice;
    // A scan that finished after the check above has written its result and freed the
    // lock, so the lock is ours but nothing is due: re-read before spawning a second scan.
    if (!scanDue(file)) {
      try { unlinkSync(lock); } catch { /* already gone */ }
      return notice;
    }
    const args = [script, '--since', '7d', '--state', file];
    if (process.env.HOUSE_COST_CHECK_PROJECTS_DIR) args.push('--dir', process.env.HOUSE_COST_CHECK_PROJECTS_DIR);
    // Test seam: lets a test count how many parallel hooks spawned a scan.
    if (process.env.HOUSE_COST_CHECK_SPAWN_LOG) appendFileSync(process.env.HOUSE_COST_CHECK_SPAWN_LOG, 'spawn\n');
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }
  return notice;
}

const out = {};
const here = dirname(fileURLToPath(import.meta.url));
try {
  const text = readFileSync(join(here, '..', 'orchestration', 'ORCHESTRATION.md'), 'utf8').trim();
  if (text.length > 0) {
    const additionalContext = '<house-orchestration>\n' + text + '\n</house-orchestration>';
    out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext };
  }
} catch {
  // Never block or noise a session over a missing file.
}
try {
  const systemMessage = await costCheck(here);
  if (systemMessage) out.systemMessage = systemMessage;
} catch {
  // The cost check is advice; any failure just skips it.
}
if (Object.keys(out).length > 0) process.stdout.write(JSON.stringify(out) + '\n');
process.exit(0);
