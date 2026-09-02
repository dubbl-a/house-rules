import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run, houseJson } from './helpers.mjs';

// See manifest.test.mjs: the module-defaults sub-checks read the INSTALLED
// plugin when one is reachable, so any run that includes the manifest family
// must hide the real ~/.claude to be deterministic.
const NO_PLUGIN = { CLAUDE_CONFIG_DIR: '/definitely/does/not/exist' };

function rule(body) {
  return `---\npaths:\n  - "src/**"\n---\n\n${body}`;
}

/** A house.json carrying just the docs module's emDash slot under test. */
function emHouse(emDash) {
  return houseJson({ modules: { docs: { enabled: true, config: { emDash } } } });
}

/** The paths of the em dash findings in a --json run, sorted. */
function emPaths(json) {
  return json.findings.filter((f) => f.message === 'em dash character').map((f) => f.path).sort();
}

const GOOD_RULE = rule([
  '## Use branch and PR for every change',
  '',
  'Anchor: CONTRIBUTING.md#workflow',
  '',
  '## Never skip the checklist',
  '',
  "Anchor: none (because there is no code anchor for a purely social norm)",
  '',
  "## Don't",
  '',
  'Do not push to master.',
  '',
  'Anchor: none (because this section is a list of prohibitions)',
  '',
].join('\n'));

test('shape: a well-formed rule file passes', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    '.claude/rules/house/git.md': GOOD_RULE,
    'CONTRIBUTING.md': '# Contributing\n\n## Workflow\n\nBody.\n',
  });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 0, out);
});

// GOOD_RULE with one em dash added, so a rule-file hit is the only defect.
const DASHED_RULE = GOOD_RULE.replace('purely social norm', 'purely social norm — no code');
const DASHED_PUBLIC = {
  'README.md': '# R\n\nA README em dash — here.\n',
  'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\nA changelog em dash — here.\n',
  'docs/note.md': '# Note\n\nA docs em dash — here.\n',
  'notes/scratch.md': '# Scratch\n\nAn out-of-scope em dash — here.\n',
};

test('shape: an em dash in a rule file is a finding under mode `all`', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ mode: 'all' }),
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /em dash/);
});

test('shape: the default emDash scan covers README, CHANGELOG and docs, not rule files', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    ...DASHED_PUBLIC,
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const { code, out, json } = run(dir, ['--only=shape', '--json']);
  assert.equal(code, 1, out);
  assert.deepEqual(emPaths(json), ['CHANGELOG.md', 'README.md', 'docs/note.md']);
});

test('shape: the default emDash scan leaves an em dash in a rule file alone', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 0, out);
});

test('shape: mode `all` adds the rule files to the public set and reports each file once', () => {
  const wide = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ mode: 'all' }),
    'README.md': '# R\n\nA README em dash — here.\n',
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const wideRes = run(wide, ['--only=shape', '--json']);
  assert.equal(wideRes.code, 1, wideRes.out);
  assert.deepEqual(emPaths(wideRes.json), ['.claude/rules/house/git.md', 'README.md']);

  // A rule file that `paths` also matches is scanned once, not twice.
  const overlap = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ mode: 'all', paths: ['README.md', '.claude/rules/house/*.md'] }),
    'README.md': '# R\n\nA README em dash — here.\n',
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const overlapRes = run(overlap, ['--only=shape', '--json']);
  assert.equal(overlapRes.code, 1, overlapRes.out);
  assert.deepEqual(emPaths(overlapRes.json), ['.claude/rules/house/git.md', 'README.md']);
});

test('shape: mode `off` emits no em dash finding anywhere', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ mode: 'off' }),
    ...DASHED_PUBLIC,
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 0, out);
});

test('shape: an exclude entry drops a matched file from the em dash scan', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ exclude: [{ path: 'docs/sources/**', why: 'point-in-time research notes kept verbatim' }] }),
    'docs/keep.md': '# Keep\n\nA scanned em dash — here.\n',
    'docs/sources/survey.md': '# Survey\n\nAn excluded em dash — here.\n',
  });
  const { code, out, json } = run(dir, ['--only=shape', '--json']);
  assert.equal(code, 1, out);
  assert.deepEqual(emPaths(json), ['docs/keep.md']);
});

test('shape: exclude cannot drop a rule file from the em dash scan under mode `all`', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ mode: 'all', exclude: ['.claude/rules/house/**'] }),
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const { code, out, json } = run(dir, ['--only=shape', '--json']);
  assert.equal(code, 1, out);
  assert.deepEqual(emPaths(json), ['.claude/rules/house/git.md']);
});

test('shape: a malformed emDash mode falls back to the default public scan', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ mode: 'loud' }),
    'README.md': '# R\n\nA README em dash — here.\n',
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const { code, out, json } = run(dir, ['--only=shape', '--json']);
  assert.equal(code, 1, out);
  assert.deepEqual(emPaths(json), ['README.md']);
});

