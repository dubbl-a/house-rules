// Black-box tests for the house CLI (plugins/house/scripts/house).
//
// Every test copies the REAL CLI file into a throwaway FIXTURE plugin dir
// (its own modules/, payload/, .claude-plugin/) and invokes it as a
// subprocess against a throwaway TARGET git repo, so module-source
// resolution ("<scriptdir>/../modules/*/module.json", relative to the
// script's own location) is genuinely exercised rather than assumed.
//
// This file deliberately does NOT read from or depend on
// plugins/house/modules/**, plugins/house/skills/**,
// plugins/house/templates/**, or docs/decisions/** -- those trees are
// written by a separate, concurrent workflow. The fixture below is a
// minimal, self-contained stand-in: two modules (one "on" with literal
// paths, one "detect" with a single "$slot" path) plus a tiny fake
// payload/check.mjs that just exits 0.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync,
  chmodSync, existsSync, statSync, rmSync, realpathSync,
} from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import nodePath, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_CLI_SRC = join(HERE, '..', 'plugins', 'house', 'scripts', 'house');
const SCHEMA_PATH = join(HERE, '..', 'plugins', 'house', 'schema', 'house.schema.json');
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const CLEANUP_DIRS = [];
after(() => {
  for (const d of CLEANUP_DIRS) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function sha256Hex(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }

function writeTree(baseDir, files) {
  for (const [p, body] of Object.entries(files)) {
    const abs = join(baseDir, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

const ALPHA_BODY = `# Alpha rules

## Do the thing
Anchor: none (because fixture)

Body text for alpha.

## Don't
Anchor: none (because fixture)

Don't do the bad thing.
`;

const BETA_BODY = `# Beta rules

## Detect the thing
Anchor: none (because fixture)

Beta body text.

## Don't
Anchor: none (because fixture)

Don't do the bad thing either.
`;

const FAKE_CHECK_MJS = `#!/usr/bin/env node
// Fixture stand-in for payload/check.mjs: always exits 0, no real checks.
console.log('fake house check: ok');
process.exit(0);
`;

const DOCS_BODY = `# Docs rules

## Scan the thing
Anchor: none (because fixture)

Docs body text.

## Don't
Anchor: none (because fixture)

Don't do the bad thing either.
`;

/**
 * Build a throwaway fixture plugin dir: modules/alpha (default "on",
 * literal defaultPaths), modules/beta (default "detect", a single "$slot"
 * defaultPaths entry), a fake payload/check.mjs, a fake plugin.json (version
 * 9.9.9), and a COPY of the real CLI at scripts/house so source resolution
 * (<scriptdir>/../modules, <scriptdir>/../.claude-plugin/plugin.json) is
 * exercised against this fixture, not the real house package.
 *
 * `withDocsModule`: also write modules/docs (default "on"), the one name
 * `buildProposedManifest` special-cases for its probe-derived config
 * (docsConfigFromProbe). Opt-in, kept out of the two default fixture
 * modules, so only the tests that need it pay for the extra module in
 * house.json.
 */
function buildFixturePlugin({ withDocsModule = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'house-fixture-'));
  CLEANUP_DIRS.push(dir);
  const modules = {
    '.claude-plugin/plugin.json': `${JSON.stringify({ name: 'house', version: '9.9.9' }, null, 2)}\n`,
    'payload/check.mjs': FAKE_CHECK_MJS,
    'modules/alpha/module.json': `${JSON.stringify({
      name: 'alpha', default: 'on', rules: ['rules/alpha.md'], files: [], configSlots: [],
      defaultPaths: ['src/**', 'scripts/**'],
    }, null, 2)}\n`,
    'modules/alpha/rules/alpha.md': ALPHA_BODY,
    // `depth` declares a non-empty default (3) and nothing in defaultPaths
    // ever reads it; it exists so a test can prove init writes {} even for a
    // slot whose own spec says its default is not an empty array.
    'modules/beta/module.json': `${JSON.stringify({
      name: 'beta', default: 'detect', rules: ['rules/beta.md'], files: [],
      configSlots: ['slot', { name: 'depth', default: 3 }],
      defaultPaths: ['$slot'],
    }, null, 2)}\n`,
    'modules/beta/rules/beta.md': BETA_BODY,
  };
  if (withDocsModule) {
    modules['modules/docs/module.json'] = `${JSON.stringify({
      name: 'docs', default: 'on', rules: ['rules/docs.md'], files: [],
      configSlots: ['roots', 'haystackDirs'],
      defaultPaths: ['$roots'],
    }, null, 2)}\n`;
    modules['modules/docs/rules/docs.md'] = DOCS_BODY;
  }
  writeTree(dir, modules);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  const cliPath = join(dir, 'scripts', 'house');
  copyFileSync(REAL_CLI_SRC, cliPath);
  chmodSync(cliPath, 0o755);
  return { dir, cliPath };
}

/** Throwaway git repo to act as the --repo target. */
// The default target carries a src/ and scripts/ file so the fixture alpha
// module's `src/**` and `scripts/**` globs match at least one tracked file and
// survive render's drop-zero-match filter (F1b). A test that wants a bare repo
// passes its own files.
function buildTargetRepo(files = { 'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n' }, prefix = 'house-repo-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  CLEANUP_DIRS.push(dir);
  writeTree(dir, files);
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init', '--allow-empty'], { cwd: dir });
  return dir;
}

function commitAll(dir, message = 'update') {
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', message, '--allow-empty'], { cwd: dir });
}

/**
 * Run the fixture CLI as a real subprocess. Returns {code, out, err}.
 *
 * Every call gets its own throwaway CLAUDE_CONFIG_DIR unless the caller
 * passes one in `env`: doctor now reads an InstructionsLoaded log under
 * <CLAUDE_CONFIG_DIR>/house/instructions-loaded/, and without this a run
 * here could read (or, via the hook tests, write) the real machine's own
 * log. Sandboxed on every call, not just doctor's, since it costs nothing
 * for the commands that never look at it.
 */
function runCli(cliPath, args, env = {}) {
  let configDir = env.CLAUDE_CONFIG_DIR;
  if (!configDir) {
    configDir = mkdtempSync(join(tmpdir(), 'house-config-'));
    CLEANUP_DIRS.push(configDir);
  }
  const res = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: configDir },
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

function writeHouseJson(repo, data) {
  writeFileSync(join(repo, 'house.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  commitAll(repo, 'house.json');
}

const BASE_HOUSE_JSON = {
  version: '9.9.9',
  defaultBranch: 'main',
  branchPolicy: 'pr',
  protectedBranches: ['master', 'main'],
};

// ── init ─────────────────────────────────────────────────────────────────

test('init: refuses when house.json already exists', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo({ 'README.md': '# hi\n', 'house.json': '{}\n' });
  const { code, err, out } = runCli(cliPath, ['init', '--repo', repo]);
  assert.equal(code, 1);
  assert.match(`${err}${out}`, /house\.json/);
  assert.match(err, /already exists/);
});

test('init --apply writes a schema-shaped house.json with probed modules', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo({ 'README.md': '# hi\n' });
  const { code } = runCli(cliPath, ['init', '--repo', repo, '--apply']);
  assert.equal(code, 0);

  const houseJsonPath = join(repo, 'house.json');
  assert.ok(existsSync(houseJsonPath));
  const data = JSON.parse(readFileSync(houseJsonPath, 'utf8'));

  // Schema-driven structural checks (plugins/house/schema/house.schema.json)
  for (const req of SCHEMA.required) assert.ok(req in data, `missing required key \`${req}\``);
  for (const key of Object.keys(data)) assert.ok(key in SCHEMA.properties, `unknown top-level key \`${key}\` not declared in the schema`);
  assert.match(data.version, new RegExp(SCHEMA.properties.version.pattern));
  assert.equal(data.version, '9.9.9'); // pulled from the fixture's plugin.json
  assert.equal(data.branchPolicy, 'pr');
  assert.deepEqual(data.protectedBranches, ['master', 'main']);
  // No origin remote: falls back to the repo's actual current branch. Not
  // hardcoded to "main" -- older `git` (pre-2.28, no init.defaultBranch
  // support) creates "master" here regardless of the -c flag in
  // buildTargetRepo(), so ask git itself what it actually named it.
  const actualBranch = execFileSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
  assert.equal(data.defaultBranch, actualBranch);

  // Module probing: alpha is default "on" -> always enabled.
  assert.equal(data.modules.alpha.enabled, true);
  assert.deepEqual(data.modules.alpha.config, {});

  // beta is default "detect" with an unrecognized module name (not
  // "deployment"/"database"): no known probe, so it defaults to disabled.
  // Its config is {}, not its declared slot defaults (`slot: []`, `depth: 3`):
  // a future default reaches this repo instead of freezing today's value.
  assert.equal(data.modules.beta.enabled, false);
  assert.deepEqual(data.modules.beta.config, {});
});

test('init --apply writes {} config even for a module declaring a slot with a non-empty default', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo();
  const { code } = runCli(cliPath, ['init', '--repo', repo, '--apply']);
  assert.equal(code, 0);
  const data = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));

  // alpha declares no configSlots at all.
  assert.deepEqual(data.modules.alpha.config, {});
  // beta declares `depth` with default 3 and `slot` with default []; init
  // writes neither. Render (buildRenderPlan) is what spreads slotDefaults(m.json)
  // under this empty config, so a repo that never touches `depth` still
  // behaves as if it were 3 until the module's own default changes.
  assert.deepEqual(data.modules.beta.config, {});
});

// A configured docs root that matches zero tracked .md files is a hard
// drift finding downstream (check.mjs's "zero-match root" check), not a
// warning, so proposing one at init would hand a fresh adopter a failing
// gate for a directory that merely happens to exist.
test('init --apply proposes no docs root for a docs/ directory holding no markdown', () => {
  const { cliPath } = buildFixturePlugin({ withDocsModule: true });
  const repo = buildTargetRepo({ 'README.md': '# hi\n', 'docs/image.txt': 'not markdown\n' });
  const { code } = runCli(cliPath, ['init', '--repo', repo, '--apply']);
  assert.equal(code, 0);
  const data = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.deepEqual(data.modules.docs.config.roots, [], 'docs/ exists but has no .md file anywhere under it');
});

test('init --apply proposes the docs root once a markdown file exists anywhere under it', () => {
  const { cliPath } = buildFixturePlugin({ withDocsModule: true });
  const repo = buildTargetRepo({ 'README.md': '# hi\n', 'docs/nested/note.md': '# note\n' });
  const { code } = runCli(cliPath, ['init', '--repo', repo, '--apply']);
  assert.equal(code, 0);
  const data = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.deepEqual(data.modules.docs.config.roots, ['docs'], 'a nested .md file is enough to qualify the directory');
});

// ── render ───────────────────────────────────────────────────────────────

test('render: requires house.json (exit 2 when absent)', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo();
  const { code, err } = runCli(cliPath, ['render', '--repo', repo]);
  assert.equal(code, 2);
  assert.match(err, /house\.json/);
});

test('render dry-run prints the plan and writes nothing', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo();
  runCli(cliPath, ['init', '--repo', repo, '--apply']);
  const { code, out } = runCli(cliPath, ['render', '--repo', repo]);
  assert.equal(code, 0);
  assert.match(out, /create\s+\.claude\/rules\/house\/alpha\.md/);
  // beta is disabled after init (generic detect module, no probe match), so
  // it does not appear in the plan at all.
  assert.doesNotMatch(out, /beta\.md/);

  assert.ok(!existsSync(join(repo, '.claude', 'rules', 'house', 'alpha.md')), 'dry run must not write the rule file');
  assert.ok(!existsSync(join(repo, '.house')), 'dry run must not create .house/');
});

test('render --apply vendors a rule with paths: frontmatter, the managed header, the correct body hash, and writes lock/INDEX/check.mjs', () => {
  const { cliPath, dir: fixtureDir } = buildFixturePlugin();
  const repo = buildTargetRepo();
  runCli(cliPath, ['init', '--repo', repo, '--apply']);
  const { code } = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(code, 0);

  const ruleFile = join(repo, '.claude', 'rules', 'house', 'alpha.md');
  assert.ok(existsSync(ruleFile));
  const content = readFileSync(ruleFile, 'utf8');
  const lines = content.split('\n');

  // paths: frontmatter, expanded from alpha's literal defaultPaths.
  assert.equal(lines[0], '---');
  assert.equal(lines[1], 'paths:');
  assert.equal(lines[2], '  - src/**');
  assert.equal(lines[3], '  - scripts/**');
  assert.equal(lines[4], '---');

  // Managed header: one line, exact format, with a correct body-sha256.
  const header = lines[5];
  const expectedBodyHash = sha256Hex(ALPHA_BODY);
  const expectedHeader = `<!-- house-managed v9.9.9 module=alpha source=modules/alpha/rules/alpha.md body-sha256=${expectedBodyHash} DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->`;
  assert.equal(header, expectedHeader);

  // Then the source body verbatim.
  const bodyStart = content.indexOf(`${header}\n`) + header.length + 1;
  assert.equal(content.slice(bodyStart), ALPHA_BODY);

  // .house/check.mjs is vendored byte-identical to the fixture's payload.
  const vendoredCheck = readFileSync(join(repo, '.house', 'check.mjs'), 'utf8');
  const sourceCheck = readFileSync(join(fixtureDir, 'payload', 'check.mjs'), 'utf8');
  assert.equal(vendoredCheck, sourceCheck);

  // .house/lock.json: {"files":[{path,module,source,bodySha256}]}
  const lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  assert.ok(Array.isArray(lock.files));
  const alphaEntry = lock.files.find((e) => e.path === '.claude/rules/house/alpha.md');
  assert.ok(alphaEntry);
  assert.equal(alphaEntry.module, 'alpha');
  assert.equal(alphaEntry.source, 'modules/alpha/rules/alpha.md');
  assert.match(alphaEntry.bodySha256, /^[0-9a-f]{64}$/);

  // .house/INDEX.md names the file and its ## headings.
  const index = readFileSync(join(repo, '.house', 'INDEX.md'), 'utf8');
  assert.match(index, /\.claude\/rules\/house\/alpha\.md/);
  assert.match(index, /Do the thing/);
  assert.match(index, /Don't/);
});

test('render: a hand-edited vendored body is refused (naming the path), and --force-managed overwrites it', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo();
  runCli(cliPath, ['init', '--repo', repo, '--apply']);
  runCli(cliPath, ['render', '--repo', repo, '--apply']);

  const ruleFile = join(repo, '.claude', 'rules', 'house', 'alpha.md');
  const original = readFileSync(ruleFile, 'utf8');
  writeFileSync(ruleFile, `${original}\nhand-edited line\n`);

  // A second file we can prove is untouched by the all-or-nothing refusal.
  const checkFile = join(repo, '.house', 'check.mjs');
  const checkBefore = readFileSync(checkFile, 'utf8');
  const checkMtimeBefore = statSync(checkFile).mtimeMs;

  const refused = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /REFUSE/);
  assert.match(refused.out, /\.claude\/rules\/house\/alpha\.md/);

  // All-or-nothing: nothing was written, not even the unrelated clean file.
  assert.equal(readFileSync(ruleFile, 'utf8'), `${original}\nhand-edited line\n`);
  assert.equal(readFileSync(checkFile, 'utf8'), checkBefore);
  assert.equal(statSync(checkFile).mtimeMs, checkMtimeBefore);

  const forced = runCli(cliPath, ['render', '--repo', repo, '--apply', '--force-managed', '.claude/rules/house/alpha.md']);
  assert.equal(forced.code, 0);
  assert.equal(readFileSync(ruleFile, 'utf8'), original);
});

test('render: a rule whose $slot expands to an empty config is skipped and reported, not written', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo();
  writeHouseJson(repo, {
    ...BASE_HOUSE_JSON,
    modules: {
      alpha: { enabled: true, config: {} },
      beta: { enabled: true, config: { slot: [] } }, // enabled, but its only defaultPaths entry is "$slot" and the slot is empty
    },
  });

  const { code, out } = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(code, 0); // a skip is not a refusal
  assert.match(out, /skip\s+\.claude\/rules\/house\/beta\.md/);
  assert.match(out, /config slot|matched no file/);
  assert.ok(!existsSync(join(repo, '.claude', 'rules', 'house', 'beta.md')));
  // alpha, unaffected, still renders.
  assert.ok(existsSync(join(repo, '.claude', 'rules', 'house', 'alpha.md')));
});

test('render --apply is idempotent: a second run changes no file content or mtime', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo();
  runCli(cliPath, ['init', '--repo', repo, '--apply']);
  runCli(cliPath, ['render', '--repo', repo, '--apply']);

  const files = [
    join(repo, '.claude', 'rules', 'house', 'alpha.md'),
    join(repo, '.house', 'lock.json'),
    join(repo, '.house', 'INDEX.md'),
    join(repo, '.house', 'check.mjs'),
    join(repo, 'house.json'),
  ];
  const before = files.map((f) => ({ f, mtime: statSync(f).mtimeMs, content: readFileSync(f, 'utf8') }));

  const second = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(second.code, 0);

  for (const b of before) {
    assert.equal(readFileSync(b.f, 'utf8'), b.content, `${b.f} content changed on an idempotent re-render`);
    assert.equal(statSync(b.f).mtimeMs, b.mtime, `${b.f} was rewritten (mtime changed) on an idempotent re-render`);
  }
});

// ── doctor ───────────────────────────────────────────────────────────────

test('doctor: prints the effective branch guard in each of the three states, and exits 0 always', () => {
  const { cliPath } = buildFixturePlugin();

  // 1) A repo-local hook wins regardless of house.json.
  const repoA = buildTargetRepo();
  mkdirSync(join(repoA, '.claude', 'hooks'), { recursive: true });
  writeFileSync(join(repoA, '.claude', 'hooks', 'no-direct-master.sh'), '#!/usr/bin/env bash\nexit 0\n');
  const a = runCli(cliPath, ['doctor', '--repo', repoA]);
  assert.equal(a.code, 0);
  assert.match(a.out, /effective branch guard:\s*repo/);

  // 1b) A settings.json with a non-empty PreToolUse hook counts as "repo";
  // a bare `hooks` key, or a PostToolUse-only block, does NOT (that is the
  // hook's own deferral rule, and doctor must not report a guard the hook
  // would not defer to).
  const repoA2 = buildTargetRepo();
  writeHouseJson(repoA2, { ...BASE_HOUSE_JSON, modules: {} });
  mkdirSync(join(repoA2, '.claude'), { recursive: true });
  writeFileSync(join(repoA2, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] } }, null, 2));
  const a2 = runCli(cliPath, ['doctor', '--repo', repoA2]);
  assert.equal(a2.code, 0);
  assert.match(a2.out, /effective branch guard:\s*repo/);
  for (const notAGuard of [{ hooks: {} }, { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [] }] } }, { hooks: { PreToolUse: [] } }]) {
    writeFileSync(join(repoA2, '.claude', 'settings.json'), JSON.stringify(notAGuard, null, 2));
    const r = runCli(cliPath, ['doctor', '--repo', repoA2]);
    assert.match(r.out, /effective branch guard:\s*plugin/, `${JSON.stringify(notAGuard)} is not a repo guard`);
  }

  // 2) No repo hook, house.json present with branchPolicy "pr" -> "plugin".
  const repoB = buildTargetRepo();
  writeHouseJson(repoB, { ...BASE_HOUSE_JSON, modules: {} });
  const b = runCli(cliPath, ['doctor', '--repo', repoB]);
  assert.equal(b.code, 0);
  assert.match(b.out, /effective branch guard:\s*plugin/);
  assert.match(b.out, /caveat/i); // the "assumes the plugin is enabled" note

  // 3) No repo hook, house.json present with branchPolicy "direct" -> explicit NONE.
  const repoC = buildTargetRepo();
  writeHouseJson(repoC, { ...BASE_HOUSE_JSON, branchPolicy: 'direct', modules: {} });
  const c = runCli(cliPath, ['doctor', '--repo', repoC]);
  assert.equal(c.code, 0);
  assert.match(c.out, /effective branch guard:\s*NONE \(branchPolicy direct\)/);

  // 4) No repo hook, no house.json at all -> fail-open NONE.
  const repoD = buildTargetRepo();
  const d = runCli(cliPath, ['doctor', '--repo', repoD]);
  assert.equal(d.code, 0);
  assert.match(d.out, /effective branch guard:\s*NONE \(fail-open: no house\.json\)/);
});

