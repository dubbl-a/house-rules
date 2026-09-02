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
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync,
  chmodSync, existsSync, statSync, rmSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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

/**
 * Build a throwaway fixture plugin dir: modules/alpha (default "on",
 * literal defaultPaths), modules/beta (default "detect", a single "$slot"
 * defaultPaths entry), a fake payload/check.mjs, a fake plugin.json (version
 * 9.9.9), and a COPY of the real CLI at scripts/house so source resolution
 * (<scriptdir>/../modules, <scriptdir>/../.claude-plugin/plugin.json) is
 * exercised against this fixture, not the real house package.
 */
function buildFixturePlugin() {
  const dir = mkdtempSync(join(tmpdir(), 'house-fixture-'));
  CLEANUP_DIRS.push(dir);
  writeTree(dir, {
    '.claude-plugin/plugin.json': `${JSON.stringify({ name: 'house', version: '9.9.9' }, null, 2)}\n`,
    'payload/check.mjs': FAKE_CHECK_MJS,
    'modules/alpha/module.json': `${JSON.stringify({
      name: 'alpha', default: 'on', rules: ['rules/alpha.md'], files: [], configSlots: [],
      defaultPaths: ['src/**', 'scripts/**'],
    }, null, 2)}\n`,
    'modules/alpha/rules/alpha.md': ALPHA_BODY,
    'modules/beta/module.json': `${JSON.stringify({
      name: 'beta', default: 'detect', rules: ['rules/beta.md'], files: [], configSlots: ['slot'],
      defaultPaths: ['$slot'],
    }, null, 2)}\n`,
    'modules/beta/rules/beta.md': BETA_BODY,
  });
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
function buildTargetRepo(files = { 'README.md': '# hi\n', 'src/a.js': '//a\n', 'scripts/b.mjs': '//b\n' }) {
  const dir = mkdtempSync(join(tmpdir(), 'house-repo-'));
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

/** Run the fixture CLI as a real subprocess. Returns {code, out, err}. */
function runCli(cliPath, args) {
  const res = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
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
  // "deployment"/"database"): no known probe, so it defaults to disabled
  // with its glob slot left empty for the operator to fill in.
  assert.equal(data.modules.beta.enabled, false);
  assert.deepEqual(data.modules.beta.config, { slot: [] });
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
