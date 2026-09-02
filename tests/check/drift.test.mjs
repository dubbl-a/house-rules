import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sandbox, run, houseJson, writeUntracked } from './helpers.mjs';

test('drift: passes a clean doc set with no anchors', () => {
  const dir = sandbox({ 'README.md': '# Hello\n\nNo backticked claims here.\n' });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
  assert.match(out, /0 finding/);
});

test('drift: flags an unresolved file-path anchor', () => {
  const dir = sandbox({
    'README.md': 'See `src/does-not-exist.ts` for details.\n',
    'src/real.ts': 'export const x = 1;\n',
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[file path\]/);
  assert.match(out, /src\/does-not-exist\.ts/);
});

test('drift: passes a file-path anchor that resolves', () => {
  const dir = sandbox({
    'README.md': 'See `src/real.ts` for details.\n',
    'src/real.ts': 'export const x = 1;\n',
  });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('drift: flags an npm script anchor that does not exist', () => {
  const dir = sandbox({
    'README.md': 'Run `npm run does-not-exist` first.\n',
    'package.json': JSON.stringify({ name: 'x', scripts: { build: 'echo hi' } }),
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[npm script\]/);
});

test('drift: passes an npm script anchor that exists', () => {
  const dir = sandbox({
    'README.md': 'Run `npm run build` first.\n',
    'package.json': JSON.stringify({ name: 'x', scripts: { build: 'echo hi' } }),
  });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('drift: bare `prebuild` claim with no prebuild script is a finding', () => {
  const dir = sandbox({
    'README.md': 'The `prebuild` step runs first.\n',
    'package.json': JSON.stringify({ name: 'x', scripts: { build: 'echo hi' } }),
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[bare script\]/);
  assert.match(out, /prebuild/);
});

test('drift: bare `prebuild` claim passes when the script exists', () => {
  const dir = sandbox({
    'README.md': 'The `prebuild` step runs first.\n',
    'package.json': JSON.stringify({ name: 'x', scripts: { prebuild: 'echo hi', build: 'echo hi' } }),
  });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

// Gap 1 (Phase 5 dogfood): kind (b) used to flag ANY colon-shaped token as
// an unmapped script whenever package.json existed, which caught ordinary
// `key:value` prose (`og:description`, `astro:assets`, `stale:true`,
// `limit:1`, ...) that has nothing to do with npm scripts. Narrowed to: a
// colon token is only a script candidate when its namespace (first segment)
// matches the namespace of a real, already-namespaced script.
test('drift: colon-namespaced token flags an unmapped script in a real namespace (positive control)', () => {
  const dirBad = sandbox({
    'README.md': 'Run `check:unmapped` before committing.\n',
    'package.json': JSON.stringify({ name: 'x', scripts: { 'check:docs': 'echo hi' } }),
  });
  const bad = run(dirBad, ['--only=drift']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /\[bare script\]/);
  assert.match(bad.out, /check:unmapped/);

  const dirGood = sandbox({
    'README.md': 'Run `check:docs` before committing.\n',
    'package.json': JSON.stringify({ name: 'x', scripts: { 'check:docs': 'echo hi' } }),
  });
  assert.equal(run(dirGood, ['--only=drift']).code, 0);
});

test('drift: colon token with no matching script namespace never flags, even against a same-named bare script (negative control)', () => {
  const dir = sandbox({
    'README.md': 'The `og:description` meta tag feeds link previews, alongside `astro:assets`.\n',
    // "astro" is a real script here, but it is colonless -- its own name
    // must not count as evidence of an "astro" namespace, or it would
    // false-positive on `astro:assets` (Astro's own built-in module import).
    'package.json': JSON.stringify({ name: 'x', scripts: { 'check:docs': 'echo hi', astro: 'astro' } }),
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 0, out);
});

test('drift: bareScriptAllowlist exempts a colon token that looks like a script but is not one', () => {
  const dir = sandbox({
    'README.md': 'External tool token: `foo:bar`.\n',
    'package.json': JSON.stringify({ name: 'x', scripts: { 'foo:baz': 'echo hi' } }),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { bareScriptAllowlist: ['foo:bar'] } } } }),
  });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('drift: heading-link slug mismatch is a finding, matching slug passes', () => {
  const dirBad = sandbox({
    'README.md': 'See `docs/guide.md#wrong-slug` for setup.\n',
    'docs/guide.md': '# Setup guide\n\nBody.\n',
  });
  const bad = run(dirBad, ['--only=drift']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /\[heading link\]/);

  const dirGood = sandbox({
    'README.md': 'See `docs/guide.md#setup-guide` for setup.\n',
    'docs/guide.md': '# Setup guide\n\nBody.\n',
  });
  assert.equal(run(dirGood, ['--only=drift']).code, 0);
});

test('drift: docs/** pathspec trap — a configured root covers both a shallow and a nested file', () => {
  const dir = sandbox({
    'docs/a.md': '# A\n',
    'docs/sub/b.md': '# B\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { roots: ['docs'] } } } }),
  });
  const { code, out, json } = run(dir, ['--only=drift', '--json']);
  assert.equal(code, 0, out);
  assert.ok(json.scannedDocs.includes('docs/a.md'));
  assert.ok(json.scannedDocs.includes('docs/sub/b.md'));
});

test('drift: a configured root that matches zero tracked files is a finding', () => {
  const dir = sandbox({
    'README.md': '# Hello\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { roots: ['nonexistent-dir'] } } } }),
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[zero-match root\]/);
});

test('drift: a root file excluded by excludeFiles is caught as missing-from-scan', () => {
  const dir = sandbox({
    'docs/a.md': '# A\n',
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { roots: ['docs'], excludeFiles: ['docs/a.md'] } } },
    }),
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[root missing from scan\]/);
});

test('drift: archiveDirs excludes by default, scanArchive:true includes', () => {
  const filesFor = () => ({
    'README.md': 'See `src/missing.ts`.\n',
    'archive/notes.md': 'Also see `src/missing.ts` here.\n',
  });
  const dirExcluded = sandbox({
    ...filesFor(),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { archiveDirs: ['archive'] } } } }),
  });
  const excluded = run(dirExcluded, ['--only=drift', '--json']);
  assert.ok(!excluded.json.scannedDocs.includes('archive/notes.md'));

  const dirIncluded = sandbox({
    ...filesFor(),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { archiveDirs: ['archive'], scanArchive: true } } } }),
  });
  const included = run(dirIncluded, ['--only=drift', '--json']);
  assert.ok(included.json.scannedDocs.includes('archive/notes.md'));
});

