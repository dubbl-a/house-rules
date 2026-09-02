import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'plugins/house/scripts/house');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' });
const house = (repo, ...a) => execFileSync('node', [CLI, ...a, '--repo', repo], { stdio: 'pipe' });

function fixtureRepo(files) {
  const d = mkdtempSync(join(tmpdir(), 'house-consumer-'));
  git(d, 'init', '-q'); git(d, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't');
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, dirname(p)), { recursive: true }); writeFileSync(join(d, p), c); }
  git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'init');
  return d;
}

// The anti-false-negative control the package-repo dogfood lacked: a freshly
// rendered consumer must pass its own vendored checker with zero findings.
test('a freshly rendered consumer repo passes .house/check.mjs with zero findings', () => {
  const repo = fixtureRepo({
    'package.json': '{"name":"x","scripts":{"test":"node --test","check:docs":"node .house/check.mjs --only=drift,todo","check:house":"node .house/check.mjs"}}',
    'README.md': '# X\n', 'CLAUDE.md': '# X\n',
    'scripts/a.mjs': 'export const a = 1;\n', 'tests/a.test.mjs': "import 'node:test';\n",
    'src/index.mjs': 'export default 1;\n', 'db/schema.sql': 'create table t();\n',
    '.github/workflows/x.yml': 'name: x\non: workflow_dispatch\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{run: "true"}]\n',
    'docs/note.md': '# note\n', 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
  });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  git(repo, 'add', '-A');
  assert.ok(existsSync(join(repo, '.house/check.mjs')), 'render wrote .house/check.mjs');
  assert.ok(readdirSync(join(repo, '.claude/rules/house')).length > 0, 'render vendored at least one rule');
  // #18 negative control for scaffold gating: github is default-on here, so
  // both one-time github scaffolds land.
  assert.ok(existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), 'github enabled: PR template scaffolded');
  assert.ok(existsSync(join(repo, '.github/workflows/pr-checks.yml')), 'github enabled: pr-checks scaffolded');
  // #32: and the third, which this repo qualifies for because it has a
  // package.json. Asserted here as well as in its own test below so a
  // dependabot.yml that landed but reddened the gate cannot pass unnoticed.
  assert.ok(existsSync(join(repo, '.github/dependabot.yml')), 'github enabled + package.json: dependabot scaffolded');
  // exit 0 = no findings (warnings allowed). execFileSync throws on non-zero.
  const out = execFileSync('node', [join(repo, '.house/check.mjs'), '--repo', repo], { encoding: 'utf8' });
  assert.match(out, /Summary: 0 finding/, `expected zero findings, got:\n${out}`);
});

test('render into a repo with an existing CLAUDE.md writes a sidecar, never overwrites', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'CLAUDE.md': '# ORIGINAL\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply'); house(repo, 'render', '--apply');
  assert.equal(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), '# ORIGINAL\n', 'existing CLAUDE.md untouched');
  assert.ok(existsSync(join(repo, 'CLAUDE.md.house-skeleton')), 'skeleton written as sidecar');
});

