import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFacts, renderBlock, splice, CHECK } from '../scripts/gen-module-facts.mjs';

// The checker carries package-wide module facts so a hand edit to the lock's
// `modules` record cannot change a verdict (#258). Like the template pins, the
// embedded copy is pinned to its source: edit a module.json and this fails
// until `node scripts/gen-module-facts.mjs` regenerates the block.
test('MODULE_FACTS in check.mjs matches what the module.json files produce', () => {
  const src = readFileSync(CHECK, 'utf8');
  assert.equal(splice(src, renderBlock()), src, 'stale: run node scripts/gen-module-facts.mjs');
});

test('MODULE_FACTS covers every shipped module, keyed by module.json name', () => {
  const dirs = readdirSync(new URL('../plugins/house/modules/', import.meta.url), { withFileTypes: true }).filter((e) => e.isDirectory());
  const facts = buildFacts();
  assert.equal(Object.keys(facts).length, dirs.length);
  assert.equal(facts.testing.rules.length, 1);
  assert.equal(facts.security.default, 'off');
  assert.equal(facts.security.rules.length, 2);
  assert.ok(facts.testing.slots.testRoots.includes('tests/**'));
});

test('the generator keys a module by its module.json name and skips a rule entry with no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-facts-'));
  mkdirSync(join(dir, 'branching'));
  writeFileSync(join(dir, 'branching', 'module.json'), JSON.stringify({ name: 'git-workflow', rules: ['rules/a.md', { paths: ['x'] }, { file: 'rules/b.md', paths: ['y/**'] }], defaultPaths: ['$s'], configSlots: ['s'] }));
  const f = buildFacts(dir);
  assert.deepEqual(Object.keys(f), ['git-workflow']);
  assert.equal(f['git-workflow'].default, 'on');
  assert.deepEqual(f['git-workflow'].rules, [{ file: 'a.md', paths: ['$s'] }, { file: 'b.md', paths: ['y/**'] }]);
});