test('drift: .claude/rules/** is always scanned even under an excluded dir', () => {
  const dir = sandbox({
    '.claude/rules/foo.md': '---\npaths:\n  - "src/**"\n---\n\nRule body.\n',
    'src/placeholder.ts': 'export const x = 1;\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { excludeFiles: ['.claude'] } } } }),
  });
  const { json } = run(dir, ['--only=drift', '--json']);
  assert.ok(json.scannedDocs.includes('.claude/rules/foo.md'));
});

test('drift: a rules file with no paths: frontmatter is an always-on-rule finding', () => {
  const dir = sandbox({ '.claude/rules/stray.md': '# Stray\n\nNo frontmatter.\n' });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[always-on rule\]/);
});

test('drift: a paths: glob whose root does not exist is a finding', () => {
  const dir = sandbox({ '.claude/rules/foo.md': '---\npaths:\n  - "nope/**"\n---\n\nBody.\n' });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[paths glob\]/);
});

test('drift: a well-formed rules file with an existing paths root passes', () => {
  const dir = sandbox({
    '.claude/rules/foo.md': '---\npaths:\n  - "src/**"\n---\n\nBody.\n',
    'src/placeholder.ts': 'export const x = 1;\n',
  });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('drift: per-line ignore hatch skips the claim on the next content line', () => {
  const dir = sandbox({
    'README.md': '<!-- docs-drift-ignore: archival -->\nSee `src/missing.ts`.\n',
  });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('drift: file-level ignore hatch exempts the whole file', () => {
  const dir = sandbox({
    'README.md': '<!-- docs-drift-ignore-file: archival -->\n\nSee `src/missing.ts`.\n',
  });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('drift: an anchor inside a fenced code block is not enforced', () => {
  const dir = sandbox({ 'README.md': '```\nSee `src/missing.ts`.\n```\n' });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('drift: an unclosed fence is its own finding', () => {
  const dir = sandbox({ 'README.md': '```\nunclosed\n' });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[unclosed fence\]/);
});

test('drift: section-id anchor resolves against configured haystackDirs', () => {
  const dirBad = sandbox({
    'README.md': 'See `#missing-id`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { haystackDirs: ['src'] } } } }),
    'src/page.html': '<div id="other-id"></div>\n',
  });
  assert.equal(run(dirBad, ['--only=drift']).code, 1);

  const dirGood = sandbox({
    'README.md': 'See `#real-id`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { haystackDirs: ['src'] } } } }),
    'src/page.html': '<div id="real-id"></div>\n',
  });
  assert.equal(run(dirGood, ['--only=drift']).code, 0);
});

test('drift: class-prefix anchor resolves via configured classPrefixes + haystackDirs', () => {
  const dir = sandbox({
    'README.md': 'Uses `.app-banner` styling.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { classPrefixes: ['app-'], haystackDirs: ['src'] } } } }),
    'src/style.css': '.app-banner { color: red; }\n',
  });
  assert.equal(run(dir, ['--only=drift']).code, 0);
});

test('drift: component-name anchor resolves against the exact component-file basename set, not a substring', () => {
  const cfg = { modules: { docs: { enabled: true, config: { componentSuffixes: ['Card'] } } } };

  // A cited component with no matching file at all: finding.
  const dirBad = sandbox({
    'README.md': 'Renders `MissingCard`.\n',
    'house.json': houseJson(cfg),
    'src/components/RaceCard.astro': '<div>race</div>\n',
  });
  assert.equal(run(dirBad, ['--only=drift']).code, 1);

  // Cited component IS an exact basename under the default componentRoots
  // (`src`) with a default component extension (`.astro`): passes.
  const dirGood = sandbox({
    'README.md': 'Renders `RaceCard`.\n',
    'house.json': houseJson(cfg),
    'src/components/RaceCard.astro': '<div>race</div>\n',
  });
  assert.equal(run(dirGood, ['--only=drift']).code, 0);

  // F7 control: a suffix rename. The doc still says `RaceCard`, but the file
  // is now `RaceCardV2.astro`. A substring test would pass this silently
  // (RaceCard is a substring of RaceCardV2); the exact-basename set must
  // FAIL it, because a stale component reference is exactly the drift shape
  // this anchor kind exists to catch.
  const dirRenamed = sandbox({
    'README.md': 'Renders `RaceCard`.\n',
    'house.json': houseJson(cfg),
    'src/components/RaceCardV2.astro': '<div>race</div>\n',
  });
  const renamed = run(dirRenamed, ['--only=drift']);
  assert.equal(renamed.code, 1, renamed.out);
  assert.match(renamed.out, /\[component\] RaceCard/);
  // And the renamed component itself, when the doc is updated to cite it, passes.
  const dirRenamedGood = sandbox({
    'README.md': 'Renders `RaceCardV2`.\n',
    'house.json': houseJson(cfg),
    'src/components/RaceCardV2.astro': '<div>race</div>\n',
  });
  assert.equal(run(dirRenamedGood, ['--only=drift']).code, 0);
});

test('drift: buildArtifactPrefixes exempt a path from existence checking', () => {
  const dir = sandbox({
    'README.md': 'Ships `dist/client/app.js`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { buildArtifactPrefixes: ['dist/'] } } } }),
  });
  assert.equal(run(dir, ['--only=drift']).code, 0);
});

test('drift: extraPathRoots adds a top-level dir not derivable from git ls-files', () => {
  const dir = sandbox({
    'README.md': 'See `external/thing.txt`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { extraPathRoots: ['external'] } } } }),
  });
  // external/ has no tracked file, so the token still fails existence -- this
  // proves extraPathRoots makes the token a recognized (and thus enforced)
  // path claim rather than being silently skipped.
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[file path\]/);
});

// Gap 2 (Phase 5 dogfood): kind (c) resolved ONLY against `git ls-files`, so
// a real, useful, gitignored directory (repo-a's
// `scripts/match/reports/**` -- build reports and gold-set exports) always
// failed. After a tracked-set miss, fall back to a real (still case-exact)
// disk check.
test('drift: a tracked-set miss for a real, gitignored path falls back to disk (positive control)', () => {
  const dir = sandbox({
    'README.md': 'See `scripts/reports/` for output.\n',
    'scripts/build.mjs': 'export const x = 1;\n', // sibling makes "scripts" a recognized top-level dir
    '.gitignore': 'scripts/reports\n',
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 0, out);
});

test('drift: a path missing from both the tracked set and disk stays a finding (negative control)', () => {
  const dir = sandbox({
    'README.md': 'See `scripts/reports/` for output.\n',
    'scripts/build.mjs': 'export const x = 1;\n',
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[file path\]/);
  assert.match(out, /scripts\/reports/);
});

// #21 fallout: the disk probe above made kind-(c) existence depend on the
// MACHINE, not on the repo. Every one of these paths is correct, and all three
// exist on a developer's checkout and none in a runner's, so `check:house`
// passed locally and the identical run failed in CI (repo-d, 2026-09-01:
// `repo-g/.env`, `app/node_modules`, `.claude/worktrees/*`). A check
// that only passes where the untracked files happen to be is not a check. Ask
// git what it ignores instead: ignore rules are committed, so the answer is the
// same everywhere.
test('drift: a gitignored path resolves with nothing on disk (the CI case)', () => {
  const dir = sandbox({
    'README.md': 'Build output lands in `scripts/reports/`.\n',
    'scripts/build.mjs': 'export const x = 1;\n',
    '.gitignore': 'scripts/reports\n',
  });
  // Deliberately NOT written to disk: this is exactly a fresh runner checkout.
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 0, out);
});

test('drift: an untracked, unignored path on disk is a finding, as it is in CI', () => {
  const dir = sandbox({
    'README.md': 'See `scripts/reports/` for output.\n',
    'scripts/build.mjs': 'export const x = 1;\n',
  });
  writeUntracked(dir, { 'scripts/reports/summary.txt': 'hi\n' });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1, out);
  assert.match(out, /\[file path\] scripts\/reports/);
});

test('drift: a gitignored glob parent resolves with nothing on disk', () => {
  const dir = sandbox({
    'README.md': 'Sessions run in `scripts/worktrees/*` worktrees.\n',
    'scripts/build.mjs': 'export const x = 1;\n',
    '.gitignore': 'scripts/worktrees/\n',
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 0, out);
});

// A local-only exclude does not travel with the repo, so it resolves here and
// nowhere else. That is the same divergence in a quieter form: pass, but say so.
test('drift: a path ignored only by .git/info/exclude passes with a warning', () => {
  const dir = sandbox({
    'README.md': 'Sessions run in `scripts/worktrees/*` worktrees.\n',
    'scripts/build.mjs': 'export const x = 1;\n',
  });
  writeUntracked(dir, { '.git/info/exclude': 'scripts/worktrees/\n' });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 0, out);
  assert.match(out, /local-only/);
  assert.match(out, /scripts\/worktrees/);
});

test('drift: the disk fallback is still case-exact -- a wrong-case match on disk is still a finding', () => {
  const dir = sandbox({
    'README.md': 'See `scripts/Reports/` for output.\n',
    'scripts/build.mjs': 'export const x = 1;\n',
  });
  writeUntracked(dir, { 'scripts/reports/summary.txt': 'hi\n' }); // lowercase on disk; doc says `Reports`
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1, out);
  assert.match(out, /\[file path\]/);
});

// Gap 3 (Phase 5 dogfood): a path inside a SKILL.md is conventionally
// relative to that skill's own directory, not repo root (repo-b's
// checker has this fallback; ours lost it -- okr-coach's SKILL.md
// referencing its own `scripts/flow.json` is the real case).
test('drift: a path inside a SKILL.md resolves relative to its own skill directory (positive control)', () => {
  const dir = sandbox({
    'scripts/other.mjs': 'export const x = 1;\n', // sibling makes "scripts" a recognized top-level dir
    '.claude/skills/demo-skill/SKILL.md': '---\nname: demo-skill\n---\n\nSee `scripts/flow.json` for the process shape.\n',
    '.claude/skills/demo-skill/scripts/flow.json': '{}\n',
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 0, out);
});

test('drift: a SKILL.md path missing even under its own skill directory still fails (negative control)', () => {
  const dir = sandbox({
    'scripts/other.mjs': 'export const x = 1;\n',
    '.claude/skills/demo-skill/SKILL.md': '---\nname: demo-skill\n---\n\nSee `scripts/nope.json` for the process shape.\n',
    '.claude/skills/demo-skill/scripts/flow.json': '{}\n',
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[file path\]/);
  assert.match(out, /scripts\/nope\.json/);
});

// Gap 4 (Phase 5 dogfood): the `paths:` frontmatter check only probed that a
// glob's literal root directory exists, which passes even when the glob
// selects nothing (repo-c's `src/pages/services*`: `src/pages/` is real,
// nothing under it starts with `services`). Borrowed from ctxlint: after the
// root probe, also require the full glob to match at least one tracked file.
test('drift: a paths: glob whose root exists but matches zero tracked files is a finding (positive control)', () => {
  const dir = sandbox({
    '.claude/rules/foo.md': '---\npaths:\n  - "src/pages/services*"\n---\n\nBody.\n',
    'src/pages/other.astro': '<div></div>\n',
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 1);
  assert.match(out, /\[paths glob\]/);
  assert.match(out, /services\*/);
});

test('drift: a paths: glob that matches a real tracked file passes (negative control)', () => {
  const dir = sandbox({
    '.claude/rules/foo.md': '---\npaths:\n  - "src/pages/services*"\n---\n\nBody.\n',
    'src/pages/services.astro': '<div></div>\n',
  });
  const { code, out } = run(dir, ['--only=drift']);
  assert.equal(code, 0, out);
});

test('drift: ENV/const anchor resolves against the haystack', () => {
  const dirBad = sandbox({
    'README.md': 'Set `SOME_MISSING_VAR`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { haystackDirs: ['src'] } } } }),
    'src/config.js': 'const OTHER_VAR = 1;\n',
  });
  assert.equal(run(dirBad, ['--only=drift']).code, 1);

  const dirGood = sandbox({
    'README.md': 'Set `SOME_REAL_VAR`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { haystackDirs: ['src'] } } } }),
    'src/config.js': 'const SOME_REAL_VAR = 1;\n',
  });
  assert.equal(run(dirGood, ['--only=drift']).code, 0);
});

test('drift: an unrecognized token shape is skipped silently', () => {
  const dir = sandbox({ 'README.md': 'This is `just some prose`.\n' });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('drift: --repo points check.mjs at a repo other than cwd', () => {
  const dir = sandbox({ 'README.md': '# Hello\n' });
  const out = run(dir, ['--only=drift', '--json']);
  assert.equal(out.code, 0);
  assert.deepEqual(out.json.scannedDocs, ['README.md']);
});

test('a bare literal paths: entry validates against the tracked set, not existsSync at root', () => {
  // `.env.example` (no wildcard) is valid when a tracked file matches it at
  // any depth, like a bare wildcard glob, not only when it sits at the root.
  const rule = [
    '---', 'paths:', '  - .env.example', '---', '',
    '# R', '', '## Do it', 'Anchor: none (because test)', 'Body.', '',
    "## Don't", 'no.', '',
  ].join('\n');
  const dir = sandbox({
    'package.json': '{"name":"x"}',
    'config/.env.example': 'X=1\n',
    '.claude/rules/house/r.md': rule,
  });
  const { out } = run(dir, ['--only=drift']);
  assert.doesNotMatch(out, /paths glob.*env\.example/, 'a literal matching a tracked file at depth must pass');
});

test('P3: an allowlisted colon-namespaced script that does not exist warns', () => {
  const dir = sandbox({
    'package.json': '{"name":"x","scripts":{"check:docs":"x"}}',
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { bareScriptAllowlist: ['check:ghost'] } } } }),
  });
  const { code, json } = run(dir, ['--only=drift', '--json']);
  assert.equal(code, 0);
  assert.ok((json.warnings || []).some((w) => /check:ghost/.test(w.message)), 'a stale check: allowlist entry must warn');
});

test('P10: buildArtifactPrefixes matches on a path segment, not a raw prefix', () => {
  const dir = sandbox({
    'package.json': '{"name":"x"}',
    'README.md': '# r\n\nSee `distribution/missing.js`.\n',
    'dist/real.js': '//x\n',
    'distribution/other.js': '//y\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { buildArtifactPrefixes: ['dist'] } } } }),
  });
  const { json } = run(dir, ['--only=drift', '--json']);
  assert.ok((json.findings || []).some((f) => /distribution\/missing/.test(f.message)), '`dist` prefix must not exempt `distribution/`');
});

// #14: the component anchor did not strip a trailing `.astro` before resolving
// against the (extension-less) basename set, so a backticked `Foo.astro`
// reference fell through unchecked and a renamed component went silently stale
// (the repo-b dogfood proved it: old checker 7 findings, house 6).
test('#14: a component reference written as `X.astro` resolves against the basename set', () => {
  const cfg = { modules: { docs: { enabled: true, config: { componentSuffixes: ['Card'] } } } };
  // positive control: a renamed component still cited as `RaceCard.astro` fails.
  const dirRenamed = sandbox({
    'README.md': 'Renders `RaceCard.astro`.\n',
    'house.json': houseJson(cfg),
    'src/components/RaceCardV2.astro': '<div>race</div>\n',
  });
  const renamed = run(dirRenamed, ['--only=drift']);
  assert.equal(renamed.code, 1, renamed.out);
  assert.match(renamed.out, /\[component\] RaceCard\.astro/);
  // negative control: a valid `RaceCard.astro` reference passes.
  const dirGood = sandbox({
    'README.md': 'Renders `RaceCard.astro`.\n',
    'house.json': houseJson(cfg),
    'src/components/RaceCard.astro': '<div>race</div>\n',
  });
  assert.equal(run(dirGood, ['--only=drift']).code, 0, 'a valid X.astro reference must pass');
});

// P11: an empty componentSuffixes silently disables kind-(h). That is the
// common, CORRECT case (a repo with no component namespace), so it must stay a
// deliberate no-op -- not a warning. Chosen resolution: document the no-op in
// code and lock it with a control that proves (a) empty flags nothing and
// (b) the kind is live once a suffix is configured.
test('P11: empty componentSuffixes is a deliberate no-op; a configured suffix makes the kind live', () => {
  // negative control (deliberate no-op): a clearly-stale component token is not
  // flagged and not warned when componentSuffixes is empty.
  const dirOff = sandbox({
    'README.md': 'Renders `MissingCard`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { componentSuffixes: [] } } } }),
    'src/components/RaceCard.astro': '<div>race</div>\n',
  });
  const off = run(dirOff, ['--only=drift', '--json']);
  assert.equal(off.code, 0, off.out);
  assert.equal((off.json.findings || []).length, 0, 'empty componentSuffixes must flag nothing');
  // positive control: the SAME token IS a finding once a suffix is configured.
  const dirOn = sandbox({
    'README.md': 'Renders `MissingCard`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { componentSuffixes: ['Card'] } } } }),
    'src/components/RaceCard.astro': '<div>race</div>\n',
  });
  const on = run(dirOn, ['--only=drift']);
  assert.equal(on.code, 1, on.out);
  assert.match(on.out, /\[component\] MissingCard/);
});

// P9: an excludeFiles/archiveDirs entry that drops a tracked .md is otherwise
// only caught by the opt-in roots loop. A doc removed from the scan that never
// carried a `docs-drift-ignore-file` opt-out is suspicious: warn (do not block).
test('P9: excluding a tracked .md with no opt-out marker warns; with the marker it does not', () => {
  // positive control: an excluded doc that never opted out warns.
  const dirBad = sandbox({
    'README.md': '# r\n',
    'notes/legacy.md': 'Legacy notes referencing `src/old.ts`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { excludeFiles: ['notes/legacy.md'] } } } }),
  });
  const bad = run(dirBad, ['--only=drift', '--json']);
  assert.equal(bad.code, 0, bad.out);
  assert.ok((bad.json.warnings || []).some((w) => w.kind === 'excluded' && /notes\/legacy\.md/.test(w.path)),
    'an excluded doc with no opt-out marker must warn');
  // negative control: the same excluded doc, but carrying the file-level marker.
  const dirGood = sandbox({
    'README.md': '# r\n',
    'notes/legacy.md': '<!-- docs-drift-ignore-file: superseded, kept for history -->\nLegacy `src/old.ts`.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { excludeFiles: ['notes/legacy.md'] } } } }),
  });
  const good = run(dirGood, ['--only=drift', '--json']);
  assert.equal(good.code, 0, good.out);
  assert.ok(!(good.json.warnings || []).some((w) => w.kind === 'excluded'),
    'an excluded doc that opted out must not warn');
});

// P13: the whole-file `docs-drift-ignore-file` opt-out suppresses ALL drift for
// a file, so it must record why -- mirroring a deviations entry.
test('P13: a reasonless whole-file opt-out warns; the same opt-out with a reason does not', () => {
  // positive control: marker with no reason still exempts the file, but warns.
  const dirNoReason = sandbox({
    'README.md': '<!-- docs-drift-ignore-file -->\n\nSee `src/missing.ts`.\n',
  });
  const noReason = run(dirNoReason, ['--only=drift', '--json']);
  assert.equal(noReason.code, 0, noReason.out); // still exempted -> no findings
  assert.ok((noReason.json.warnings || []).some((w) => w.kind === 'ignore-file' && /no reason/.test(w.message)),
    'a reasonless whole-file opt-out must warn');
  // negative control: the same opt-out WITH a reason does not warn.
  const dirReason = sandbox({
    'README.md': '<!-- docs-drift-ignore-file: archival snapshot, tokens are historical -->\n\nSee `src/missing.ts`.\n',
  });
  const withReason = run(dirReason, ['--only=drift', '--json']);
  assert.equal(withReason.code, 0, withReason.out);
  assert.ok(!(withReason.json.warnings || []).some((w) => w.kind === 'ignore-file'),
    'a reasoned opt-out must not warn');
});

// Ultra review of v0.2.1: #14 stripped only `.astro`, while DEFAULT_COMPONENT_EXTS
// and the basename set cover .jsx/.tsx/.vue/.svelte too, so `Foo.tsx` in prose
// fell through kind (h) unchecked.
test('component reference with any configured extension (.tsx, .vue) resolves against the basename set', () => {
  const cfg = { modules: { docs: { enabled: true, config: { componentSuffixes: ['Card'] } } } };
  for (const ext of ['.tsx', '.vue']) {
    const renamed = sandbox({
      'README.md': `Renders \`RaceCard${ext}\`.\n`,
      'house.json': houseJson(cfg),
      [`src/components/RaceCardV2${ext}`]: 'export default 1;\n',
    });
    const r = run(renamed, ['--only=drift']);
    assert.equal(r.code, 1, `${ext} renamed reference must fail: ${r.out}`);
    assert.match(r.out, new RegExp(`\\[component\\] RaceCard\\${ext}`));
    const good = sandbox({
      'README.md': `Renders \`RaceCard${ext}\`.\n`,
      'house.json': houseJson(cfg),
      [`src/components/RaceCard${ext}`]: 'export default 1;\n',
    });
    assert.equal(run(good, ['--only=drift']).code, 0, `a valid RaceCard${ext} reference must pass`);
  }
});

// ── v0.3.0: ADR 0010 package-surface drop (#32 item 1) ──────────────────

// A lock-vouched managed rule in a CONSUMER repo naming the package's own
// tree (handbook receipts are HEADING LINKS, test paths are file paths) must
// produce nothing at all: not a finding, not a warning.
const MANAGED_RULE = (bodyLines) => [
  '---', 'paths:', '  - README.md', '---',
  '<!-- house-managed v0.3.0 module=docs source=modules/docs/rules/docs.md body-sha256=abc -->',
  '# R', '',
  '## Do it', ...bodyLines, '',
  "## Don't", 'no.', '',
].join('\n');
// The lock records the REAL body hash (managedBody of a frontmatter-first
// file is the whole file), because the ADR 0010 drop is hash-gated: a
// locally modified managed file must keep its loud downgrade warnings.
const lockFor = (ruleContent) => JSON.stringify({
  files: [{
    path: '.claude/rules/house/r.md', module: 'docs', source: 'modules/docs/rules/docs.md',
    bodySha256: createHash('sha256').update(ruleContent, 'utf8').digest('hex'),
  }],
});

const DROP_RULE = MANAGED_RULE([
  'Anchor: `tests/hooks/run.sh` gates it, per `docs/decisions/0002-hook-fails-open-without-a-manifest.md`.',
  'Receipts: `docs/handbook/docs.md#do-it`',
]);

test('ADR 0010: package-surface tokens in a lock-vouched managed file are silent in a consumer', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'tests/other.txt': 'x\n',
    'docs/notes.md': 'notes\n',
    '.claude/rules/house/r.md': DROP_RULE,
    '.house/lock.json': lockFor(DROP_RULE),
    'house.json': houseJson(),
  });
  const res = run(dir, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok(!(res.json.warnings || []).some((w) => /docs\/handbook|docs\/decisions|tests\/hooks/.test(w.message)),
    `package-surface tokens must be dropped, not downgraded: ${res.out}`);
});

const SIBLING_RULE = MANAGED_RULE(['Anchor: `scripts/house/deploy-guards.mjs` gates it.']);

test('ADR 0010: the sibling-destination downgrade is unchanged (negative control)', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'scripts/x.mjs': 'export {};\n',
    '.claude/rules/house/r.md': SIBLING_RULE,
    '.house/lock.json': lockFor(SIBLING_RULE),
    'house.json': houseJson(),
  });
  const res = run(dir, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok((res.json.warnings || []).some((w) => /sibling module/.test(w.message) && /deploy-guards/.test(w.message)),
    `a sibling-destination token must still warn: ${res.out}`);
});

const SRC_RULE = MANAGED_RULE(['Anchor: `src/missing.ts` gates it.']);

test('ADR 0010: a non-package-surface token in a managed file still downgrade-warns (negative control)', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'src/real.ts': 'export {};\n',
    '.claude/rules/house/r.md': SRC_RULE,
    '.house/lock.json': lockFor(SRC_RULE),
    'house.json': houseJson(),
  });
  const res = run(dir, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok((res.json.warnings || []).some((w) => /src\/missing\.ts/.test(w.message)),
    `an unresolved non-package-surface token must still warn: ${res.out}`);
});