// The fallback is whole-field, not entry-by-entry: one bad entry restores the
// WHOLE default list rather than keeping the good entries beside it. That is a
// deliberate choice (a gate should fail toward the documented set, not toward
// a set nobody wrote), and it is the reason a repo whose `paths` is broader
// than the default loses the extra coverage until the typo is fixed. Pinned
// here so a later switch to entry-dropping cannot happen silently.
test('shape: one bad `paths` entry reverts the whole field to the default set, and says so', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ paths: ['README.md', 42] }),
    ...DASHED_PUBLIC,
  });
  const { code, out, json } = run(dir, ['--only=shape,manifest', '--json'], NO_PLUGIN);
  assert.equal(code, 1, out);
  // Not ['README.md']: the good entry does not survive on its own.
  assert.deepEqual(emPaths(json), ['CHANGELOG.md', 'README.md', 'docs/note.md']);
  const manifest = json.findings.filter((f) => f.family === 'manifest');
  assert.equal(manifest.length, 1, out);
  assert.match(manifest[0].message, /emDash\.paths must be an array/);
});

test("shape: mode `off` still runs the other shape checks (a missing `## Don't` is a finding)", () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': emHouse({ mode: 'off' }),
    '.claude/rules/house/git.md': rule('## Use branches\n\nAnchor: none (because a)\n'),
  });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /Don't/);
});

test('shape: a bare 20XX-XX date in rule prose is a finding', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    '.claude/rules/house/git.md': rule('## Use the 2026-08 policy\n\nAnchor: none (because dated)\n'),
  });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /date-like/);
});

test('shape: a percent in rule prose is a finding', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    '.claude/rules/house/git.md': rule('## Keep coverage high\n\n90% is the target.\n\nAnchor: none (because metric)\n'),
  });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /percent-like/);
});

test('shape: two headings normalizing to the same string is a finding', () => {
  const body = rule([
    '## Write the tests',
    '',
    'Anchor: none (because a)',
    '',
    '## Write tests',
    '',
    'Anchor: none (because b)',
    '',
    "## Don't",
    '',
    'Anchor: none (because c)',
    '',
  ].join('\n'));
  const dir = sandbox({ 'src/placeholder.ts': 'export const x = 1;\n', '.claude/rules/house/git.md': body });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /duplicates/);
});

test('shape: a missing `## Don\'t` section is a finding', () => {
  const body = rule('## Use branches\n\nAnchor: none (because a)\n');
  const dir = sandbox({ 'src/placeholder.ts': 'export const x = 1;\n', '.claude/rules/house/git.md': body });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /Don't/);
});

test('shape: a rule block with no Anchor: line is a finding', () => {
  const body = rule("## Use branches\n\nNo anchor line here.\n\n## Don't\n\nAnchor: none (because a)\n");
  const dir = sandbox({ 'src/placeholder.ts': 'export const x = 1;\n', '.claude/rules/house/git.md': body });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /has no `Anchor:` line/);
});

test('shape: `Anchor: none` without a (because ...) clause is a finding', () => {
  const body = rule("## Use branches\n\nAnchor: none\n\n## Don't\n\nAnchor: none (because a)\n");
  const dir = sandbox({ 'src/placeholder.ts': 'export const x = 1;\n', '.claude/rules/house/git.md': body });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /Anchor: none.*must read/);
});

test('shape: more than three `Anchor: none` entries in one file is a finding', () => {
  const body = rule([
    '## Use one', '', 'Anchor: none (because a)', '',
    '## Use two', '', 'Anchor: none (because b)', '',
    '## Use three', '', 'Anchor: none (because c)', '',
    '## Use four', '', 'Anchor: none (because d)', '',
    "## Don't", '', 'Anchor: none (because e)', '',
  ].join('\n'));
  const dir = sandbox({ 'src/placeholder.ts': 'export const x = 1;\n', '.claude/rules/house/git.md': body });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /more than three/);
});

test('shape: an ambiguous non-imperative heading (e.g. "Overview") is flagged', () => {
  const body = rule("## Overview\n\nAnchor: none (because a)\n\n## Don't\n\nAnchor: none (because b)\n");
  const dir = sandbox({ 'src/placeholder.ts': 'export const x = 1;\n', '.claude/rules/house/git.md': body });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /imperative verb/);
});

test('shape: SKILL.md frontmatter name matching its directory passes', () => {
  const dir = sandbox({
    '.claude/skills/conventions/SKILL.md': '---\nname: conventions\ndescription: x\n---\n\nBody.\n',
  });
  const { code } = run(dir, ['--only=shape']);
  assert.equal(code, 0);
});

test('shape: SKILL.md frontmatter name differing from its directory is a finding', () => {
  const dir = sandbox({
    '.claude/skills/conventions/SKILL.md': '---\nname: wrong-name\ndescription: x\n---\n\nBody.\n',
  });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 1, out);
  assert.match(out, /does not match its directory/);
});

test('shape: modules/**/rules/*.md is scanned when run inside the package repo layout', () => {
  const body = rule("## Use it\n\nAnchor: none (because a)\n\n## Don't\n\nAnchor: none (because b)\n");
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    'plugins/house/modules/git-workflow/rules/branching.md': body.replace('—', ''),
  });
  const { code, out } = run(dir, ['--only=shape', '--json']);
  assert.equal(code, 0, out);
});
