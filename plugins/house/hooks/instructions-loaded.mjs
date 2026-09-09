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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// A line past this, the file rewrites itself down to roughly its last half
// rather than growing without bound: this log is evidence for doctor to
// read back, not an audit trail worth keeping forever.
const CAP_BYTES = 256 * 1024;

function logPathFor(cwd) {
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
  const key = (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CODE_PROJECT_DIR_NAME) || cwd.replace(/\//g, '-');
  return path.join(cfgDir, 'house', 'instructions-loaded', `${key}.jsonl`);
}

function appendCapped(logPath, line) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  let existing = '';
  try { existing = readFileSync(logPath, 'utf8'); } catch { /* no log yet: start fresh */ }
  let content = `${existing}${line}\n`;
  if (Buffer.byteLength(content, 'utf8') > CAP_BYTES) {
    const lines = content.split('\n').filter((l) => l.length > 0);
    content = `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`;
  }
  writeFileSync(logPath, content, 'utf8');
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
    appendCapped(logPathFor(payload.cwd), JSON.stringify(record));
  }
} catch { /* malformed stdin, unwritable log, anything: never block the session */ }

process.exit(0);