// #32: "plugin" as the effective guard is a real choice, but doctor printed it
// identically whether the repo had decided it or had simply never looked. The
// line now says which, and points at the record that clears the checker's
// [guard] warning.
test('#32 doctor: the plugin guard line reports whether house.json records the choice', () => {
  const { cliPath } = buildFixturePlugin();

  // Recorded: a well-formed guard record, echoed with its date.
  const recorded = buildTargetRepo();
  writeHouseJson(recorded, {
    ...BASE_HOUSE_JSON,
    guard: { by: 'plugin', decided: '2026-08-31', why: 'user-scope plugin install is the guard here; no repo hook wanted' },
    modules: {},
  });
  const r = runCli(cliPath, ['doctor', '--repo', recorded]);
  assert.equal(r.code, 0);
  assert.match(r.out, /effective branch guard:\s*plugin \(recorded 2026-08-31\)/);
  assert.equal(JSON.parse(runCli(cliPath, ['doctor', '--repo', recorded, '--json']).out).guardRecorded, true);

  // Unrecorded: names the key to add and why adding it matters.
  const bare = buildTargetRepo();
  writeHouseJson(bare, { ...BASE_HOUSE_JSON, modules: {} });
  const b = runCli(cliPath, ['doctor', '--repo', bare]);
  assert.equal(b.code, 0);
  assert.match(b.out, /effective branch guard:\s*plugin \(unrecorded;/);
  assert.match(b.out, /"guard".*"by".*"plugin".*"decided".*"why"/, 'the line teaches the shape of the record');
  assert.match(b.out, /\[guard\]/, 'and names the warning it clears');
  assert.equal(JSON.parse(runCli(cliPath, ['doctor', '--repo', bare, '--json']).out).guardRecorded, false);

  // Negative controls: a record missing any one part is not a record. Each
  // case differs from the well-formed one above in exactly one field.
  const malformed = [
    { by: 'repo', decided: '2026-08-31', why: 'x' },
    { by: 'plugin', decided: '31-08-2026', why: 'x' },
    { by: 'plugin', decided: '2026-08-31', why: '   ' },
    { by: 'plugin', why: 'x' },
    { by: 'plugin', decided: '2026-08-31' },
    'plugin',
  ];
  const repoM = buildTargetRepo();
  for (const guard of malformed) {
    writeHouseJson(repoM, { ...BASE_HOUSE_JSON, guard, modules: {} });
    const m = runCli(cliPath, ['doctor', '--repo', repoM]);
    assert.match(m.out, /effective branch guard:\s*plugin \(unrecorded;/, `${JSON.stringify(guard)} is not a guard record`);
    assert.equal(JSON.parse(runCli(cliPath, ['doctor', '--repo', repoM, '--json']).out).guardRecorded, false);
  }
});

// ── rule-load positive control (#26) ────────────────────────────────────
//
// instructionsLoadedProbe used to be a substring search over two settings
// files, which could not see a hook the plugin itself ships and could be
// fooled by the word "InstructionsLoaded" appearing anywhere in a settings
// file. It now checks the real hook wiring (repo settings first, then the
// plugin's own hooks/hooks.json) and reports evidence read back from the
// hook's own log.

function writePluginInstructionsLoadedHooks(dir) {
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'hooks', 'hooks.json'), `${JSON.stringify({
    hooks: { InstructionsLoaded: [{ hooks: [{ type: 'command', command: 'node x', timeout: 5 }] }] },
  }, null, 2)}\n`);
}

function instructionsLoadedKey(repoRoot) { return repoRoot.replace(/\//g, '-'); }

function writeInstructionsLoadedLog(configDir, repoRoot, lines) {
  const dir = join(configDir, 'house', 'instructions-loaded');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${instructionsLoadedKey(repoRoot)}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

test('doctor: rule-load positive control reports none wired when nothing declares the hook', () => {
  const { cliPath } = buildFixturePlugin(); // this fixture ships no hooks/hooks.json at all
  const repo = buildTargetRepo();

  const r = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.equal(r.code, 0);
  assert.match(r.out, /rule-load positive control: none wired \(add an InstructionsLoaded hook/);

  const configDir = mkdtempSync(join(tmpdir(), 'house-config-'));
  CLEANUP_DIRS.push(configDir);
  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json'], { CLAUDE_CONFIG_DIR: configDir }).out);
  assert.deepEqual(j.ruleLoadProbe, {
    source: null,
    logPath: join(configDir, 'house', 'instructions-loaded', `${instructionsLoadedKey(repo)}.jsonl`),
    lastLoadAt: null,
    vendoredSeen: 0,
    vendoredTotal: 0,
    vendoredUnseen: [],
  });
});

test('doctor: rule-load positive control reports repo when .claude/settings.json declares a non-empty InstructionsLoaded array', () => {
  const { cliPath } = buildFixturePlugin(); // plugin does NOT declare it either, to isolate repo priority
  const repo = buildTargetRepo();
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), `${JSON.stringify({
    hooks: { InstructionsLoaded: [{ hooks: [{ type: 'command', command: 'node y' }] }] },
  }, null, 2)}\n`);

  const r = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.equal(r.code, 0);
  assert.match(r.out, /rule-load positive control: repo \(\.claude\/settings\.json\)/);
  assert.doesNotMatch(r.out.split('rule-load positive control:')[1] || '', /caveat/, 'the repo case carries no plugin-enablement caveat');

  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json']).out);
  assert.equal(j.ruleLoadProbe.source, 'repo');
});

test('doctor: the word "InstructionsLoaded" inside an unrelated settings.json string is not a repo guard (negative control)', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo();
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), `${JSON.stringify({
    note: 'we rely on InstructionsLoaded to see rule loads',
  }, null, 2)}\n`);

  const r = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.equal(r.code, 0);
  assert.match(r.out, /rule-load positive control: none wired/);
  assert.doesNotMatch(r.out, /rule-load positive control: repo/);

  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json']).out);
  assert.equal(j.ruleLoadProbe.source, null);
});

test('doctor: plugin hook declared but no log yet for this checkout', () => {
  const { dir, cliPath } = buildFixturePlugin();
  writePluginInstructionsLoadedHooks(dir);
  const repo = buildTargetRepo();

  const r = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.equal(r.code, 0);
  assert.match(r.out, /rule-load positive control: plugin hook declared; no log yet for this checkout \(start a session here, then re-run doctor\)/);
  assert.match(r.out, /caveat: assumes the house plugin is installed and enabled/);

  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json']).out);
  assert.equal(j.ruleLoadProbe.source, 'plugin');
  assert.equal(j.ruleLoadProbe.lastLoadAt, null);
  assert.equal(j.ruleLoadProbe.vendoredTotal, 0); // no house.json/render yet: nothing vendored
});

test('doctor: plugin hook with a log reports the last load and how many vendored rules were seen', () => {
  const { dir, cliPath } = buildFixturePlugin();
  writePluginInstructionsLoadedHooks(dir);
  const repo = buildTargetRepo();
  writeHouseJson(repo, { ...BASE_HOUSE_JSON, modules: { alpha: { enabled: true, config: {} } } });
  const rendered = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(rendered.code, 0, rendered.out + rendered.err);
  // alpha is the only rendered rule here; beta stays disabled (detect, unmatched).
  const lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  assert.equal(lock.files.filter((e) => e.path.startsWith('.claude/rules/house/')).length, 1);

  const configDir = mkdtempSync(join(tmpdir(), 'house-config-'));
  CLEANUP_DIRS.push(configDir);
  writeInstructionsLoadedLog(configDir, repo, [
    { ts: '2026-09-08T10:00:00.000Z', file_path: join(repo, '.claude', 'rules', 'house', 'alpha.md'), load_reason: 'session_start', session_id: 's1' },
    { ts: '2026-09-08T10:05:00.000Z', file_path: join(repo, '.claude', 'rules', 'house', 'alpha.md'), load_reason: 'path_glob_match', session_id: 's1' },
  ]);
  const env = { CLAUDE_CONFIG_DIR: configDir };

  const r = runCli(cliPath, ['doctor', '--repo', repo], env);
  assert.equal(r.code, 0);
  assert.match(r.out, /rule-load positive control: plugin hook; log .*: last load 2026-09-08T10:05:00\.000Z, 1 of 1 vendored rules seen/);
  assert.match(r.out, /caveat: assumes the house plugin is installed and enabled/);
  // Negative control for the unseen-rule line below: every vendored rule is
  // in the log here, so the suffix must be absent entirely rather than
  // printed empty. A line that always ends in "not seen in this log:" would
  // read as a finding on a healthy repo.
  assert.doesNotMatch(r.out, /not seen in this log/);

  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json'], env).out);
  assert.equal(j.ruleLoadProbe.source, 'plugin');
  assert.equal(j.ruleLoadProbe.lastLoadAt, '2026-09-08T10:05:00.000Z');
  assert.equal(j.ruleLoadProbe.vendoredSeen, 1);
  assert.equal(j.ruleLoadProbe.vendoredTotal, 1);
  assert.deepEqual(j.ruleLoadProbe.vendoredUnseen, []);
  assert.equal(j.ruleLoadProbe.logPath, join(configDir, 'house', 'instructions-loaded', `${instructionsLoadedKey(repo)}.jsonl`));
});

// Positive control for the same line: the count said "1 of 2" and stopped,
// which is where a real diagnosis begins. Found in this repo, where doctor
// reported 4 of 5 for days while the reader had no way to learn from that
// line which of the five was dead.
test('doctor: the rule-load line names the vendored rules the log has not seen', () => {
  const { dir, cliPath } = buildFixturePlugin();
  writePluginInstructionsLoadedHooks(dir);
  // beta's defaultPaths is the single `$slot` entry, so it renders only when
  // the slot names a glob that matches a tracked file: two vendored rules is
  // the whole point of this case, and one of them has to be beta.
  const repo = buildTargetRepo({
    'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n', 'tests/t.mjs': '//t\n',
  });
  writeHouseJson(repo, {
    ...BASE_HOUSE_JSON,
    modules: { alpha: { enabled: true, config: {} }, beta: { enabled: true, config: { slot: ['tests/**'] } } },
  });
  const rendered = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(rendered.code, 0, rendered.out + rendered.err);
  const lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  const dests = lock.files.filter((e) => e.path.startsWith('.claude/rules/house/')).map((e) => e.path);
  assert.equal(dests.length, 2, `expected two vendored rules, got ${JSON.stringify(dests)}`);

  const configDir = mkdtempSync(join(tmpdir(), 'house-config-'));
  CLEANUP_DIRS.push(configDir);
  // Only the first dest appears in the log; the second is the planted
  // violation this control exists to catch.
  const [seenDest, unseenDest] = dests;
  writeInstructionsLoadedLog(configDir, repo, [
    { ts: '2026-09-08T10:00:00.000Z', file_path: join(repo, seenDest), load_reason: 'path_glob_match', session_id: 's1' },
  ]);
  const env = { CLAUDE_CONFIG_DIR: configDir };

  const r = runCli(cliPath, ['doctor', '--repo', repo], env);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 of 2 vendored rules seen; not seen in this log: /);
  const unseenBase = unseenDest.slice('.claude/rules/house/'.length);
  assert.match(r.out, new RegExp(`not seen in this log: ${unseenBase.replace('.', '\\.')}$`, 'm'));
  // The rule that DID load must not be named, or the line stops discriminating.
  assert.doesNotMatch(r.out.split('not seen in this log:')[1], new RegExp(seenDest.slice('.claude/rules/house/'.length).replace('.', '\\.')));

  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json'], env).out);
  assert.deepEqual(j.ruleLoadProbe.vendoredUnseen, [unseenDest]);
  assert.equal(j.ruleLoadProbe.vendoredSeen, 1);
  assert.equal(j.ruleLoadProbe.vendoredTotal, 2);
});

test('doctor: lastLoadAt is the max timestamp seen, not the last line in file order (#37 concurrent appends land in completion order)', () => {
  const { dir, cliPath } = buildFixturePlugin();
  writePluginInstructionsLoadedHooks(dir);
  const repo = buildTargetRepo();

  const configDir = mkdtempSync(join(tmpdir(), 'house-config-'));
  CLEANUP_DIRS.push(configDir);
  // The later-timestamped record lands first on disk, as a slower hook
  // process's earlier-stamped append can finish after a faster one's later
  // append once both are writing concurrently. File order must not win.
  writeInstructionsLoadedLog(configDir, repo, [
    { ts: '2026-09-08T10:05:00.000Z', file_path: 'a.md', load_reason: 'path_glob_match', session_id: 's1' },
    { ts: '2026-09-08T10:00:00.000Z', file_path: 'b.md', load_reason: 'session_start', session_id: 's1' },
  ]);
  const env = { CLAUDE_CONFIG_DIR: configDir };

  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json'], env).out);
  assert.equal(j.ruleLoadProbe.lastLoadAt, '2026-09-08T10:05:00.000Z');
});

test('doctor: a malformed ts (not a real timestamp) is ignored for lastLoadAt rather than winning the max on a lexicographic fluke', () => {
  const { dir, cliPath } = buildFixturePlugin();
  writePluginInstructionsLoadedHooks(dir);
  const repo = buildTargetRepo();

  const configDir = mkdtempSync(join(tmpdir(), 'house-config-'));
  CLEANUP_DIRS.push(configDir);
  // 'seed-0' starts with 's', which sorts above every digit, so a plain
  // string max with no shape guard would pin lastLoadAt to this garbage
  // forever instead of the one real, parseable timestamp in the log.
  writeInstructionsLoadedLog(configDir, repo, [
    { ts: 'seed-0', file_path: 'a.md', load_reason: 'path_glob_match', session_id: 's1' },
    { ts: '2026-09-08T10:00:00.000Z', file_path: 'b.md', load_reason: 'session_start', session_id: 's1' },
  ]);
  const env = { CLAUDE_CONFIG_DIR: configDir };

  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json'], env).out);
  assert.equal(j.ruleLoadProbe.lastLoadAt, '2026-09-08T10:00:00.000Z');
});

test('doctor: honors CLAUDE_CODE_PROJECT_DIR_NAME beside CLAUDE_CONFIG_DIR for the log key, matching the hook\'s own derivation', () => {
  const { dir, cliPath } = buildFixturePlugin();
  writePluginInstructionsLoadedHooks(dir);
  const repo = buildTargetRepo();
  const configDir = mkdtempSync(join(tmpdir(), 'house-config-'));
  CLEANUP_DIRS.push(configDir);
  const named = 'my-named-project';
  mkdirSync(join(configDir, 'house', 'instructions-loaded'), { recursive: true });
  writeFileSync(join(configDir, 'house', 'instructions-loaded', `${named}.jsonl`), `${JSON.stringify({ ts: '2026-09-08T10:00:00.000Z', file_path: 'x', load_reason: 'session_start', session_id: 's1' })}\n`);

  const env = { CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_PROJECT_DIR_NAME: named };
  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json'], env).out);
  assert.equal(j.ruleLoadProbe.logPath, join(configDir, 'house', 'instructions-loaded', `${named}.jsonl`));
  assert.equal(j.ruleLoadProbe.lastLoadAt, '2026-09-08T10:00:00.000Z');
});

// ── check ────────────────────────────────────────────────────────────────

// #32: `house check` used to prefer the repo's vendored .house/check.mjs when
// one existed, which made the command mean "the checker this repo already has"
// rather than "the checker this plugin ships". sync/SKILL.md step 6 uses it to
// PREVIEW the checker a sync is about to vendor, so in any repo that had ever
// rendered the preview answered with the old copy. It now always runs the
// payload; the vendored copy is CI's, run directly as `node .house/check.mjs`.
test('check: always runs the plugin payload, never the repo\'s vendored copy, and banners the path on stderr', () => {
  const { cliPath, dir: fixtureDir } = buildFixturePlugin();
  const payload = join(fixtureDir, 'payload', 'check.mjs');

  // Nothing vendored yet: the payload runs and its exit code passes through.
  const repo = buildTargetRepo();
  const fresh = runCli(cliPath, ['check', '--repo', repo]);
  assert.equal(fresh.code, 0);
  assert.match(fresh.out, /fake house check: ok/);
  assert.ok(fresh.err.includes(payload), `the banner names the payload it ran:\n${fresh.err}`);

  // Vendor a checker, then overwrite it with a fake that is impossible to
  // confuse with the payload: a different marker on stdout and a different
  // exit code. Running it would be visible in both.
  runCli(cliPath, ['init', '--repo', repo, '--apply']);
  runCli(cliPath, ['render', '--repo', repo, '--apply']);
  const vendoredPath = join(repo, '.house', 'check.mjs');
  assert.ok(existsSync(vendoredPath), 'precondition: render --apply vendored a checker');
  writeFileSync(vendoredPath, "#!/usr/bin/env node\nconsole.log('VENDORED COPY RAN');\nprocess.exit(7);\n");

  const after = runCli(cliPath, ['check', '--repo', repo]);
  assert.doesNotMatch(after.out, /VENDORED COPY RAN/, 'the vendored copy must not run');
  assert.notEqual(after.code, 7, 'and its exit code must not be the one that passes through');
  assert.equal(after.code, 0, 'the payload ran instead, so its 0 passes through');
  assert.match(after.out, /fake house check: ok/);
  assert.ok(after.err.includes(payload), `the banner still names the payload:\n${after.err}`);
  // stdout stays clean: `house check --json` output is parsed off it.
  assert.doesNotMatch(after.out, /running the plugin payload/, 'the banner belongs on stderr only');
});

// #12: render OWNS the vendored tree. When a module's paths narrow until they
// match nothing, the rule is skipped -- but a copy from a prior, broader render
// was left on disk (repo-c had to `git rm` a stale data-pipelines.md by hand).
// render --apply must remove any managed file no longer in the plan.
test('#12: render --apply removes a rule orphaned by a narrow-to-zero module; in-plan files stay', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo(); // has src/a.js, scripts/b.mjs

  // First render: alpha (literal src/**, scripts/**) and beta (slot=['src/**'])
  // both vendor a rule.
  writeHouseJson(repo, {
    ...BASE_HOUSE_JSON,
    modules: {
      alpha: { enabled: true, config: {} },
      beta: { enabled: true, config: { slot: ['src/**'] } },
    },
  });
  const first = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(first.code, 0, first.out + first.err);
  assert.doesNotMatch(first.out, /Removed/, 'a first render removes nothing');
  const alphaFile = join(repo, '.claude', 'rules', 'house', 'alpha.md');
  const betaFile = join(repo, '.claude', 'rules', 'house', 'beta.md');
  assert.ok(existsSync(alphaFile), 'alpha vendored');
  assert.ok(existsSync(betaFile), 'beta vendored');
  let lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  assert.ok(lock.files.some((e) => e.path === '.claude/rules/house/beta.md'), 'beta recorded in the lock');

  // Narrow beta to zero matches (empty slot) and re-render.
  writeHouseJson(repo, {
    ...BASE_HOUSE_JSON,
    modules: {
      alpha: { enabled: true, config: {} },
      beta: { enabled: true, config: { slot: [] } },
    },
  });
  const second = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(second.code, 0, second.out + second.err);

  // Positive: the orphaned beta.md is removed on disk AND dropped from the lock.
  assert.ok(!existsSync(betaFile), 'orphaned beta.md removed on re-render');
  assert.match(second.out, /Removed[^]*beta\.md/);
  lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  assert.ok(!lock.files.some((e) => e.path === '.claude/rules/house/beta.md'), 'beta dropped from the lock');
  // Negative: alpha, still in the plan, is untouched (tree matches the plan).
  assert.ok(existsSync(alphaFile), 'in-plan alpha.md left intact');
  assert.ok(lock.files.some((e) => e.path === '.claude/rules/house/alpha.md'), 'alpha still in the lock');
});

// ── #18: a gitignored house destination is invisible to the checker ──────
//
// repo-e's .gitignore blanket-ignored `.claude/`, so the vendored
// rules never reached `git ls-files` and the checker's drift/shape/coload/
// tamper families printed a false "0 findings". init, render, and doctor
// must say so, with the fix (narrow the rule to .claude/settings.local.json).

