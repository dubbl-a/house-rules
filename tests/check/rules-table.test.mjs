import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run, houseJson } from './helpers.mjs';

// #277: the CLAUDE.md domain-rules table copies each rule file's globs by hand.
const rule = (...globs) => `---\npaths:\n${globs.map((g) => `  - "${g}"`).join('\n')}\n---\n\n# Rule\n`;
const table = (cell) => `# Repo\n\n| File | Loads when working in | Covers |\n| --- | --- | --- |\n| \`.claude/rules/house/docs.md\` | ${cell} | docs |\n`;
const fixture = (cell, ...globs) => sandbox({
  'CLAUDE.md': table(cell),
  '.claude/rules/house/docs.md': rule(...globs),
  'README.md': 'x\n',
  'docs/a.md': 'x\n',
  'house.json': houseJson({}),
});
// A crash prints no JSON, so every caller, the negative ones included, fails on it.
const tableFindings = (dir) => {
  const { json, out } = run(dir, ['--only=drift', '--json']);
  assert.notEqual(json, null, `checker output did not parse: ${out}`);
  return json.findings.filter((f) => f.kind === 'rules table');
};

test('rules table: a row matching the rule file paths is clean', () => {
  const dir = fixture('`docs/**`, `README.md`', 'README.md', 'docs/**');
  assert.equal(tableFindings(dir).length, 0);
});

test('rules table: a glob the rule file gained is one finding naming it', () => {
  const dir = fixture('`docs/**`', 'README.md', 'docs/**');
  const f = tableFindings(dir);
  assert.equal(f.length, 1);
  assert.equal(f[0].path, 'CLAUDE.md');
  assert.match(f[0].message, /missing `README\.md`/);
});

test('rules table: a glob the rule file lost is one finding naming it', () => {
  const dir = fixture('`docs/**`, `old/**`', 'docs/**');
  const f = tableFindings(dir);
  assert.equal(f.length, 1);
  assert.match(f[0].message, /lists `old\/\*\*`/);
});

test('rules table: a repo-authored rule row is not compared', () => {
  const dir = sandbox({
    'CLAUDE.md': table('`docs/**`').replace('rules/house/docs.md', 'rules/mine.md'),
    '.claude/rules/mine.md': rule('README.md', 'docs/**'),
    'README.md': 'x\n',
    'docs/a.md': 'x\n',
    'house.json': houseJson({}),
  });
  assert.equal(tableFindings(dir).length, 0);
});

test('rules table: a stale row inside a code fence or an HTML comment is not live', () => {
  const stale = '| `.claude/rules/house/docs.md` | `old/**` | docs |';
  const dir = sandbox({
    'CLAUDE.md': `# Repo\n\n\`\`\`\n${stale}\n\`\`\`\n\n<!-- example:\n${stale}\n-->\n\n<!-- ${stale} -->\n`,
    '.claude/rules/house/docs.md': rule('README.md', 'docs/**'),
    'README.md': 'x\n',
    'docs/a.md': 'x\n',
    'house.json': houseJson({}),
  });
  assert.equal(tableFindings(dir).length, 0);
});

test('rules table: a row naming a missing rule file is skipped', () => {
  const dir = sandbox({
    'CLAUDE.md': table('`docs/**`'),
    'docs/a.md': 'x\n',
    'house.json': houseJson({}),
  });
  assert.equal(tableFindings(dir).length, 0);
});
