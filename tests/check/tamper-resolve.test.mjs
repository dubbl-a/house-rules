import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandbox, run, houseJson, CHECK_SRC } from './helpers.mjs';

// #165: a lock entry is read through the filesystem, so the tamper family
// resolves it (symlinks included) and refuses one that lands outside the repo
// or inside .git, instead of comparing path text alone.

const HEADER = '<!-- house:managed module=git-workflow source=modules/git-workflow/rules/branching.md -->';
const BODY = `${HEADER}\nBranch + PR for every change.\n`;
const hash = (body) => createHash('sha256').update(body.split('\n').slice(1).join('\n'), 'utf8').digest('hex');
const lockFor = (path, body = BODY) => JSON.stringify({ files: [{ path, module: 'git-workflow', source: 'modules/git-workflow/rules/branching.md', bodySha256: hash(body) }] });
const repoWith = (path, extra = {}) => sandbox({ 'house.json': houseJson(), '.house/lock.json': lockFor(path), ...extra });
const tamper = (dir) => run(dir, ['--only=tamper']);

test('tamper-resolve: an entry through a symlinked directory pointing outside the repo is a finding, hash correct', () => {
  const outside = mkdtempSync(join(tmpdir(), 'house-outside-'));
  writeFileSync(join(outside, 'f.txt'), BODY);
  const dir = repoWith('linkdir/f.txt');
  symlinkSync(outside, join(dir, 'linkdir'));
  const { code, out } = tamper(dir);
  assert.equal(code, 1, out);
  assert.match(out, /== tamper ==/);
  assert.match(out, /linkdir\/f\.txt/);
  assert.match(out, /resolves outside the repo root/);
});

test('tamper-resolve: an entry under .git/ is a finding', () => {
  const { code, out } = tamper(repoWith('.git/hooks/pre-commit'));
  assert.equal(code, 1, out);
  assert.match(out, /\.git\/hooks\/pre-commit/);
  assert.match(out, /inside \.git/);
});

// `.GIT` is refused on every filesystem: the segment test folds case. On this
// machine's case-insensitive filesystem it IS .git; on a case-sensitive one it
// is a directory nobody has, and the fold flags it anyway (a false refusal,
// the safe side). Either way: a tamper finding naming the entry.
test('tamper-resolve: an entry under .GIT/ is a finding on a case-insensitive and a case-sensitive filesystem', () => {
  const { code, out } = tamper(repoWith('.GIT/hooks/pre-commit'));
  assert.equal(code, 1, out);
  assert.match(out, /\.GIT\/hooks\/pre-commit/);
  assert.match(out, /inside \.git/);
});

test('tamper-resolve: an absolute lock path is a finding that names it, not a silent path inside the repo', () => {
  const { code, out } = tamper(repoWith('/etc/house-forged.md'));
  assert.equal(code, 1, out);
  assert.match(out, /\/etc\/house-forged\.md/);
  assert.match(out, /absolute path/);
});

test('tamper-resolve: ../x stays a finding', () => {
  const { code, out } = tamper(repoWith('../x'));
  assert.equal(code, 1, out);
  assert.match(out, /escapes the repo root/);
});

test('tamper-resolve: a symlinked directory inside the repo pointing inside the repo is clean', () => {
  const dir = repoWith('linkdir/f.txt', { 'real/f.txt': BODY });
  symlinkSync(join(dir, 'real'), join(dir, 'linkdir'));
  const { code, out } = tamper(dir);
  assert.equal(code, 0, out);
});

test('tamper-resolve: a repo reached through a symlinked path is not falsely flagged', () => {
  const dir = repoWith('rules/f.txt', { 'rules/f.txt': BODY });
  const holder = mkdtempSync(join(tmpdir(), 'house-via-'));
  const alias = join(holder, 'alias');
  symlinkSync(realpathSync(dir), alias);
  const { code, out } = run(alias, ['--only=tamper']);
  assert.equal(code, 0, out);
});

// Unit level, no filesystem: the shipped comparison text run with `/` as sep.
test('tamper-resolve: the root comparison is exact and by segment (case-different and prefix siblings are outside)', () => {
  const src = readFileSync(CHECK_SRC, 'utf8');
  const text = src.match(/function resolvedIsInside\(realRoot, real\) \{[\s\S]*?\n\}\n/)[0];
  const inside = new Function('sep', `${text}\nreturn resolvedIsInside;`)('/');
  assert.equal(inside('/work/Proj', '/work/Proj/a/b'), true);
  assert.equal(inside('/work/Proj', '/work/proj/a/b'), false, 'a case-different sibling is outside');
  assert.equal(inside('/work/Proj', '/work/Proj-x/a'), false, 'a prefix sibling is outside');
  assert.equal(inside('/work/Proj', '/work/Proj'), false, 'the root itself is not inside');
  assert.equal(inside('/work/Proj/', '/work/Proj/a'), true);
});
