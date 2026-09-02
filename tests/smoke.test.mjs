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
