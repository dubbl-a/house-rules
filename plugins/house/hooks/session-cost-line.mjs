#!/usr/bin/env node
// UserPromptSubmit hook: say once, in one systemMessage line, when this
// session's main-thread cost is unusual for this repo or account.
//
// The baselines come from the weekly scan (<config dir>/house/cost-check.json,
// written by ../scripts/cost-report.mjs --state). Session cost is priced from
// transcript_path with the functions the report exports, so the price table and
// the dedupe have one home. Subagent cost is left out, as it is from the
// baseline.
//
// The line fires when session cost reaches the larger of the advisor limit and
// the baseline's p95: the project's when it has enough sessions, otherwise the
// account's, otherwise nothing. The p95 and session-count choices are justified
// beside MIN_BASELINE_SESSIONS in cost-report.mjs. It never blocks a prompt and
// never adds to the model's context.
//
// Native floor: /cost, /usage and the status line show what a session has spent
// when someone looks, but nothing native compares a session with this account's
// own history or speaks up unprompted; this hook does that, once per session.
//
// HOUSE_COST_ADVISOR=off disables it; HOUSE_COST_ADVISOR_USD sets the limit
// (default 5). Hooks of one event fire concurrently, so the once-per-session
// marker is created exclusively, and if it cannot be written the hook says
// nothing. Any error emits nothing and exits 0, so the prompt goes through.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const MARKER_DIR = join(tmpdir(), 'house-session-cost-line');

// The baseline to judge against, or null when there is none to trust. A project
// with enough sessions is used even when its p95 is unreadable, so a malformed
// entry is silence and never a quiet swap to a different scope.
function chooseBaseline(baselines, project, lib) {
  if (!baselines || typeof baselines !== 'object') return null;
  const enough = (b) => b && typeof b === 'object' && Number.isInteger(b.sessions) && b.sessions >= lib.MIN_BASELINE_SESSIONS;
  const own = baselines.projects && typeof baselines.projects === 'object' && Object.hasOwn(baselines.projects, project) ? baselines.projects[project] : null;
  const scope = enough(own) ? 'repo' : enough(baselines.account) ? 'account' : null;
  if (!scope) return null;
  const p95 = (scope === 'repo' ? own : baselines.account)[lib.BASELINE_PERCENTILE];
  return Number.isFinite(p95) && p95 >= 0 ? { scope, p95 } : null;
}

try {
  if (String(process.env.HOUSE_COST_ADVISOR || '').toLowerCase() !== 'off') {
    const { transcript_path: path, session_id: sessionId } = JSON.parse(readFileSync(0, 'utf8'));
    if (typeof path === 'string' && typeof sessionId === 'string') {
      const marker = join(MARKER_DIR, sessionId.replace(/[^A-Za-z0-9_-]/g, '_'));
      if (!existsSync(marker)) {
        const lib = await import('../scripts/cost-report.mjs');
        const cfgDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
        const state = JSON.parse(readFileSync(join(cfgDir, 'house', 'cost-check.json'), 'utf8'));
        const base = chooseBaseline(state && state.baselines, basename(dirname(path)), lib);
        if (base) {
          const line = Math.max(lib.advisorLimit().usd, base.p95);
          const usd = await lib.sessionMainUsd(path);
          if (usd > 0 && usd >= line) {
            mkdirSync(MARKER_DIR, { recursive: true });
            writeFileSync(marker, new Date().toISOString(), { flag: 'wx' });
            const systemMessage = `house: this session's main thread has cost about $${usd.toFixed(0)} at list price, unusual for this ${base.scope} (p95 of past sessions is $${base.p95.toFixed(0)}). ` +
              `Next: ${lib.NEXT_CLEAR} /house-rules:cost-advisor explains it. Silence with HOUSE_COST_ADVISOR=off.`;
            process.stdout.write(JSON.stringify({ systemMessage }) + '\n');
          }
        }
      }
    }
  }
} catch {
  // Advice only: a malformed payload, baseline or transcript, or a marker that
  // cannot be written, means saying nothing.
}
process.exit(0);
