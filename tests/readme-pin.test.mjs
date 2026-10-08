import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Nothing else moves the README's install pin when a release ships, so it
// would otherwise stay on whichever tag was current when it was last edited.
test('every release tag the README pins is the plugin version', () => {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'plugins/house/.claude-plugin/plugin.json'), 'utf8'));
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  // The command's pin, the prose that names it (`#vX.Y.Z`), and the move-a-pin
  // diff's base (`git diff vX.Y.Z..`) all name the current release.
  const tags = [
    ...[...readme.matchAll(/#v(\d+\.\d+\.\d+)/g)].map((m) => m[1]),
    ...[...readme.matchAll(/git diff v(\d+\.\d+\.\d+)\.\./g)].map((m) => m[1]),
  ];
  assert.ok(/dubbl-a\/house-rules#v\d+\.\d+\.\d+/.test(readme), 'README names no pinned dubbl-a/house-rules#vX.Y.Z');
  assert.ok(tags.length >= 3, `README pin sites shrank to ${tags.length}; update this test if that was intended`);
  for (const tag of tags) assert.equal(tag, version);
});