test('#18 init: warns when .gitignore ignores a house write destination (positive); silent when only settings.local.json is ignored (negative)', () => {
  const { cliPath } = buildFixturePlugin();

  const repoA = buildTargetRepo({ 'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n', '.gitignore': '.claude/\n' });
  const a = runCli(cliPath, ['init', '--repo', repoA]);
  assert.equal(a.code, 0, a.out + a.err);
  assert.match(a.out, /warning: .*\.gitignore:1 .*\.claude\//, 'names the ignore source line and pattern');
  assert.match(a.out, /\.claude\/settings\.local\.json/, 'names the narrowing fix');
  const aj = runCli(cliPath, ['init', '--repo', repoA, '--json']);
  const probe = JSON.parse(aj.out).probe;
  assert.ok(Array.isArray(probe.ignoredHouseDests) && probe.ignoredHouseDests.some((e) => e.path.startsWith('.claude/rules/house/')),
    `probe.ignoredHouseDests must name the ignored rules dir, got ${JSON.stringify(probe.ignoredHouseDests)}`);

  const repoB = buildTargetRepo({ 'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n', '.gitignore': '.claude/settings.local.json\n' });
  const b = runCli(cliPath, ['init', '--repo', repoB]);
  assert.equal(b.code, 0, b.out + b.err);
  assert.doesNotMatch(b.out, /\.gitignore:/, 'a narrowed ignore must not warn');
  const bj = runCli(cliPath, ['init', '--repo', repoB, '--json']);
  assert.deepEqual(JSON.parse(bj.out).probe.ignoredHouseDests, []);
});

test('#18 render: warns about an ignored destination in dry run and --apply, still writes it, exit code unchanged', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo({ 'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n', '.gitignore': '.house/\n' });
  writeHouseJson(repo, { ...BASE_HOUSE_JSON, modules: { alpha: { enabled: true, config: {} } } });

  const dry = runCli(cliPath, ['render', '--repo', repo]);
  assert.equal(dry.code, 0, dry.out + dry.err);
  assert.match(dry.out, /warning: .*\.house\/check\.mjs.*\.gitignore:1/);

  const dryJson = runCli(cliPath, ['render', '--repo', repo, '--json']);
  const parsed = JSON.parse(dryJson.out);
  assert.ok(parsed.ignoredDests.some((e) => e.path === '.house/check.mjs'), `--json must carry ignoredDests, got ${JSON.stringify(parsed.ignoredDests)}`);

  const applied = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(applied.code, 0, applied.out + applied.err);
  assert.match(applied.out, /warning: .*\.house\/check\.mjs.*\.gitignore:1/);
  assert.ok(existsSync(join(repo, '.house', 'check.mjs')), 'the file is still written; the warning is advisory');
});

test('#18 doctor: reports git-ignored house destinations in both states', () => {
  const { cliPath } = buildFixturePlugin();

  const repoA = buildTargetRepo({ 'README.md': '# hi\n', '.gitignore': '.claude/\n' });
  const a = runCli(cliPath, ['doctor', '--repo', repoA]);
  assert.equal(a.code, 0);
  assert.match(a.out, /git-ignored house destinations: .*\.claude\/rules\/house.*\.gitignore:1/);
  const aj = JSON.parse(runCli(cliPath, ['doctor', '--repo', repoA, '--json']).out);
  assert.ok(aj.ignoredDests.some((e) => e.path.startsWith('.claude/rules/house/')));

  const repoB = buildTargetRepo({ 'README.md': '# hi\n', '.gitignore': '.claude/settings.local.json\n' });
  const b = runCli(cliPath, ['doctor', '--repo', repoB]);
  assert.equal(b.code, 0);
  assert.match(b.out, /git-ignored house destinations: none/);
  assert.deepEqual(JSON.parse(runCli(cliPath, ['doctor', '--repo', repoB, '--json']).out).ignoredDests, []);
});

// ── #19: expandPaths dedup ───────────────────────────────────────────────
//
// A slot value that repeats a literal (testing's `tests/**` from both the
// module.json literal and a repo's testGlobs) rendered the glob twice.
test('#19: a slot value repeating a literal renders once (positive); a distinct slot value renders beside it (negative)', () => {
  const { dir, cliPath } = buildFixturePlugin();
  writeTree(dir, {
    'modules/gamma/module.json': `${JSON.stringify({
      name: 'gamma', default: 'on', rules: ['rules/gamma.md'], files: [], configSlots: ['slot'],
      defaultPaths: ['src/**', '$slot'],
    }, null, 2)}\n`,
    'modules/gamma/rules/gamma.md': ALPHA_BODY,
  });
  const repo = buildTargetRepo(); // src/a.js and scripts/b.mjs are tracked
  const rendered = () => readFileSync(join(repo, '.claude', 'rules', 'house', 'gamma.md'), 'utf8');
  const count = (text, re) => (text.match(re) || []).length;

  writeHouseJson(repo, { ...BASE_HOUSE_JSON, modules: { gamma: { enabled: true, config: { slot: ['src/**'] } } } });
  const dup = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(dup.code, 0, dup.out + dup.err);
  assert.equal(count(rendered(), /^ {2}- src\/\*\*$/gm), 1, `expected src/** once:\n${rendered()}`);

  writeHouseJson(repo, { ...BASE_HOUSE_JSON, modules: { gamma: { enabled: true, config: { slot: ['scripts/**'] } } } });
  const distinct = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(distinct.code, 0, distinct.out + distinct.err);
  assert.equal(count(rendered(), /^ {2}- src\/\*\*$/gm), 1);
  assert.equal(count(rendered(), /^ {2}- scripts\/\*\*$/gm), 1);
});

test('#18 init: a path re-included by a negated .gitignore pattern is not reported as ignored', () => {
  const { cliPath } = buildFixturePlugin();
  // `.claude/*` ignores everything under .claude except what `!.claude/rules/` re-includes.
  const repo = buildTargetRepo({ 'README.md': '# hi\n', '.gitignore': '.claude/*\n!.claude/rules/\n' });
  const r = runCli(cliPath, ['init', '--repo', repo, '--json']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(JSON.parse(r.out).probe.ignoredHouseDests, [], 'a negation match must not count as ignored');
});

test('#18 init: the ignore probe covers every module files[].dest, not only the fixed rule/lock paths', () => {
  const { dir, cliPath } = buildFixturePlugin();
  // delta ships a managed file under scripts/house/, like the real engineering/github modules.
  writeTree(dir, {
    'modules/delta/module.json': `${JSON.stringify({ name: 'delta', default: 'on', rules: [], files: [{ src: 'files/tool.mjs', dest: 'scripts/house/tool.mjs' }], configSlots: [], defaultPaths: [] }, null, 2)}\n`,
    'modules/delta/files/tool.mjs': 'export const t = 1;\n',
  });
  const repo = buildTargetRepo({ 'README.md': '# hi\n', '.gitignore': 'scripts/\n' });
  const r = runCli(cliPath, ['init', '--repo', repo]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /warning: .*scripts\/house\/tool\.mjs.*\.gitignore:1/, 'a managed file dest under an ignored dir is reported at init');
});

// ── #58: the git-hook floor (render, arming, doctor) ────────────────────
//
// The floor is the seven files the github module vendors under `.githooks/`.
// Three things have to be true for it to actually guard anything, and each one
// fails silently on its own: the files have to be written, they have to be
// EXECUTABLE (git silently ignores a hook without the bit), and `core.hooksPath`
// has to point at them (machine state living in .git/config, which no clone and
// no PR carries). The cases below cover all three plus the migration for repos
// that adopted the old hand-installed `templates/pre-commit`.
//
// Unlike the fixture modules above, this one copies the REAL
// plugins/house/hooks/arm-git-hooks.sh: it is the same file render shells out
// to and doctor probes with, so a stand-in would test nothing that ships.

const REAL_ARM_SCRIPT = join(HERE, '..', 'plugins', 'house', 'hooks', 'arm-git-hooks.sh');

const FLOOR_FILES = [
  'pre-commit', 'pre-push', 'reference-transaction', 'house-lib.sh',
  'pre-commit.d/10-house-branch', 'pre-push.d/10-house-branch',
  'reference-transaction.d/10-house-branch',
];

const SECRETS_TEMPLATE_BODY = '#!/usr/bin/env bash\n# fixture stand-in for templates/pre-commit.d/20-secrets\nexit 0\n';

/**
 * Give a fixture plugin a `github` module that vendors the seven floor files,
 * the 20-secrets template the SCAFFOLDS table names, and the real arming
 * script. The module has to be called `github`: that is the module gate the
 * scaffold row and the migration both read.
 */
function addGitHookFloor(dir) {
  const files = FLOOR_FILES.map((rel) => ({ src: `files/githooks/${rel}`, dest: `.githooks/${rel}` }));
  const tree = {
    'modules/github/module.json': `${JSON.stringify({
      name: 'github', default: 'on', rules: [], files, configSlots: [], defaultPaths: [],
    }, null, 2)}\n`,
    'templates/pre-commit.d/20-secrets': SECRETS_TEMPLATE_BODY,
  };
  for (const rel of FLOOR_FILES) {
    tree[`modules/github/files/githooks/${rel}`] = `#!/usr/bin/env bash\n# fixture floor file: ${rel}\nexit 0\n`;
  }
  writeTree(dir, tree);
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  copyFileSync(REAL_ARM_SCRIPT, join(dir, 'hooks', 'arm-git-hooks.sh'));
}

function buildFloorFixture() {
  const fx = buildFixturePlugin();
  addGitHookFloor(fx.dir);
  return fx;
}

/** A target repo with house.json already enabling only the github module. */
function buildFloorRepo(files) {
  const repo = buildTargetRepo(files);
  writeHouseJson(repo, { ...BASE_HOUSE_JSON, modules: { github: { enabled: true, config: {} } } });
  return repo;
}

function gitConfigGet(repo, key) {
  const res = spawnSync('git', ['-C', repo, 'config', '--get', key], { encoding: 'utf8' });
  return (res.stdout || '').trim();
}

// mktemp hands back /var/..., git answers /private/var/... on macOS, and the
// arming script normalizes with `pwd -P`. Compare against the resolved path or
// every arming assertion fails for a reason that has nothing to do with arming.
function floorDir(repo) { return join(realpathSync(repo), '.githooks'); }

function modeOf(p) { return statSync(p).mode & 0o777; }

// Two very different files live at `.githooks/pre-commit` in the wild, and the
// migration has to tell them apart: house's own secrets template, which an
// adopter installed by hand and may have edited, and an adopter's own hook,
// which house never wrote a line of. `PIIPATTERNS=(` is the template's marker
// (the array of regexes it scans with) and nothing else declares it. Round 1
// moved both to `20-secrets` and told both repos it was "your unmanaged copy of
// the old template", which is a false claim about somebody's own lint runner
// and an invitation to delete it.
const ADOPTER_PRE_COMMIT = [
  '#!/usr/bin/env bash',
  '# house secrets backstop -- an adopter\'s copy, with a line they added',
  'PIIPATTERNS=(',
  '  "AKIA[0-9A-Z]{16}"',
  ')',
  'echo "custom secret scan"',
  'exit 0',
  '',
].join('\n');
const OWN_PRE_COMMIT = '#!/usr/bin/env bash\n# this repo\'s own hook; house never wrote a line of it\nnpm run lint-staged\n';

test('#58 render --apply moves an adopter\'s unmanaged .githooks/pre-commit into pre-commit.d/20-secrets and writes the dispatcher over it', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  writeFileSync(join(repo, '.githooks', 'pre-commit'), ADOPTER_PRE_COMMIT);
  chmodSync(join(repo, '.githooks', 'pre-commit'), 0o755);

  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Moved \.githooks\/pre-commit \(your unmanaged copy of the old template\) to \.githooks\/pre-commit\.d\/20-secrets; the house dispatcher now runs it/);

  // The adopter's body survives, verbatim, at the new path. Overwriting it
  // would silently drop whatever they had added to it.
  assert.equal(readFileSync(join(repo, '.githooks', 'pre-commit.d', '20-secrets'), 'utf8'), ADOPTER_PRE_COMMIT);
  // ...and is NOT the template: a repo that already had a copy is not offered
  // a fresh one on top of it.
  assert.notEqual(readFileSync(join(repo, '.githooks', 'pre-commit.d', '20-secrets'), 'utf8'), SECRETS_TEMPLATE_BODY);

  // The dispatcher now owns .githooks/pre-commit.
  assert.equal(readFileSync(join(repo, '.githooks', 'pre-commit'), 'utf8'),
    '#!/usr/bin/env bash\n# fixture floor file: pre-commit\nexit 0\n');

  // The lock records the scaffold at the path the move landed on, so a later
  // render does not write the template beside it.
  const lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  assert.deepEqual(lock.scaffolds.find((e) => e.template === 'pre-commit.d/20-secrets'),
    { template: 'pre-commit.d/20-secrets', path: '.githooks/pre-commit.d/20-secrets' });

  // Idempotent: a second render neither moves anything nor re-offers the template.
  const again = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(again.code, 0, again.out + again.err);
  assert.doesNotMatch(again.out, /Moved|would move/);
  assert.equal(readFileSync(join(repo, '.githooks', 'pre-commit.d', '20-secrets'), 'utf8'), ADOPTER_PRE_COMMIT);
});

test('#58 render without --apply only promises the move ("would move"), classifies the dispatcher as create, and touches nothing', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  writeFileSync(join(repo, '.githooks', 'pre-commit'), ADOPTER_PRE_COMMIT);

  const dry = runCli(cliPath, ['render', '--repo', repo]);
  assert.equal(dry.code, 0, dry.out + dry.err);
  assert.match(dry.out, /would move \.githooks\/pre-commit \(your unmanaged copy of the old template\) to \.githooks\/pre-commit\.d\/20-secrets/);
  assert.doesNotMatch(dry.out, /^Moved /m);
  // Classified as create, NOT as the REFUSE a hand-edited managed file gets:
  // the adopter's copy is the previous shape of the same idea, not drift.
  assert.match(dry.out, /create\s+\.githooks\/pre-commit\b/);
  assert.doesNotMatch(dry.out, /REFUSE/);

  assert.equal(readFileSync(join(repo, '.githooks', 'pre-commit'), 'utf8'), ADOPTER_PRE_COMMIT, 'a dry run must not move the file');
  assert.ok(!existsSync(join(repo, '.githooks', 'pre-commit.d', '20-secrets')));

  const j = JSON.parse(runCli(cliPath, ['render', '--repo', repo, '--json']).out);
  assert.deepEqual(j.migrations, [{ from: '.githooks/pre-commit', to: '.githooks/pre-commit.d/20-secrets' }]);
});

// A lock that never recorded the dispatcher (a rebase onto a lock written
// before the floor, or a hand-deleted lock) must not read the dispatcher
// itself as an adopter's old hook and "migrate" it into the .d directory.
test('#58 render leaves a .githooks/pre-commit that is already the managed dispatcher alone, even with no lock entry for it', () => {
  const { cliPath, dir } = buildFloorFixture();
  const repo = buildFloorRepo();
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  copyFileSync(join(dir, 'modules', 'github', 'files', 'githooks', 'pre-commit'), join(repo, '.githooks', 'pre-commit'));

  const dry = runCli(cliPath, ['render', '--repo', repo]);
  assert.equal(dry.code, 0, dry.out + dry.err);
  assert.doesNotMatch(dry.out, /would move|Moved/);
  const j = JSON.parse(runCli(cliPath, ['render', '--repo', repo, '--json']).out);
  assert.deepEqual(j.migrations, []);

  const applied = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(applied.code, 0, applied.out + applied.err);
  assert.ok(!existsSync(join(repo, '.githooks', 'pre-commit.d', '15-local')), 'the dispatcher is not parked as a local hook');
});

// R2: the other file that lives at that path. A repo's own pre-commit hook is
// not a copy of anything of ours, so it goes to 15-local -- after the branch
// guard, before the secrets backstop -- and the line says whose file it is.
test('#58 render --apply moves a repo\'s OWN unmanaged pre-commit to pre-commit.d/15-local, and still offers the secrets scaffold', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  writeFileSync(join(repo, '.githooks', 'pre-commit'), OWN_PRE_COMMIT);
  chmodSync(join(repo, '.githooks', 'pre-commit'), 0o755);

  const dry = runCli(cliPath, ['render', '--repo', repo]);
  assert.equal(dry.code, 0, dry.out + dry.err);
  assert.match(dry.out, /would move \.githooks\/pre-commit \(your own pre-commit hook\) to \.githooks\/pre-commit\.d\/15-local; the house dispatcher now runs it after the branch guard/);
  assert.doesNotMatch(dry.out, /old template/, 'a repo\'s own hook must never be described as a copy of house\'s template');

  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^Moved \.githooks\/pre-commit \(your own pre-commit hook\) to \.githooks\/pre-commit\.d\/15-local; the house dispatcher now runs it after the branch guard$/m);

  // Their hook survives verbatim, one step ahead of the secrets backstop.
  assert.equal(readFileSync(join(repo, '.githooks', 'pre-commit.d', '15-local'), 'utf8'), OWN_PRE_COMMIT);
  assert.equal(modeOf(join(repo, '.githooks', 'pre-commit.d', '15-local')), 0o755);
  // And because this repo never had our template, it is still offered one: the
  // scaffold record must NOT have been pointed at 15-local.
  assert.equal(readFileSync(join(repo, '.githooks', 'pre-commit.d', '20-secrets'), 'utf8'), SECRETS_TEMPLATE_BODY);
  const lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  assert.deepEqual(lock.scaffolds.find((e) => e.template === 'pre-commit.d/20-secrets'),
    { template: 'pre-commit.d/20-secrets', path: '.githooks/pre-commit.d/20-secrets' });

  // Idempotent, like the other destination.
  const again = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.doesNotMatch(again.out, /Moved|would move/);
  assert.equal(readFileSync(join(repo, '.githooks', 'pre-commit.d', '15-local'), 'utf8'), OWN_PRE_COMMIT);
});

test('#58 render --apply writes every .githooks file executable, and restores a mode bit a later chmod dropped', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();

  const first = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(first.code, 0, first.out + first.err);
  for (const rel of FLOOR_FILES) {
    assert.equal(modeOf(join(repo, '.githooks', rel)), 0o755, `.githooks/${rel} is not 0755`);
  }
  // The scaffold in the same directory is run by the dispatcher, so it gets the
  // bit too.
  assert.equal(modeOf(join(repo, '.githooks', 'pre-commit.d', '20-secrets')), 0o755);

  // A checkout, an unzip, or a stray chmod can drop the bit without touching a
  // byte, which git reads as "no hook here". That file classifies `clean`
  // (content matches the lock), so only a mode pass catches it.
  chmodSync(join(repo, '.githooks', 'pre-push'), 0o644);
  const second = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(second.code, 0, second.out + second.err);
  assert.equal(modeOf(join(repo, '.githooks', 'pre-push')), 0o755, 'a clean file that lost the execute bit was not restored');
});

// R3: restoring the execute bit is not permission to widen the file. A 0600
// hook is somebody's deliberate choice (a shared machine, a tight umask), and
// git only needs the OWNER to be able to run it, so the bit is added per class
// that already has read: 0600 becomes 0700, never 0755.
test('#58 render --apply adds the execute bit per class that can read, and never widens a 0600 hook to 0755', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);

  chmodSync(join(repo, '.githooks', 'pre-push'), 0o600);
  chmodSync(join(repo, '.githooks', 'pre-commit'), 0o640);
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(modeOf(join(repo, '.githooks', 'pre-push')), 0o700, 'a 0600 hook must come back as 0700, not 0755');
  assert.equal(modeOf(join(repo, '.githooks', 'pre-commit')), 0o750, 'the group could read, so the group gets execute; other still gets nothing');
});

test('#58 render --apply arms the floor: core.hooksPath points at this repo\'s own .githooks', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  assert.equal(gitConfigGet(repo, 'core.hooksPath'), '', 'precondition: a fresh clone has no hooksPath');

  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(gitConfigGet(repo, 'core.hooksPath'), floorDir(repo));
  assert.match(r.out, /house: armed git hooks \(core\.hooksPath=/);

  // Already armed: silent on the next render, so the line means something.
  const again = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.doesNotMatch(again.out, /armed git hooks/);
});

// R1: SessionStart fires the arming script, and sessions start in bunches (a
// window per worktree, a render running beside them). They all reach for
// .git/config at once, one wins the lock, and the losers used to announce
// "the git-hook floor is NOT armed" about a repo that had just been armed --
// seven false alarms in ten concurrent runs. A loser now re-reads the setting
// before it says anything, because the question is whether the repo is armed,
// not whether THIS process is the one that armed it.
test('#58 arming is concurrency-safe: eight simultaneous runs never report NOT armed', async () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  execFileSync('git', ['-C', repo, 'config', '--unset', 'core.hooksPath']);
  assert.equal(gitConfigGet(repo, 'core.hooksPath'), '', 'precondition: every run starts from unarmed');

  const runs = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve) => {
    const p = spawn('bash', [REAL_ARM_SCRIPT, '--repo', repo], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  })));

  for (const r of runs) {
    assert.equal(r.code, 0, `arming must never exit non-zero: ${r.err}`);
    assert.doesNotMatch(r.out, /NOT armed/, `a losing run reported the repo unarmed: ${r.out}`);
    assert.doesNotMatch(r.out, /could not set core\.hooksPath/, r.out);
  }
  // One value, and it is the floor: the losers wrote nothing and claimed nothing.
  assert.equal(gitConfigGet(repo, 'core.hooksPath'), floorDir(repo));
  assert.equal(
    execFileSync('git', ['-C', repo, 'config', '--get-all', 'core.hooksPath'], { encoding: 'utf8' }).trim().split('\n').length,
    1, 'core.hooksPath must not be written twice',
  );
});

