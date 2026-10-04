import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run } from './helpers.mjs';

// A claim naming a script the package lacks: the drift scan flags it unless a marker opts it out.
const PKG = { 'package.json': JSON.stringify({ name: 'x', scripts: { 'check:docs': 'echo hi' } }) };

// #160: a docs opt-out marker's reason runs to the marker's real end (`-->`),
// so an angle bracket in the reason is part of the reason and the marker
// still opts out. The plain forms (drift.test.mjs) stay accepted.
for (const reason of ['a > b', 'old -> new', 'a < b', 'trailing spaces   ']) {
  test(`markers: a file-level opt-out with reason ${JSON.stringify(reason)} opts the file out, no warning`, () => {
    const dir = sandbox({ 'README.md': `<!-- docs-drift-ignore-file: ${reason}-->\n\nRun \`check:unmapped\` before committing.\n`, ...PKG });
    const r = run(dir, ['--only=drift', '--json']);
    assert.equal(r.code, 0, r.out);
    assert.ok(!(r.json.warnings || []).some((w) => w.kind === 'ignore-file'), 'a reasoned opt-out must not warn');
  });
  test(`markers: a per-line ignore with reason ${JSON.stringify(reason)} skips the next claim`, () => {
    const dir = sandbox({ 'README.md': `<!-- docs-drift-ignore: ${reason}-->\nRun \`check:unmapped\` before committing.\n`, ...PKG });
    const r = run(dir, ['--only=drift']);
    assert.equal(r.code, 0, r.out);
  });
}

test('markers: a file-level opt-out with an empty reason still opts out and still warns', () => {
  const dir = sandbox({ 'README.md': '<!-- docs-drift-ignore-file:   -->\n\nRun `check:unmapped` before committing.\n', ...PKG });
  const r = run(dir, ['--only=drift', '--json']);
  assert.equal(r.code, 0, r.out);
  assert.ok((r.json.warnings || []).some((w) => w.kind === 'ignore-file' && /no reason/.test(w.message)));
});

test('markers: two markers on one line, the first reason holding an angle bracket, both read', () => {
  const dir = sandbox({ 'README.md': '<!-- docs-drift-ignore: a > b --> <!-- docs-drift-ignore: second -->\nRun `check:unmapped` before committing.\n', ...PKG });
  const r = run(dir, ['--only=drift']);
  assert.equal(r.code, 0, r.out);
});

test('markers: a marker with no closing --> opts nothing out and does not swallow the rest of the file', () => {
  const dir = sandbox({ 'README.md': 'Run `check:unmapped` before committing.\n<!-- docs-drift-ignore-file: never closed\n', ...PKG });
  const r = run(dir, ['--only=drift']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /check:unmapped/);
});