// #13: docs.md matched README.md at any depth and engineering.md matched src/**
// via HARDCODED module.json defaultPaths, so a consumer could not scope them to
// resolve a co-load. Those load-bearing paths are now behind config slots
// ($docFiles, $codeRoots) whose DEFAULT is the historical literals, so an
// unchanged repo renders identically but a consumer can narrow them.
test('#13: a house.json slot override narrows what the docs rule vendors; the default keeps the full set', () => {
  const repo = fixtureRepo({
    'package.json': '{"name":"x"}',
    'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'CHANGELOG.md': '# c\n',
    'docs/note.md': '# note\n', 'scripts/a.mjs': 'export const a=1;\n',
  });
  house(repo, 'init', '--apply');

  // init seeds docFiles with the current literals as its default (so the slot
  // is visible and overridable, and existing behavior is unchanged).
  const hjInit = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.deepEqual(hjInit.modules.docs.config.docFiles, [
    'CLAUDE.md', 'README.md', 'CHANGELOG.md',
    '.claude/rules/**', '.claude/skills/**', '.claude/commands/**', 'docs/**',
  ], 'init seeds docFiles with the historical literals');

  // Default render: the docs rule governs the full literal set.
  house(repo, 'render', '--apply');
  const full = readFileSync(join(repo, '.claude/rules/house/docs.md'), 'utf8');
  assert.match(full, /^ {2}- CLAUDE\.md$/m);
  assert.match(full, /^ {2}- docs\/\*\*$/m);

  // Narrow docFiles to README.md only, then re-render.
  const hj = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  hj.modules.docs.config.docFiles = ['README.md'];
  writeFileSync(join(repo, 'house.json'), JSON.stringify(hj, null, 2) + '\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'narrow docFiles');
  house(repo, 'render', '--apply');
  const narrowed = readFileSync(join(repo, '.claude/rules/house/docs.md'), 'utf8');
  assert.match(narrowed, /^ {2}- README\.md$/m);
  assert.doesNotMatch(narrowed, /^ {2}- CLAUDE\.md$/m);
  assert.doesNotMatch(narrowed, /^ {2}- docs\/\*\*$/m);
});

// #18: render wrote the github scaffolds (PR template, pr-checks.yml) even when
// the github module was disabled; repo-e (no CI, direct-to-main) had to
// delete them by hand. The scaffolds are owned by the github module, so a
// disabled github module must not produce them. The CLAUDE.md skeleton is the
// docs module's and still lands.
function disableGithub(repo) {
  const hj = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  hj.modules.github = { enabled: false, config: hj.modules.github ? hj.modules.github.config : {} };
  hj.deviations = [{ kind: 'disabled-module', module: 'github', what: 'no CI or PR flow here', why: 'fixture', decided: '2026-08-25' }];
  writeFileSync(join(repo, 'house.json'), JSON.stringify(hj, null, 2) + '\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'disable github');
}

test('#18: github disabled -> render writes no .github/ scaffold; the CLAUDE.md skeleton still lands', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  disableGithub(repo);
  const out = house(repo, 'render', '--apply').toString();
  assert.ok(!existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), 'github disabled: no PR template');
  assert.ok(!existsSync(join(repo, '.github/workflows/pr-checks.yml')), 'github disabled: no pr-checks.yml');
  assert.ok(!existsSync(join(repo, '.github/dependabot.yml')), 'github disabled: no dependabot.yml either');
  assert.ok(existsSync(join(repo, 'CLAUDE.md.house-skeleton')), 'docs skeleton still written');
  // Never silent: a repo on branchPolicy "pr" with github off has just lost
  // its CI step, and the note is how it learns that.
  const notes = out.split('\n').filter((l) => /github module is disabled/.test(l));
  assert.equal(notes.length, 1, `expected exactly one note, got:\n${out}`);
  assert.match(notes[0], /PULL_REQUEST_TEMPLATE\.md/);
  assert.match(notes[0], /pr-checks\.yml/);
  assert.match(notes[0], /dependabot\.yml/);
  assert.match(notes[0], /not written/);
});

test('#18: github disabled with pre-existing scaffolds leaves them byte-identical and prints one note', () => {
  const mine = 'name: mine\non: workflow_dispatch\n';
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n', '.github/workflows/pr-checks.yml': mine });
  house(repo, 'init', '--apply');
  disableGithub(repo);
  const out = house(repo, 'render', '--apply').toString();
  assert.equal(readFileSync(join(repo, '.github/workflows/pr-checks.yml'), 'utf8'), mine, 'existing scaffold untouched');
  assert.ok(!existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), 'the missing scaffold is not written either');
  const notes = out.split('\n').filter((l) => /github module is disabled/.test(l));
  assert.equal(notes.length, 1, `expected exactly one note, got:\n${out}`);
  assert.match(notes[0], /pr-checks\.yml/);
});

