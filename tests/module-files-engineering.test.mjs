// Tests for the vendored engineering module file under plugins/house/modules/
// (engineering/is-main.mjs).
//
// These are the literal files a consuming repo gets copied into
// scripts/house/** by `house render` (module.json's files[] entries) — they
// are tested here directly at their files/ source path, not through the
// render pipeline (that's tests/cli-house.test.mjs's job). One file per
// module; the helpers they share are in module-files-helpers.mjs.
//
// Every sandbox is a throwaway dir under the OS tmpdir. No network calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, mktemp } from './module-files-helpers.mjs';

const IS_MAIN = join(ROOT, 'plugins/house/modules/engineering/files/is-main.mjs');

// ===========================================================================
// engineering/is-main.mjs
// ===========================================================================

test('is-main: isMain is truthy when the caller is the process entry point, including under a spaced path', () => {
  const dir = mktemp('house-is-main-');
  const spaced = join(dir, 'a spaced dir');
  mkdirSync(spaced, { recursive: true });
  copyFileSync(IS_MAIN, join(spaced, 'is-main.mjs'));
  const entry = join(spaced, 'entry.mjs');
  writeFileSync(entry, "import { isMain } from './is-main.mjs';\nconsole.log(isMain(import.meta.url));\n");
  const out = execFileSync('node', [entry], { encoding: 'utf8' }).trim();
  assert.equal(out, 'true', 'a spaced path is the exact failure mode is-main.mjs exists to fix');
});

test('is-main: isMain is falsy when the caller was only imported, not run directly', () => {
  const dir = mktemp('house-is-main-');
  copyFileSync(IS_MAIN, join(dir, 'is-main.mjs'));
  writeFileSync(
    join(dir, 'lib.mjs'),
    "import { isMain } from './is-main.mjs';\nexport const result = isMain(import.meta.url);\n",
  );
  writeFileSync(join(dir, 'entry.mjs'), "import { result } from './lib.mjs';\nconsole.log(result);\n");
  const out = execFileSync('node', [join(dir, 'entry.mjs')], { encoding: 'utf8' }).trim();
  assert.equal(out, 'false');
});
