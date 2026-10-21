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
// or model switches cost at least HOUSE_COST_CHECK_USD (default 10), once per
// result. HOUSE_COST_CHECK=off disables it. The scan takes seconds, so the
// hook never waits for it; a claim written first stops parallel sessions from
// each spawning one.
//
// A context hook must never cost a session anything: if the file is missing
// or unreadable, emit nothing and exit 0. Stdout is the only channel the
// harness reads, and only a JSON object is treated as hook output, so the
// text is carried under hookSpecificOutput.additionalContext (the field the
// docs require for Claude Code; a top-level additionalContext is ignored).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEEK_MS = 7 * 86400000;
const DEFAULT_THRESHOLD_USD = 10;

function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state) + '\n');
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
  const checkedAt = state ? Date.parse(state.checkedAt) : NaN;
  if (!Number.isFinite(checkedAt) || Date.now() - checkedAt >= WEEK_MS) {
    writeState(file, { checkedAt: new Date().toISOString() });
    const args = [script, '--since', '7d', '--state', file];
    if (process.env.HOUSE_COST_CHECK_PROJECTS_DIR) args.push('--dir', process.env.HOUSE_COST_CHECK_PROJECTS_DIR);
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return undefined;
  }
  const override = Number.parseFloat(process.env.HOUSE_COST_CHECK_USD);
  const threshold = Number.isFinite(override) && override >= 0 ? override : DEFAULT_THRESHOLD_USD;
  if (state.shownAt || !Number.isFinite(state.avoidableUsd) || !Number.isFinite(state.totalUsd) || state.avoidableUsd < threshold) return undefined;
  writeState(file, { ...state, shownAt: new Date().toISOString() });
  return `house: in the last 7 days, cache rebuilds after idle gaps or model switches cost about $${state.avoidableUsd.toFixed(0)} of $${state.totalUsd.toFixed(0)} at list price (${state.avoidableCount} rebuilds). ` +
    `Next: /session-report shows where; node "${script}" splits cost by model and cause. Silence with HOUSE_COST_CHECK=off.`;
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