const PKG_RULE = MANAGED_RULE(['Receipts: `docs/handbook/nope.md#do-it`']);

test('ADR 0010: the same tokens stay FINDINGS in the package repo itself (negative control)', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'plugins/house/modules/docs/module.json': '{"name":"docs"}',
    'docs/handbook/other.md': '# other\n',
    'docs/decisions/0001-x.md': '# x\n',
    'tests/other.txt': 'x\n',
    '.claude/rules/house/r.md': PKG_RULE,
    '.house/lock.json': lockFor(PKG_RULE),
    'house.json': houseJson(),
  });
  const res = run(dir, ['--only=drift']);
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /\[heading link\] docs\/handbook\/nope\.md#do-it/);
});

test('ADR 0010: a locally modified managed file loses the drop but keeps the downgrade warning', () => {
  // Same fixture as the silent-drop positive, except the lock records a hash
  // the on-disk body no longer matches (a hand edit): the package-surface
  // token must come back as a loud warning, never stay silent.
  const dir = sandbox({
    'README.md': '# r\n',
    'tests/other.txt': 'x\n',
    'docs/notes.md': 'notes\n',
    '.claude/rules/house/r.md': DROP_RULE,
    '.house/lock.json': JSON.stringify({ files: [{ path: '.claude/rules/house/r.md', module: 'docs', source: 'modules/docs/rules/docs.md', bodySha256: 'not-the-real-hash' }] }),
    'house.json': houseJson(),
  });
  const res = run(dir, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok((res.json.warnings || []).some((w) => /docs\/handbook/.test(w.message)),
    `a hand-edited managed file must keep its downgrade warnings: ${res.out}`);
});

test('ADR 0010: a stale PACKAGE_SURFACE_PREFIXES entry is a finding in the package repo', () => {
  // A package-repo fixture with no tests/ tree: the self-check must name the
  // prefix that would silence consumer warnings for a surface that is gone.
  const dir = sandbox({
    'README.md': '# r\n',
    'plugins/house/modules/docs/module.json': '{"name":"docs"}',
    'docs/handbook/other.md': '# other\n',
    'docs/decisions/0001-x.md': '# x\n',
    'house.json': houseJson(),
  });
  const res = run(dir, ['--only=drift']);
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /\[stale suppression\].*`tests\/`/);
});

