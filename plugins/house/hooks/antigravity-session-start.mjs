#!/usr/bin/env node
// SessionStart hook for Antigravity CLI (agy): arm the git-hook floor.
//
// plugins/house/hooks.json (the Antigravity dialect, distinct from
// hooks/hooks.json, which is Claude Code's) runs this once before the first
// model call, by `${extensionPath}/hooks/antigravity-session-start.mjs`:
// the Antigravity changelog (agy 1.0.7) says ${extensionPath} resolves to the
// final installation directory in plugins, and relative hook command paths have
// no documented base, so the command does not use one. Antigravity's SessionStart input is camelCase JSON with
// workspacePaths (an array) and no cwd, so this arms each workspace path with
// `arm-git-hooks.sh --repo <path>`, the same script the Claude Code hook and
// `house render --apply` use, resolved from this file's own location.
//
// Output is one JSON object, always. `{}` when there is nothing to say; else
// injectSteps carrying the script's lines as one ephemeralMessage (the
// documented output field for this event). Anything else on stdout would not be
// JSON, so nothing else is ever written there.
//
// Antigravity does not document the exit-code or timeout behavior of a hook, so
// this never exits non-zero, and every step is bounded: a few seconds per path
// and a total well under the 10 s timeout hooks.json sets. Bad or empty stdin,
// a missing bash, or a failing script emits `{}` and exits 0. The git-hook
// floor and the remote ruleset are the guarantee, not this hook.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARM_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'arm-git-hooks.sh');
const PER_PATH_MS = 3000;
const TOTAL_MS = 7000;
const MAX_PATHS = 8;
const MAX_MESSAGE_CHARS = 2000;

function workspacePaths() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const paths = input && Array.isArray(input.workspacePaths) ? input.workspacePaths : [];
  return paths.filter((p) => typeof p === 'string' && p !== '').slice(0, MAX_PATHS);
}

function armLines(repo, budgetMs) {
  const res = spawnSync('bash', [ARM_SCRIPT, '--repo', repo], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: Math.min(PER_PATH_MS, budgetMs),
  });
  if (res.error || typeof res.stdout !== 'string') return [];
  return res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

let out = {};
try {
  const started = Date.now();
  const lines = [];
  for (const repo of workspacePaths()) {
    const left = TOTAL_MS - (Date.now() - started);
    if (left <= 0) break;
    lines.push(...armLines(repo, left));
  }
  if (lines.length) out = { injectSteps: [{ ephemeralMessage: lines.join('\n').slice(0, MAX_MESSAGE_CHARS) }] };
} catch { /* a context hook never costs a session anything */ }
process.stdout.write(`${JSON.stringify(out)}\n`);
process.exit(0);
