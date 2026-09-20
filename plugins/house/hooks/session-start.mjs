#!/usr/bin/env node
// SessionStart hook: inject the orchestration defaults into every session.
//
// The always-on text lives in ../orchestration/ORCHESTRATION.md, one copy in
// the plugin rather than a ~/.claude/CLAUDE.md the user has to keep in sync
// by hand. The roster it names ships in ../agents/. Together they are the
// house port of github.com/SirRuggie/claude-code-orchestration-kit, tracked
// by scripts/check-orchestration-kit-upstream.mjs in the package repo.
//
// A context hook must never cost a session anything: if the file is missing
// or unreadable, emit nothing and exit 0. Stdout is the only channel the
// harness reads, and only a JSON object is treated as hook output, so the
// text is carried under hookSpecificOutput.additionalContext (the field the
// docs require for Claude Code; a top-level additionalContext is ignored).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(join(here, '..', 'orchestration', 'ORCHESTRATION.md'), 'utf8').trim();
  if (text.length > 0) {
    const additionalContext = '<house-orchestration>\n' + text + '\n</house-orchestration>';
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }) + '\n');
  }
} catch {
  // Never block or noise a session over a missing file.
}
process.exit(0);
