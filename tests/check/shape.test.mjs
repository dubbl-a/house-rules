import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, run, houseJson, writeUntracked } from './helpers.mjs';

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

test('shape: with no emDash config, an em dash in README.md is one finding; emDash.paths opts docs in', () => {
  const files = {
    'src/placeholder.ts': 'export const x = 1;\n',
    'README.md': DASHED_PUBLIC['README.md'],
    'docs/x.md': '# X\n\nA docs em dash \u2014 here.\n',
  };
  const bare = run(sandbox(files), ['--only=shape', '--json']);
  assert.equal(bare.code, 1, bare.out);
  assert.deepEqual(emPaths(bare.json), ['README.md']);
  const opted = run(sandbox({ ...files, 'README.md': '# R\n', 'house.json': emHouse({ paths: ['docs/**/*.md'] }) }), ['--only=shape', '--json']);
  assert.equal(opted.code, 1, opted.out);
  assert.deepEqual(emPaths(opted.json), ['docs/x.md']);
});

test('shape: the default emDash scan covers README only, not CHANGELOG, docs or rule files', () => {
  const dir = sandbox({
    'src/placeholder.ts': 'export const x = 1;\n',
    ...DASHED_PUBLIC,
    '.claude/rules/house/git.md': DASHED_RULE,
  });
  const { code, out, json } = run(dir, ['--only=shape', '--json']);
  assert.equal(code, 1, out);
  assert.deepEqual(emPaths(json), ['README.md']);
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

// #304: a new doc not yet added is in the next commit, so the em dash scan
// reads it the way CI will; an ignored doc never reaches a commit.
test('#304: the em dash scan reads an untracked, unignored doc, so a new doc fails locally as in CI', () => {
  const dir = sandbox({ 'src/placeholder.ts': 'export const x = 1;\n', 'README.md': '# R\n', 'house.json': emHouse({ paths: ['docs/**/*.md'] }) });
  writeUntracked(dir, { 'docs/new.md': '# New\n\nAn untracked em dash \u2014 here.\n' });
  const { code, out, json } = run(dir, ['--only=shape', '--json']);
  assert.equal(code, 1, out);
  assert.deepEqual(emPaths(json), ['docs/new.md']);
});

test('#304: the em dash scan leaves a gitignored doc alone', () => {
  const dir = sandbox({ 'src/placeholder.ts': 'export const x = 1;\n', '.gitignore': 'docs/private.md\n', 'house.json': emHouse({ paths: ['docs/**/*.md'] }) });
  writeUntracked(dir, { 'docs/private.md': '# P\n\nAn ignored em dash \u2014 here.\n' });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 0, out);
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
    'house.json': emHouse({ paths: ['docs/**/*.md'], exclude: [{ path: 'docs/sources/**', why: 'point-in-time research notes kept verbatim' }] }),
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
    'house.json': emHouse({ paths: ['docs/**/*.md', 42] }),
    ...DASHED_PUBLIC,
  });
  const { code, out, json } = run(dir, ['--only=shape,manifest', '--json'], NO_PLUGIN);
  assert.equal(code, 1, out);
  // README.md only (the default): the good `docs/**/*.md` entry does not
  // survive on its own, so docs/note.md is not reported.
  assert.deepEqual(emPaths(json), ['README.md']);
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

// #151: `house disable` removes a module's committed rule files, and until the
// removal is staged the index still lists them. A file gone from disk is not a
// document to check; read as empty, it used to fail every required section.
test('shape: a tracked rule file deleted from disk is not checked; one on disk still is', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.claude/rules/house/gone.md': rule('# Gone\n\nNo sections here.\n'),
  });
  rmSync(join(dir, '.claude/rules/house/gone.md'));
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /gone\.md/);
  const kept = sandbox({
    'house.json': houseJson(),
    '.claude/rules/house/kept.md': rule('# Kept\n\nNo sections here.\n'),
  });
  const control = run(kept, ['--only=shape']);
  assert.equal(control.code, 1, `positive control: the same file on disk is a finding\n${control.out}`);
  assert.match(control.out, /kept\.md \[shape\] missing required `## Don't` section/);
});

