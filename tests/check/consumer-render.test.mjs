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

// PR 3 parity control: buildProposedManifest now writes {} for a slot instead
// of its declared default, so this proves the CLI's own defaults (spread by
// buildRenderPlan) and the vendored checker's per-slot hardcoded fallbacks
// (400 for maxCoLoadLines, 2000 for actionsBudgetMinutes, EM_DASH_DEFAULT,
// {} for lengthLimits, [] for every other slot) still agree with what each
// module.json declares. The three named scalars/objects below are the house
// CLI's own SCALAR_SLOT_DEFAULTS/OBJECT_SLOT_DEFAULTS table
// (plugins/house/scripts/house), restated here as an independent adopter-side
// spec: an adopter who copied these defaults into house.json by hand must see
// the exact same render and check as one who left the slot out entirely.
const MODULES_DIR = join(ROOT, 'plugins/house/modules');
const NAMED_SLOT_DEFAULTS = { scanArchive: false, maxCoLoadLines: 400, actionsBudgetMinutes: 2000, lengthLimits: {} };

function declaredConfig(moduleName) {
  const json = JSON.parse(readFileSync(join(MODULES_DIR, moduleName, 'module.json'), 'utf8'));
  const out = {};
  for (const s of json.configSlots || []) {
    if (typeof s === 'string') {
      out[s] = Object.prototype.hasOwnProperty.call(NAMED_SLOT_DEFAULTS, s)
        ? JSON.parse(JSON.stringify(NAMED_SLOT_DEFAULTS[s]))
        : [];
    } else if (s && typeof s === 'object' && typeof s.name === 'string') {
      out[s.name] = JSON.parse(JSON.stringify(s.default));
    }
  }
  return out;
}

