#!/usr/bin/env node
// UserPromptSubmit hook: hold the first prompt after an idle gap that has
// likely expired the prompt cache, once, and say what sending it costs.
//
// resume-cost.mjs covers a resumed session; this covers one left open and
// returned to, where most idle rebuilds happen. The UserPromptSubmit input
// carries no timing or cost, so the hook reads the transcript's last main
// assistant entry: its timestamp gives the idle gap, its usage gives the
// context size, and its cache_creation split gives the cache lifetime (1 h
// when it wrote ephemeral_1h tokens, 5 min when it wrote ephemeral_5m). The
// transcript format is internal and written asynchronously, so anything
// unexpected means silence.
//
// The hold blocks the prompt once per idle gap: the block message shows the
// prompt text (hooks reference, "What a blocked prompt leaves behind"), and
// submitting it again goes through, because a state file in the temp dir
// records the assistant entry already held on. If that file cannot be
// written, the hook never blocks.
//
// It never holds a turn nobody typed. A background task's report, a message
// from another session or a plugin's injected prompt (<task-notification,
// <agent-message, <cross-session-message, "Another Claude session sent a
// message:", "[Plannotator") passes silently. Any other prompt that opens with
// a tag (`<` and a letter) or a bracketed label (`[`, a letter, text, `]`)
// looks machine-written and gets the text as a systemMessage instead of a
// hold. So does a scheduled or /loop prompt: the session counts as
// having scheduled work if its transcript has a scheduled_task_fire entry or
// a CronCreate or ScheduleWakeup call, or the project has a non-empty
// .claude/scheduled_tasks.json (durable tasks). Only the terminal client
// (entrypoint "cli", read from CLAUDE_CODE_ENTRYPOINT first, since `claude
// -p --continue` can follow an interactive transcript) is held; sdk,
// GitHub Action, remote and any other entrypoint only gets the warning. A prompt that starts with "/" is never held, since /clear is the
// cheap way out.
//
// Defaults a user can override from settings env or the shell:
// HOUSE_IDLE_CACHE_HOLD=off disables the hook, HOUSE_IDLE_CACHE_HOLD=warn
// warns without holding, HOUSE_IDLE_CACHE_HOLD_USD sets the dollar threshold
// (default 5, as resume-cost.mjs). HOUSE_IDLE_CACHE_HOLD_DEBUG=1 appends
// one line per hold, and per warning given in place of a hold because the
// prompt looked machine-written, to debug.log in the state dir (ISO time, the
// decision, the first 80 characters of the prompt); a log that cannot be
// written changes nothing.
//
// Any error emits nothing and exits 0, so the prompt goes through.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_THRESHOLD_USD = 5;
// Cache write list prices in USD per million tokens, [5 min, 1 h], from the
// platform.claude.com pricing page on 2026-10-20 (the same figures as
// research/token-cost/scripts/cost.py). A model matching no row gets no
// estimate and no message.
const WRITE_PRICE = {
  'claude-fable-5-1': [12.5, 20],
  'claude-fable-5': [12.5, 20],
  'claude-opus-5-5': [5, 8],
  'claude-opus-5': [6.25, 10],
  'claude-opus-4-8': [6.25, 10],
  'claude-sonnet-5-5': [2.5, 4],
  'claude-sonnet-5': [2.5, 4],
};
const TAIL_BYTES = [1 << 20, 8 << 20, 32 << 20];
const STATE_DIR = join(tmpdir(), 'house-idle-cache-hold');

function price(model) {
  if (typeof model !== 'string') return null;
  let best = null;
  for (const key of Object.keys(WRITE_PRICE)) {
    if ((model === key || model.startsWith(key + '-') || model.startsWith(key + '[')) && (!best || key.length > best.length)) best = key;
  }
  return best && WRITE_PRICE[best];
}