// ── v0.3.0: packageRoots (#33 item 1) ────────────────────────────────────

test('packageRoots: npm-run anchors in a doc under a package root resolve against that root\'s package.json', () => {
  const cfg = houseJson({ modules: { docs: { enabled: true, config: { packageRoots: ['pkg'] } } } });
  const dir = sandbox({
    'package.json': '{"scripts":{"root-only":"x"}}',
    'pkg/package.json': '{"scripts":{"dev":"x"}}',
    'pkg/README.md': 'Run `npm run dev` from here, or `npm run root-only` at the top.\n',
    'house.json': cfg,
  });
  const res = run(dir, ['--only=drift']);
  assert.equal(res.code, 0, res.out);

  // Negative control: the SAME token in a root doc does not see pkg's scripts.
  const dirRoot = sandbox({
    'package.json': '{"scripts":{"root-only":"x"}}',
    'pkg/package.json': '{"scripts":{"dev":"x"}}',
    'README.md': 'Run `npm run dev`.\n',
    'house.json': cfg,
  });
  const rootRes = run(dirRoot, ['--only=drift']);
  assert.equal(rootRes.code, 1, rootRes.out);
  assert.match(rootRes.out, /\[npm script\] npm run dev/);
});

test('packageRoots: path anchors in a doc under a package root resolve against that root first, then repo root', () => {
  const cfg = houseJson({ modules: { docs: { enabled: true, config: { packageRoots: ['pkg'] } } } });
  const dir = sandbox({
    'pkg/lib/util.mjs': 'export {};\n',
    'pkg/README.md': 'See `lib/util.mjs`, also reachable as `pkg/lib/util.mjs`.\n',
    'house.json': cfg,
  });
  const res = run(dir, ['--only=drift']);
  assert.equal(res.code, 0, res.out);

  // Positive control: a root-relative path that resolves under NEITHER root
  // is still a finding for a doc under the package root.
  const dirBad = sandbox({
    'pkg/lib/util.mjs': 'export {};\n',
    'pkg/README.md': 'See `lib/missing.mjs`.\n',
    'house.json': cfg,
  });
  const bad = run(dirBad, ['--only=drift']);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /\[file path\] lib\/missing\.mjs/);
});

