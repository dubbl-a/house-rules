import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandbox, run } from './helpers.mjs';

// #271: render wrote each `paths:` glob bare, and a glob opening with a YAML
// indicator (`*.mjs`) is invalid YAML, so the harness loaded the rule
// unscoped. Render now writes JSON-quoted scalars; the checker reads quoted
// and plain items exactly and flags an item YAML would reject.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'plugins/house/scripts/house');
// Render arms the git-hook floor in the repo it renders into; an empty hooks
// directory keeps this file testing render's output, not the guards.
const EMPTY_HOOKS = mkdtempSync(join(tmpdir(), 'house-no-hooks-'));
const git = (cwd, ...a) => execFileSync('git', ['-c', `core.hooksPath=${EMPTY_HOOKS}`, ...a], { cwd, stdio: 'pipe' });
const house = (repo, ...a) => execFileSync('node', [CLI, ...a, '--repo', repo], { stdio: 'pipe' });

const rule = (items) => `---\npaths:\n${items.map((i) => `  - ${i}`).join('\n')}\n---\n# R\n`;
const driftOut = (files) => run(sandbox(files), ['--only=drift']);

test('render writes quoted globs, and the checker reads them back exactly', () => {
  const d = mkdtempSync(join(tmpdir(), 'house-yamlq-'));
  git(d, 'init', '-q'); git(d, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't');
  mkdirSync(join(d, 'scripts'), { recursive: true });
  writeFileSync(join(d, 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(d, 'q"x.md'), '# q\n');
  writeFileSync(join(d, 'scripts/b.mjs'), 'export const b = 1;\n');
  writeFileSync(join(d, 'README.md'), '# X\n');
  writeFileSync(join(d, 'CLAUDE.md'), '# X\n');
  git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'init');
  house(d, 'init', '--apply');
  const hj = JSON.parse(readFileSync(join(d, 'house.json'), 'utf8'));
  hj.modules.engineering.config.codeGlobs = ['*.mjs', 'q"x.md'];
  writeFileSync(join(d, 'house.json'), JSON.stringify(hj, null, 2));
  house(d, 'render', '--apply');
  const raw = readFileSync(join(d, '.claude/rules/house/engineering.md'), 'utf8');
  assert.match(raw, /^ {2}- "\*\.mjs"$/m);
  assert.match(raw, /^ {2}- "q\\"x\.md"$/m);
  // The checker reads the rendered file back to the same globs: no YAML
  // problem, and no drift between the vendored paths and the config.
  git(d, 'add', '-A');
  const res = spawnSync('node', [join(d, '.house/check.mjs'), '--only=drift,tamper'], { cwd: d, encoding: 'utf8' });
  assert.doesNotMatch(res.stdout, /paths frontmatter/, res.stdout);
  assert.match(res.stdout, /0 finding/, res.stdout);
});

test('a bare `- *.mjs` item is a finding naming the file and line', () => {
  const { code, out } = driftOut({
    'a.mjs': 'export const a = 1;\n',
    '.claude/rules/x.md': rule(['*.mjs']),
  });
  assert.equal(code, 1, out);
  assert.match(out, /\.claude\/rules\/x\.md:3/);
  assert.match(out, /paths frontmatter/);
  assert.match(out, /unscoped/);
  assert.match(out, /Re-render/);
});

test('a quoted indicator glob, a quoted glob with an escaped quote, and a single-quoted glob parse and match', () => {
  const { code, out } = driftOut({
    'a.mjs': 'export const a = 1;\n',
    'q"x.md': '# q\n',
    'b.txt': 'b\n',
    '.claude/rules/x.md': rule(['"*.mjs"', '"q\\"x.md"', "'b.txt'"]),
  });
  assert.equal(code, 0, out);
});

test('a plain glob with no indicator, written before this change, still parses', () => {
  const { code, out } = driftOut({
    'scripts/a.mjs': 'export const a = 1;\n',
    '.claude/rules/x.md': rule(['scripts/**']),
  });
  assert.equal(code, 0, out);
});

test('an unterminated double quote is a finding', () => {
  const { code, out } = driftOut({
    'a.mjs': 'export const a = 1;\n',
    '.claude/rules/x.md': rule(['"*.mjs']),
  });
  assert.equal(code, 1, out);
  assert.match(out, /unterminated double quote/);
});
