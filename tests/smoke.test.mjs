import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
test('plugin manifest is valid JSON with the plugin name', () => {
  const m = JSON.parse(readFileSync(new URL('../plugins/house/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(m.name, 'house-rules');
});
test('hooks.json uses the plugin wrapper format', () => {
  const h = JSON.parse(readFileSync(new URL('../plugins/house/hooks/hooks.json', import.meta.url), 'utf8'));
  assert.ok(h.hooks && Array.isArray(h.hooks.PreToolUse));
});

// #26: the rule-load positive control depends on the plugin actually
// shipping this hook; a hooks.json that lost the block would silently
// degrade `house doctor`'s "plugin" case back to "none wired".
test('hooks.json declares a non-empty InstructionsLoaded array', () => {
  const h = JSON.parse(readFileSync(new URL('../plugins/house/hooks/hooks.json', import.meta.url), 'utf8'));
  assert.ok(h.hooks && Array.isArray(h.hooks.InstructionsLoaded) && h.hooks.InstructionsLoaded.length > 0);
});

// #58: the PreToolUse guard now also reads Edit/Write/MultiEdit/NotebookEdit payloads, since
// writing a floor file directly is the same disable the Bash text scan refuses.
// A matcher that lost those tool names would leave that door open silently.
test('#58 hooks.json: the PreToolUse matcher covers Bash and the file-writing tools', () => {
  const h = JSON.parse(readFileSync(new URL('../plugins/house/hooks/hooks.json', import.meta.url), 'utf8'));
  const entry = h.hooks.PreToolUse.find((e) => (e.hooks || []).some((x) => String(x.command || '').includes('no-direct-master.sh')));
  assert.ok(entry, 'no PreToolUse entry runs no-direct-master.sh');
  // Unanchored, as the harness tests a matcher.
  const matcher = new RegExp(entry.matcher);
  for (const tool of ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    assert.ok(matcher.test(tool), `the PreToolUse matcher does not cover ${tool}: ${entry.matcher}`);
  }
});

// MCP tools have no standard path field and neither path deny rules nor the
// sandbox cover them, so the docs route an MCP write through a PreToolUse hook
// matched on the tool name. The harness tests a matcher unanchored, so a verb
// regex there is no boundary: every MCP tool reaches the hook, and the script
// decides write-likeness from the name, in any case.
test('hooks.json: every MCP tool reaches the guard, and the script decides the write verbs in any case', () => {
  const h = JSON.parse(readFileSync(new URL('../plugins/house/hooks/hooks.json', import.meta.url), 'utf8'));
  const entry = h.hooks.PreToolUse.find((e) => (e.hooks || []).some((x) => String(x.command || '').includes('no-direct-master.sh')));
  const matcher = new RegExp(entry.matcher);
  const writes = ['mcp__fs__Write_file', 'mcp__fs__copy_file', 'mcp__serena__replace_symbol_body'];
  for (const tool of [...writes, 'mcp__fs__read_file']) {
    assert.ok(matcher.test(tool), `the PreToolUse matcher does not reach ${tool}: ${entry.matcher}`);
  }
  const hook = fileURLToPath(new URL('../plugins/house/hooks/no-direct-master.sh', import.meta.url));
  const repo = mkdtempSync(join(tmpdir(), 'mcp-matcher-'));
  try {
    execFileSync('git', ['init', '-q', repo]);
    writeFileSync(join(repo, 'house.json'), '{}\n');
    const decide = (tool) => {
      const payload = JSON.stringify({ tool_name: tool, tool_input: { path: join(repo, '.githooks', 'pre-push') },
        cwd: repo, hook_event_name: 'PreToolUse' });
      const out = execFileSync('bash', [hook], { input: payload, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
      return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow';
    };
    for (const tool of writes) assert.equal(decide(tool), 'deny', `${tool} was not decided as a write`);
    assert.equal(decide('mcp__fs__read_file'), 'allow', 'a read-only MCP tool name was decided as a write');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// #58: core.hooksPath is machine state no clone, no render and no PR carries,
// so the vendored git-hook floor is inert in a fresh checkout until something
// arms it. SessionStart is the once-per-session moment that does; a hooks.json
// that lost the entry would leave new clones unguarded with nothing saying so.
test('#58 hooks.json declares a SessionStart entry that runs the arming script', () => {
  const h = JSON.parse(readFileSync(new URL('../plugins/house/hooks/hooks.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(h.hooks.SessionStart) && h.hooks.SessionStart.length > 0, 'no SessionStart array');
  const commands = h.hooks.SessionStart.flatMap((e) => (e.hooks || []).map((x) => String(x.command || '')));
  assert.ok(commands.some((c) => c.includes('arm-git-hooks.sh')), `SessionStart does not run the arming script: ${JSON.stringify(commands)}`);
});

// The same file `house render --apply` and `house doctor` shell out to, so a
// rename or a delete breaks three callers at once.
test('#58 the arming script the hooks and the CLI both name is shipped', () => {
  const p = new URL('../plugins/house/hooks/arm-git-hooks.sh', import.meta.url);
  assert.match(readFileSync(p, 'utf8'), /^#!\/usr\/bin\/env bash/);
});

// v0.3.0 ship-set invariant: the vendored checker must be byte-identical to
// the payload and match the lock's recorded hash. Until now this was a human
// checklist step (cmp + shasum); a payload edit without a render left tamper
// green because it compares vendored-vs-lock, which go stale together. This
// goes red on exactly that state and names the missing step.
test('the vendored checker is byte-identical to the payload and matches the lock', async () => {
  const { createHash } = await import('node:crypto');
  const payload = readFileSync(new URL('../plugins/house/payload/check.mjs', import.meta.url), 'utf8');
  const vendored = readFileSync(new URL('../.house/check.mjs', import.meta.url), 'utf8');
  assert.equal(vendored, payload, 'payload and .house/check.mjs differ: run `node plugins/house/scripts/house render --apply --repo .` to re-vendor');
  const lock = JSON.parse(readFileSync(new URL('../.house/lock.json', import.meta.url), 'utf8'));
  const entry = (lock.files || lock).find((e) => e.path === '.house/check.mjs');
  assert.ok(entry, '.house/lock.json records no .house/check.mjs entry');
  assert.equal(entry.bodySha256, createHash('sha256').update(payload, 'utf8').digest('hex'),
    'the lock hash for .house/check.mjs does not match the payload: re-render');
});
