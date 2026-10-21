import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run } from './helpers.mjs';

// `git ls-files -z` past execFileSync's default 1 MiB buffer used to throw
// ENOBUFS, which gitLsFilesZ swallowed into an empty list: a clean result the
// checker had not earned.
test('big listing: a tracked file list over 1 MiB is still scanned', () => {
  const files = { '.claude/rules/x.md': '---\npaths:\n  - "nomatch*"\n---\n\nbody\n' };
  const prefix = `${'d'.repeat(200)}/`;
  for (let i = 0; i < 6000; i++) files[`${prefix}f${i}.txt`] = '';
  const dir = sandbox(files);
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\.claude\/rules\/x\.md/);
});
