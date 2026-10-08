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
  const tags = [...readme.matchAll(/dubbl-a\/house-rules#v(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  assert.ok(tags.length > 0, 'README names no pinned dubbl-a/house-rules#vX.Y.Z');
  for (const tag of tags) assert.equal(tag, version);
});
