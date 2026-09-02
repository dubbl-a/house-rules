import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run } from './helpers.mjs';

test('todo: a TODO: line in CLAUDE.md is a finding', () => {
  const dir = sandbox({ 'CLAUDE.md': '# Repo\n\nTODO: fix the thing later.\n' });
  const { code, out } = run(dir, ['--only=todo']);
  assert.equal(code, 1);
  assert.match(out, /\[todo\]/);
  assert.match(out, /CLAUDE\.md:3/);
});

test('todo: CLAUDE.md with no TODO: passes', () => {
  const dir = sandbox({ 'CLAUDE.md': '# Repo\n\nAll done here.\n' });
  const { code } = run(dir, ['--only=todo']);
  assert.equal(code, 0);
});

test('todo: no CLAUDE.md at all is silently fine', () => {
  const dir = sandbox({ 'README.md': '# Hello\n' });
  const { code } = run(dir, ['--only=todo']);
  assert.equal(code, 0);
});

test('todo: a TODO: elsewhere (not CLAUDE.md) is not checked', () => {
  const dir = sandbox({ 'CLAUDE.md': '# Repo\n', 'README.md': 'TODO: not enforced here.\n' });
  const { code } = run(dir, ['--only=todo']);
  assert.equal(code, 0);
});