test('#58 render --apply refuses to arm a repo whose .git/hooks already holds a foreign executable hook, and names it', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  // A hand-written hook, or one the pre-commit framework / lefthook installed.
  // core.hooksPath REPLACES .git/hooks wholesale, so arming would disable it.
  const foreign = join(repo, '.git', 'hooks', 'pre-commit');
  mkdirSync(dirname(foreign), { recursive: true });
  writeFileSync(foreign, '#!/bin/sh\nexit 0\n');
  chmodSync(foreign, 0o755);

  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(gitConfigGet(repo, 'core.hooksPath'), '', 'house must not arm over a foreign hook');
  assert.match(r.out, /git-hook floor NOT armed/);
  assert.match(r.out, /pre-commit/);
  assert.match(r.out, /chain them|move them into/);

  // Negative control: a .sample file is not a hook git runs, so it must not
  // block arming. Removing the foreign hook clears the block on the next run.
  rmSync(foreign);
  writeFileSync(join(repo, '.git', 'hooks', 'pre-push.sample'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(repo, '.git', 'hooks', 'pre-push.sample'), 0o755);
  const after = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(gitConfigGet(repo, 'core.hooksPath'), floorDir(repo), 'a .sample must not count as a foreign hook');
  assert.match(after.out, /house: armed git hooks/);
});

test('#58 render --apply leaves a core.hooksPath that points elsewhere alone, and says how to chain the floor from there', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  mkdirSync(join(repo, '.husky', '_'), { recursive: true });
  execFileSync('git', ['-C', repo, 'config', 'core.hooksPath', '.husky/_']);

  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(gitConfigGet(repo, 'core.hooksPath'), '.husky/_', 'house must never overwrite somebody else\'s hooksPath');
  assert.match(r.out, /core\.hooksPath is \.husky\/_/);
  assert.match(r.out, /git-hook floor NOT armed/);
  assert.match(r.out, /chain it: add 'bash .*\/\.githooks\/pre-commit "\$@"'/);
});

// core.hooksPath lives in the config a linked worktree SHARES with its main
// checkout. Arming from inside a worktree would therefore point the whole clone
// at a directory that disappears when the worktree is removed, after which git
// runs no hooks at all and says nothing: the exact silent fail-open the floor
// exists to close. house's own convention is a worktree per change, so this is
// the common path, not an exotic one.
test('#58 render --apply inside a linked worktree never writes the shared core.hooksPath, and says where to set it', () => {
  const { cliPath } = buildFloorFixture();
  const main = buildFloorRepo();
  const wt = join(mkdtempSync(join(tmpdir(), 'house-wt-')), 'wt');
  CLEANUP_DIRS.push(dirname(wt));
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', '-b', 'feat/x', wt], { stdio: 'pipe' });

  const r = runCli(cliPath, ['render', '--repo', wt, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(existsSync(join(wt, '.githooks', 'pre-push')), 'the floor is still rendered into the worktree');
  assert.equal(gitConfigGet(main, 'core.hooksPath'), '', 'a worktree must not write the shared hooksPath');
  assert.match(r.out, /shared with the main checkout, so set it there/);
  assert.match(r.out, new RegExp(join(realpathSync(main), '.githooks').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const wj = JSON.parse(runCli(cliPath, ['doctor', '--repo', wt, '--json']).out);
  assert.equal(wj.gitHookFloor.linkedWorktree, true);
  assert.equal(wj.gitHookFloor.armed, false);
  assert.match(runCli(cliPath, ['doctor', '--repo', wt]).out, /shared with the main checkout, so arm it there/);

  // Arming the main checkout arms the worktree too: the hooks ask git for the
  // toplevel themselves, so one absolute path serves every worktree.
  assert.equal(runCli(cliPath, ['render', '--repo', main, '--apply']).code, 0);
  assert.equal(gitConfigGet(main, 'core.hooksPath'), floorDir(main));
  const armedWt = JSON.parse(runCli(cliPath, ['doctor', '--repo', wt, '--json']).out);
  assert.equal(armedWt.gitHookFloor.armed, true, 'the worktree inherits the main checkout\'s hooksPath');
  assert.doesNotMatch(runCli(cliPath, ['render', '--repo', wt, '--apply']).out, /NOT armed/);
});

test('#58 doctor reports the git-hook floor in every state, in text and as gitHookFloor in --json', () => {
  const { cliPath } = buildFloorFixture();

  // 1) Rendered and armed by render --apply.
  const armed = buildFloorRepo();
  assert.equal(runCli(cliPath, ['render', '--repo', armed, '--apply']).code, 0);
  const a = runCli(cliPath, ['doctor', '--repo', armed]);
  assert.equal(a.code, 0);
  assert.match(a.out, new RegExp(`git-hook floor: armed \\(core\\.hooksPath=${floorDir(armed).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const aj = JSON.parse(runCli(cliPath, ['doctor', '--repo', armed, '--json']).out);
  assert.equal(aj.gitHookFloor.applicable, true);
  assert.equal(aj.gitHookFloor.rendered, true);
  assert.equal(aj.gitHookFloor.armed, true);
  assert.equal(aj.gitHookFloor.hooksPath, floorDir(armed));
  assert.deepEqual(aj.gitHookFloor.foreignHooks, []);
  assert.deepEqual(aj.gitHookFloor.nonExecutable, []);
  assert.match(aj.gitHookFloor.gitVersion, /^\d+\.\d+/);
  assert.equal(typeof aj.gitHookFloor.referenceTransactionSupported, 'boolean');
  // reference-transaction only exists on git 2.28+, and doctor says which side
  // of that line this machine is on rather than implying full coverage.
  assert.match(a.out, aj.gitHookFloor.referenceTransactionSupported
    ? /reference-transaction: supported by git .* \(>= 2\.28\)/
    : /reference-transaction: inert on git .* \(needs 2\.28\)/);

  assert.deepEqual(aj.gitHookFloor.missing, [], 'a complete floor reports nothing missing');

  // 2) Adopted (branchPolicy pr) but never rendered.
  const unrendered = buildFloorRepo();
  const u = runCli(cliPath, ['doctor', '--repo', unrendered]);
  assert.match(u.out, /git-hook floor: not rendered here/);
  const uj = JSON.parse(runCli(cliPath, ['doctor', '--repo', unrendered, '--json']).out);
  assert.equal(uj.gitHookFloor.rendered, false);
  assert.deepEqual(uj.gitHookFloor.missing.slice().sort(), FLOOR_FILES.slice().sort(), 'every floor file is reported missing');
  for (const rel of FLOOR_FILES) assert.ok(u.out.includes(`.githooks/${rel}`), `doctor must name .githooks/${rel}`);

  // 2b) R4: rendered EXCEPT the library every guard sources. `rendered` is all
  // seven or nothing, because a floor missing only house-lib.sh fails every
  // commit closed and "rendered: true" would send the reader to the wrong file.
  const halfRendered = buildFloorRepo();
  assert.equal(runCli(cliPath, ['render', '--repo', halfRendered, '--apply']).code, 0);
  rmSync(join(halfRendered, '.githooks', 'house-lib.sh'));
  const h = runCli(cliPath, ['doctor', '--repo', halfRendered]);
  assert.match(h.out, /git-hook floor: not rendered here \(missing: \.githooks\/house-lib\.sh;/);
  const hj = JSON.parse(runCli(cliPath, ['doctor', '--repo', halfRendered, '--json']).out);
  assert.equal(hj.gitHookFloor.rendered, false);
  assert.deepEqual(hj.gitHookFloor.missing, ['house-lib.sh']);

  // 3) Rendered but not armed: the floor is on disk and inert, which is the
  // state every fresh clone starts in and the one the checker cannot see.
  const inert = buildFloorRepo();
  assert.equal(runCli(cliPath, ['render', '--repo', inert, '--apply']).code, 0);
  execFileSync('git', ['-C', inert, 'config', '--unset', 'core.hooksPath']);
  const i = runCli(cliPath, ['doctor', '--repo', inert]);
  assert.match(i.out, /git-hook floor: NOT armed -- core\.hooksPath is unset in this clone/);
  const ij = JSON.parse(runCli(cliPath, ['doctor', '--repo', inert, '--json']).out);
  assert.equal(ij.gitHookFloor.armed, false);
  assert.equal(ij.gitHookFloor.hooksPath, null);
  // A floor file that lost its execute bit is reported, not silently tolerated.
  chmodSync(join(inert, '.githooks', 'pre-push'), 0o644);
  const i2 = runCli(cliPath, ['doctor', '--repo', inert]);
  assert.match(i2.out, /not executable \(git silently ignores a hook without the bit\): pre-push/);
  assert.deepEqual(JSON.parse(runCli(cliPath, ['doctor', '--repo', inert, '--json']).out).gitHookFloor.nonExecutable, ['pre-push']);

  // 4) Not adopted at all: no house.json, so there is no policy to enforce.
  const plain = buildTargetRepo();
  const p = runCli(cliPath, ['doctor', '--repo', plain]);
  assert.match(p.out, /git-hook floor: not applicable/);
  assert.equal(JSON.parse(runCli(cliPath, ['doctor', '--repo', plain, '--json']).out).gitHookFloor.applicable, false);
});

test('#58 init: the wiring block names the once-per-clone arming command', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildTargetRepo();
  const r = runCli(cliPath, ['init', '--repo', repo]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /git config core\.hooksPath "\$\(pwd\)\/\.githooks"/);
  assert.ok(JSON.parse(runCli(cliPath, ['init', '--repo', repo, '--json']).out).wiring
    .some((l) => l.includes('core.hooksPath')), '--json wiring carries the same line');
});

test('#18 doctor: one ignore rule is reported once, not once per vendored file, and --json collapses the same way', () => {
  const { cliPath } = buildFixturePlugin();
  const repo = buildTargetRepo({ 'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n', '.gitignore': '.claude/\n' });
  writeHouseJson(repo, { ...BASE_HOUSE_JSON, modules: { alpha: { enabled: true, config: {} }, beta: { enabled: true, config: { slot: ['src/**'] } } } });
  const rendered = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(rendered.code, 0, rendered.out + rendered.err);
  const lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  assert.equal(lock.files.filter((e) => e.path.startsWith('.claude/rules/house/')).length, 2, 'two vendored rules under the ignored dir');
  const d = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json']).out);
  const rules = d.ignoredDests.filter((e) => e.path.startsWith('.claude/rules/house'));
  assert.equal(rules.length, 1, `one entry for the rules dir, got ${JSON.stringify(rules)}`);
  assert.equal(rules[0].path, '.claude/rules/house/**');
  const text = runCli(cliPath, ['doctor', '--repo', repo]).out;
  const line = text.split('\n').find((l) => l.startsWith('git-ignored house destinations:'));
  assert.equal((line.match(/\.gitignore:1/g) || []).length, 1, `the rule is cited once on the line: ${line}`);
});

// ── targets: the AGENTS.md block for Codex and Gemini CLI (ADR 0015) ──────
//
// A fixture with a claude-code module beside alpha, so the block can be shown
// to omit it: Claude Code already loads the vendored rules by path.
const CC_BODY = `# Claude Code rules

## Keep the root file short
Anchor: none (because fixture)
`;

function buildTargetsFixture() {
  const fx = buildFixturePlugin();
  writeTree(fx.dir, {
    'modules/claude-code/module.json': `${JSON.stringify({ name: 'claude-code', default: 'on', rules: ['rules/claude-code.md'], files: [], configSlots: [], defaultPaths: ['CLAUDE.md'] }, null, 2)}\n`,
    'modules/claude-code/rules/claude-code.md': CC_BODY,
  });
  return fx;
}

function targetsRepo(extra = {}) {
  return buildTargetRepo({ 'README.md': '# hi\n', 'CLAUDE.md': '# root\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n', ...extra });
}

function targetsHouse(targets, modules = { 'claude-code': { enabled: true, config: {} }, alpha: { enabled: true, config: {} } }) {
  return { ...BASE_HOUSE_JSON, ...(targets ? { targets } : {}), modules };
}

test('targets: render --apply creates AGENTS.md holding only the block, lists every module but claude-code, and locks the block', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo();
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  const raw = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.match(raw.split('\n')[0], /^<!-- house-managed:begin v9\.9\.9 .*-->$/);
  assert.ok(raw.endsWith('<!-- house-managed:end -->\n'), 'the block is the whole file');
  assert.equal((raw.match(/house-managed:begin/g) || []).length, 1);
  assert.match(raw, /\.claude\/rules\/house\//);
  assert.match(raw, /^### alpha$/m);
  assert.match(raw, /^Applies to: `src\/\*\*`, `scripts\/\*\*`$/m);
  assert.match(raw, /^Full text: `\.claude\/rules\/house\/alpha\.md`$/m);
  assert.match(raw, /^- Do the thing$/m);
  assert.doesNotMatch(raw, /^- Don't$/m, 'a bare Don\'t heading carries nothing as a bullet');
  assert.doesNotMatch(raw, /Body text for alpha/, 'headings only, never rule bodies');
  assert.doesNotMatch(raw, /### claude-code/, 'Claude Code loads its rules by path; the block omits the module');
  const lock = JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'));
  const entry = lock.files.find((e) => e.path === 'AGENTS.md');
  assert.ok(entry, 'the block has its own lock entry');
  assert.equal(entry.kind, 'block');
  assert.match(entry.bodySha256, /^[0-9a-f]{64}$/);
  assert.ok(!existsSync(join(repo, 'GEMINI.md')), 'no gemini target, no GEMINI.md');
  // Idempotent: a second render writes nothing new.
  const again = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(again.code, 0, again.out + again.err);
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), raw);
});

test('targets: an adopter\'s text above and below the block survives a re-render byte for byte', () => {
  const { cliPath } = buildTargetsFixture();
  const above = '# Our agents\n\nShared text every agent reads.\n';
  const repo = targetsRepo({ 'AGENTS.md': above });
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  let raw = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.ok(raw.startsWith(above), 'existing text kept as the prefix');
  const below = '\n## After the block\n\nMore adopter text.\n';
  writeFileSync(join(repo, 'AGENTS.md'), `${raw}${below}`);
  const withBlock = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  // Change the plan so the block really is rewritten: enable beta.
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex'], {
    'claude-code': { enabled: true, config: {} }, alpha: { enabled: true, config: {} }, beta: { enabled: true, config: { slot: ['src/**'] } },
  }));
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  raw = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.match(raw, /^### beta$/m, 'the block was rewritten');
  assert.notEqual(raw, withBlock);
  assert.ok(raw.startsWith(above), 'text above the block unchanged');
  assert.ok(raw.endsWith(`<!-- house-managed:end -->\n${below}`), 'text below the block unchanged');
});

test('targets: dropping codex and gemini removes the block, restores the adopter file, and deletes a file that held only the block', () => {
  const { cliPath } = buildTargetsFixture();
  const mine = '# Ours\n\nKeep me.\n';
  const repoA = targetsRepo({ 'AGENTS.md': mine });
  writeHouseJson(repoA, targetsHouse(['claude-code', 'codex', 'gemini']));
  assert.equal(runCli(cliPath, ['render', '--repo', repoA, '--apply']).code, 0);
  assert.notEqual(readFileSync(join(repoA, 'AGENTS.md'), 'utf8'), mine);
  writeHouseJson(repoA, targetsHouse(['claude-code']));
  const r = runCli(cliPath, ['render', '--repo', repoA, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(readFileSync(join(repoA, 'AGENTS.md'), 'utf8'), mine, 'adopter text restored exactly');
  assert.ok(!JSON.parse(readFileSync(join(repoA, '.house', 'lock.json'), 'utf8')).files.some((e) => e.path === 'AGENTS.md'));

  const repoB = targetsRepo();
  writeHouseJson(repoB, targetsHouse(['claude-code', 'codex']));
  assert.equal(runCli(cliPath, ['render', '--repo', repoB, '--apply']).code, 0);
  assert.ok(existsSync(join(repoB, 'AGENTS.md')));
  writeHouseJson(repoB, targetsHouse(null));
  assert.equal(runCli(cliPath, ['render', '--repo', repoB, '--apply']).code, 0);
  assert.ok(!existsSync(join(repoB, 'AGENTS.md')), 'nothing but the block was there, so the file goes');
});

test('targets: a hand edit inside the block is refused and --force-managed AGENTS.md restores it; an edit outside is never refused', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo({ 'AGENTS.md': '# Ours\n' });
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  const rendered = readFileSync(join(repo, 'AGENTS.md'), 'utf8');

  // Outside the markers: the adopter's own text, never read.
  const outside = rendered.replace('# Ours\n', '# Ours, edited\n');
  writeFileSync(join(repo, 'AGENTS.md'), outside);
  const ok = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), outside);

  // Inside the markers: refused, file untouched.
  const inside = outside.replace('- Do the thing\n', '- Do the thing, locally reworded\n');
  assert.notEqual(inside, outside);
  writeFileSync(join(repo, 'AGENTS.md'), inside);
  const refused = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(refused.code, 1, refused.out + refused.err);
  assert.match(refused.out, /REFUSE\s+AGENTS\.md/);
  assert.match(refused.out, /--force-managed AGENTS\.md/);
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), inside);

  const forced = runCli(cliPath, ['render', '--repo', repo, '--apply', '--force-managed', 'AGENTS.md']);
  assert.equal(forced.code, 0, forced.out + forced.err);
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), outside, 'block restored, outside edit kept');
});

test('targets: gemini scaffolds GEMINI.md importing AGENTS.md, unless Gemini is already wired or GEMINI.md exists', () => {
  const { cliPath } = buildTargetsFixture();
  const bare = targetsRepo();
  writeHouseJson(bare, targetsHouse(['claude-code', 'gemini']));
  const r = runCli(cliPath, ['render', '--repo', bare, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  const gemini = readFileSync(join(bare, 'GEMINI.md'), 'utf8');
  assert.match(gemini, /^@AGENTS\.md$/m);
  assert.ok(existsSync(join(bare, 'AGENTS.md')), 'gemini alone still gets the block');
  assert.ok(!JSON.parse(readFileSync(join(bare, '.house', 'lock.json'), 'utf8')).files.some((e) => e.path === 'GEMINI.md'), 'adopter-owned, never hash-checked');

  const settings = targetsRepo({ '.gemini/settings.json': JSON.stringify({ context: { fileName: ['AGENTS.md', 'GEMINI.md'] } }) });
  writeHouseJson(settings, targetsHouse(['claude-code', 'gemini']));
  assert.equal(runCli(cliPath, ['render', '--repo', settings, '--apply']).code, 0);
  assert.ok(!existsSync(join(settings, 'GEMINI.md')), 'settings already point Gemini CLI at AGENTS.md');

  const own = targetsRepo({ 'GEMINI.md': '# our gemini notes\n' });
  writeHouseJson(own, targetsHouse(['claude-code', 'gemini']));
  assert.equal(runCli(cliPath, ['render', '--repo', own, '--apply']).code, 0);
  assert.equal(readFileSync(join(own, 'GEMINI.md'), 'utf8'), '# our gemini notes\n', 'an existing GEMINI.md is never overwritten');
});

test('targets: doctor prints one line per target; only claude-code can carry verified evidence', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo();
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex', 'gemini']));
  const r = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^target claude-code: /m);
  assert.match(r.out, /^target codex: unverified: Codex fires no instructions-loaded event; git floor /m);
  assert.match(r.out, /^target gemini: unverified: Gemini CLI fires no instructions-loaded event; git floor /m);
  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json']).out);
  assert.deepEqual(j.targets.map((t) => t.target), ['claude-code', 'codex', 'gemini']);
  assert.ok(j.targets.filter((t) => t.target !== 'claude-code').every((t) => t.verified === false));

  const plain = targetsRepo();
  writeHouseJson(plain, targetsHouse(null));
  const p = runCli(cliPath, ['doctor', '--repo', plain]);
  assert.match(p.out, /^target claude-code: /m);
  assert.doesNotMatch(p.out, /^target codex/m, 'absent targets means claude-code only');
});

// ── ADR 0015 review fixes ─────────────────────────────────────────────────

test('targets: add then remove restores a CRLF file with no trailing newline byte for byte', () => {
  const { cliPath } = buildTargetsFixture();
  for (const mine of ['# Ours\r\nline two', '# Ours\r\n', '# Ours\n\n\n', 'no newline']) {
    const repo = targetsRepo({ 'AGENTS.md': mine });
    writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
    assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
    assert.ok(readFileSync(join(repo, 'AGENTS.md'), 'utf8').startsWith(mine));
    writeHouseJson(repo, targetsHouse(null));
    const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), mine, `${JSON.stringify(mine)} restored exactly`);
  }
});

const FENCED_EXAMPLE = '# Ours\n\nAn example of the markers:\n\n```md\n<!-- house-managed:begin v1.0.0 -->\nexample body\n<!-- house-managed:end -->\n```\n';

// The marker lines are reserved for the house block (ADR 0015): a marker
// anywhere else, a code example included, is refused with every marker line
// named rather than parsed around, since each round of fence parsing found a
// new Markdown edge.
test('targets: marker lines quoted in an adopter code example refuse (exit 2) naming every marker line, file untouched', () => {
  const { cliPath } = buildTargetsFixture();
  for (const [mine, named] of [
    [FENCED_EXAMPLE, [6, 8]],
    ['# Ours\n\n<!-- house-managed:end -->\n', [3]],
  ]) {
    const repo = targetsRepo({ 'AGENTS.md': mine });
    writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
    for (const extra of [[], ['--force-managed', 'AGENTS.md']]) {
      const r = runCli(cliPath, ['render', '--repo', repo, '--apply', ...extra]);
      assert.equal(r.code, 2, `${JSON.stringify(mine)} ${extra.join(' ')}: ${r.out}${r.err}`);
      for (const n of named) assert.match(r.out, new RegExp(`AGENTS\\.md:${n}\\b`));
      assert.match(r.out, /reserved for the house block/);
      assert.match(r.out, /code examples/);
      assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), mine, 'file untouched');
    }
  }
});

test('targets: a repo with no block in the lock and no codex or gemini target never touches an AGENTS.md that quotes the markers', () => {
  const { cliPath } = buildTargetsFixture();
  for (const mine of [FENCED_EXAMPLE, '# Ours\n\n```\n<!-- house-managed:end -->\n```\n']) {
    for (const extra of [[], ['--force-managed', 'AGENTS.md']]) {
      const repo = targetsRepo({ 'AGENTS.md': mine });
      writeHouseJson(repo, targetsHouse(null));
      const r = runCli(cliPath, ['render', '--repo', repo, '--apply', ...extra]);
      assert.equal(r.code, 0, `${JSON.stringify(mine)} ${extra.join(' ')}: ${r.out}${r.err}`);
      assert.doesNotMatch(r.out, /REFUSE/);
      assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), mine, 'AGENTS.md byte-identical');
      assert.ok(existsSync(join(repo, '.claude', 'rules', 'house', 'alpha.md')), 'the rules still render');
    }
  }
});

test('targets: an indented marker line is reserved too, and named', () => {
  const { cliPath } = buildTargetsFixture();
  const mine = '# Ours\n\n    <!-- house-managed:end -->\n';
  const repo = targetsRepo({ 'AGENTS.md': mine });
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.out, /AGENTS\.md:3\b/);
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), mine);
});

test('targets: the --json plan marks a reserved-marker refusal with its reason and 1-based marker lines', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo({ 'AGENTS.md': FENCED_EXAMPLE });
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  const r = runCli(cliPath, ['render', '--repo', repo, '--json']);
  assert.equal(r.code, 2, r.out + r.err);
  const entry = JSON.parse(r.out).plan.find((p) => p.path === 'AGENTS.md');
  assert.equal(entry.status, 'refuse');
  assert.equal(entry.reason, 'reserved');
  assert.deepEqual(entry.markerLines, [6, 8]);
});

test('targets: removal refuses (exit 2) naming the lines when the adopter quoted a marker beside the real block', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo({ 'AGENTS.md': '# Ours\n' });
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  const quoted = `${readFileSync(join(repo, 'AGENTS.md'), 'utf8')}\n\`\`\`\n<!-- house-managed:begin v1.0.0 -->\n\`\`\`\n`;
  writeFileSync(join(repo, 'AGENTS.md'), quoted);
  writeHouseJson(repo, targetsHouse(null));
  for (const extra of [[], ['--force-managed', 'AGENTS.md']]) {
    const r = runCli(cliPath, ['render', '--repo', repo, '--apply', ...extra]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /AGENTS\.md:3\b/);
    assert.match(r.out, /reserved for the house block/);
    assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), quoted, 'file untouched');
  }
});

test('targets: --force-managed after the end marker was deleted removes the stale body instead of doubling it', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo({ 'AGENTS.md': '# Ours\n' });
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  const good = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  writeFileSync(join(repo, 'AGENTS.md'), good.replace('<!-- house-managed:end -->\n', ''));
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 2, 'refused without force');
  const forced = runCli(cliPath, ['render', '--repo', repo, '--apply', '--force-managed', 'AGENTS.md']);
  assert.equal(forced.code, 0, forced.out + forced.err);
  const raw = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.equal((raw.match(/^## House rules$/gm) || []).length, 1, raw);
  assert.equal(raw, good);
});

test('targets: --force-managed refuses, naming the lines, when a broken block\'s stale body cannot be attributed', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo({ 'AGENTS.md': '# Ours\n' });
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  const broken = readFileSync(join(repo, 'AGENTS.md'), 'utf8').replace('<!-- house-managed:end -->\n', '').replace('- Do the thing\n', '- Do the thing, edited\n');
  writeFileSync(join(repo, 'AGENTS.md'), broken);
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply', '--force-managed', 'AGENTS.md']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.out, /AGENTS\.md:3-\d+/, 'names the unattributable lines');
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), broken, 'nothing written');
});

test('targets: an invalid `targets` value makes render refuse instead of falling back and removing the block', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo();
  writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  const before = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  for (const bad of ['codex', ['codex'], ['claude-code', 'cursor'], ['claude-code', 'codex', 'codex']]) {
    writeHouseJson(repo, targetsHouse(bad));
    const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
    assert.equal(r.code, 2, `${JSON.stringify(bad)} must refuse as unreadable input`);
    assert.match(r.err, /targets/);
    assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), before, 'the block is left alone');
  }
});