// #32: the dependabot.yml template shipped in the handbook manifest with
// nothing wiring it, so no consumer ever received it. It is a github-module
// scaffold like the other two, with one extra condition: the template
// hardcodes `package-ecosystem: npm`, so it must not land in a repo with no
// package.json.
const templateBody = (name) => readFileSync(join(ROOT, 'plugins/house/templates', name), 'utf8');

test('#32: a fresh render scaffolds .github/dependabot.yml byte-identical to the template', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  const out = house(repo, 'render', '--apply').toString();
  const landed = join(repo, '.github/dependabot.yml');
  assert.ok(existsSync(landed), `dependabot.yml scaffolded:\n${out}`);
  assert.equal(readFileSync(landed, 'utf8'), templateBody('dependabot.yml'), 'vendored verbatim from the template');
  assert.match(out, /Scaffolded[^]*dependabot\.yml/, 'and announced like any other one-time scaffold');
  assert.ok(scaffoldTemplates(repo).includes('dependabot.yml'), 'the lock records that it was offered');
});

test('#32: a repo with no package.json gets no dependabot.yml, and still gets the other github scaffolds', () => {
  // No package.json anywhere: the npm ecosystem block in the template would
  // be unresolvable, so the row's `when` keeps it out.
  const repo = fixtureRepo({ 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  const out = house(repo, 'render', '--apply').toString();
  assert.ok(!existsSync(join(repo, '.github/dependabot.yml')), `no package.json: no dependabot.yml:\n${out}`);
  assert.doesNotMatch(out, /dependabot\.yml/, 'and it is not announced as scaffolded');
  // Negative control: the gate is the missing package.json, not a broken
  // github scaffold path, so the module's other scaffolds still land.
  assert.ok(existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), 'the PR template still lands');
  assert.ok(existsSync(join(repo, '.github/workflows/pr-checks.yml')), 'and so does pr-checks.yml');
  assert.deepEqual(scaffoldTemplates(repo), ['CLAUDE.md.skeleton', 'PULL_REQUEST_TEMPLATE.md', 'pr-checks.yml'],
    'an inapplicable scaffold is not recorded either, so adding a package.json later still delivers it');
});

// #19: #13 put docs' and engineering's load-bearing paths behind slots but
// left github, claude-code, database, and testing on hardcoded literals, so a
// co-load involving those modules stayed unresolvable from house.json. Every
// literal now sits behind a slot whose DEFAULT is the historical set: an
// untouched repo renders exactly what it did before, and a consumer can narrow.
test('#19: every module literal path sits behind a slot defaulting to the historical set, and each narrows', () => {
  const repo = fixtureRepo({
    'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n',
    '.github/workflows/x.yml': 'name: x\n', '.githooks/pre-commit': '#!/bin/sh\n', '.env.example': 'A=1\n',
    '.claude/settings.json': '{}\n', 'tests/a.test.mjs': '// a\n', 'test/b.test.mjs': '// b\n',
    'db/schema.sql': '-- s\n', 'migrations/001.sql': '-- m\n', 'src/lib/db/x.mjs': '// x\n', 'scripts/db-seed.mjs': '// seed\n',
  });
  house(repo, 'init', '--apply');
  const hj = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.deepEqual(hj.modules.github.config.githubGlobs, ['.github/**', '.githooks/**', '.env.example']);
  assert.deepEqual(hj.modules['claude-code'].config.claudeGlobs, ['.claude/**', 'CLAUDE.md']);
  assert.equal(hj.modules.database.enabled, true, 'db/ exists, so database detects on');
  assert.deepEqual(hj.modules.database.config.dbGlobs, ['db/**', 'migrations/**', 'src/lib/db/**', 'scripts/db-*']);
  assert.deepEqual(hj.modules.testing.config.testRoots, ['tests/**', 'test/**']);

  house(repo, 'render', '--apply');
  // Assert on the rendered `paths:` frontmatter only; a rule's prose may name
  // any of these paths in passing (github.md mentions `.env.example`).
  const vendored = (f) => readFileSync(join(repo, '.claude/rules/house', f), 'utf8').split('\n---\n')[0];
  assert.match(vendored('github.md'), /^ {2}- \.githooks\/\*\*$/m);
  assert.match(vendored('github.md'), /^ {2}- \.env\.example$/m);
  assert.match(vendored('claude-code.md'), /^ {2}- CLAUDE\.md$/m);
  assert.match(vendored('database.md'), /^ {2}- migrations\/\*\*$/m);
  assert.match(vendored('testing.md'), /^ {2}- test\/\*\*$/m);

  hj.modules.github.config.githubGlobs = ['.github/workflows/**'];
  hj.modules.testing.config.testRoots = [];
  hj.modules.testing.config.testGlobs = ['tests/**'];
  writeFileSync(join(repo, 'house.json'), JSON.stringify(hj, null, 2) + '\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'narrow slots');
  house(repo, 'render', '--apply');
  const gh = vendored('github.md');
  assert.match(gh, /^ {2}- \.github\/workflows\/\*\*$/m);
  assert.doesNotMatch(gh, /githooks|\.env\.example/);
  const t = vendored('testing.md');
  assert.equal((t.match(/^ {2}- tests\/\*\*$/gm) || []).length, 1, `tests/** exactly once:\n${t}`);
  assert.doesNotMatch(t, /^ {2}- test\/\*\*$/m);
});

// #23: the CLAUDE.md skeleton exists to be merged into CLAUDE.md by hand and
// then deleted, but every later `render --apply` wrote it back, so each adopter
// re-sync had to `rm` it again to keep the commit clean. A scaffold is now
// offered once per repo: the lock records which templates were offered, and a
// recorded template is not rewritten whether or not its file survives.
const lockOf = (repo) => JSON.parse(readFileSync(join(repo, '.house/lock.json'), 'utf8'));
const scaffoldTemplates = (repo) => (lockOf(repo).scaffolds || []).map((s) => s.template).sort();

test('#23: a deleted CLAUDE.md skeleton does not come back on the next render --apply', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  assert.ok(existsSync(join(repo, 'CLAUDE.md.house-skeleton')), 'first render still writes the skeleton');
  assert.deepEqual(scaffoldTemplates(repo), ['CLAUDE.md.skeleton', 'PULL_REQUEST_TEMPLATE.md', 'dependabot.yml', 'pr-checks.yml'], 'the lock records every template offered');

  // The adopter merges it into CLAUDE.md and deletes the sidecar.
  rmSync(join(repo, 'CLAUDE.md.house-skeleton'));
  const out = house(repo, 'render', '--apply').toString();
  assert.ok(!existsSync(join(repo, 'CLAUDE.md.house-skeleton')), 'the skeleton stays deleted');
  assert.doesNotMatch(out, /CLAUDE\.md\.house-skeleton/, 'and is not announced as scaffolded');
  assert.deepEqual(scaffoldTemplates(repo), ['CLAUDE.md.skeleton', 'PULL_REQUEST_TEMPLATE.md', 'dependabot.yml', 'pr-checks.yml'], 'the record survives the delete');

  // Same for a deleted .github/ scaffold, which has the same shape.
  rmSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md'));
  house(repo, 'render', '--apply');
  assert.ok(!existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), 'a deleted github scaffold stays deleted too');
});