function readHouseJson(repo) { return JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')); }

// Rewrites every module's config in place (keeping enabled flags, version,
// ratchet, everything else house.json already carries) and commits, so a
// later render sees a real, tracked change rather than an uncommitted edit.
function setEveryModuleConfig(repo, configFor) {
  const hj = readHouseJson(repo);
  for (const name of Object.keys(hj.modules)) hj.modules[name].config = configFor(name);
  writeFileSync(join(repo, 'house.json'), JSON.stringify(hj, null, 2) + '\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'rewrite module configs');
}

function readFiles(repo, paths) {
  const out = {};
  for (const p of paths) out[p] = existsSync(join(repo, p)) ? readFileSync(join(repo, p), 'utf8') : null;
  return out;
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

  // init writes {} for docFiles (it is not probe-derived), so the module's
  // own declared default governs until the operator sets the slot.
  const hjInit = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.ok(!('docFiles' in hjInit.modules.docs.config), 'init does not freeze docFiles at its current default');

  // Default render: render spreads the module's declared default under the
  // (empty) adopter config, so the docs rule still governs the full literal set.
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
  // init writes {} for every one of these slots: none is probe-derived, so
  // none is frozen at today's default. `database` still detects on from the
  // probe (a boolean, unrelated to its config's contents).
  assert.deepEqual(hj.modules.github.config, {});
  assert.deepEqual(hj.modules['claude-code'].config, {});
  assert.equal(hj.modules.database.enabled, true, 'db/ exists, so database detects on');
  assert.deepEqual(hj.modules.database.config, {});
  assert.deepEqual(hj.modules.testing.config, {});

  house(repo, 'render', '--apply');
  // Assert on the rendered `paths:` frontmatter only; a rule's prose may name
  // any of these paths in passing (github.md mentions `.env.example`). Render
  // spreads each module's declared slot default under the (empty) config, so
  // the historical literal set still governs on an untouched repo.
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
  // #25: src/** and lib/** are engineering's own declared codeRoots default
  // (scripts/** is the sibling that matches here), a known alternative
  // convention rather than something this adopter wrote, so the drop goes
  // quiet in text mode.
  assert.doesNotMatch(out, /warning:/, 'a dropped default prints no warning');
  const eng = readFileSync(join(repo, '.claude/rules/house/engineering.md'), 'utf8').split('\n---\n')[0];
  assert.doesNotMatch(eng, /^ {2}- src\/\*\*$/m, 'src/** is absent here and stays dropped from the frontmatter');

  const outJson = JSON.parse(house(repo, 'render', '--json').toString());
  const eng2 = outJson.droppedDefaults.find((d) => d.rule === '.claude/rules/house/engineering.md');
  assert.ok(eng2, `expected an engineering.md droppedDefaults entry, got ${JSON.stringify(outJson.droppedDefaults)}`);
  assert.deepEqual(eng2.paths.sort(), ['lib/**', 'src/**'], 'the drop still surfaces, just in --json rather than as a warning');
});

// #25: the flip side, an adopter-written glob is not a known alternative
// convention, so it must keep warning even though a default-list drop next
// to it now goes quiet.
test('#25: an adopter-written glob matching nothing still warns', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  const hj = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  hj.modules.engineering.config.codeGlobs = ['nope/**'];
  writeFileSync(join(repo, 'house.json'), JSON.stringify(hj, null, 2) + '\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'pin an adopter-written codeGlobs entry');

  const out = house(repo, 'render', '--apply').toString();
  assert.match(out, /warning: modules\/engineering\/rules\/engineering\.md: dropped 1 paths: glob\(s\) matching nothing here \(nope\/\*\*\)/,
    `an adopter-written glob still warns:\n${out}`);

  const outJson = JSON.parse(house(repo, 'render', '--json').toString());
  const eng = outJson.droppedDefaults.find((d) => d.rule === '.claude/rules/house/engineering.md');
  assert.ok(!eng || !eng.paths.includes('nope/**'), 'the adopter-written glob is never reported as a droppedDefault');
});

// #25: membership is checked against the module's DECLARED default list, not
// against whether house.json still matches what init originally wrote, so an
// adopter who explicitly re-pins a slot to its own default value (exactly
// what init seeds) gets the same quiet treatment.
test('#25: a default path re-pinned verbatim in house.json still counts as a default', () => {
  const repo = fixtureRepo({ 'package.json': '{"name":"x"}', 'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'scripts/a.mjs': 'export const a=1;\n' });
  house(repo, 'init', '--apply');
  const hj = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  hj.modules.engineering.config.codeRoots = ['scripts/**', 'src/**', 'lib/**'];
  writeFileSync(join(repo, 'house.json'), JSON.stringify(hj, null, 2) + '\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 're-pin codeRoots to its own default');

  const out = house(repo, 'render', '--apply').toString();
  assert.doesNotMatch(out, /warning:/, 'a default re-pinned to its own value is still a default, so it stays quiet');

  const outJson = JSON.parse(house(repo, 'render', '--json').toString());
  const eng = outJson.droppedDefaults.find((d) => d.rule === '.claude/rules/house/engineering.md');
  assert.ok(eng, `expected an engineering.md droppedDefaults entry, got ${JSON.stringify(outJson.droppedDefaults)}`);
  assert.deepEqual(eng.paths.sort(), ['lib/**', 'src/**']);
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
  // #25: .github/** is githubGlobs' own declared default (alongside
  // .githooks/** and .env.example, neither of which this fixture has either),
  // so the drop goes quiet in text mode and surfaces only in --json.
  const out2 = house(repo, 'render', '--apply').toString();
  assert.doesNotMatch(out2, /warning:/, 'a dropped default prints no warning');
  const outJson = JSON.parse(house(repo, 'render', '--json').toString());
  const ghDropped = outJson.droppedDefaults.find((d) => d.rule === '.claude/rules/house/github.md');
  assert.ok(ghDropped, `expected a github.md droppedDefaults entry, got ${JSON.stringify(outJson.droppedDefaults)}`);
  assert.ok(ghDropped.paths.includes('.github/**'), `expected .github/** among the dropped defaults, got ${JSON.stringify(ghDropped.paths)}`);
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

test('parity: a house.json with every slot absent renders and checks identically to one with every slot spelled out at its declared default', () => {
  const repo = fixtureRepo({
    'package.json': '{"name":"x","scripts":{"check:house":"node .house/check.mjs"}}',
    'README.md': '# X\n', 'CLAUDE.md': '# X\n', 'CHANGELOG.md': '# c\n',
    '.github/workflows/x.yml': 'name: x\non: workflow_dispatch\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{run: "true"}]\n',
    '.githooks/pre-commit': '#!/bin/sh\n', '.env.example': 'A=1\n',
    'tests/a.test.mjs': "import 'node:test';\n", 'test/b.test.mjs': "import 'node:test';\n",
    'db/schema.sql': '-- s\n', 'migrations/001.sql': '-- m\n', 'src/lib/db/x.mjs': '// x\n', 'scripts/db-seed.mjs': '// seed\n',
    'src/index.mjs': 'export default 1;\n', 'scripts/a.mjs': 'export const a = 1;\n', 'docs/note.md': '# note\n',
  });
  house(repo, 'init', '--apply');

  const managed = [
    '.claude/rules/house/claude-code.md', '.claude/rules/house/database.md', '.claude/rules/house/docs.md',
    '.claude/rules/house/engineering.md', '.claude/rules/house/github.md', '.claude/rules/house/testing.md',
  ];

  // render --json plans, both taken before any apply exists on disk (so
  // neither run can differ only because one repo already has a lock and the
  // other does not): every slot absent, then every slot spelled out.
  setEveryModuleConfig(repo, () => ({}));
  const sparsePlan = house(repo, 'render', '--json').toString();
  setEveryModuleConfig(repo, declaredConfig);
  const fullPlan = house(repo, 'render', '--json').toString();
  assert.deepEqual(JSON.parse(fullPlan), JSON.parse(sparsePlan),
    'a fresh render --json plan must not depend on whether a slot is absent or spelled out at its default');

  // Vendored rule bodies and checker output: render with every slot absent
  // first, capture the result, then switch to every slot spelled out and
  // render again over the SAME tree. A real divergence would compute a
  // different target body hash and overwrite the file; an absent divergence
  // leaves the bytes exactly as they were.
  setEveryModuleConfig(repo, () => ({}));
  house(repo, 'render', '--apply');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'sparse render');
  const sparseFiles = readFiles(repo, managed);
  const sparseCheck = execFileSync('node', [join(repo, '.house/check.mjs'), '--repo', repo], { encoding: 'utf8' });

  setEveryModuleConfig(repo, declaredConfig);
  house(repo, 'render', '--apply');
  // --allow-empty: a genuine parity means this render changes nothing on
  // disk, so there may be nothing new to stage.
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'full render', '--allow-empty');
  const fullFiles = readFiles(repo, managed);
  const fullCheck = execFileSync('node', [join(repo, '.house/check.mjs'), '--repo', repo], { encoding: 'utf8' });

  assert.deepEqual(fullFiles, sparseFiles,
    'the vendored rule bodies must be byte-identical whether a slot is absent or spelled out at its declared default');
  assert.equal(fullCheck, sparseCheck,
    `checker output must be identical whether a slot is absent or spelled out at its default:\nsparse:\n${sparseCheck}\nfull:\n${fullCheck}`);
});