test('targets: removal strips nothing when the adopter already deleted the separator render added', () => {
  const { cliPath } = buildTargetsFixture();
  for (const mine of ['foo\n', 'foo\r\n']) {
    const repo = targetsRepo({ 'AGENTS.md': mine });
    writeHouseJson(repo, targetsHouse(['claude-code', 'codex']));
    assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
    const raw = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
    assert.ok(raw.startsWith(`${mine}\n<!-- house-managed:begin`), 'render added one separator newline');
    writeFileSync(join(repo, 'AGENTS.md'), `${mine}${raw.slice(mine.length + 1)}`);
    writeHouseJson(repo, targetsHouse(null));
    const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), mine, `${JSON.stringify(mine)} keeps its own bytes`);
  }
});

test('targets: the dry-run plan lists the GEMINI.md scaffold --apply would write', () => {
  const { cliPath } = buildTargetsFixture();
  const repo = targetsRepo();
  writeHouseJson(repo, targetsHouse(['claude-code', 'gemini']));
  const r = runCli(cliPath, ['render', '--repo', repo]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^scaffold\s+GEMINI\.md/m);
  assert.ok(!existsSync(join(repo, 'GEMINI.md')), 'dry run writes nothing');
  const j = JSON.parse(runCli(cliPath, ['render', '--repo', repo, '--json']).out);
  assert.ok(j.scaffolds.includes('GEMINI.md'));
});

// ── #135: house enable, in an already-adopted repo ──────────────────────
//
// gamma and delta stand in for an opt-in module like security: default off,
// each with atAdoption steps. gamma's default roots list lib/** beside src/**,
// and the target repo has no lib/, so that path is dropped.

function buildEnableFixture() {
  const fx = buildFixturePlugin();
  writeTree(fx.dir, {
    'modules/gamma/module.json': `${JSON.stringify({
      name: 'gamma', default: 'off', rules: ['rules/gamma.md'], files: [],
      configSlots: [{ name: 'gammaRoots', default: ['src/**', 'lib/**'] }],
      defaultPaths: ['$gammaRoots'],
      atAdoption: [
        { id: 'scan-on', step: 'Turn on scanning.' },
        { id: 'owners', step: 'Add an owners entry.' },
      ],
    }, null, 2)}\n`,
    'modules/gamma/rules/gamma.md': ALPHA_BODY,
    'modules/delta/module.json': `${JSON.stringify({
      name: 'delta', default: 'off', rules: ['rules/delta.md'], files: [], configSlots: [],
      defaultPaths: ['scripts/**'],
      atAdoption: [{ id: 'deny-list', step: 'Add the deny list to user settings.' }],
    }, null, 2)}\n`,
    'modules/delta/rules/delta.md': BETA_BODY,
  });
  return fx;
}

// An adopted repo: house.json written, rendered once, everything committed.
function adoptedRepo(cliPath, modules = { alpha: { enabled: true, config: {} }, beta: { enabled: false, config: {} } }) {
  const repo = buildTargetRepo();
  writeHouseJson(repo, { ...BASE_HOUSE_JSON, modules });
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  commitAll(repo, 'adopt');
  return repo;
}

function gitStatusShort(repo) {
  return execFileSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' });
}

test('#135 enable: refuses a repo with no house.json and points at bootstrap', () => {
  const { cliPath } = buildEnableFixture();
  const repo = buildTargetRepo();
  const r = runCli(cliPath, ['enable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /bootstrap/);
  assert.equal(gitStatusShort(repo), '', 'nothing written');
});

test('#135 enable: an unknown module is refused by name and nothing is written', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath);
  const r = runCli(cliPath, ['enable', 'gamma', 'nosuch', '--repo', repo, '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /`nosuch` is not a module/);
  assert.match(r.err, /gamma/, 'lists the modules that do exist');
  assert.equal(gitStatusShort(repo), '');
});

test('#135 enable: plan only prints the house.json diff, the files, the checklist, and the load cost, and writes nothing', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath);
  const r = runCli(cliPath, ['enable', 'gamma', '--repo', repo]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^\+ +"gamma": \{"enabled":true,"config":\{\}\}$/m, 'house.json diff');
  assert.match(r.out, /^create\s+\.claude\/rules\/house\/gamma\.md/m, 'the file render would write');
  assert.match(r.out, /\[ \] scan-on: Turn on scanning\./);
  assert.match(r.out, /\[ \] owners: Add an owners entry\./);
  assert.match(r.out, /Load cost/);
  assert.match(r.out, /gamma: \+\d+ lines on \d+ tracked path/);
  assert.match(r.out, /dropped.*lib\/\*\*/, 'a default path whose first segment does not resolve is dropped');
  assert.match(r.out, /--apply/);
  assert.equal(gitStatusShort(repo), '', 'plan only leaves the tree untouched');
});

test('#135 enable --apply: two modules in one run, one render, then the vendored checker', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath);
  const r = runCli(cliPath, ['enable', 'gamma', 'delta', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.equal(house.modules.gamma.enabled, true);
  assert.equal(house.modules.delta.enabled, true);
  assert.equal(house.modules.alpha.enabled, true, 'other modules untouched');
  const gamma = readFileSync(join(repo, '.claude', 'rules', 'house', 'gamma.md'), 'utf8');
  assert.match(gamma, /^ {2}- src\/\*\*$/m);
  assert.doesNotMatch(gamma, /lib\/\*\*/, 'unresolved path dropped in the rendered rule');
  assert.ok(existsSync(join(repo, '.claude', 'rules', 'house', 'delta.md')));
  assert.equal((r.out.match(/^Rendering /gm) || []).length, 1, `one render for both modules:\n${r.out}`);
  assert.match(r.out, /fake house check: ok/, 'the vendored checker ran and its output is printed');
});

test('#135 enable: a module already on is reported, not an error, and the rest still plan', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath);
  const solo = runCli(cliPath, ['enable', 'alpha', '--repo', repo, '--apply']);
  assert.equal(solo.code, 0, solo.out + solo.err);
  assert.match(solo.out, /`alpha` is already on/);
  assert.equal(gitStatusShort(repo), '', 'nothing to change, nothing written');
  const both = runCli(cliPath, ['enable', 'alpha', 'gamma', '--repo', repo]);
  assert.equal(both.code, 0, both.out + both.err);
  assert.match(both.out, /`alpha` is already on/);
  assert.match(both.out, /"gamma": \{"enabled":true/);
});

test('#135 enable: the load cost names a path the new modules push over the co-load ceiling', () => {
  const { cliPath } = buildEnableFixture();
  const roomy = adoptedRepo(cliPath);
  const under = runCli(cliPath, ['enable', 'gamma', 'delta', '--repo', roomy]);
  assert.equal(under.code, 0, under.out + under.err);
  assert.match(under.out, /no path exceeds the co-load ceiling of 400/, 'the default ceiling when docs sets none');
  // alpha already loads on src/a.js and scripts/b.mjs; a ceiling of 15 leaves
  // room for one fixture rule on a path and not for two.
  const tight = adoptedRepo(cliPath, {
    alpha: { enabled: true, config: {} },
    docs: { enabled: false, config: { maxCoLoadLines: 15 } },
  });
  const over = runCli(cliPath, ['enable', 'gamma', 'delta', '--repo', tight]);
  assert.equal(over.code, 0, over.out + over.err);
  assert.match(over.out, /2 path\(s\) would exceed the co-load ceiling of 15/);
  assert.match(over.out, /^ {2}src\/a\.js: \d+ -> \d+ lines \(gamma \+\d+\)$/m, 'lines the module adds on that path');
  assert.equal(gitStatusShort(tight), '', 'a plan over the ceiling still writes nothing');
});

test('#135 doctor: lists an enabled module\'s unconfirmed at-adoption steps, and stops once each is confirmed', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath, {
    alpha: { enabled: true, config: {} },
    gamma: { enabled: true, config: {} },
    delta: { enabled: false, config: {} },
  });
  const before = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.equal(before.code, 0);
  assert.match(before.out, /^at-adoption steps not confirmed for gamma: scan-on, owners \(record each with `house confirm gamma <step-id>`\)$/m);
  assert.doesNotMatch(before.out, /deny-list/, 'a disabled module is not listed');
  assert.doesNotMatch(before.out, /not confirmed for alpha/, 'a module with no steps is not listed');

  assert.equal(runCli(cliPath, ['confirm', 'gamma', 'scan-on', '--repo', repo]).code, 0);
  assert.match(runCli(cliPath, ['doctor', '--repo', repo]).out, /^at-adoption steps not confirmed for gamma: owners \(/m);

  assert.equal(runCli(cliPath, ['confirm', 'gamma', 'owners', '--repo', repo]).code, 0);
  const after = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.doesNotMatch(after.out, /at-adoption/);
  const j = JSON.parse(runCli(cliPath, ['doctor', '--repo', repo, '--json']).out);
  assert.deepEqual(j.atAdoption, []);
});

function enabledGammaRepo(cliPath) {
  return adoptedRepo(cliPath, {
    alpha: { enabled: true, config: {} },
    gamma: { enabled: true, config: {} },
    delta: { enabled: false, config: {} },
  });
}

test('#135 confirm: writes the step id and today\'s date beside the module\'s entry, and says what it wrote', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const r = runCli(cliPath, ['confirm', 'gamma', 'scan-on', '--repo', repo]);
  assert.equal(r.code, 0, r.out + r.err);
  const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  const date = house.modules.gamma.confirmed['scan-on'];
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  // Today in the local calendar, read independently of the CLI.
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
  assert.equal(date, today);
  assert.match(r.out, new RegExp(`modules\\.gamma\\.confirmed\\["scan-on"\\] = "${today}"`));
  assert.equal(house.modules.gamma.enabled, true, 'the rest of the entry is untouched');
  assert.ok(readFileSync(join(repo, 'house.json'), 'utf8').endsWith('}\n'), 'written the way render writes it');
});

test('#135 confirm: a repeat keeps the first date and says so', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  house.modules.gamma.confirmed = { owners: '2026-01-02' };
  writeHouseJson(repo, house);
  const r = runCli(cliPath, ['confirm', 'gamma', 'owners', '--repo', repo]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /already confirmed on 2026-01-02/);
  assert.equal(JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')).modules.gamma.confirmed.owners, '2026-01-02');
  assert.equal(gitStatusShort(repo), '', 'nothing rewritten');
});

test('#135 confirm: refuses an undeclared step id, a disabled module, an unknown module, and a repo with no house.json', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const undeclared = runCli(cliPath, ['confirm', 'gamma', 'nope', '--repo', repo]);
  assert.equal(undeclared.code, 2);
  assert.match(undeclared.err, /`nope` is not an at-adoption step of `gamma`.*scan-on, owners/);
  const disabled = runCli(cliPath, ['confirm', 'delta', 'deny-list', '--repo', repo]);
  assert.equal(disabled.code, 2);
  assert.match(disabled.err, /`delta` is not enabled/);
  const unknown = runCli(cliPath, ['confirm', 'nosuch', 'x', '--repo', repo]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /`nosuch` is not a module/);
  assert.equal(gitStatusShort(repo), '', 'no refusal writes');
  const bare = buildTargetRepo();
  const none = runCli(cliPath, ['confirm', 'gamma', 'scan-on', '--repo', bare]);
  assert.equal(none.code, 2);
  assert.match(none.err, /bootstrap/);
});

test('#135 render tolerates a confirmed record: it renders and keeps the key', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  assert.equal(runCli(cliPath, ['confirm', 'gamma', 'owners', '--repo', repo]).code, 0);
  commitAll(repo, 'confirm');
  const dry = runCli(cliPath, ['render', '--repo', repo]);
  assert.equal(dry.code, 0, dry.out + dry.err);
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')).modules.gamma.confirmed.owners, /^\d{4}-\d{2}-\d{2}$/);
});

// A vendored checker from before #135: its manifest family refuses any module
// key but enabled and config, as payload/check.mjs did at f5a9a9e. A stand-in
// rather than that file, since CI's shallow checkout has no history to show
// it from; what confirm must notice is that the vendored copy is not the
// plugin's payload.
const OLD_CHECK_MJS = `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const i = process.argv.indexOf('--repo');
const root = i === -1 ? process.cwd() : process.argv[i + 1];
const d = JSON.parse(readFileSync(root + '/house.json', 'utf8'));
for (const [n, e] of Object.entries(d.modules || {})) {
  for (const k of Object.keys(e)) if (k !== 'enabled' && k !== 'config') { console.log('module ' + n + ' has unknown key ' + k); process.exit(1); }
}
console.log('old house check: ok');
`;

function runVendoredCheck(repo) {
  return spawnSync(process.execPath, [join(repo, '.house', 'check.mjs'), '--repo', repo], { encoding: 'utf8' });
}