// The record is keyed by TEMPLATE, not destination. Kept after #26 pinned the
// skeleton to one dest: the key is what makes the record survive a dest
// change, and a path key would have to be migrated if the dest ever moves
// again.
test('#26: a first render never originates CLAUDE.md; only the sidecar lands', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  assert.ok(!existsSync(join(repo, 'CLAUDE.md')), 'the repo root file is the repo\'s to author, not house\'s');
  assert.ok(existsSync(join(repo, 'CLAUDE.md.house-skeleton')), 'the skeleton lands as a sidecar');
  assert.deepEqual(scaffoldTemplates(repo), ['CLAUDE.md.skeleton', 'PULL_REQUEST_TEMPLATE.md', 'dependabot.yml', 'pr-checks.yml']);
  // and still once per repo: delete it, re-render, it stays gone (#23)
  rmSync(join(repo, 'CLAUDE.md.house-skeleton'));
  house(repo, 'render', '--apply');
  assert.ok(!existsSync(join(repo, 'CLAUDE.md.house-skeleton')), 'still once per repo');
  assert.ok(!existsSync(join(repo, 'CLAUDE.md')), 'and never falls back to originating the root file');
});

// The half of #26 that makes the half above safe. A `paths:` glob was dropped
// when it matched no TRACKED file, but a first render creates files that
// satisfy some of those globs. `.claude/**` was the load-bearing case: it
// matched nothing on a first render, so claude-code's default claudeGlobs
// collapsed to `CLAUDE.md` alone, and a repo without one had the whole module
// vendor zero rules, which the manifest family reports as a FINDING. Stopping
// CLAUDE.md origination without this would have handed every fresh adopter a
// red checker.
test('#26: a repo with no CLAUDE.md still vendors claude-code and gates clean', () => {
  const repo = fixtureRepo({
    'package.json': '{"name":"x","scripts":{"check:house":"node .house/check.mjs"}}',
    'README.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n', 'tests/a.test.mjs': "import 'node:test';\n",
  });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  assert.ok(!existsSync(join(repo, 'CLAUDE.md')), 'precondition: no root file exists');
  assert.ok(existsSync(join(repo, '.claude/rules/house/claude-code.md')), 'claude-code vendored anyway, via .claude/**');
  git(repo, 'add', '-A');
  const out = execFileSync('node', [join(repo, '.house/check.mjs'), '--repo', repo], { encoding: 'utf8' });
  assert.match(out, /Summary: 0 finding/, `a repo with no CLAUDE.md must still gate clean:\n${out}`);
});

