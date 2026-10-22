import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude Code matches a rule's `paths:` globs relative to the directory that
// holds `.claude/`, so the testing module's default has to reach a nested test
// directory and a co-located test file as well as a top-level `tests/`. These
// run the real CLI into a throwaway repo holding ONE test-shaped file, so the
// package's own matcher (render drops a glob that matches no tracked file, and
// skips a rule left with none) decides whether the rule loads for that path.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'plugins/house/scripts/house');
// render --apply arms the git-hook floor in the repo it renders into; point git
// at an empty hooks dir so the test exercises render's output, not the guard.
const NO_HOOKS_DIR = mkdtempSync(join(tmpdir(), 'house-no-hooks-'));
const git = (cwd, ...a) => execFileSync('git', ['-c', `core.hooksPath=${NO_HOOKS_DIR}`, ...a], { cwd, stdio: 'pipe' });
const house = (repo, ...a) => execFileSync('node', [CLI, ...a, '--repo', repo], { stdio: 'pipe' }).toString();

function adopter(files) {
  const d = mkdtempSync(join(tmpdir(), 'house-testing-default-'));
  git(d, 'init', '-q'); git(d, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't');
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, dirname(p)), { recursive: true }); writeFileSync(join(d, p), c); }
  git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'init');
  house(d, 'init', '--apply');
  house(d, 'render', '--apply');
  git(d, 'add', '-A'); git(d, 'commit', '-q', '--allow-empty', '-m', 'render');
  return d;
}

const vendored = (d) => join(d, '.claude/rules/house/testing.md');

for (const path of [
  'tests/a.test.mjs',
  'city-meetings/tests/x.test.mjs',
  'secondarrow/tests/a.test.mjs',
  'src/lib/walk-logic.test.ts',
  'src/lib/walk-logic.spec.ts',
]) {
  test(`the default testing paths load the rule for ${path}, and the vendored checker has no finding`, () => {
    const d = adopter({ 'README.md': '# X\n', [path]: '// t\n' });
    assert.ok(existsSync(vendored(d)), `render vendored the testing rule for ${path}`);
    const fm = readFileSync(vendored(d), 'utf8').split('\n---\n')[0];
    assert.match(fm, /^ {2}- "\*\*\//m, `a default glob reaches ${path}:\n${fm}`);
    const cfg = mkdtempSync(join(tmpdir(), 'house-cfg-'));
    const r = spawnSync('node', ['.house/check.mjs', '--only=manifest', '--json'], { cwd: d, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
    const { findings, warnings } = JSON.parse(r.stdout);
    assert.deepEqual([...findings, ...warnings].filter((f) => /testing/.test(f.message)), []);
  });
}

test('negative control: a repo with no test-shaped file does not load the testing rule', () => {
  const d = adopter({ 'README.md': '# X\n', 'docs/notes.md': '# n\n', 'src/lib/walk-logic.ts': '// code\n' });
  assert.ok(!existsSync(vendored(d)), 'no default glob matches, so the rule is not written');
});

test('an adopter that sets testRoots keeps its own value, not the new default', () => {
  const d = adopter({ 'README.md': '# X\n', 'spec/a.mjs': '// s\n', 'tests/a.test.mjs': '// t\n' });
  const hj = JSON.parse(readFileSync(join(d, 'house.json'), 'utf8'));
  hj.modules.testing.config.testRoots = ['spec/**'];
  writeFileSync(join(d, 'house.json'), `${JSON.stringify(hj, null, 2)}\n`);
  git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'pin testRoots');
  house(d, 'render', '--apply');
  const fm = readFileSync(vendored(d), 'utf8').split('\n---\n')[0];
  assert.match(fm, /^ {2}- "spec\/\*\*"$/m);
  assert.doesNotMatch(fm, /\*\*\/tests\/\*\*/);
});