test('#135 confirm: refuses, writing nothing, while the vendored checker is not the plugin\'s; doctor says to sync first', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  // What an older render leaves: the old checker on disk, its hash in the lock.
  writeFileSync(join(repo, '.house', 'check.mjs'), OLD_CHECK_MJS);
  const lockPath = join(repo, '.house', 'lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.files.find((f) => f.path === '.house/check.mjs').bodySha256 = sha256Hex(OLD_CHECK_MJS);
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  commitAll(repo, 'an adopter still on the old checker');

  const doc = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.match(doc.out, /^at-adoption steps not confirmed for gamma: scan-on, owners \(sync first/m);
  assert.doesNotMatch(doc.out, /record each with `house confirm/);

  const r = runCli(cliPath, ['confirm', 'gamma', 'scan-on', '--repo', repo]);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /\/house-rules:sync/);
  assert.match(r.err, /house render --apply/);
  assert.equal(gitStatusShort(repo), '', 'house.json untouched');
  assert.equal(runVendoredCheck(repo).status, 0, 'the old checker still passes the untouched house.json');

  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  const ok = runCli(cliPath, ['confirm', 'gamma', 'scan-on', '--repo', repo]);
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.equal(runVendoredCheck(repo).status, 0, 'the synced checker accepts the record');
});

test('#135 confirm: refuses a confirmed value that is not an object, and never overwrites a malformed date', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const set = (confirmed) => {
    const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
    house.modules.gamma.confirmed = confirmed;
    writeHouseJson(repo, house);
  };
  for (const bad of [['scan-on'], 'scan-on', null]) {
    set(bad);
    const r = runCli(cliPath, ['confirm', 'gamma', 'scan-on', '--repo', repo]);
    assert.equal(r.code, 2, `${JSON.stringify(bad)}: ${r.out}${r.err}`);
    assert.match(r.err, /modules\.gamma\.confirmed is not an object/);
    assert.equal(gitStatusShort(repo), '');
  }
  set({ 'scan-on': 'soon' });
  const own = runCli(cliPath, ['confirm', 'gamma', 'scan-on', '--repo', repo]);
  assert.equal(own.code, 2, own.out + own.err);
  assert.match(own.err, /"soon", which is not a date/);
  assert.equal(gitStatusShort(repo), '');

  set({ owners: 'soon' });
  const other = runCli(cliPath, ['confirm', 'gamma', 'scan-on', '--repo', repo]);
  assert.equal(other.code, 0, other.out + other.err);
  assert.match(other.out, /left `owners` as it was \("soon"\)/);
  const c = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')).modules.gamma.confirmed;
  assert.equal(c.owners, 'soon', 'the other entry is untouched');
  assert.match(c['scan-on'], /^\d{4}-\d{2}-\d{2}$/);
});

test('#135 enable: a module whose paths all drop out is named, with the checker finding it will meet and the slot to set', () => {
  const { dir, cliPath } = buildEnableFixture();
  writeTree(dir, {
    'modules/epsilon/module.json': `${JSON.stringify({
      name: 'epsilon', default: 'off', rules: ['rules/epsilon.md'], files: [],
      configSlots: [{ name: 'epsilonRoots', default: ['evals/**'] }], defaultPaths: ['$epsilonRoots'],
    }, null, 2)}\n`,
    'modules/epsilon/rules/epsilon.md': ALPHA_BODY,
  });
  const repo = adoptedRepo(cliPath);
  const r = runCli(cliPath, ['enable', 'epsilon', '--repo', repo]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /epsilon would vendor zero rules here/);
  assert.match(r.out, /enabled but vendored zero rules/);
  assert.match(r.out, /epsilonRoots/);
  const fine = runCli(cliPath, ['enable', 'gamma', '--repo', repo]);
  assert.doesNotMatch(fine.out, /vendor zero rules/, 'negative control: a module that lands says nothing');
});

test('#135 enable --apply: a render that would refuse leaves house.json unwritten', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath);
  const alpha = join(repo, '.claude', 'rules', 'house', 'alpha.md');
  writeFileSync(alpha, `${readFileSync(alpha, 'utf8')}hand edit\n`);
  commitAll(repo, 'hand edit a managed rule');
  const before = readFileSync(join(repo, 'house.json'), 'utf8');
  const r = runCli(cliPath, ['enable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^REFUSE\s+\.claude\/rules\/house\/alpha\.md/m);
  assert.equal(readFileSync(join(repo, 'house.json'), 'utf8'), before);
  assert.equal(gitStatusShort(repo), '');
});

test('#135 enable --apply: an off module keeps the config written for it by hand', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath, {
    alpha: { enabled: true, config: {} },
    gamma: { enabled: false, config: { gammaRoots: ['scripts/**'] } },
  });
  const r = runCli(cliPath, ['enable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')).modules.gamma, { enabled: true, config: { gammaRoots: ['scripts/**'] } });
  const gamma = readFileSync(join(repo, '.claude', 'rules', 'house', 'gamma.md'), 'utf8');
  assert.match(gamma, /^ {2}- scripts\/\*\*$/m);
  assert.doesNotMatch(gamma, /src\/\*\*/);
});

// ── disable (#151) ───────────────────────────────────────────────────────
//
// The reverse of enable: one plan, nothing written without --apply, then one
// render, which already sweeps a disabled module's managed files, and the
// vendored checker. These reuse the enable fixture (gamma and delta).

function deltaOnRepo(cliPath) {
  return adoptedRepo(cliPath, {
    alpha: { enabled: true, config: {} },
    gamma: { enabled: true, config: {} },
    delta: { enabled: true, config: {} },
  });
}

function lockPaths(repo) {
  return JSON.parse(readFileSync(join(repo, '.house', 'lock.json'), 'utf8')).files.map((f) => f.path);
}

test('#151 disable: refuses a repo with no house.json, and an unknown module, writing nothing', () => {
  const { cliPath } = buildEnableFixture();
  const bare = buildTargetRepo();
  const none = runCli(cliPath, ['disable', 'gamma', '--repo', bare, '--apply']);
  assert.equal(none.code, 2, none.out + none.err);
  assert.match(none.err, /bootstrap/);
  assert.equal(gitStatusShort(bare), '');
  const repo = enabledGammaRepo(cliPath);
  const r = runCli(cliPath, ['disable', 'gamma', 'nosuch', '--repo', repo, '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /`nosuch` is not a module/);
  assert.match(r.err, /gamma/, 'lists the modules that do exist');
  assert.equal(gitStatusShort(repo), '');
});

test('#151 disable: plan only prints the house.json diff, the files it removes, and the load change, and writes nothing', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const houseBefore = readFileSync(join(repo, 'house.json'));
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', repo]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^- +"gamma": \{"enabled":true,"config":\{\}\}$/m, 'house.json diff, before');
  assert.match(r.out, /^\+ +"gamma": \{"enabled":false,"config":\{\}\}$/m, 'house.json diff, after');
  assert.match(r.out, /^remove\s+\.claude\/rules\/house\/gamma\.md\s+\(module: gamma\)/m, 'the managed file render removes');
  assert.doesNotMatch(r.out, /^remove\s+\.claude\/rules\/house\/alpha\.md/m, 'a module staying on loses nothing');
  assert.match(r.out, /Load cost/);
  assert.match(r.out, /gamma: -\d+ lines on \d+ tracked path/);
  assert.match(r.out, /^ {2}src\/a\.js: \d+ -> \d+ lines \(gamma -\d+\)$/m, 'lines the module stops loading on that path');
  assert.match(r.out, /--apply/);
  assert.ok(readFileSync(join(repo, 'house.json')).equals(houseBefore), 'house.json bytes untouched');
  assert.equal(gitStatusShort(repo), '', 'plan only leaves the tree untouched');
});

test('#151 disable --apply: one module, one render, no orphan left in the tree, the lock, or the index', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.equal(house.modules.gamma.enabled, false);
  assert.equal(house.modules.alpha.enabled, true, 'other modules untouched');
  assert.ok(!existsSync(join(repo, '.claude', 'rules', 'house', 'gamma.md')), 'rule file removed');
  assert.ok(existsSync(join(repo, '.claude', 'rules', 'house', 'alpha.md')));
  assert.ok(!lockPaths(repo).includes('.claude/rules/house/gamma.md'), 'no orphaned lock entry');
  assert.doesNotMatch(readFileSync(join(repo, '.house', 'INDEX.md'), 'utf8'), /gamma\.md/, 'no orphaned index section');
  assert.equal((r.out.match(/^Rendering /gm) || []).length, 1, `one render:\n${r.out}`);
  assert.match(r.out, /fake house check: ok/, 'the vendored checker ran and its output is printed');
});

test('#151 disable --apply: two modules share one plan and one render', () => {
  const { cliPath } = buildEnableFixture();
  const repo = deltaOnRepo(cliPath);
  const r = runCli(cliPath, ['disable', 'gamma', 'delta', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal((r.out.match(/^house disable: plan for /gm) || []).length, 1, 'one plan');
  assert.equal((r.out.match(/^Rendering /gm) || []).length, 1, 'one render');
  const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.equal(house.modules.gamma.enabled, false);
  assert.equal(house.modules.delta.enabled, false);
  for (const f of ['gamma.md', 'delta.md']) assert.ok(!existsSync(join(repo, '.claude', 'rules', 'house', f)), `${f} removed`);
  assert.deepEqual(lockPaths(repo).filter((p) => /gamma|delta/.test(p)), []);
});

test('#151 disable: a module already off is reported, not an error, and the rest still plan', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const solo = runCli(cliPath, ['disable', 'delta', '--repo', repo, '--apply']);
  assert.equal(solo.code, 0, solo.out + solo.err);
  assert.match(solo.out, /`delta` is already off/);
  assert.equal(gitStatusShort(repo), '', 'nothing to change, nothing written');
  const both = runCli(cliPath, ['disable', 'delta', 'gamma', '--repo', repo]);
  assert.equal(both.code, 0, both.out + both.err);
  assert.match(both.out, /`delta` is already off/);
  assert.match(both.out, /"gamma": \{"enabled":false/);
});

test('#151 disable --apply: a hand-edited managed file of the module is refused by name and nothing is written', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const gamma = join(repo, '.claude', 'rules', 'house', 'gamma.md');
  writeFileSync(gamma, `${readFileSync(gamma, 'utf8')}hand edit\n`);
  commitAll(repo, 'hand edit a managed rule');
  const before = readFileSync(join(repo, 'house.json'), 'utf8');
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^REFUSE\s+\.claude\/rules\/house\/gamma\.md/m);
  assert.match(r.err, /nothing was written/);
  assert.equal(readFileSync(join(repo, 'house.json'), 'utf8'), before);
  assert.ok(existsSync(gamma), 'the edited file stays');
  assert.equal(gitStatusShort(repo), '');
});

test('#151 disable --apply: config and at-adoption confirmations survive; only enabled changes', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath, {
    alpha: { enabled: true, config: {} },
    gamma: { enabled: true, config: { gammaRoots: ['scripts/**'] }, confirmed: { owners: '2026-01-02' } },
  });
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')).modules.gamma,
    { enabled: false, config: { gammaRoots: ['scripts/**'] }, confirmed: { owners: '2026-01-02' } });
  assert.match(r.out, /confirm/i, 'the plan says the confirmations are kept');
});

test('#151 round trip: enable, disable, enable returns house.json and the rendered files to the same bytes', () => {
  const { cliPath } = buildEnableFixture();
  const repo = adoptedRepo(cliPath, {
    alpha: { enabled: true, config: {} },
    gamma: { enabled: false, config: { gammaRoots: ['scripts/**'] }, confirmed: { owners: '2026-01-02' } },
  });
  const tracked = ['house.json', '.house/lock.json', '.house/INDEX.md', '.claude/rules/house/alpha.md'];
  const snap = () => Object.fromEntries([...tracked, '.claude/rules/house/gamma.md'].map((p) => [p, existsSync(join(repo, p)) ? readFileSync(join(repo, p), 'utf8') : null]));
  const beforeEnable = snap();
  assert.equal(runCli(cliPath, ['enable', 'gamma', '--repo', repo, '--apply']).code, 0);
  const enabledOnce = snap();
  commitAll(repo, 'enable gamma');
  const off = runCli(cliPath, ['disable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(off.code, 0, off.out + off.err);
  assert.deepEqual(snap(), beforeEnable, 'disable after enable returns every file to its bytes before the enable');
  assert.equal(runCli(cliPath, ['enable', 'gamma', '--repo', repo, '--apply']).code, 0);
  assert.deepEqual(snap(), enabledOnce, 'enabling again lands on the same bytes as the first enable');
});

test('#151 disable github: the plan names the removed floor, the scaffold left in place, what stops enforcing, and core.hooksPath', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  const rendered = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(rendered.code, 0, rendered.out + rendered.err);
  commitAll(repo, 'adopt with the floor');
  assert.ok(existsSync(join(repo, '.githooks', 'pre-commit.d', '20-secrets')), 'precondition: the scaffold was written');

  const plan = runCli(cliPath, ['disable', 'github', '--repo', repo]);
  assert.equal(plan.code, 0, plan.out + plan.err);
  for (const rel of FLOOR_FILES) assert.match(plan.out, new RegExp(`^remove\\s+\\.githooks/${rel.replace(/\./g, '\\.')}\\s`, 'm'), `lists ${rel}`);
  assert.match(plan.out, /^left\s+\.githooks\/pre-commit\.d\/20-secrets\s/m, 'the scaffold is listed as left in place');
  assert.match(plan.out, /branch policy is no longer enforced by git hooks in this repo/);
  assert.match(plan.out, /core\.hooksPath/);
  assert.match(plan.out, /git config --unset core\.hooksPath/, 'says what the user does');
  assert.equal(gitStatusShort(repo), '', 'plan only');
  const hooksPathBefore = gitConfigGet(repo, 'core.hooksPath');

  const r = runCli(cliPath, ['disable', 'github', '--repo', repo, '--apply', '--why', 'fixture']);
  assert.equal(r.code, 0, r.out + r.err);
  for (const rel of FLOOR_FILES) assert.ok(!existsSync(join(repo, '.githooks', rel)), `${rel} removed`);
  assert.ok(existsSync(join(repo, '.githooks', 'pre-commit.d', '20-secrets')), 'the scaffold stays');
  assert.equal(gitConfigGet(repo, 'core.hooksPath'), hooksPathBefore, 'disable writes no git config');
  assert.deepEqual(lockPaths(repo).filter((p) => p.startsWith('.githooks/')), []);

  const quiet = runCli(cliPath, ['disable', 'gamma', '--repo', enabledGammaRepo(buildEnableFixture().cliPath)]);
  assert.doesNotMatch(quiet.out, /git hooks|core\.hooksPath/, 'negative control: a module with no hook files says nothing about the floor');
});

test('#151 disable --apply: the real vendored checker exits 0 afterwards', () => {
  const { dir, cliPath } = buildEnableFixture();
  copyFileSync(join(HERE, '..', 'plugins', 'house', 'payload', 'check.mjs'), join(dir, 'payload', 'check.mjs'));
  const repo = enabledGammaRepo(cliPath);
  assert.equal(runVendoredCheck(repo).status, 0, `precondition: the adopted repo passes\n${runVendoredCheck(repo).stdout}`);
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^Checker \(/m, 'disable ran the checker');
  // Nothing staged: the removed rule file is still in the index, which the
  // checker must not read as an empty document.
  assert.match(gitStatusShort(repo), /^ D \.claude\/rules\/house\/gamma\.md$/m);
  const after = runVendoredCheck(repo);
  assert.equal(after.status, 0, after.stdout + after.stderr);
  // Where no house plugin is installed (a CI runner), the checker warns that it
  // could not verify the disabled modules against their defaults and names them.
  // That line is about the environment, not about anything disable left behind.
  const named = after.stdout.split('\n').filter((l) => !/disabled-module check could not resolve module defaults/.test(l)).join('\n');
  assert.doesNotMatch(named, /gamma/, 'no orphan, lock entry, or index section left for the checker to name');
});

// The checker's disabled-module check reads module defaults from an installed
// plugin; point it at the fixture plugin, so a default-on module turned off
// with no deviation is the finding it is in a real adopter.
function runCheckWithPlugin(repo, pluginDir) {
  const cfg = mkdtempSync(join(tmpdir(), 'house-config-'));
  CLEANUP_DIRS.push(cfg);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: pluginDir, version: '9.9.9' }] },
  }));
  return spawnSync(process.execPath, [join(repo, '.house', 'check.mjs'), '--repo', repo], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
}

function todayLocal() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
}

function realCheckerFixture() {
  const fx = buildEnableFixture();
  copyFileSync(join(HERE, '..', 'plugins', 'house', 'payload', 'check.mjs'), join(fx.dir, 'payload', 'check.mjs'));
  return fx;
}

test('#151 disable: a default-on module needs --why; without it --apply refuses and writes nothing', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const plan = runCli(cliPath, ['disable', 'alpha', '--repo', repo]);
  assert.equal(plan.code, 0, plan.out + plan.err);
  assert.match(plan.out, /alpha.*on by default.*--why/);
  const r = runCli(cliPath, ['disable', 'alpha', '--repo', repo, '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /--why/);
  assert.equal(gitStatusShort(repo), '', 'nothing written');
  const empty = runCli(cliPath, ['disable', 'alpha', '--repo', repo, '--apply', '--why', '  ']);
  assert.equal(empty.code, 2, 'a blank reason is no reason');
  assert.equal(gitStatusShort(repo), '');
});

test('#151 disable --why: a default-on module gets a dated disabled-module deviation in the user\'s words, and the checker passes', () => {
  const { dir, cliPath } = realCheckerFixture();
  const repo = enabledGammaRepo(cliPath);
  const r = runCli(cliPath, ['disable', 'alpha', '--repo', repo, '--apply', '--why', 'no source tree here']);
  assert.equal(r.code, 0, r.out + r.err);
  const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  assert.deepEqual(house.deviations, [{ kind: 'disabled-module', module: 'alpha', what: 'the alpha module is off in this repo', why: 'no source tree here', decided: todayLocal() }]);
  const ok = runCheckWithPlugin(repo, dir);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  delete house.deviations;
  writeFileSync(join(repo, 'house.json'), `${JSON.stringify(house, null, 2)}\n`);
  const control = runCheckWithPlugin(repo, dir);
  assert.equal(control.status, 1, 'positive control: the same repo without the deviation is a finding');
  assert.match(control.stdout, /module `alpha` is default-on but disabled with no deviations entry/);
});

test('#151 disable --why on a module off by default records nothing and says so', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', repo, '--apply', '--why', 'not needed']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /gamma is off by default.*not recorded/);
  assert.equal(JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')).deviations, undefined);
});

test('#151 round trip with a reason: enable drops the deviation it supersedes, and the checker stays at 0', () => {
  const { dir, cliPath } = realCheckerFixture();
  const repo = enabledGammaRepo(cliPath);
  const before = readFileSync(join(repo, 'house.json'), 'utf8');
  assert.equal(runCli(cliPath, ['disable', 'alpha', '--repo', repo, '--apply', '--why', 'trial']).code, 0);
  commitAll(repo, 'alpha off');
  const plan = runCli(cliPath, ['enable', 'alpha', '--repo', repo]);
  assert.match(plan.out, /deviations.*disabled-module.*alpha.*removed/);
  const on = runCli(cliPath, ['enable', 'alpha', '--repo', repo, '--apply']);
  assert.equal(on.code, 0, on.out + on.err);
  // No stale deviation. The array disable created stays, emptied: nothing
  // records who created it, and a repo's own `"deviations": []` must survive.
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')), { ...JSON.parse(before), deviations: [] });
  const check = runCheckWithPlugin(repo, dir);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('#151 render refuses to delete a hand-edited managed file whose module was turned off by hand', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const gamma = join(repo, '.claude', 'rules', 'house', 'gamma.md');
  writeFileSync(gamma, `${readFileSync(gamma, 'utf8')}hand edit\n`);
  const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  house.modules.gamma.enabled = false;
  writeHouseJson(repo, house);
  const lockBefore = readFileSync(join(repo, '.house', 'lock.json'), 'utf8');
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^REFUSE\s+\.claude\/rules\/house\/gamma\.md/m);
  assert.ok(existsSync(gamma), 'the edited file stays');
  assert.equal(readFileSync(join(repo, '.house', 'lock.json'), 'utf8'), lockBefore, 'nothing rewritten');
  const forced = runCli(cliPath, ['render', '--repo', repo, '--apply', '--force-managed', '.claude/rules/house/gamma.md']);
  assert.equal(forced.code, 0, forced.out + forced.err);
  assert.ok(!existsSync(gamma), '--force-managed names the file, and render removes it');
});

test('#151 disable github: a directory render emptied is removed; one still holding a file stays', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  commitAll(repo, 'adopt with the floor');
  const r = runCli(cliPath, ['disable', 'github', '--repo', repo, '--apply', '--why', 'fixture']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(!existsSync(join(repo, '.githooks', 'pre-push.d')), 'emptied by render, removed');
  assert.ok(!existsSync(join(repo, '.githooks', 'reference-transaction.d')));
  assert.ok(existsSync(join(repo, '.githooks', 'pre-commit.d', '20-secrets')), 'the scaffold keeps its directory');
});

// ── #151 review notes ────────────────────────────────────────────────────

test('#151 disable: a file of the user\'s own in .claude/rules/house/ is not managed, so it is listed and left', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  writeFileSync(join(repo, '.claude', 'rules', 'house', 'mine.md'), '# mine\n');
  commitAll(repo, 'a rule of my own');
  const plan = runCli(cliPath, ['disable', 'gamma', '--repo', repo]);
  assert.equal(plan.code, 0, plan.out + plan.err);
  assert.match(plan.out, /^left\s+\.claude\/rules\/house\/mine\.md\s+\(not managed, left in place\)/m);
  assert.doesNotMatch(plan.out, /^remove\s+\.claude\/rules\/house\/mine\.md/m);
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(existsSync(join(repo, '.claude', 'rules', 'house', 'mine.md')), 'the user\'s file stays');
  assert.ok(!existsSync(join(repo, '.claude', 'rules', 'house', 'gamma.md')), 'the managed one goes');
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  assert.ok(existsSync(join(repo, '.claude', 'rules', 'house', 'mine.md')), 'a plain render leaves it too');
});

test('#151 disable: a module\'s rule file from before the lock recorded it is still removed', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const lockPath = join(repo, '.house', 'lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.files = lock.files.filter((f) => f.path !== '.claude/rules/house/gamma.md');
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  commitAll(repo, 'a lock that predates gamma.md');
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(!existsSync(join(repo, '.claude', 'rules', 'house', 'gamma.md')), 'a dest render produces for a module now off is still swept');
});

test('#151 a forged lock entry reaching outside the repo through a symlinked directory, or into .git, is refused and nothing is deleted', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const outside = mkdtempSync(join(tmpdir(), 'house-outside-'));
  CLEANUP_DIRS.push(outside);
  writeFileSync(join(outside, 'f.txt'), 'outside\n');
  symlinkSync(outside, join(repo, 'linkdir'));
  const lockPath = join(repo, '.house', 'lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const gitDesc = readFileSync(join(repo, '.git', 'description'), 'utf8');
  lock.files.push({ path: 'linkdir/f.txt', module: 'gamma', source: 'x', bodySha256: sha256Hex('outside\n') });
  lock.files.push({ path: '.git/description', module: 'gamma', source: 'x', bodySha256: sha256Hex(gitDesc) });
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  commitAll(repo, 'forged lock entries');
  for (const args of [['disable', 'gamma', '--repo', repo, '--apply'], ['render', '--repo', repo, '--apply']]) {
    const r = runCli(cliPath, args);
    assert.equal(r.code, 1, `${args[0]}: ${r.out}${r.err}`);
    assert.match(r.out, /^REFUSE\s+linkdir\/f\.txt\s+\(lock entry resolves outside this repo/m, args[0]);
    assert.match(r.out, /^REFUSE\s+\.git\/description\s+\(lock entry resolves inside \.git/m, args[0]);
    assert.ok(existsSync(join(outside, 'f.txt')), `${args[0]}: the file outside the repo is still on disk`);
    assert.ok(existsSync(join(repo, '.git', 'description')), `${args[0]}: .git is untouched`);
    assert.equal(gitStatusShort(repo), '', `${args[0]}: nothing written`);
  }
});

test('#151 disable: --why followed by another flag, or by nothing, is an error naming it', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  for (const args of [['--why', '--apply'], ['--apply', '--why']]) {
    const r = runCli(cliPath, ['disable', 'alpha', '--repo', repo, ...args]);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`);
    assert.match(r.err, /--why needs a reason/);
  }
  assert.equal(gitStatusShort(repo), '');
});