// Same defect one module over: the github rule is governed by `.github/**`,
// and this render writes the two .github/ scaffolds, so the glob must not be
// dropped for matching nothing beforehand. Before the fix the rule appeared
// only on a SECOND render.
test('#26: the github rule is vendored on a FIRST render, because that render creates .github/', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  assert.ok(existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), 'precondition: the render scaffolds .github/');
  assert.ok(existsSync(join(repo, '.claude/rules/house/github.md')), 'and the rule that governs it is vendored in the same pass');
});

// Negative control for that widening: a glob matching neither a tracked file
// nor anything this render writes is still dropped.
test('#26: a glob matching nothing tracked and nothing rendered is still dropped', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  const out = house(repo, 'render', '--apply').toString();
  assert.match(out, /dropped \d+ paths: glob\(s\) matching nothing here/, 'the drop still happens for genuinely absent paths');
  const eng = readFileSync(join(repo, '.claude/rules/house/engineering.md'), 'utf8').split('\n---\n')[0];
  assert.doesNotMatch(eng, /^ {2}- src\/\*\*$/m, 'src/** is absent here and stays dropped');
});

// Migration: every repo rendered at 0.2.2 or earlier has a lock with no
// `scaffolds` key. Such a lock reads as "already offered" for each template
// whose module gate passes now, so the very next re-sync is the quiet one the
// issue asks for, without a render that writes the skeleton one last time.
test('#23: a pre-0.2.3 lock (no scaffolds key) is read as already-scaffolded', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  rmSync(join(repo, 'CLAUDE.md.house-skeleton'));
  // #32: dependabot.yml is the case a real adopter hits, since a pre-0.2.3
  // lock predates the scaffold entirely. Deleting it here stands in for a repo
  // that never had it: the seed reads the github gate as it stands now, so the
  // new scaffold is suppressed until `render --apply --scaffold`.
  rmSync(join(repo, '.github/dependabot.yml'));
  const lock = lockOf(repo);
  delete lock.scaffolds;
  writeFileSync(join(repo, '.house/lock.json'), JSON.stringify(lock, null, 2) + '\n');

  house(repo, 'render', '--apply');
  assert.ok(!existsSync(join(repo, 'CLAUDE.md.house-skeleton')), 'no skeleton on the first render after the upgrade');
  assert.ok(!existsSync(join(repo, '.github/dependabot.yml')), 'and no dependabot.yml either: the seed covers every template whose module gate passes');
  assert.deepEqual(scaffoldTemplates(repo), ['CLAUDE.md.skeleton', 'PULL_REQUEST_TEMPLATE.md', 'dependabot.yml', 'pr-checks.yml'], 'the seeded record is written back');

  // `--scaffold` is the documented way back, the same as for any other
  // scaffold a pre-0.2.3 lock suppresses.
  house(repo, 'render', '--apply', '--scaffold');
  assert.equal(readFileSync(join(repo, '.github/dependabot.yml'), 'utf8'), templateBody('dependabot.yml'), '--scaffold delivers it');
});