function idle(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round((seconds / 3600) * 10) / 10} h`;
}

function readTail(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // partial first line
    return { lines, whole: start === 0 };
  } finally {
    closeSync(fd);
  }
}

const tokens = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

// Cache lifetime in seconds from a response's cache writes, or null when it
// wrote none (a full cache hit). A response writing both counts as 1 h,
// which errs toward silence.
function lifetime(usage) {
  const cc = usage.cache_creation || {};
  if (tokens(cc.ephemeral_1h_input_tokens) > 0) return 3600;
  if (tokens(cc.ephemeral_5m_input_tokens) > 0) return 300;
  return null;
}

// The last main-conversation assistant entry with usage, whether a
// compaction came after it, and the cache lifetime from the newest response
// that wrote to the cache (the last one may have read everything). Returns
// null when the tail holds no response.
function lastResponse(path) {
  for (const bytes of TAIL_BYTES) {
    const { lines, whole } = readTail(path, bytes);
    let compactedAfter = false;
    let last = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      if (!last && (line.includes('"compact_boundary"') || line.includes('"isCompactSummary":true'))) compactedAfter = true;
      if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const m = entry && entry.message;
      if (entry.type !== 'assistant' || entry.isSidechain === true || !m || !m.usage || m.model === '<synthetic>') continue;
      if (!last) last = entry;
      const ttl = lifetime(m.usage);
      if (ttl) return { entry: last, compactedAfter, ttl };
    }
    if (last && whole) return { entry: last, compactedAfter, ttl: null };
    if (whole) return null;
  }
  return null;
}

// Checked entry by entry: every transcript also records the tool
// definitions (api-request-shape and prompt_snapshot entries), so a bare
// "ScheduleWakeup" string matches sessions that never scheduled anything.
const SCHEDULERS = new Set(['CronCreate', 'ScheduleWakeup']);
// Claude Code writes the durable-task file as {"tasks": [...]} and leaves
// {"tasks": []} behind when the last task goes, so only a non-empty list
// counts (the same test Claude Code applies).
function hasScheduledWork(path, projectDir) {
  if (typeof projectDir === 'string') {
    try {
      const saved = JSON.parse(readFileSync(join(projectDir, '.claude', 'scheduled_tasks.json'), 'utf8'));
      if (saved && Array.isArray(saved.tasks) && saved.tasks.length > 0) return true;
    } catch {}
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('"scheduled_task_fire"') && !line.includes('"CronCreate"') && !line.includes('"ScheduleWakeup"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry && entry.type === 'system' && entry.subtype === 'scheduled_task_fire') return true;
    const content = entry && entry.type === 'assistant' && entry.message && entry.message.content;
    if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_use' && SCHEDULERS.has(b.name))) return true;
  }
  return false;
}

const MACHINE_PREFIXES = ['<task-notification', 'Another Claude session sent a message:', '<agent-message', '<cross-session-message', '[Plannotator'];
function machinePrompt(prompt) {
  const p = prompt.trimStart();
  return MACHINE_PREFIXES.some((prefix) => p.startsWith(prefix));
}

// An unrecognised prompt that opens with a tag or a bracketed label is
// probably injected by a plugin or another session, not typed. `<3 thanks`,
// `[ ]` and `[1] item` are not letter-led and stay ordinary text.
function machineLooking(prompt) {
  const p = prompt.trimStart();
  return /^<[A-Za-z]/.test(p) || /^\[[A-Za-z][^\]]*\]/.test(p);
}

function debugLog(decision, prompt) {
  if (process.env.HOUSE_IDLE_CACHE_HOLD_DEBUG !== '1') return;
  try {
    const head = prompt.slice(0, 80).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(join(STATE_DIR, 'debug.log'), `${new Date().toISOString()} ${decision} ${head}\n`);
  } catch {}
}

try {
  const mode = String(process.env.HOUSE_IDLE_CACHE_HOLD || '').toLowerCase();
  if (mode !== 'off') {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const { prompt, transcript_path: path, session_id: sessionId, cwd } = input;
    if (typeof prompt === 'string' && typeof path === 'string' && typeof sessionId === 'string' && !prompt.trimStart().startsWith('/') && !machinePrompt(prompt)) {
      const found = lastResponse(path);
      if (found && !found.compactedAfter) {
        const { entry, ttl } = found;
        const u = entry.message.usage;
        const gap = (Date.now() - Date.parse(entry.timestamp)) / 1000;
        const rates = price(entry.message.model);
        const context = tokens(u.input_tokens) + tokens(u.cache_creation_input_tokens) + tokens(u.cache_read_input_tokens) + tokens(u.output_tokens);
        const override = Number.parseFloat(process.env.HOUSE_IDLE_CACHE_HOLD_USD);
        const threshold = Number.isFinite(override) && override >= 0 ? override : DEFAULT_THRESHOLD_USD;
        if (ttl && rates && Number.isFinite(gap) && gap > ttl && context > 0) {
          const usd = (context * rates[ttl === 3600 ? 1 : 0]) / 1e6;
          if (usd >= threshold) {
            const marker = String(entry.uuid || entry.timestamp);
            const stateFile = join(STATE_DIR, sessionId.replace(/[^A-Za-z0-9_-]/g, '_'));
            let held = null;
            try { held = readFileSync(stateFile, 'utf8'); } catch {}
            if (held !== marker) {
              const why = `the prompt cache has likely expired (last response ${idle(gap)} ago, cache lifetime ${ttl === 3600 ? '1 h' : '5 min'}). ` +
                `Sending this prompt rewrites about ${context.toLocaleString('en-US')} tokens of context into the cache, an estimated $${usd.toFixed(2)} at list price. ` +
                'If you do not need this history, /clear and start fresh from a handoff note in the repo; a /compact now would pay the same rewrite first. ';
              const tune = 'To change this, set HOUSE_IDLE_CACHE_HOLD=off or =warn, or raise HOUSE_IDLE_CACHE_HOLD_USD (default 5), in your shell or the env block of your settings.';
              const interactive = (process.env.CLAUDE_CODE_ENTRYPOINT || entry.entrypoint) === 'cli';
              let hold = mode !== 'warn' && interactive && !hasScheduledWork(path, process.env.CLAUDE_PROJECT_DIR || cwd);
              const looksMachine = hold && machineLooking(prompt);
              if (looksMachine) hold = false;
              if (hold) {
                try {
                  mkdirSync(STATE_DIR, { recursive: true });
                  writeFileSync(stateFile, marker);
                } catch {
                  hold = false;
                }
              }
              if (hold) {
                debugLog('hold', prompt);
                const reason = `house: held this prompt once, because ${why}` +
                  'To send it anyway, submit it again (its text is below); it goes through. ' + tune;
                process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
              } else {
                if (looksMachine) debugLog('warn-machine-looking', prompt);
                process.stdout.write(JSON.stringify({ systemMessage: `house: ${why}${tune}` }) + '\n');
              }
            }
          }
        }
      }
    }
  }
} catch {
  // Never block or noise a session over a malformed payload or transcript.
}
process.exit(0);