test('#151 enable keeps a deviations array that was already there, emptied or not', () => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const house = JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
  house.deviations = [];
  writeHouseJson(repo, house);
  assert.equal(runCli(cliPath, ['disable', 'alpha', '--repo', repo, '--apply', '--why', 'trial']).code, 0);
  assert.equal(runCli(cliPath, ['enable', 'alpha', '--repo', repo, '--apply']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8')).deviations, []);
});

test('#151 with github off, doctor says the floor is off because the module is, and the arming script stays silent', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  commitAll(repo, 'adopt with the floor');
  const armedBefore = spawnSync('bash', [REAL_ARM_SCRIPT, '--repo', repo], { encoding: 'utf8' });
  assert.equal(armedBefore.stdout, '', 'precondition: an armed floor is silent');
  assert.equal(runCli(cliPath, ['disable', 'github', '--repo', repo, '--apply', '--why', 'fixture']).code, 0);
  commitAll(repo, 'github off');
  const doc = runCli(cliPath, ['doctor', '--repo', repo]);
  assert.match(doc.out, /^git-hook floor: off \(the github module is off in house\.json/m);
  assert.doesNotMatch(doc.out, /git-hook floor: not rendered/);
  const arm = spawnSync('bash', [REAL_ARM_SCRIPT, '--repo', repo], { encoding: 'utf8' });
  assert.equal(arm.status, 0);
  assert.equal(arm.stdout, '', 'nothing at session start for a module that is off');
});

// What the branch guard actually follows (plugins/house/hooks/no-direct-master.sh):
// branchPolicy and protectedBranches from HEAD:house.json, never `modules`, and
// "armed" from the floor files on disk. tests/hooks/run.sh pins the guard side.
const FALSE_GUARD_CLAIMS = [/takes effect for the branch guard when/, /until then the guard/, /guard sees it once it is merged/];

test('#151 disable github: the plan states what the guard follows and who unsets core.hooksPath; a commit still works', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildFloorRepo();
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply']).code, 0);
  commitAll(repo, 'adopt with the floor');
  const plan = runCli(cliPath, ['disable', 'github', '--repo', repo, '--why', 'fixture']);
  for (const re of FALSE_GUARD_CLAIMS) assert.doesNotMatch(plan.out, re);
  assert.match(plan.out, /the PreToolUse branch guard does not read module state/);
  assert.match(plan.out, /it follows `branchPolicy` \(and `protectedBranches`\) in house\.json at HEAD/);
  assert.match(plan.out, /While that says "pr" it keeps enforcing it by its text rules, which are stricter with no hook floor, and its refusals will give floor advice \(to arm the floor, or to restore it with a render\) that does not apply while the github module is off/);
  assert.doesNotMatch(plan.out, /will tell you to arm the floor/, 'the advice varies with core.hooksPath, so it is not quoted');
  assert.match(plan.out, new RegExp(`you run \`git config --unset core\\.hooksPath\` yourself, from ${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(plan.out, /an agent cannot: the branch guard refuses it/);
  assert.match(plan.out, /leaving it set is harmless/);
  const other = runCli(cliPath, ['disable', 'gamma', '--repo', enabledGammaRepo(buildEnableFixture().cliPath)]);
  for (const re of [...FALSE_GUARD_CLAIMS, /branch guard/]) assert.doesNotMatch(other.out, re, 'a module that ships no floor says nothing about the guard');
  assert.equal(runCli(cliPath, ['disable', 'github', '--repo', repo, '--why', 'fixture', '--apply']).code, 0);
  assert.notEqual(gitConfigGet(repo, 'core.hooksPath'), '', 'still set');
  commitAll(repo, 'a commit with core.hooksPath naming a floor that is gone');
  assert.match(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' }), /floor that is gone/);
});

test('#151 enable: the plan makes no claim about when the branch guard sees the change', () => {
  const { cliPath } = buildEnableFixture();
  const r = runCli(cliPath, ['enable', 'gamma', '--repo', adoptedRepo(cliPath)]);
  assert.equal(r.code, 0, r.out + r.err);
  for (const re of FALSE_GUARD_CLAIMS) assert.doesNotMatch(r.out, re);
});

// The reviewer's sequence: on a case-insensitive filesystem `.GIT/description`
// names .git/description, and a byte comparison against ".git" let it through.
test('#151 forged lock entries naming .git in another case, or a nested repo\'s .git, are refused and every file survives byte for byte', (t) => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  mkdirSync(join(repo, 'sub', '.git'), { recursive: true });
  writeFileSync(join(repo, 'sub', '.git', 'x'), 'nested\n');
  const caseInsensitive = existsSync(join(repo, '.GIT', 'config'));
  const forged = [['sub/.git/x', join(repo, 'sub', '.git', 'x')]];
  if (caseInsensitive) forged.push(['.GIT/description', join(repo, '.git', 'description')], ['.Git/config', join(repo, '.git', 'config')]);
  else t.diagnostic('case-sensitive filesystem here: `.GIT` is not `.git`, so the case variants have nothing to reach and are not planted');
  const lockPath = join(repo, '.house', 'lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const bytes = new Map();
  for (const [rel, abs] of forged) {
    bytes.set(abs, readFileSync(abs));
    lock.files.push({ path: rel, module: 'docs', source: 'x', bodySha256: sha256Hex(readFileSync(abs, 'utf8')) });
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  for (const args of [['render', '--repo', repo, '--apply'], ['disable', 'gamma', '--repo', repo, '--apply']]) {
    const r = runCli(cliPath, args);
    assert.equal(r.code, 1, `${args[0]}: ${r.out}${r.err}`);
    for (const [rel] of forged) assert.match(r.out, new RegExp(`^REFUSE\\s+${rel.replace(/\./g, '\\.')}\\s+\\(lock entry resolves inside \\.git`, 'm'), `${args[0]} names ${rel}`);
    for (const [abs, b] of bytes) assert.ok(readFileSync(abs).equals(b), `${args[0]}: ${abs} unchanged`);
  }
});

// The outside-the-repo test is a pure function of two resolved paths, so it is
// lifted out of the real CLI source and run here, with no filesystem: a
// case-sensitive mount, where `Proj` and `proj` are different directories,
// cannot be made inside `npm test` on a case-insensitive machine.
function loadResolvedIsInside() {
  const src = readFileSync(REAL_CLI_SRC, 'utf8').match(/^function resolvedIsInside\([^)]*\) \{\n[^]*?\n\}$/m);
  assert.ok(src, 'resolvedIsInside is not a top-level function in the CLI any more');
  return new Function('path', `${src[0]}\nreturn resolvedIsInside;`)({ sep: '/' });
}

test('#151 resolvedIsInside: exact on resolved paths, so a sibling differing only by case is outside', () => {
  const inside = loadResolvedIsInside();
  assert.equal(inside('/m/Proj/repo', '/m/Proj/repo/a/b.md'), true, 'positive control');
  assert.equal(inside('/m/Proj/repo', '/m/proj/repo/victim.txt'), false, 'case-different sibling');
  assert.equal(inside('/m/Proj/repo', '/m/Proj/REPO/x'), false);
  assert.equal(inside('/m/Proj/repo', '/m/Proj/repo-x/x'), false, 'a prefix that is not a path segment');
  assert.equal(inside('/m/Proj/repo', '/m/Proj/repo'), false, 'the root itself is never a removal');
  assert.equal(inside('/', '/etc/x'), true, 'a root ending in the separator');
});

// The call site, not just the helper: unsafeRemovalReason must hand
// resolvedIsInside the resolved paths untouched. Its own source, with the two
// functions it calls, runs here against a fake resolver standing in for a
// case-sensitive filesystem where `out` is a symlink to a sibling `proj`.
test('#151 unsafeRemovalReason: a lock path resolving to a case-different sibling of the root is refused', () => {
  const cli = readFileSync(REAL_CLI_SRC, 'utf8');
  const fn = (name) => {
    const m = cli.match(new RegExp(`^function ${name}\\([^)]*\\) \\{\\n[^]*?\\n\\}$`, 'm'));
    assert.ok(m, `${name} is not a top-level function in the CLI any more`);
    return m[0];
  };
  const unsafeRemovalReason = new Function('path', 'realpathSync',
    `${fn('isInsideRoot')}\n${fn('resolvedIsInside')}\n${fn('unsafeRemovalReason')}\nreturn unsafeRemovalReason;`)(nodePath.posix, null);
  const disk = new Map([['/m/Proj/repo', '/m/Proj/repo'], ['/m/Proj/repo/out', '/m/proj/repo'], ['/m/Proj/repo/in', '/m/Proj/repo/in']]);
  const resolve = (p) => { if (disk.has(p)) return disk.get(p); throw new Error(`ENOENT ${p}`); };
  assert.match(unsafeRemovalReason('/m/Proj/repo', 'out/victim.txt', resolve), /^lock entry resolves outside this repo, to \/m\/proj\/repo\/victim\.txt$/);
  assert.equal(unsafeRemovalReason('/m/Proj/repo', 'in/kept.md', resolve), null, 'negative control: a path that stays inside is allowed');
});

test('#151 disable: a --repo spelled in another case still resolves to the same repo', (t) => {
  const { cliPath } = buildEnableFixture();
  const repo = enabledGammaRepo(cliPath);
  const other = repo.replace(/house-repo-/, 'HOUSE-REPO-');
  if (!existsSync(other)) { t.skip('case-sensitive filesystem: the other spelling is a different path'); return; }
  const r = runCli(cliPath, ['disable', 'gamma', '--repo', other, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /REFUSE/);
  assert.ok(!existsSync(join(repo, '.claude', 'rules', 'house', 'gamma.md')));
});

test('#151 disable: the --why error names --why=<reason> for a reason that starts with dashes', () => {
  const { cliPath } = buildEnableFixture();
  const r = runCli(cliPath, ['disable', 'alpha', '--repo', enabledGammaRepo(cliPath), '--why', '--no-ci-here']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /--why=<reason>/);
});

// ── uninstall (#152) ─────────────────────────────────────────────────────
//
// Removes the adoption from one repo: one plan, nothing written without
// --apply, every managed file and the vendored floor removed through the same
// sweep and refusals render and disable use, the hooks path undone only where
// it names this repo's own floor, and everything left listed. Every run gets
// its own global git config file, so a hooks path on the machine running the
// suite cannot leak in, and a test can prove that file is never written.

const AGENTS_OWN = '# Agents\n\nOur own instructions, which uninstall leaves byte for byte.\n';
const PKG_WITH_CALLERS = '{\n  "name": "fixture",\n  "scripts": {\n    "check:house": "node .house/check.mjs",\n    "verify": "npm test && npm run check:house"\n  }\n}\n';
const CI_WITH_CALLER = 'name: ci\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node .house/check.mjs\n';

function isolatedGitEnv(globalBody = '') {
  const d = mkdtempSync(join(tmpdir(), 'house-uninstall-152-'));
  CLEANUP_DIRS.push(d);
  const file = join(d, 'global.gitconfig');
  writeFileSync(file, globalBody);
  return { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: '1' };
}

function gitIn(repo, args, env) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}
function localHooksPath(repo, env) { return (gitIn(repo, ['config', '--local', '--get', 'core.hooksPath'], env).stdout || '').trim(); }

// An adopted repo with every kind of thing uninstall meets: rule files, the
// checker, the floor and its scaffold, an AGENTS.md block inside the repo's
// own text, and the checker wired into package.json and a workflow by hand.
function uninstallRepo(cliPath, env, extra = {}) {
  const repo = buildTargetRepo({
    'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n',
    'AGENTS.md': AGENTS_OWN, 'package.json': PKG_WITH_CALLERS, '.github/workflows/ci.yml': CI_WITH_CALLER, ...extra,
  });
  writeHouseJson(repo, {
    ...BASE_HOUSE_JSON, targets: ['claude-code', 'codex'],
    modules: { alpha: { enabled: true, config: {} }, beta: { enabled: false, config: {} }, github: { enabled: true, config: {} } },
  });
  const r = runCli(cliPath, ['render', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  commitAll(repo, 'adopt');
  return repo;
}

const MANAGED = ['.claude/rules/house/alpha.md', '.house/check.mjs', '.house/lock.json', '.house/INDEX.md', ...FLOOR_FILES.map((f) => `.githooks/${f}`)];
const SECRETS_SCAFFOLD = '.githooks/pre-commit.d/20-secrets';

test('#152 uninstall: refuses a repo with no house.json, naming it, and writes nothing', () => {
  const { cliPath } = buildFloorFixture();
  const repo = buildTargetRepo();
  const env = isolatedGitEnv();
  for (const args of [['uninstall', '--repo', repo], ['uninstall', '--repo', repo, '--apply']]) {
    const r = runCli(cliPath, args, env);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /house\.json not found/);
    assert.match(r.err, /nothing to uninstall/);
  }
  assert.equal(gitStatusShort(repo), '');
});

test('#152 uninstall: the plan lists what goes, what stays, the hooks path, and what stops, and writes nothing', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  writeFileSync(join(repo, '.house', 'notes.txt'), 'mine\n');
  commitAll(repo, 'a file of my own in .house');
  assert.equal(localHooksPath(repo, env), floorDir(repo), 'precondition: render armed the floor');
  const snapshot = () => ({
    status: execFileSync('git', ['status', '--short', '--ignored'], { cwd: repo, encoding: 'utf8' }),
    config: gitIn(repo, ['config', '--local', '--list'], env).stdout,
    bytes: [...MANAGED, 'AGENTS.md', 'house.json'].map((p) => readFileSync(join(repo, p), 'utf8')),
    global: readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8'),
  });
  const before = snapshot();
  const r = runCli(cliPath, ['uninstall', '--repo', repo], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(snapshot(), before, 'the plan writes nothing: bytes, status, local and global config');

  for (const rel of MANAGED) assert.match(r.out, new RegExp(`^remove\\s+${rel.replace(/\./g, '\\.')}\\s`, 'm'), `lists ${rel}`);
  assert.match(r.out, /^remove-block\s+AGENTS\.md\s+\(the house-managed block only; your text stays\)/m);
  assert.match(r.out, /^ {2}\.githooks\/pre-push\.d$/m, 'a directory that ends empty');
  assert.doesNotMatch(r.out, /^ {2}\.githooks\/pre-commit\.d$/m, 'the scaffold keeps its directory');
  assert.match(r.out, /core\.hooksPath, local scope .*: .*\.githooks, this repo's floor: will be unset/);
  assert.match(r.out, /no hooks path from before adoption to restore/i);
  assert.match(r.out, /^remove\s+house\.json\s+\(last, after everything else/m, 'house.json goes by default');
  assert.match(r.out, /0 deviation\(s\) in its ledger go with it/);
  assert.match(r.out, /git show [0-9a-f]{7,}:house\.json/, 'how to get it back, before anything is removed');
  assert.match(r.out, /\/house-rules:bootstrap/);
  assert.doesNotMatch(r.out, /^ {2}house\.json: left/m);
  const keep = runCli(cliPath, ['uninstall', '--repo', repo, '--keep-config'], env);
  assert.equal(keep.code, 0, keep.out + keep.err);
  assert.match(keep.out, /^ {2}house\.json: left \(--keep-config\)/m);
  assert.doesNotMatch(keep.out, /^remove\s+house\.json/m);
  assert.deepEqual(snapshot(), before, 'the --keep-config plan writes nothing either');
  assert.match(r.out, new RegExp(`^ {2}scaffold ${SECRETS_SCAFFOLD.replace(/\./g, '\\.')}`, 'm'));
  assert.match(r.out, /^ {2}not managed \.house\/notes\.txt/m);
  assert.match(r.out, /^ {2}package\.json:4 +"check:house": "node \.house\/check\.mjs",$/m, 'the script that runs the checker');
  assert.match(r.out, /^ {2}package\.json:5 +"verify": "npm test && npm run check:house"$/m, 'a script that calls it by name');
  assert.match(r.out, /^ {2}\.github\/workflows\/ci\.yml:7 +- run: node \.house\/check\.mjs$/m, 'the workflow step');
  assert.match(r.out, /git-hook floor/);
  assert.match(r.out, /1 rule file\(s\) stop loading/);
  assert.match(r.out, /tracked and unchanged in git/);
  assert.match(r.out, /house render --apply/, 're-adopting from the kept house.json');
  assert.match(r.out, /--apply/);
});

test('#152 uninstall --apply: every managed file, the floor, and house.json go; the scaffold and files not managed stay; a commit then succeeds', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  writeFileSync(join(repo, '.claude', 'rules', 'house', 'mine.md'), '# mine\n');
  commitAll(repo, 'a rule of my own');
  const globalBefore = readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8');
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  for (const rel of MANAGED) assert.ok(!existsSync(join(repo, rel)), `${rel} removed`);
  assert.ok(!existsSync(join(repo, '.githooks', 'pre-push.d')), 'an emptied directory goes');
  assert.ok(!existsSync(join(repo, '.house')), '.house goes once empty');
  assert.ok(!existsSync(join(repo, 'house.json')), 'house.json goes by default');
  const removedOrder = r.out.slice(r.out.indexOf('\nRemoved:')).split('\n').map((l) => l.trim()).filter((l) => /^(house\.json|\.house\/lock\.json)$/.test(l));
  assert.deepEqual(removedOrder, ['.house/lock.json', 'house.json'], 'house.json is removed last');
  assert.ok(existsSync(join(repo, SECRETS_SCAFFOLD)), 'the scaffold stays');
  assert.ok(existsSync(join(repo, '.claude', 'rules', 'house', 'mine.md')), 'a file not managed stays');
  assert.match(r.out, /^ {2}not managed \.claude\/rules\/house\/mine\.md/m);
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), AGENTS_OWN, 'AGENTS.md is the repo\'s own text again, byte for byte');
  assert.equal(localHooksPath(repo, env), '', 'the local hooks path is unset');
  assert.match(r.out, /unset core\.hooksPath at local scope/);
  assert.equal(readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8'), globalBefore, 'global config untouched');
  const status = gitStatusShort(repo).split('\n').filter(Boolean);
  const expected = [...MANAGED.map((p) => ` D ${p}`), ' D house.json', ' M AGENTS.md'].sort();
  assert.deepEqual(status.sort(), expected, 'only deletions of tracked managed files and the AGENTS.md edit; nothing untracked');
  commitAll(repo, 'uninstall house');
  assert.match(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' }), /uninstall house/);
  assert.equal(gitStatusShort(repo), '');
});

test('#152 uninstall --apply: a hand-edited managed file is refused by name and nothing is deleted or unset', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  const alpha = join(repo, '.claude', 'rules', 'house', 'alpha.md');
  writeFileSync(alpha, `${readFileSync(alpha, 'utf8')}hand edit\n`);
  commitAll(repo, 'hand edit a managed rule');
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^REFUSE\s+\.claude\/rules\/house\/alpha\.md/m);
  assert.match(r.err, /nothing was (deleted|written)/);
  for (const rel of MANAGED) assert.ok(existsSync(join(repo, rel)), `${rel} stays`);
  assert.equal(gitStatusShort(repo), '');
  assert.equal(localHooksPath(repo, env), floorDir(repo), 'the hooks path is not touched either');
  assert.ok(existsSync(join(repo, 'house.json')), 'house.json stays when anything is refused');
});

test('#152 uninstall --apply --keep-config: everything managed goes and house.json stays, with what that leaves on', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  const houseBefore = readFileSync(join(repo, 'house.json'), 'utf8');
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply', '--keep-config'], env);
  assert.equal(r.code, 0, r.out + r.err);
  for (const rel of MANAGED) assert.ok(!existsSync(join(repo, rel)), `${rel} removed`);
  assert.equal(readFileSync(join(repo, 'house.json'), 'utf8'), houseBefore, 'house.json is left as it was');
  assert.match(r.out, /^ {2}house\.json: left \(--keep-config\)/m);
  assert.match(r.out, /keeps treating this repo as adopted/);
  assert.match(r.out, /git-hook floor not rendered here/, 'what session start prints while it stays');
  assert.equal(localHooksPath(repo, env), '');
});

test('#152 uninstall: a house.json git cannot give back needs --keep-config or --discard-untracked-config', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  execFileSync('git', ['rm', '-q', '--cached', 'house.json'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'house.json untracked'], { cwd: repo });
  const plan = runCli(cliPath, ['uninstall', '--repo', repo], env);
  assert.match(plan.out, /house\.json is not in HEAD, so its contents are not recoverable from git/);
  const refused = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(refused.code, 1, refused.out + refused.err);
  assert.match(refused.err, /--keep-config.*--discard-untracked-config/);
  for (const rel of [...MANAGED, 'house.json']) assert.ok(existsSync(join(repo, rel)), `${rel} stays`);
  const discard = runCli(cliPath, ['uninstall', '--repo', repo, '--apply', '--discard-untracked-config'], env);
  assert.equal(discard.code, 0, discard.out + discard.err);
  assert.ok(!existsSync(join(repo, 'house.json')));
  for (const rel of MANAGED) assert.ok(!existsSync(join(repo, rel)), `${rel} removed`);
});

test('#152 uninstall --apply: with house.json already gone, the lock still says what is left, and a rerun completes', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  for (const rel of ['house.json', '.githooks/pre-push']) rmSync(join(repo, rel));
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  for (const rel of MANAGED) assert.ok(!existsSync(join(repo, rel)), `${rel} removed`);
  assert.equal(localHooksPath(repo, env), '');
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), AGENTS_OWN);
});

// The reviewer's sequence: adopt, break the lock, add an uncommitted line to a
// rule file, uninstall. The lock is the proof of ownership, so with it
// missing, unparseable, shapeless, or empty, nothing is deleted or unset,
// house.json included, and the edit survives.
const BROKEN_LOCKS = [
  ['deleted, house.json present', (repo) => rmSync(join(repo, '.house', 'lock.json'))],
  ['deleted, house.json gone too', (repo) => { rmSync(join(repo, '.house', 'lock.json')); rmSync(join(repo, 'house.json')); }],
  ['unparseable', (repo) => writeFileSync(join(repo, '.house', 'lock.json'), '{ not json\n')],
  ['with no files array', (repo) => writeFileSync(join(repo, '.house', 'lock.json'), '{"scaffolds": []}\n')],
  ['with an empty files array', (repo) => writeFileSync(join(repo, '.house', 'lock.json'), '{"files": []}\n')],
  ['whose only path is blank', (repo) => writeFileSync(join(repo, '.house', 'lock.json'), '{"files": [{"path": "   "}]}\n')],
];
for (const [name, breakLock] of BROKEN_LOCKS) {
  test(`#152 uninstall: a lock ${name} proves nothing, so nothing is deleted or unset and the edit survives`, () => {
    const { cliPath } = buildFloorFixture();
    const env = isolatedGitEnv();
    const repo = uninstallRepo(cliPath, env);
    breakLock(repo);
    const alpha = join(repo, '.claude', 'rules', 'house', 'alpha.md');
    writeFileSync(alpha, `${readFileSync(alpha, 'utf8')}an uncommitted line\n`);
    const lockBytes = existsSync(join(repo, '.house', 'lock.json')) ? readFileSync(join(repo, '.house', 'lock.json'), 'utf8') : null;
    const houseThere = existsSync(join(repo, 'house.json'));
    for (const args of [['uninstall', '--repo', repo], ['uninstall', '--repo', repo, '--apply']]) {
      const r = runCli(cliPath, args, env);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}${r.err}`);
      for (const rel of ['.githooks/pre-commit', '.claude/rules/house/alpha.md', '.house/check.mjs', '.house/INDEX.md']) {
        assert.match(r.out, new RegExp(`^ {2}${rel.replace(/\./g, '\\.')}$`, 'm'), `lists ${rel}`);
      }
      assert.match(r.out, /^ {2}AGENTS\.md \(the house-managed block\)$/m);
      assert.doesNotMatch(r.out, /not managed/, 'ownership is unknown, never "yours"');
      assert.match(r.err, /lock\.json is (missing|unreadable|empty)/);
      assert.match(r.err, /house render --apply/, 'names the way forward');
    }
    assert.match(readFileSync(alpha, 'utf8'), /an uncommitted line/, 'the edit is still on disk');
    for (const rel of MANAGED.filter((p) => p !== '.house/lock.json')) assert.ok(existsSync(join(repo, rel)), `${rel} stays`);
    assert.equal(existsSync(join(repo, 'house.json')), houseThere, 'house.json is not touched');
    assert.equal(existsSync(join(repo, '.house', 'lock.json')) ? readFileSync(join(repo, '.house', 'lock.json'), 'utf8') : null, lockBytes, 'the lock, broken or not, is not touched');
    assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /house-managed:begin/, 'the block stays');
    assert.equal(localHooksPath(repo, env), floorDir(repo), 'the hooks path is not touched either');
  });
}

test('#152 uninstall: after render rebuilds a deleted lock from house.json, uninstall completes', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  rmSync(join(repo, '.house', 'lock.json'));
  assert.equal(runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env).code, 1);
  const rebuilt = runCli(cliPath, ['render', '--repo', repo, '--apply'], env);
  assert.equal(rebuilt.code, 0, rebuilt.out + rebuilt.err);
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  for (const rel of [...MANAGED, 'house.json']) assert.ok(!existsSync(join(repo, rel)), `${rel} removed`);
  assert.equal(localHooksPath(repo, env), '');
});

test('#152 uninstall: the Recovery line names a managed file git cannot give back', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  execFileSync('git', ['rm', '-q', '--cached', '.house/INDEX.md'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'index untracked'], { cwd: repo });
  const r = runCli(cliPath, ['uninstall', '--repo', repo], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^Recovery: \d+ of \d+ file\(s\) to remove are tracked and unchanged in git/m);
  assert.match(r.out, /Not recoverable from git \(untracked, or changed since the last commit\): \.house\/INDEX\.md\./);
});

test('#152 uninstall: of two local core.hooksPath values, only the one naming this repo\'s floor is removed', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  assert.equal(gitIn(repo, ['config', '--local', '--add', 'core.hooksPath', '/opt/other-hooks'], env).status, 0);
  const plan = runCli(cliPath, ['uninstall', '--repo', repo], env);
  assert.equal(plan.code, 0, plan.out + plan.err);
  assert.match(plan.out, /this repo's floor: will be unset; \/opt\/other-hooks, not this repo's floor: left/);
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(gitIn(repo, ['config', '--local', '--get-all', 'core.hooksPath'], env).stdout, '/opt/other-hooks\n', 'the other value is kept');
  const again = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(again.code, 0, again.out + again.err);
});

// #152 review note a: a file in a managed directory that the lock does not
// record is removed only when its bytes are what render would write for it
// now; otherwise it is the repo's, left and listed. Render, disable, and
// uninstall all read the one sweep.
function unrecordedEditedGamma(cliPath) {
  const repo = enabledGammaRepo(cliPath);
  const lockPath = join(repo, '.house', 'lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.files = lock.files.filter((f) => f.path !== '.claude/rules/house/gamma.md');
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const gamma = join(repo, '.claude', 'rules', 'house', 'gamma.md');
  writeFileSync(gamma, `${readFileSync(gamma, 'utf8')}a line of the repo's own\n`);
  commitAll(repo, 'gamma.md unrecorded and edited');
  return { repo, gamma };
}
const UNRECORDED_LEFT = /^left\s+\.claude\/rules\/house\/gamma\.md\s+\(not recorded in the lock and differs from the rendered file, left in place\)/m;
const FORGED_NOTE = /the repo's checker reports it as a forged managed header: delete it, or `house render --force-managed \.claude\/rules\/house\/(gamma|alpha)\.md` if its module is on/;

test('#152 an unrecorded rule file that differs from the render is left by disable and by render', () => {
  const { cliPath } = buildEnableFixture();
  const viaDisable = unrecordedEditedGamma(cliPath);
  const d = runCli(cliPath, ['disable', 'gamma', '--repo', viaDisable.repo, '--apply']);
  assert.equal(d.code, 0, d.out + d.err);
  assert.match(d.out, UNRECORDED_LEFT);
  assert.match(d.out, FORGED_NOTE);
  assert.match(readFileSync(viaDisable.gamma, 'utf8'), /a line of the repo's own/);
  const viaRender = unrecordedEditedGamma(cliPath);
  const house = JSON.parse(readFileSync(join(viaRender.repo, 'house.json'), 'utf8'));
  house.modules.gamma.enabled = false;
  writeHouseJson(viaRender.repo, house);
  const r = runCli(cliPath, ['render', '--repo', viaRender.repo, '--apply']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, UNRECORDED_LEFT);
  assert.match(r.out, FORGED_NOTE);
  assert.match(readFileSync(viaRender.gamma, 'utf8'), /a line of the repo's own/);
});

// Drops lock entries matching `drop`, optionally edits one file, commits.
function unrecordInLock(repo, drop, edit = null) {
  const lockPath = join(repo, '.house', 'lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.files = lock.files.filter((f) => !drop(f.path));
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  if (edit) writeFileSync(join(repo, edit.path), edit.to(readFileSync(join(repo, edit.path), 'utf8')));
  commitAll(repo, 'entries dropped from the lock');
}

// An adoption the lock records only in part is judged against what render
// would write: an unrecorded file whose body matches goes; one that differs
// cannot be proved render's, so uninstall refuses up front and changes nothing.
test('#152 uninstall: an unrecorded rule file is removed when its body matches the render, whatever version its header names', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  for (const older of [false, true]) {
    const repo = uninstallRepo(cliPath, env);
    unrecordInLock(repo, (p) => p === '.claude/rules/house/alpha.md', older ? { path: '.claude/rules/house/alpha.md', to: (s) => s.replace('house-managed v9.9.9', 'house-managed v9.8.0') } : null);
    const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.ok(!existsSync(join(repo, '.claude', 'rules', 'house', 'alpha.md')), older ? 'an older header over the current body goes' : 'a byte-identical one goes');
  }
});

test('#152 uninstall: an unrecorded rule file whose body differs is refused up front, with the checker note, and nothing changes', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  unrecordInLock(repo, (p) => p === '.claude/rules/house/alpha.md', { path: '.claude/rules/house/alpha.md', to: (s) => s.replace('house-managed v9.9.9', 'house-managed v9.8.0').replace('Body text for alpha.', 'An older body.') });
  for (const args of [['uninstall', '--repo', repo], ['uninstall', '--repo', repo, '--apply']]) {
    const r = runCli(cliPath, args, env);
    assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}${r.err}`);
    assert.match(r.out, /^REFUSE\s+\.claude\/rules\/house\/alpha\.md\s+\(not recorded in the lock and differs from the rendered file/m);
    assert.match(r.out, FORGED_NOTE);
    assert.doesNotMatch(r.out, /alpha\.md\s+\(yours|not managed \.claude\/rules\/house\/alpha\.md/);
  }
  for (const rel of [...MANAGED, 'house.json']) assert.ok(existsSync(join(repo, rel)), `${rel} stays`);
  assert.equal(localHooksPath(repo, env), floorDir(repo));
});

test('#152 uninstall: a lock without the .githooks entries still accounts for the floor', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const clean = uninstallRepo(cliPath, env);
  unrecordInLock(clean, (p) => p.startsWith('.githooks/'));
  const r = runCli(cliPath, ['uninstall', '--repo', clean, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  for (const rel of [...MANAGED, 'house.json']) assert.ok(!existsSync(join(clean, rel)), `${rel} removed: byte-identical to the render`);
  const edited = uninstallRepo(cliPath, env);
  unrecordInLock(edited, (p) => p.startsWith('.githooks/'), { path: '.githooks/pre-push', to: (s) => `${s}# mine\n` });
  const e = runCli(cliPath, ['uninstall', '--repo', edited, '--apply'], env);
  assert.equal(e.code, 1, e.out + e.err);
  assert.match(e.out, /^REFUSE\s+\.githooks\/pre-push\s+\(not recorded in the lock and differs from the rendered file/m);
  assert.doesNotMatch(e.out, /not managed \.githooks/);
  for (const rel of [...MANAGED, 'house.json']) assert.ok(existsSync(join(edited, rel)), `${rel} stays`);
  assert.equal(localHooksPath(edited, env), floorDir(edited));
});

test('#152 uninstall: a lock that records only a path that is not there still removes what render wrote, block included', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  writeFileSync(join(repo, '.house', 'lock.json'), '{"files": [{"path": "x"}]}\n');
  commitAll(repo, 'a lock that lost its entries');
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  for (const rel of [...MANAGED, 'house.json']) assert.ok(!existsSync(join(repo, rel)), `${rel} removed`);
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), AGENTS_OWN, 'the unrecorded block matched the render and went');
  assert.equal(localHooksPath(repo, env), '');
});

// Preflight: everything that could stop a removal is checked before the first
// write, so a refusal leaves the hooks path set and every file in place.
test('#152 uninstall: a read-only managed directory is refused before anything is written', (t) => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  const dir = join(repo, '.claude', 'rules', 'house');
  chmodSync(dir, 0o555);
  t.after(() => chmodSync(dir, 0o755));
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^REFUSE\s+\.claude\/rules\/house\/alpha\.md\s+\(its directory cannot be written/m);
  assert.match(r.err, /nothing was deleted or unset/);
  assert.equal(localHooksPath(repo, env), floorDir(repo), 'the hooks path is still set');
  for (const rel of [...MANAGED, 'house.json']) assert.ok(existsSync(join(repo, rel)), `${rel} stays`);
});

test('#152 uninstall: a lock entry naming a directory is refused before anything is written', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  const lockPath = join(repo, '.house', 'lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.files.push({ path: 'src', module: 'alpha', source: 'x', bodySha256: 'x' });
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  commitAll(repo, 'a lock entry naming a directory');
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^REFUSE\s+src\s+\(a directory, not a file\)/m);
  assert.equal(localHooksPath(repo, env), floorDir(repo), 'the hooks path is still set');
  for (const rel of [...MANAGED, 'house.json', 'src/a.js']) assert.ok(existsSync(join(repo, rel)), `${rel} stays`);
});

