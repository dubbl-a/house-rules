import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// #58: the PreToolUse guard now also reads Edit/Write/MultiEdit payloads, since
// writing a floor file directly is the same disable the Bash text scan refuses.
// A matcher that lost those tool names would leave that door open silently.
test('#58 hooks.json: the PreToolUse matcher covers Bash and the file-writing tools', () => {
  const h = JSON.parse(readFileSync(new URL('../plugins/house/hooks/hooks.json', import.meta.url), 'utf8'));
  const entry = h.hooks.PreToolUse.find((e) => (e.hooks || []).some((x) => String(x.command || '').includes('no-direct-master.sh')));
  assert.ok(entry, 'no PreToolUse entry runs no-direct-master.sh');
  const names = String(entry.matcher).split('|');
  for (const tool of ['Bash', 'Edit', 'Write', 'MultiEdit']) {
    assert.ok(names.includes(tool), `the PreToolUse matcher does not cover ${tool}: ${entry.matcher}`);
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
