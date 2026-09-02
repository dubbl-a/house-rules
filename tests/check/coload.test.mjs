import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run, houseJson } from './helpers.mjs';

function linesOf(n) {
  return Array.from({ length: n }, (_, i) => `Line ${i + 1}.`).join('\n') + '\n';
}
function rule(paths, bodyLines) {
  return `---\npaths:\n${paths.map((p) => `  - "${p}"`).join('\n')}\n---\n\n${linesOf(bodyLines)}`;
}

test('coload: a path matched by rules summing under the ceiling passes', () => {
  const dir = sandbox({
    'src/a.ts': 'export const x = 1;\n',
    '.claude/rules/house/one.md': rule(['src/**'], 100),
    '.claude/rules/house/two.md': rule(['src/**'], 100),
    'house.json': houseJson(),
  });
  const { code, out } = run(dir, ['--only=coload']);
  assert.equal(code, 0, out); // 200 <= default 400
});

test('coload: a path matched by rules summing over the ceiling is a finding', () => {
  const dir = sandbox({
    'src/a.ts': 'export const x = 1;\n',
    '.claude/rules/house/one.md': rule(['src/**'], 200),
    '.claude/rules/house/two.md': rule(['src/**'], 200),
    '.claude/rules/house/three.md': rule(['src/**'], 200),
    'house.json': houseJson(),
  });
  const { code, out } = run(dir, ['--only=coload']);
  assert.equal(code, 1, out); // 600 > default 400
  assert.match(out, /\[coload\]/);
  assert.match(out, /src\/a\.ts/);
});

test('coload: a path matched by no rule at all is never a finding', () => {
  const dir = sandbox({
    'other/file.ts': 'export const x = 1;\n',
    '.claude/rules/house/one.md': rule(['src/**'], 500),
    'house.json': houseJson(),
  });
  const { code } = run(dir, ['--only=coload']);
  assert.equal(code, 0);
});

test('coload: maxCoLoadLines is configurable', () => {
  const dir = sandbox({
    'src/a.ts': 'export const x = 1;\n',
    '.claude/rules/house/one.md': rule(['src/**'], 100),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { maxCoLoadLines: 50 } } } }),
  });
  const { code, out } = run(dir, ['--only=coload']);
  assert.equal(code, 1, out); // 100 > configured 50
});

test('coload: a bare filename glob matches at any depth', () => {
  const dir = sandbox({
    'brain/README.md': '# Brain\n',
    '.claude/rules/house/readme-rule.md': rule(['README.md'], 500),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { maxCoLoadLines: 100 } } } }),
  });
  const { code, out } = run(dir, ['--only=coload']);
  assert.equal(code, 1, out);
  assert.match(out, /brain\/README\.md/);
});

test('coload: --json reports coloadWorst even when the run passes', () => {
  const dir = sandbox({
    'src/a.ts': 'export const x = 1;\n',
    '.claude/rules/house/one.md': rule(['src/**'], 10),
    'house.json': houseJson(),
  });
  const { json } = run(dir, ['--only=coload', '--json']);
  assert.ok(json.coloadWorst);
  assert.equal(json.coloadWorst.path, 'src/a.ts');
});

// P12: the co-load sum must include the repo's OWN authored rules, and an
// always-on rule (no `paths:`) must count toward every path, not zero.
test('P12: an always-on repo rule counts toward every path (positive); scoping it removes that (negative)', () => {
  // positive control: a 500-line always-on non-house rule pushes an unrelated
  // tracked file over the default 400 ceiling.
  const dirOn = sandbox({
    'src/a.ts': 'export const x = 1;\n',
    '.claude/rules/big.md': linesOf(500), // no frontmatter -> always-on
    'house.json': houseJson(),
  });
  const on = run(dirOn, ['--only=coload']);
  assert.equal(on.code, 1, on.out);
  assert.match(on.out, /\[coload\]/);
  assert.match(on.out, /big\.md/);
  // negative control: the SAME 500-line rule, but scoped to docs/**, does not
  // inflate src/a.ts (no docs file exists, so nothing goes over).
  const dirOff = sandbox({
    'src/a.ts': 'export const x = 1;\n',
    '.claude/rules/big.md': rule(['docs/**'], 500),
    'house.json': houseJson(),
  });
  assert.equal(run(dirOff, ['--only=coload']).code, 0, 'a scoped rule must not inflate an unrelated path');
});

test('P12: a repo-authored non-house .claude/rules/*.md counts toward the co-load sum', () => {
  // A non-house authored rule (300) + a vendored house rule (300), both scoped
  // to src/**, sum over the ceiling. Before P12 only the house rule counted
  // (under the ceiling), hiding the real per-file load.
  const dir = sandbox({
    'src/a.ts': 'export const x = 1;\n',
    '.claude/rules/design.md': rule(['src/**'], 300),
    '.claude/rules/house/engineering.md': rule(['src/**'], 300),
    'house.json': houseJson(),
  });
  const { code, out } = run(dir, ['--only=coload']);
  assert.equal(code, 1, out);
  assert.match(out, /design\.md/);
  assert.match(out, /engineering\.md/);
});

// #19: only the single worst path was reported, so lowering a ceiling meant
// fixing one collision to discover the next. Each distinct over-budget rule
// set is now its own finding, with how many paths share it.
test('#19: each distinct over-budget rule set is one finding with its path count (positive); one set over many paths is one finding, not many (negative)', () => {
  const dir = sandbox({
    'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n', 'docs/x.md': '# x\n',
    '.claude/rules/house/one.md': rule(['src/**'], 300),
    '.claude/rules/house/two.md': rule(['src/**'], 200),
    '.claude/rules/house/three.md': rule(['docs/**'], 600),
    'house.json': houseJson(),
  });
  const { code, out } = run(dir, ['--only=coload']);
  assert.equal(code, 1, out);
  const lines = out.split('\n').filter((l) => /\[coload\]/.test(l));
  assert.equal(lines.length, 2, `two rule sets, two findings:\n${out}`);
  const srcLine = lines.find((l) => /one\.md/.test(l));
  assert.match(srcLine, /2 path\(s\)/, 'src/a.ts and src/b.ts share one rule set');
  assert.match(srcLine, /two\.md/);
  const docLine = lines.find((l) => /three\.md/.test(l));
  assert.match(docLine, /docs\/x\.md/);
  assert.match(docLine, /1 path\(s\)/);
  assert.match(out, /coload-ceiling/, 'the finding names the resolution order and the deviation kind');
  // --json keeps the single-worst shape callers already read.
  const { json } = run(dir, ['--only=coload', '--json']);
  assert.equal(json.coloadWorst.path, 'docs/x.md', 'the 600-line docs rule set is the single worst');
  assert.ok(json.coloadWorst.sum >= 600, `sum ${json.coloadWorst.sum}`);
  assert.ok(Array.isArray(json.coloadWorst.rules));
});