// A failure after the config phase has to say the config changed. The message
// is a pure function of what was done, lifted out of the CLI and run here.
test('#152 uninstall: a run that stops part way names the config it already changed', () => {
  const src = readFileSync(REAL_CLI_SRC, 'utf8').match(/^function partialRunMessage\([^)]*\) \{\n[^]*?\n\}$/m);
  assert.ok(src, 'partialRunMessage is not a top-level function in the CLI any more');
  const partialRunMessage = new Function(`${src[0]}\nreturn partialRunMessage;`)();
  const msg = partialRunMessage('remove .githooks/pre-push', new Error('EACCES'), ['unset core.hooksPath /r/.githooks at local scope'], [], ['.githooks/pre-push', 'house.json'], true);
  assert.match(msg, /Already changed: unset core\.hooksPath \/r\/\.githooks at local scope\./);
  assert.match(msg, /Not done: \.githooks\/pre-push, house\.json\./);
  assert.doesNotMatch(msg, /nothing/);
  assert.match(msg, /re-run `house uninstall --apply`/);
});

test('#152 uninstall: in a repo path full of pattern characters, only the floor value is unset', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = buildTargetRepo({ 'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n' }, 'house-repo-a.b (c)+[d] e-');
  writeHouseJson(repo, { ...BASE_HOUSE_JSON, modules: { alpha: { enabled: true, config: {} }, github: { enabled: true, config: {} } } });
  assert.equal(runCli(cliPath, ['render', '--repo', repo, '--apply'], env).code, 0);
  commitAll(repo, 'adopt');
  const floor = floorDir(repo);
  assert.equal(localHooksPath(repo, env), floor, 'precondition: armed');
  const lookalike = floor.replace('a.b (c)+[d] e', 'aXb cd e').replace(/\/\.githooks$/, '/Xgithooks');
  assert.ok(new RegExp(`^${floor}$`).test(lookalike), 'precondition: an unescaped pattern would match the second value');
  assert.equal(gitIn(repo, ['config', '--local', '--add', 'core.hooksPath', lookalike], env).status, 0);
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(gitIn(repo, ['config', '--local', '--get-all', 'core.hooksPath'], env).stdout, `${lookalike}\n`);
});

test('#152 uninstall: forged lock entries outside the repo or in .git are refused through the shared deletion check, and nothing is deleted', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  const outside = mkdtempSync(join(tmpdir(), 'house-outside-'));
  CLEANUP_DIRS.push(outside);
  writeFileSync(join(outside, 'f.txt'), 'outside\n');
  symlinkSync(outside, join(repo, 'linkdir'));
  const lockPath = join(repo, '.house', 'lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const gitDesc = readFileSync(join(repo, '.git', 'description'), 'utf8');
  lock.files.push({ path: 'linkdir/f.txt', module: 'alpha', source: 'x', bodySha256: sha256Hex('outside\n') });
  lock.files.push({ path: '.git/description', module: 'alpha', source: 'x', bodySha256: sha256Hex(gitDesc) });
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  commitAll(repo, 'forged lock entries');
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^REFUSE\s+linkdir\/f\.txt\s+\(lock entry resolves outside this repo/m);
  assert.match(r.out, /^REFUSE\s+\.git\/description\s+\(lock entry resolves inside \.git/m);
  assert.ok(existsSync(join(outside, 'f.txt')));
  assert.equal(readFileSync(join(repo, '.git', 'description'), 'utf8'), gitDesc);
  for (const rel of MANAGED) assert.ok(existsSync(join(repo, rel)), `${rel} stays`);
  assert.equal(gitStatusShort(repo), '');
});

test('#152 uninstall: a hooks path pointing elsewhere is left and reported, and a global one is never written', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv('[core]\n\thooksPath = /opt/global-hooks\n');
  const repo = uninstallRepo(cliPath, env);
  assert.equal(localHooksPath(repo, env), '', 'precondition: arming refused, since a global value governs this repo');
  assert.equal(gitIn(repo, ['config', '--local', 'core.hooksPath', '/opt/own-hooks'], env).status, 0);
  const globalBefore = readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8');
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(localHooksPath(repo, env), '/opt/own-hooks', 'a local value that is not this repo\'s floor stays');
  assert.equal(readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8'), globalBefore, 'global config byte-identical');
  assert.match(r.out, /local scope .*: \/opt\/own-hooks, not this repo's floor: left/);
  assert.match(r.out, /global scope .*: \/opt\/global-hooks, not this repo's floor: left/);
});

test('#152 uninstall --apply: a rerun after a completed run finds it done and exits 0', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  assert.equal(runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env).code, 0);
  const statusAfter = gitStatusShort(repo);
  const again = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(again.code, 0, again.out + again.err);
  assert.match(again.out, /already/i);
  assert.match(again.out, /core\.hooksPath, local scope: unset/);
  assert.equal(gitStatusShort(repo), statusAfter, 'a rerun changes nothing');
});

test('#152 uninstall --apply: a rerun after an interrupted run completes it', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const repo = uninstallRepo(cliPath, env);
  // Interrupted part way: some managed files already gone, the lock still there.
  for (const rel of ['.githooks/pre-push', '.claude/rules/house/alpha.md']) rmSync(join(repo, rel));
  const r = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^already gone\s+\.githooks\/pre-push/m);
  for (const rel of MANAGED) assert.ok(!existsSync(join(repo, rel)), `${rel} removed`);
  assert.equal(localHooksPath(repo, env), '');
  // Interrupted after the lock went but before the hooks path was undone.
  assert.equal(gitIn(repo, ['config', '--local', 'core.hooksPath', floorDir(repo)], env).status, 0);
  const rest = runCli(cliPath, ['uninstall', '--repo', repo, '--apply'], env);
  assert.equal(rest.code, 0, rest.out + rest.err);
  assert.equal(localHooksPath(repo, env), '', 'the rerun undoes what was left');
});

test('#152 uninstall in a linked worktree: the shared hooks path is not written from there, and the main-checkout command is named', () => {
  const { cliPath } = buildFloorFixture();
  const env = isolatedGitEnv();
  const main = uninstallRepo(cliPath, env);
  const wt = `${main}-wt`;
  CLEANUP_DIRS.push(wt);
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat/out', wt], { cwd: main });
  assert.equal(localHooksPath(main, env), floorDir(main));
  const r = runCli(cliPath, ['uninstall', '--repo', wt, '--apply'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(localHooksPath(main, env), floorDir(main), 'the shared config is not written from a worktree');
  assert.match(r.out, /shared with the main checkout/);
  assert.match(r.out, new RegExp(`run \`house uninstall --apply\` again from the main checkout \\(${realpathSync(main).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  assert.doesNotMatch(r.out, /node \S+\/scripts\/house uninstall/, 'no plugin path that goes stale after an update');
  for (const rel of MANAGED) assert.ok(!existsSync(join(wt, rel)), `${rel} removed in the worktree`);
});