// Site and knowledge-base detection (2026-10-20): each detector adds its
// markdown to the default em-dash scan, so a README-only repo still scans it.
const DASH = '# P\n\nAn em dash — here.\n';
const SRC = { 'src/placeholder.ts': 'export const x = 1;\n' };

const DETECTORS = [
  ['mkdocs default docs_dir', { 'mkdocs.yml': 'site_name: S\n', 'docs/a.md': DASH }, 'docs/a.md'],
  ['mkdocs custom docs_dir', { 'mkdocs.yaml': 'site_name: S\ndocs_dir: pages\n', 'pages/a.md': DASH, 'docs/b.md': DASH }, 'pages/a.md'],
  ['docusaurus docs', { 'docusaurus.config.ts': 'export default {};\n', 'docs/a.mdx': DASH }, 'docs/a.mdx'],
  ['docusaurus blog', { 'docusaurus.config.js': 'module.exports = {};\n', 'blog/p.md': DASH }, 'blog/p.md'],
  ['vitepress parent', { 'guide/.vitepress/config.mts': 'export default {};\n', 'guide/a.md': DASH }, 'guide/a.md'],
  ['astro src/content', { 'astro.config.mjs': 'export default {};\n', 'src/content/p.md': DASH }, 'src/content/p.md'],
  ['hugo.toml content', { 'hugo.toml': 'title = "S"\n', 'content/p.md': DASH }, 'content/p.md'],
  ['config.toml with baseURL', { 'config.toml': 'baseURL = "https://x.test"\n', 'content/p.md': DASH }, 'content/p.md'],
  ['conventional wiki dir', { 'wiki/home.md': DASH }, 'wiki/home.md'],
  ['conventional kb dir', { 'kb/a.md': DASH }, 'kb/a.md'],
  ['conventional handbook dir', { 'handbook/a.md': DASH }, 'handbook/a.md'],
];

for (const [name, files, hit] of DETECTORS) {
  test(`shape: emDash detection finds ${name}`, () => {
    const { code, out, json } = run(sandbox({ ...SRC, ...files }), ['--only=shape', '--json']);
    assert.equal(code, 1, out);
    assert.deepEqual(emPaths(json), [hit]);
  });
}

test('shape: emDash detection finds a nested subproject site', () => {
  const dir = sandbox({ ...SRC, 'secondarrow/astro.config.mjs': 'export default {};\n', 'secondarrow/src/content/p.md': DASH });
  const { json } = run(dir, ['--only=shape', '--json']);
  assert.deepEqual(emPaths(json), ['secondarrow/src/content/p.md']);
});

test('shape: detect false turns site detection off', () => {
  const dir = sandbox({ ...SRC, 'house.json': emHouse({ detect: false }), 'wiki/home.md': DASH });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 0, out);
});

test('shape: exclude beats a detected file', () => {
  const dir = sandbox({ ...SRC, 'house.json': emHouse({ exclude: [{ path: 'wiki/old.md', why: 'verbatim record' }] }), 'wiki/old.md': DASH, 'wiki/new.md': DASH });
  const { json } = run(dir, ['--only=shape', '--json']);
  assert.deepEqual(emPaths(json), ['wiki/new.md']);
});

test('shape: a malformed emDash detect value falls back to detecting', () => {
  const dir = sandbox({ ...SRC, 'house.json': emHouse({ detect: 'no' }), 'wiki/home.md': DASH });
  const { code, out, json } = run(dir, ['--only=shape', '--json']);
  assert.equal(code, 1, out);
  assert.deepEqual(emPaths(json), ['wiki/home.md']);
});

