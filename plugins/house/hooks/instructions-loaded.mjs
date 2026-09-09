#!/usr/bin/env node
// InstructionsLoaded hook: house's rule-load positive control (PA-003).
//
// Claude Code fires this event whenever it loads an instruction file into
// context: session start, a nested CLAUDE.md hit on traversal, a rules
// `paths:` glob match, an `@include`, or a context compaction, naming the
// file and the reason (`load_reason`: session_start, nested_traversal,
// path_glob_match, include, compact). This hook's only job is to append
// that fact to a per-repo log, so `house doctor` can report real evidence
// that a vendored rule's glob actually matched something, rather than
// leaving that to inference (a rule whose glob never matches looks exactly
// like a rule that does nothing).
//
// A logger must never cost a session anything: every step is wrapped in
// try/catch, nothing goes to stdout (that would be read as hook output),
// and the process always exits 0, malformed-input path included.
//
// Log path and its <key> mirror payload/check.mjs's memoryIndexPath:
// <CLAUDE_CONFIG_DIR or ~/.claude>/house/instructions-loaded/<key>.jsonl,
// where <key> is CLAUDE_CODE_PROJECT_DIR_NAME when it rides beside
// CLAUDE_CONFIG_DIR, else this payload's own `cwd` with every "/" turned
// into "-". `house doctor` derives the same key from the resolved repo
// root instead, since that is all doctor ever has.
import {
  readFileSync, appendFileSync, writeFileSync, mkdirSync, statSync, renameSync, unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// A line past this, the file rewrites itself down to roughly its last half
// rather than growing without bound: this log is evidence for doctor to
// read back, not an audit trail worth keeping forever. Appends are
// concurrency-safe (appendLine below); the rewrite this triggers is the one
// remaining window where a concurrent event can be lost, see trimIfOversized.
const CAP_BYTES = 256 * 1024;

function logPathFor(cwd) {
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
  const key = (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CODE_PROJECT_DIR_NAME) || cwd.replace(/\//g, '-');
  return path.join(cfgDir, 'house', 'instructions-loaded', `${key}.jsonl`);
}

// One small O_APPEND write per event. Each hook process opens its own file
// descriptor, but O_APPEND makes the seek-to-EOF and the write a single
// atomic step against every other writer to the same file, so two hook
// processes racing here each land their whole line, never an interleaved
// half of one.
function appendLine(logPath, line) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${line}\n`, 'utf8');
}

// Runs only when the file has actually grown past CAP_BYTES, so the
// whole-file rewrite this does is rare rather than once per event. Reads the
// log, halves it, and writes the result to a temp file beside the log (same
// directory, so the rename below is on the same filesystem and atomic)
// before renameSync over the original, so no reader ever observes a
// half-written file.
//
// Fail direction: every appendLine that lands between this function's
// readFileSync and its renameSync is lost, so a burst of concurrent appends
// crossing the cap at once can drop several lines, not just one (a second
// process can also see size > CAP_BYTES and run its own trim, whose rename
// then clobbers every append written after its own read). The loss is
// confined to a cap crossing and is undercount-only: it can drop a load
// that happened, never fabricate one that did not.
function trimIfOversized(logPath) {
  let size;
  try { size = statSync(logPath).size; } catch { return; }
  if (size <= CAP_BYTES) return;

  const tmpPath = path.join(path.dirname(logPath), `.${path.basename(logPath)}.${process.pid}.tmp`);
  try {
    const content = readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    const trimmed = `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`;
    writeFileSync(tmpPath, trimmed, 'utf8');
    renameSync(tmpPath, logPath);
  } catch {
    // Best effort: leave the log as-is rather than risk losing it, and
    // clean up the temp file if the write got that far but the rename did not.
    try { unlinkSync(tmpPath); } catch { /* nothing to clean up */ }
  }
}

try {
  const raw = readFileSync(0, 'utf8');
  const payload = JSON.parse(raw);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)
    && typeof payload.cwd === 'string' && payload.cwd) {
    const record = {
      ts: new Date().toISOString(),
      file_path: typeof payload.file_path === 'string' ? payload.file_path : null,
      load_reason: typeof payload.load_reason === 'string' ? payload.load_reason : null,
      session_id: typeof payload.session_id === 'string' ? payload.session_id : null,
    };
    const logPath = logPathFor(payload.cwd);
    appendLine(logPath, JSON.stringify(record));
    trimIfOversized(logPath);
  }
} catch { /* malformed stdin, unwritable log, anything: never block the session */ }

process.exit(0);