// The record is gated per module, so it must not swallow a scaffold the repo
// was never offered: a repo that rendered with github off and turns it on later
// still gets the PR template and pr-checks.yml.
test('#23: enabling github after a render with it disabled still delivers its scaffolds', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  disableGithub(repo);
  house(repo, 'render', '--apply');
  assert.deepEqual(scaffoldTemplates(repo), ['CLAUDE.md.skeleton'], 'a disabled module records nothing');

  const hj = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  hj.modules.github.enabled = true;
  delete hj.deviations;
  writeFileSync(join(repo, 'house.json'), JSON.stringify(hj, null, 2) + '\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 're-enable github');

  house(repo, 'render', '--apply');
  assert.ok(existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), 'github back on: PR template lands');
  assert.ok(existsSync(join(repo, '.github/workflows/pr-checks.yml')), 'github back on: pr-checks lands');
  assert.deepEqual(scaffoldTemplates(repo), ['CLAUDE.md.skeleton', 'PULL_REQUEST_TEMPLATE.md', 'dependabot.yml', 'pr-checks.yml']);
});

// The one case the migration seed cannot get right, pinned rather than left to
// be discovered: a pre-0.2.3 lock records nothing, so the seed can only read
// the module gates as they stand NOW. A repo that turns a module ON in the same
// render that upgrades it is seeded as though it had already been offered that
// module's scaffolds, and does not get them. `--scaffold` is the way back, and
// this is why the flag exists.
test('#23: a module enabled in the same render that migrates a pre-0.2.3 lock needs --scaffold', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  disableGithub(repo);
  house(repo, 'render', '--apply');
  const lock = lockOf(repo);
  delete lock.scaffolds; // as every repo rendered at 0.2.2 or earlier looks
  writeFileSync(join(repo, '.house/lock.json'), JSON.stringify(lock, null, 2) + '\n');
  const hj = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  hj.modules.github.enabled = true;
  delete hj.deviations;
  writeFileSync(join(repo, 'house.json'), JSON.stringify(hj, null, 2) + '\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 're-enable github');

  house(repo, 'render', '--apply');
  assert.ok(!existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), 'seeded as already-offered, so nothing lands');
  house(repo, 'render', '--apply', '--scaffold');
  assert.ok(existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), '--scaffold recovers it');
  assert.ok(existsSync(join(repo, '.github/workflows/pr-checks.yml')), '--scaffold recovers both');
});

test('#23: --scaffold writes a recorded scaffold back, and never overwrites one on disk', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  const skeleton = readFileSync(join(repo, 'CLAUDE.md.house-skeleton'), 'utf8');
  rmSync(join(repo, 'CLAUDE.md.house-skeleton'));
  writeFileSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md'), '# mine\n');

  const out = house(repo, 'render', '--apply', '--scaffold').toString();
  assert.equal(readFileSync(join(repo, 'CLAUDE.md.house-skeleton'), 'utf8'), skeleton, '--scaffold writes the missing one back');
  assert.match(out, /CLAUDE\.md\.house-skeleton/, 'and says so');
  assert.equal(readFileSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8'), '# mine\n', 'an edited scaffold on disk is still never overwritten');
});

