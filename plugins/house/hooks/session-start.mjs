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
// a later startup shows one systemMessage line when rebuilds after idle gaps
// or model switches cost at least HOUSE_COST_CHECK_USD (default 10), or when
// the price premiums (fast mode, US-only inference, legacy models) total at
// least that, once per result; a premium line names the largest of the three.
// HOUSE_COST_CHECK=off disables it. The scan takes seconds, so the
// hook never waits for it. An exclusive lock file (cost-check.lock, stale after
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
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEEK_MS = 7 * 86400000;
const DEFAULT_THRESHOLD_USD = 10;
const LOCK_STALE_MS = 3600000;

function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state) + '\n');
}

// True for the one caller that creates the lock; a lock older than an hour is cleared first.
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
        unlinkSync(lock);
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
function costCheck(here) {
  if (String(process.env.HOUSE_COST_CHECK || '').toLowerCase() === 'off') return undefined;
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (!input || input.source !== 'startup') return undefined;
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const file = join(cfgDir, 'house', 'cost-check.json');
  const script = join(here, '..', 'scripts', 'cost-report.mjs');
  let state = null;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none or malformed: treat as no state */ }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) state = null;
  const override = Number.parseFloat(process.env.HOUSE_COST_CHECK_USD);
  const threshold = Number.isFinite(override) && override >= 0 ? override : DEFAULT_THRESHOLD_USD;
  let notice;
  const valid = state && !state.shownAt && Number.isFinite(state.totalUsd);
  const rebuildOver = valid && Number.isFinite(state.avoidableUsd) && state.avoidableUsd >= threshold;
  const prem = valid && state.premiums && typeof state.premiums === 'object' ? state.premiums : {};
  const premiumList = [['fast mode', prem.fastUsd], ['US-only inference', prem.usOnlyUsd], ['legacy models', prem.legacyModelUsd]]
    .map(([name, v]) => [name, Number.isFinite(v) ? v : 0]);
  // The factors overlap, so the notice uses the combined premium, not their sum.
  const premiumTotal = Number.isFinite(prem.totalUsd) ? prem.totalUsd : 0;
  const premiumOver = premiumTotal > 0 && premiumTotal >= threshold;
  if (rebuildOver || premiumOver) {
    state = { ...state, shownAt: new Date().toISOString() };
    writeState(file, state);
    const parts = ['house: in the last 7 days,'];
    if (rebuildOver) parts.push(`cache rebuilds after idle gaps or model switches cost about $${state.avoidableUsd.toFixed(0)} of $${state.totalUsd.toFixed(0)} at list price (${state.avoidableCount} rebuilds).`);
    if (premiumOver) {
      const [name, v] = premiumList.reduce((a, b) => (b[1] > a[1] ? b : a));
      parts.push(`${rebuildOver ? 'price premiums' : 'price premiums (fast mode, US-only inference, legacy models)'} added about $${premiumTotal.toFixed(0)}, mostly ${name} ($${v.toFixed(0)}).`);
    }
    parts.push(rebuildOver ? `Next: /session-report shows where; node "${script}" splits cost by model and cause. Silence with HOUSE_COST_CHECK=off.`
      : `Next: node "${script}" shows the split. Silence with HOUSE_COST_CHECK=off.`);
    notice = parts.join(' ');
  }
  // No claim is written at spawn: a scan that dies leaves no new checkedAt, and the
  // lock (stale after an hour) is what paces the retry.
  const lock = join(dirname(file), 'cost-check.lock');
  if (scanDue(file)) {
    // Test seam: widens the gap between the due check and the lock so a test can land a scan in it.
    const gap = Number.parseInt(process.env.HOUSE_COST_CHECK_LOCK_DELAY_MS, 10);
    if (gap > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, gap);
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
  const systemMessage = costCheck(here);
  if (systemMessage) out.systemMessage = systemMessage;
} catch {
  // The cost check is advice; any failure just skips it.
}
if (Object.keys(out).length > 0) process.stdout.write(JSON.stringify(out) + '\n');
process.exit(0);