test('shape: each detected root prints one info line naming its source', () => {
  const dir = sandbox({ ...SRC, 'secondarrow/astro.config.mjs': 'export default {};\n', 'secondarrow/src/content/p.md': '# P\n\nClean.\n' });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 0, out);
  assert.match(out, /\[em-dash\] scanning site content: secondarrow\/src\/content \(secondarrow\/astro\.config\.mjs\)/);
  assert.equal(run(dir, ['--only=shape', '--json']).json.info.length, 1);
});

test('shape: a site root that resolves to the repo root is not scanned, and says so', () => {
  const dir = sandbox({ ...SRC, '.vitepress/config.mts': 'export default {};\n', 'notes.md': DASH });
  const { code, out } = run(dir, ['--only=shape']);
  assert.equal(code, 0, out);
  assert.match(out, /\[em-dash\] site content could not be bounded .*list it in emDash\.paths/);
  const nested = run(sandbox({ ...SRC, 'site/.vitepress/config.mts': 'export default {};\n', 'site/a.md': DASH, 'notes.md': DASH }), ['--only=shape', '--json']);
  assert.deepEqual(emPaths(nested.json), ['site/a.md']);
});

for (const skipped of ['.claude/skills/wiki/SKILL.md', '.claude/commands/kb/x.md', '.house/kb/a.md', 'vendor/pkg/handbook/a.md']) {
  test(`shape: detection never claims ${skipped}`, () => {
    const { code, out } = run(sandbox({ ...SRC, [skipped]: DASH }), ['--only=shape']);
    assert.equal(code, 0, out);
  });
}

test('shape: a .vitepress under docs/ still detects docs/', () => {
  const { json } = run(sandbox({ ...SRC, 'docs/.vitepress/config.mts': 'export default {};\n', 'docs/a.md': DASH }), ['--only=shape', '--json']);
  assert.deepEqual(emPaths(json), ['docs/a.md']);
});

test('shape: an explicit empty emDash.paths turns detection off too', () => {
  const { code, out } = run(sandbox({ ...SRC, 'house.json': emHouse({ paths: [] }), 'wiki/a.md': DASH }), ['--only=shape']);
  assert.equal(code, 0, out);
});

test('shape: mkdocs docs_dir takes a whole quoted value with spaces', () => {
  const { json } = run(sandbox({ ...SRC, 'mkdocs.yml': 'docs_dir: "my docs"\n', 'my docs/a.md': DASH }), ['--only=shape', '--json']);
  assert.deepEqual(emPaths(json), ['my docs/a.md']);
});

for (const val of ['/etc/docs', '../elsewhere', '.', './']) {
  test(`shape: mkdocs docs_dir ${val} is reported as unbounded, not scanned`, () => {
    const { code, out } = run(sandbox({ ...SRC, 'mkdocs.yml': `docs_dir: ${val}\n`, 'notes.md': DASH }), ['--only=shape']);
    assert.equal(code, 0, out);
    assert.match(out, /could not be bounded/);
    assert.doesNotMatch(out, /scanning site content/);
  });
}

test('shape: hugo config under config/_default resolves content/ beside config/', () => {
  const { json } = run(sandbox({ ...SRC, 'web/config/_default/hugo.toml': 'title = "S"\n', 'web/content/p.md': DASH }), ['--only=shape', '--json']);
  assert.deepEqual(emPaths(json), ['web/content/p.md']);
});

test('shape: a root with no Markdown prints no scanning line; a directory-name root names its full path; nested roots keep the outer', () => {
  const empty = run(sandbox({ ...SRC, 'astro.config.mjs': 'export default {};\n' }), ['--only=shape']);
  assert.doesNotMatch(empty.out, /scanning site content/);
  const named = run(sandbox({ ...SRC, 'a/b/wiki/x.md': '# X\n' }), ['--only=shape']);
  assert.match(named.out, /scanning site content: a\/b\/wiki \(a\/b\/wiki\)/);
  const nested = run(sandbox({ ...SRC, 'site/.vitepress/config.mts': 'x\n', 'site/wiki/x.md': '# X\n' }), ['--only=shape', '--json']);
  assert.equal(nested.json.info.length, 1);
});