// Review finding against #26's own fix: counting every enabled scaffold as a
// render target was wrong once #23 made a scaffold write-once-per-repo. A repo
// that deletes the two .github/ scaffolds (the documented "yours to edit or
// delete" path) and re-renders kept `paths: - .github/**` in the vendored
// rule, and check.mjs reports a glob matching zero tracked files as a drift
// FINDING: render would hand the repo a red gate.
test('#26: a deleted scaffold stops counting as a render target, so no dead glob is vendored', () => {
  // A realistic repo: .github/ holds a workflow of its own, so deleting the
  // two scaffolds leaves the module something to govern.
  const repo = fixtureRepo({
    'package.json': '{"name":"x","scripts":{"check:house":"node .house/check.mjs"}}',
    'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n',
    'tests/a.test.mjs': "import 'node:test';\n",
    '.github/workflows/x.yml': 'name: x\non: workflow_dispatch\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{run: "true"}]\n',
  });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  rmSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md'));
  rmSync(join(repo, '.github/workflows/pr-checks.yml'));
  house(repo, 'render', '--apply');
  git(repo, 'add', '-A');
  const out = execFileSync('node', [join(repo, '.house/check.mjs'), '--repo', repo], { encoding: 'utf8' });
  assert.match(out, /Summary: 0 finding/, `render must never leave a red gate behind:\n${out}`);
});

// The narrow guarantee, isolated from whether the repo has any other github
// surface: a vendored rule never carries a paths: glob that matches nothing.
// With both scaffolds deleted and no other .github/ content, the old code
// vendored `.github/**` anyway and check.mjs flagged it as drift.
test('#26: a scaffold the render will not write does not keep its glob alive', () => {
  const repo = fixtureRepo({
    'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n',
    'scripts/a.mjs': 'export const a=1;\n',
  });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  rmSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md'));
  rmSync(join(repo, '.github/workflows/pr-checks.yml'));
  rmSync(join(repo, '.github/dependabot.yml')); // #32: the third github scaffold, or `.github/**` still matches
  house(repo, 'render', '--apply');
  // Always assert something: an `if (existsSync(...))` wrapper around the only
  // assertion makes this print green while checking nothing the moment the
  // fixture stops vendoring the rule for an unrelated reason.
  const gh = join(repo, '.claude/rules/house/github.md');
  const frontmatter = existsSync(gh) ? readFileSync(gh, 'utf8').split('\n---\n')[0] : '';
  assert.doesNotMatch(frontmatter, /\.github\/\*\*/,
    'a glob that neither the tree nor this render satisfies must not be vendored');
  const out2 = house(repo, 'render', '--apply').toString();
  assert.match(out2, /dropped \d+ paths: glob\(s\) matching nothing here[^\n]*\.github/,
    `and the drop must be reported, not silent:\n${out2}`);
});

// Second review pass: `plannedDestPaths` skipped a scaffold that already
// existed, assuming `git ls-files` covered it. False for a scaffold the LAST
// render wrote and nobody has staged: it was in neither set, so the glob was
// dropped, the rule skipped, and the orphan sweep DELETED the rule file the
// previous render had just written. Two renders in a row flip-flopped.
test('#26: a second render before any git add does not delete the rule the first one wrote', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  const gh = join(repo, '.claude/rules/house/github.md');
  assert.ok(existsSync(gh), 'precondition: the first render vendors the github rule');
  // deliberately no `git add` between the two renders
  const out = house(repo, 'render', '--apply').toString();
  assert.ok(existsSync(gh), `the second render must not delete it:\n${out}`);
  assert.doesNotMatch(out, /Removed \(orphaned/, 'and must not report it as an orphan');
});

// Same divergence on the other side: --scaffold writes the scaffolds back, so
// the glob they satisfy has to count as a render target in that pass too.
test('#26: --scaffold writes scaffolds back without dropping the rule that governs them', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  house(repo, 'render', '--apply');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'adopt');
  rmSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md'));
  rmSync(join(repo, '.github/workflows/pr-checks.yml'));
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'drop scaffolds');
  const out = house(repo, 'render', '--apply', '--scaffold').toString();
  assert.ok(existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), '--scaffold writes them back');
  assert.ok(existsSync(join(repo, '.claude/rules/house/github.md')), `and keeps the rule that governs them:\n${out}`);
});