test('packageRoots: a repo with no root package.json still checks script anchors under a declared root', () => {
  const cfg = houseJson({ modules: { docs: { enabled: true, config: { packageRoots: ['pkg'] } } } });
  const dir = sandbox({
    'pkg/package.json': '{"scripts":{"dev":"x"}}',
    'pkg/README.md': 'Run `npm run missing`.\n',
    'README.md': 'Run `npm run anything` (unchecked: no root package.json).\n',
    'house.json': cfg,
  });
  const res = run(dir, ['--only=drift']);
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /pkg\/README\.md.*\[npm script\] npm run missing/);
  assert.doesNotMatch(res.out, /npm run anything/);
});

test('packageRoots: the longest declared root wins for nested roots', () => {
  const cfg = houseJson({ modules: { docs: { enabled: true, config: { packageRoots: ['apps', 'apps/web'] } } } });
  const dir = sandbox({
    'apps/package.json': '{"scripts":{"outer":"x"}}',
    'apps/web/package.json': '{"scripts":{"web-dev":"x"}}',
    'apps/web/README.md': 'Run `npm run web-dev`.\n',
    'house.json': cfg,
  });
  const res = run(dir, ['--only=drift']);
  assert.equal(res.code, 0, res.out);
});

test('P3 + packageRoots: an allowlist token that is a live script in a nested manifest does not warn', () => {
  const cfg = (allow) => houseJson({ modules: { docs: { enabled: true, config: { packageRoots: ['pkg'], bareScriptAllowlist: allow } } } });
  const dir = sandbox({
    'package.json': '{"scripts":{"a:b":"x"}}',
    'pkg/package.json': '{"scripts":{"results:pull":"x"}}',
    'README.md': '# r\n',
    'house.json': cfg(['results:pull']),
  });
  const res = run(dir, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok(!(res.json.warnings || []).some((w) => w.kind === 'allowlist'), res.out);

  // Positive control: a token live in NO manifest still warns.
  const dirStale = sandbox({
    'package.json': '{"scripts":{"a:b":"x"}}',
    'pkg/package.json': '{"scripts":{"results:pull":"x"}}',
    'README.md': '# r\n',
    'house.json': cfg(['results:gone']),
  });
  const stale = run(dirStale, ['--only=drift', '--json']);
  assert.ok((stale.json.warnings || []).some((w) => w.kind === 'allowlist' && /results:gone/.test(w.message)), stale.out);
});

// ── v0.3.0: ADR 0009 object forms (#32 item 3, #33 item 2) ──────────────

test('ADR 0009: an allowlist entry with a why exempts its token and silences the P3 warning', () => {
  const mkCfg = (entry) => houseJson({ modules: { docs: { enabled: true, config: { bareScriptAllowlist: [entry] } } } });
  const files = {
    'package.json': '{"scripts":{"kv:other":"x"}}',
    'README.md': 'Reads the `kv:key` value.\n',
  };
  const reasoned = sandbox({ ...files, 'house.json': mkCfg({ token: 'kv:key', kind: 'not-a-script', why: 'KV key name, never a script' }) });
  const res = run(reasoned, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok(!(res.json.warnings || []).some((w) => w.kind === 'allowlist'), `a reasoned entry must not warn: ${res.out}`);

  // Negative control: the same token as a plain string exempts but warns.
  const plain = sandbox({ ...files, 'house.json': mkCfg('kv:key') });
  const plainRes = run(plain, ['--only=drift', '--json']);
  assert.equal(plainRes.code, 0, plainRes.out);
  assert.ok((plainRes.json.warnings || []).some((w) => w.kind === 'allowlist' && /kv:key/.test(w.message)),
    `a plain stale entry must still warn: ${plainRes.out}`);
});

test('ADR 0009: an excludeFiles entry with a why satisfies the P9 nudge', () => {
  const mkCfg = (entry) => houseJson({ modules: { docs: { enabled: true, config: { excludeFiles: [entry] } } } });
  const files = {
    'README.md': '# r\n',
    'notes/nested.md': 'A living doc naming `src/elsewhere.ts` relative to another tree.\n',
  };
  const reasoned = sandbox({ ...files, 'house.json': mkCfg({ path: 'notes/nested.md', why: 'nested package doc, scanned by its own repo' }) });
  const res = run(reasoned, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok(!(res.json.warnings || []).some((w) => w.kind === 'excluded'), `a reasoned exclusion must not warn: ${res.out}`);

  // Negative control: the same exclusion as a plain string still warns.
  const plain = sandbox({ ...files, 'house.json': mkCfg('notes/nested.md') });
  const plainRes = run(plain, ['--only=drift', '--json']);
  assert.ok((plainRes.json.warnings || []).some((w) => w.kind === 'excluded'),
    `a reasonless exclusion must still warn: ${plainRes.out}`);
});

test('ADR 0009: an archiveDirs entry with a why also satisfies the P9 nudge', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'reports/2026-01/run.md': 'Point-in-time `src/old.ts` report.\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { archiveDirs: [{ path: 'reports/**', why: 'generated run reports, point in time by construction' }] } } } }),
  });
  const res = run(dir, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok(!(res.json.warnings || []).some((w) => w.kind === 'excluded'), res.out);
});

// ── v0.3.0: the marker window skips YAML frontmatter (#32 item 4) ────────

test('docs-drift-ignore-file after a frontmatter fence is honoured by P13 (and outside the window is not)', () => {
  const inWindow = sandbox({
    'src/real.ts': 'export {};\n',
    'README.md': [
      '---', 'id: t1', 'persona: x', '---',
      '<!-- docs-drift-ignore-file: pipeline input, paths are template placeholders -->',
      '', 'Uses `src/placeholder.ts`.', '',
    ].join('\n'),
  });
  const res = run(inWindow, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok(!(res.json.warnings || []).some((w) => w.kind === 'ignore-file'), res.out);

  // Positive control: the marker more than three lines below the fence is
  // outside the window, so the file is NOT exempted.
  const outside = sandbox({
    'src/real.ts': 'export {};\n',
    'README.md': [
      '---', 'id: t1', '---',
      '', 'Uses `src/placeholder.ts`.', '',
      '<!-- docs-drift-ignore-file: too late down here -->', '',
    ].join('\n'),
  });
  const badRes = run(outside, ['--only=drift']);
  assert.equal(badRes.code, 1, badRes.out);
  assert.match(badRes.out, /\[file path\] src\/placeholder\.ts/);
});

test('docs-drift-ignore-file after a frontmatter fence is honoured by the P9 excluded-doc nudge', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'tpl/outbound.md': [
      '---', 'id: t1', '---',
      '<!-- docs-drift-ignore-file: pipeline input -->',
      'Body `src/x.ts`.', '',
    ].join('\n'),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { excludeFiles: ['tpl/outbound.md'] } } } }),
  });
  const res = run(dir, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok(!(res.json.warnings || []).some((w) => w.kind === 'excluded'), res.out);
});

// #34 review: heading links re-root like kind (c), so a doc under a package
// root can link a sibling .md#slug relative to that root.
test('packageRoots: heading links in a doc under a package root resolve against that root', () => {
  const cfg = houseJson({ modules: { docs: { enabled: true, config: { packageRoots: ['pkg'] } } } });
  const dir = sandbox({
    'pkg/docs/guide.md': '# Setup\n\nBody.\n',
    'pkg/README.md': 'See `docs/guide.md#setup`.\n',
    'house.json': cfg,
  });
  const res = run(dir, ['--only=drift']);
  assert.equal(res.code, 0, res.out);

  // Positive control: a slug that resolves under neither root is a finding.
  const dirBad = sandbox({
    'pkg/docs/guide.md': '# Setup\n\nBody.\n',
    'pkg/README.md': 'See `docs/guide.md#wrong-slug`.\n',
    'house.json': cfg,
  });
  const bad = run(dirBad, ['--only=drift']);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /\[heading link\]/);
});

// #34 review: a doc whose first line is a Markdown thematic-break `---` (with
// another `---` later) looks like frontmatter; the marker window must still
// include the top of the file, or an unchanged doc regresses on upgrade.
test('docs-drift-ignore-file in the top window still counts when a leading --- looks like frontmatter', () => {
  const dir = sandbox({
    'src/real.ts': 'export {};\n',
    'README.md': [
      '---',
      '<!-- docs-drift-ignore-file: archival, tokens are historical -->',
      'Uses `src/placeholder.ts`.',
      '---',
      'More body.', '',
    ].join('\n'),
  });
  const res = run(dir, ['--only=drift', '--json']);
  assert.equal(res.code, 0, res.out);
  assert.ok(!(res.json.warnings || []).some((w) => w.kind === 'ignore-file'), res.out);
});
