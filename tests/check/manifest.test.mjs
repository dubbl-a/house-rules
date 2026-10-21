import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandbox, run, houseJson, writeUntracked, addFiles } from './helpers.mjs';

// The module-defaults sub-checks read defaults from the INSTALLED house plugin
// when one is reachable (it wins over a sandbox's local modules tree), so any
// test that plants its own module.json must hide the real ~/.claude, or it
// passes or fails depending on whether the machine has the plugin installed.
const NO_PLUGIN = { CLAUDE_CONFIG_DIR: '/definitely/does/not/exist' };

test('manifest: a minimal valid house.json passes', () => {
  const dir = sandbox({ 'house.json': houseJson() });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
});

test('manifest: missing house.json exits 2 (unusable)', () => {
  const dir = sandbox({ 'README.md': '# Hello\n' });
  const { code } = run(dir, ['--only=manifest']);
  assert.equal(code, 2);
});

test('manifest: invalid JSON in house.json exits 2 (unusable)', () => {
  const dir = sandbox({ 'house.json': '{ not valid json' });
  const { code } = run(dir, ['--only=manifest']);
  assert.equal(code, 2);
});

test('manifest: a missing required key is a finding', () => {
  const dir = sandbox({ 'house.json': JSON.stringify({ version: '0.1.0', defaultBranch: 'main', modules: {} }) });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 1, out);
  assert.match(out, /missing required key `branchPolicy`/);
});

test('manifest: an unknown top-level key is a finding', () => {
  const dir = sandbox({ 'house.json': houseJson({ notARealKey: true }) });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 1, out);
  assert.match(out, /unknown top-level key/);
});

test('manifest: branchPolicy "direct" without a matching deviations entry is a finding', () => {
  const dir = sandbox({ 'house.json': houseJson({ branchPolicy: 'direct' }) });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 1, out);
  assert.match(out, /branchPolicy "direct" requires a deviations entry/);
});

test('manifest: branchPolicy "direct" with a matching deviations entry passes', () => {
  const dir = sandbox({
    'house.json': houseJson({
      branchPolicy: 'direct',
      deviations: [{ kind: 'branch-policy', what: 'solo repo, no PR overhead', why: 'single maintainer', decided: '2026-08-24' }],
    }),
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
});

test('manifest: a carveOut without a matching deviations entry is a finding', () => {
  const dir = sandbox({ 'house.json': houseJson({ carveOuts: ['scripts/newsletter/issue-*.json'] }) });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 1, out);
  assert.match(out, /carveOut `scripts\/newsletter\/issue-\*\.json` requires a deviations entry/);
});

test('manifest: a carveOut with a matching deviations entry passes', () => {
  const dir = sandbox({
    'house.json': houseJson({
      carveOuts: ['scripts/newsletter/issue-*.json'],
      deviations: [{ kind: 'carve-out', what: 'newsletter copy at scripts/newsletter/issue-*.json ships direct to master', why: 'publishing, not shipping code', decided: '2026-08-24' }],
    }),
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
});

test('manifest: disabling a default-on module without a deviations entry is a finding', () => {
  const dir = sandbox({ 'house.json': houseJson({ modules: { testing: { enabled: false } } }) });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 1, out);
  assert.match(out, /module `testing` is default-on but disabled/);
});

test('manifest: disabling a default-on module WITH a matching deviations entry passes', () => {
  const dir = sandbox({
    'house.json': houseJson({
      modules: { testing: { enabled: false } },
      deviations: [{ kind: 'disabled-module', module: 'testing', what: 'not used here', why: 'single-file repo', decided: '2026-08-24' }],
    }),
  });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 0, out);
});

test('manifest: disabling a default-OFF module needs no deviations entry', () => {
  const dir = sandbox({ 'house.json': houseJson({ modules: { security: { enabled: false } } }) });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 0, out);
});

// #258: module defaults are part of the checker (MODULE_FACTS), so the
// disabled-module check never depends on a plugin, a modules tree or the lock.
// A module the checker does not ship is a finding, enabled or not.
test('P8: a module the checker does not ship is a finding even with nothing else reachable (positive control)', () => {
  const dir = sandbox({ 'house.json': houseJson({ modules: { 'git-workflow': { enabled: false } } }) });
  const { code, json } = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(code, 1, JSON.stringify(json));
  assert.ok((json.findings || []).some((w) => /ships no module `git-workflow`/.test(w.message)), 'an unknown module must fail the gate, not silently pass');
});

test('P8: a shipped default-off module disabled with no plugin reachable is clean (negative control)', () => {
  const dir = sandbox({ 'house.json': houseJson({ modules: { security: { enabled: false } } }) });
  const { code, json } = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(code, 0, JSON.stringify(json));
});

test('manifest: ratchet values must be positive integers', () => {
  const dir = sandbox({ 'house.json': houseJson({ ratchet: { 'README.md': -5 } }) });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 1, out);
  assert.match(out, /positive integer/);
});

// ── #18: a managed file git cannot see is a false zero ───────────────────
//
// The drift/shape/lengths/coload families walk `git ls-files`. A vendored
// rule that .gitignore swallows never enters that list, so the checker prints
// "0 findings" for a repo it never inspected (repo-e, first run). The
// lock knows what render wrote; the manifest family must compare that against
// what git tracks.
const LOCK = JSON.stringify({ files: [{ path: '.claude/rules/house/x.md', module: 'docs', source: 'modules/docs/rules/docs.md', bodySha256: 'deadbeef' }] }, null, 2);
const RULE = '<!-- house-managed v0.0.0 module=docs source=modules/docs/rules/docs.md body-sha256=deadbeef -->\n# X\n';

test('#18: a lock entry present on disk but gitignored is a manifest finding (positive control)', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.gitignore': '.claude/\n', '.house/lock.json': LOCK, '.claude/rules/house/x.md': RULE });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 1, out);
  assert.match(out, /\.claude\/rules\/house\/x\.md \[gitignored\]/);
  assert.match(out, /\.gitignore:1/, 'names the ignore source');
  assert.match(out, /settings\.local\.json/, 'names the narrowing fix');
});

test('#18: the same lock entry, tracked, is not a finding (negative control)', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.gitignore': 'node_modules/\n', '.house/lock.json': LOCK, '.claude/rules/house/x.md': RULE });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /gitignored|untracked/);
});

test('#18: a lock entry present on disk but not yet staged is a warning that clears on git add', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': LOCK });
  writeUntracked(dir, { '.claude/rules/house/x.md': RULE });
  const before = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(before.code, 0, JSON.stringify(before.json));
  const w = (before.json.warnings || []).find((x) => x.kind === 'untracked' && x.path === '.claude/rules/house/x.md');
  assert.ok(w, `expected an untracked warning, got ${JSON.stringify(before.json.warnings)}`);
  assert.match(w.message, /git add/);
  addFiles(dir, { '.claude/rules/house/x.md': RULE });
  const after = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(after.code, 0);
  assert.ok(!(after.json.warnings || []).some((x) => x.kind === 'untracked'), 'staged: no untracked warning');
});

// ── #19: a raised co-load ceiling must be on the record ──────────────────
//
// Three adopters raised maxCoLoadLines (600, 700, 1100) with a free-text
// `other` deviation nothing validated. Like branch-policy and carve-out, the
// raise is verifiable from house.json alone, so its absence is a finding.
const ceiling = (n, deviations) => houseJson({ modules: { docs: { enabled: true, config: { maxCoLoadLines: n } } }, ...(deviations ? { deviations } : {}) });
// The entry carries the number as a structured `ceiling` (like ratchetRaises.to),
// compared exactly; prose in `what` is never parsed.
const raise = (n) => ({ kind: 'coload-ceiling', module: 'docs', ceiling: n, what: 'raised for the api rule set', why: 'fixture', decided: '2026-08-25' });

test('#19: maxCoLoadLines above the default with no coload-ceiling deviation is a finding', () => {
  const dir = sandbox({ 'house.json': ceiling(500) });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 1, out);
  assert.match(out, /coload-ceiling/);
  assert.match(out, /500/);
});

test('#19: a raised ceiling with a matching coload-ceiling entry passes', () => {
  const dir = sandbox({ 'house.json': ceiling(500, [raise(500)]) });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 0, out);
});

test('#19: an entry whose ceiling is a different number does not cover the current ceiling', () => {
  const dir = sandbox({ 'house.json': ceiling(600, [raise(500)]) });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 1, out);
  assert.match(out, /coload-ceiling/);
});

test('#19: a coload-ceiling entry without an integer `ceiling` is a finding, even when prose names the number', () => {
  const dir = sandbox({ 'house.json': ceiling(500, [{ kind: 'coload-ceiling', module: 'docs', what: 'maxCoLoadLines raised to 500', why: 'fixture', decided: '2026-08-25' }]) });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 1, out);
  assert.match(out, /`ceiling`/);
});

test('#19: a non-integer maxCoLoadLines is a finding, not a silent fallback to the default', () => {
  for (const bad of ['"600"', '450.5', '0']) {
    const dir = sandbox({ 'house.json': `{"version":"0.1.0","defaultBranch":"main","branchPolicy":"pr","modules":{"docs":{"enabled":true,"config":{"maxCoLoadLines":${bad}}}}}` });
    const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
    assert.equal(code, 1, `${bad}: ${out}`);
    assert.match(out, /maxCoLoadLines must be a positive integer/);
  }
});

test('#19: a ceiling at or below the default needs no entry', () => {
  for (const n of [400, 300]) {
    const dir = sandbox({ 'house.json': ceiling(n) });
    const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
    assert.equal(code, 0, `${n}: ${out}`);
  }
});

test('manifest: every deviation kind in the schema enum is accepted; an unknown kind is a finding', () => {
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'house', 'schema', 'house.schema.json');
  const kinds = JSON.parse(readFileSync(schemaPath, 'utf8')).properties.deviations.items.properties.kind.enum;
  assert.ok(kinds.includes('coload-ceiling'), 'the schema declares coload-ceiling');
  for (const kind of kinds) {
    const extra = kind === 'coload-ceiling' ? { ceiling: 500 } : kind === 'declined-step' ? { module: 'github', step: 'community-profile' } : {};
    const dir = sandbox({ 'house.json': houseJson({ modules: { github: { enabled: true } }, deviations: [{ kind, ...extra, what: 'x', why: 'y', decided: '2026-08-25' }] }) });
    const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
    assert.equal(code, 0, `${kind}: ${out}`);
  }
  const bogus = sandbox({ 'house.json': houseJson({ deviations: [{ kind: 'bogus', what: 'x', why: 'y', decided: '2026-08-25' }] }) });
  const { code, out } = run(bogus, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 1, out);
  assert.match(out, /not a valid kind/);
});

test('#18: a lock entry re-included by a negated .gitignore pattern is untracked (warning), not gitignored (finding)', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.gitignore': '.claude/*\n!.claude/rules/\n', '.house/lock.json': LOCK });
  writeUntracked(dir, { '.claude/rules/house/x.md': RULE });
  const { code, json } = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(code, 0, JSON.stringify(json));
  assert.ok(!(json.findings || []).some((f) => f.kind === 'gitignored'), 'negation match is not an ignore');
  assert.ok((json.warnings || []).some((w) => w.kind === 'untracked'), 'still unstaged, so still a warning');
});

test('#18: a lock entry whose path escapes or is empty is ignored by the untracked check (isInsideRoot)', () => {
  const lock = JSON.stringify({ files: [{ path: '', module: 'docs' }, { path: '../outside.md', module: 'docs' }, { path: '/etc/hosts', module: 'docs' }] });
  const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': lock });
  const { code, json } = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(code, 0, JSON.stringify(json));
  assert.ok(!(json.warnings || []).some((w) => w.kind === 'untracked' || w.kind === 'gitignored'), `no tracking verdict on an out-of-root path: ${JSON.stringify(json.warnings)}`);
});

test('#18: a --repo that is not a git repository gets one "could not evaluate" warning, not one [untracked] per managed file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-nogit-'));
  for (const [p, body] of Object.entries({ 'house.json': houseJson(), '.house/lock.json': LOCK, '.claude/rules/house/x.md': RULE })) {
    mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body);
  }
  const { code, json } = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(code, 0, JSON.stringify(json));
  const w = json.warnings || [];
  assert.equal(w.filter((x) => x.kind === 'untracked').length, 0, 'no per-file untracked verdicts without git');
  assert.equal(w.filter((x) => x.kind === 'unverifiable').length, 1, `one not-evaluable warning: ${JSON.stringify(w)}`);
  assert.match(w.find((x) => x.kind === 'unverifiable').message, /git/);
});

// ── v0.3.0: ADR 0009 shapes ──────────────────────────────────────────────

test('manifest: a well-formed guard record passes; each malformed shape is a finding', () => {
  const good = sandbox({ 'house.json': houseJson({ guard: { by: 'plugin', decided: '2026-08-31', why: 'plugin supplies the hook' } }) });
  const goodRes = run(good, ['--only=manifest'], NO_PLUGIN);
  assert.equal(goodRes.code, 0, goodRes.out);

  const cases = [
    [{ by: 'repo', decided: '2026-08-31', why: 'x' }, /`guard\.by` must be "plugin"/],
    [{ by: 'plugin', decided: 'yesterday', why: 'x' }, /`guard\.decided` must be YYYY-MM-DD/],
    [{ by: 'plugin', decided: '2026-13-45', why: 'x' }, /`guard\.decided` must be YYYY-MM-DD/],
    [{ by: 'plugin', decided: '2026-02-30', why: 'x' }, /`guard\.decided` must be YYYY-MM-DD/],
    [{ by: 'plugin', decided: '2026-08-31', why: ' ' }, /`guard\.why` must be a non-empty string/],
    [{ by: 'plugin', decided: '2026-08-31', why: 'x', extra: 1 }, /`guard` has unknown key `extra`/],
    [true, /`guard` must be an object/],
  ];
  for (const [guard, re] of cases) {
    const dir = sandbox({ 'house.json': houseJson({ guard }) });
    const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
    assert.equal(code, 1, `${JSON.stringify(guard)} must be a finding`);
    assert.match(out, re);
  }
});

test('manifest: object-form docs config entries are validated (allowlist, excludes, packageRoots)', () => {
  const mkDir = (config) => sandbox({
    'README.md': '# r\n',
    'pkg/index.mjs': 'export {};\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config } } }),
  });

  // Well-formed object entries pass.
  const good = mkDir({
    bareScriptAllowlist: ['plain:ok', { token: 'kv:key', kind: 'not-a-script', why: 'KV key' }],
    excludeFiles: ['plain.md', { path: 'notes/x.md', why: 'nested package doc' }],
    archiveDirs: [{ path: 'reports/**', why: 'generated' }],
    packageRoots: ['pkg', { dir: 'pkg' }],
  });
  const goodRes = run(good, ['--only=manifest'], NO_PLUGIN);
  assert.equal(goodRes.code, 0, goodRes.out);

  // Each malformed shape is its own finding.
  const cases = [
    [{ bareScriptAllowlist: [{ token: 'kv:key' }] }, /bareScriptAllowlist\[0\]/],
    [{ bareScriptAllowlist: [{ token: 'kv:key', why: 'x', extra: 1 }] }, /bareScriptAllowlist\[0\]/],
    [{ excludeFiles: [{ path: 'x.md' }] }, /excludeFiles\[0\]/],
    [{ excludeFiles: [{ path: 'x.md', why: 'y', extra: 1 }] }, /excludeFiles\[0\]/],
    [{ archiveDirs: [{ why: 'y' }] }, /archiveDirs\[0\]/],
    [{ packageRoots: [42] }, /packageRoots\[0\]/],
    [{ packageRoots: ['../escape'] }, /packageRoots\[0\].*escapes the repo root/],
  ];
  for (const [config, re] of cases) {
    const { code, out } = run(mkDir(config), ['--only=manifest'], NO_PLUGIN);
    assert.equal(code, 1, `${JSON.stringify(config)} must be a finding: ${out}`);
    assert.match(out, re);
  }

  // A declared root matching nothing tracked is a warning, not a finding.
  const stale = mkDir({ packageRoots: ['ghost'] });
  const staleRes = run(stale, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(staleRes.code, 0, staleRes.out);
  assert.ok((staleRes.json.warnings || []).some((w) => /packageRoots\[0\].*matches no tracked files/.test(w.message)), staleRes.out);
});

test('manifest: the docs emDash slot is validated field by field', () => {
  const mkDir = (emDash) => sandbox({
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { emDash } } } }),
  });

  // A fully populated well-formed slot passes, in both entry forms.
  const good = mkDir({
    mode: 'all',
    paths: ['README.md', { path: 'docs/**/*.md', why: 'public prose' }],
    exclude: [{ path: 'docs/sources/**', why: 'point-in-time research notes kept verbatim' }],
  });
  const goodRes = run(good, ['--only=manifest'], NO_PLUGIN);
  assert.equal(goodRes.code, 0, goodRes.out);

  // Each malformed field is its own single finding, naming the fallback.
  const cases = [
    [{ mode: 'loud' }, /emDash\.mode must be "public", "all", or "off"/],
    [{ paths: 'README.md' }, /emDash\.paths must be an array/],
    [{ paths: ['README.md', 42] }, /emDash\.paths must be an array/],
    [{ exclude: [''] }, /emDash\.exclude must be an array/],
    [{ mode: 'off', nope: true }, /emDash has unknown key `nope`/],
    ['off', /emDash must be an object/],
  ];
  for (const [emDash, re] of cases) {
    const { code, out, json } = run(mkDir(emDash), ['--only=manifest', '--json'], NO_PLUGIN);
    assert.equal(code, 1, `${JSON.stringify(emDash)} must be a finding: ${out}`);
    const hits = json.findings.filter((f) => /emDash/.test(f.message));
    assert.equal(hits.length, 1, `${JSON.stringify(emDash)} must give exactly one finding: ${out}`);
    assert.match(hits[0].message, re);
  }
});

test('manifest: an absent emDash slot is not a finding', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: {} } } }),
  });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 0, out);
});

test('manifest: `targets` is validated against the schema enum; claude-code must be present', () => {
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'house', 'schema', 'house.schema.json');
  const allowed = JSON.parse(readFileSync(schemaPath, 'utf8')).properties.targets.items.enum;
  const ok = sandbox({ 'house.json': houseJson({ targets: allowed }) });
  assert.equal(run(ok, ['--only=manifest']).code, 0, 'every schema target at once is valid');
  assert.equal(run(sandbox({ 'house.json': houseJson({ targets: ['claude-code'] }) }), ['--only=manifest']).code, 0);
  for (const [targets, re] of [
    ['codex', /`targets` must be an array/],
    [['claude-code', 'cursor'], /`targets` entry `cursor` is not one of/],
    [['claude-code', 'codex', 'codex'], /`targets` lists `codex` more than once/],
    [['codex', 'gemini'], /`targets` must include "claude-code"/],
  ]) {
    const { code, out } = run(sandbox({ 'house.json': houseJson({ targets }) }), ['--only=manifest']);
    assert.equal(code, 1, `${JSON.stringify(targets)}: ${out}`);
    assert.match(out, re);
  }
});

// #135: dated at-adoption confirmations ride beside the module's entry.
test('manifest: a well-formed modules.<name>.confirmed passes', () => {
  const modules = { github: { enabled: true, config: {}, confirmed: { 'push-protection': '2026-10-03' } } };
  const { code, out } = run(sandbox({ 'house.json': houseJson({ modules }) }), ['--only=manifest']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /confirmed/);
});

test('manifest: a real leap day is a date, an impossible one is not', () => {
  const guard = (decided) => run(sandbox({ 'house.json': houseJson({ guard: { by: 'plugin', decided, why: 'x' } }) }), ['--only=manifest'], NO_PLUGIN);
  assert.equal(guard('2028-02-29').code, 0);
  assert.equal(guard('2026-02-29').code, 1);
});

test('manifest: a malformed confirmed record is a finding', () => {
  for (const [confirmed, re] of [
    [{ 'push-protection': '2026-13-45' }, /must be a date \(YYYY-MM-DD\)/],
    [{ 'push-protection': '3 Oct 2026' }, /modules\.github\.confirmed\["push-protection"\] must be a date \(YYYY-MM-DD\)/],
    [{ 'push-protection': true }, /must be a date/],
    [['push-protection'], /modules\.github\.confirmed must be an object/],
  ]) {
    const modules = { github: { enabled: true, config: {}, confirmed } };
    const { code, out } = run(sandbox({ 'house.json': houseJson({ modules }) }), ['--only=manifest']);
    assert.equal(code, 1, `${JSON.stringify(confirmed)}: ${out}`);
    assert.match(out, re);
  }
});

// #178: a vendored script no one references, beside the adopter's own wired twin.
function lockFor(paths) {
  return JSON.stringify({ files: paths.map((path) => ({ path, module: 'engineering', source: 'x', bodySha256: 'a'.repeat(64) })) });
}

test('#178: an unreferenced scripts/house script names the same-named tracked file elsewhere', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockFor(['scripts/house/foo-guard.mjs']),
    'scripts/house/foo-guard.mjs': 'export const a = 1;\n',
    'scripts/foo-guard.mjs': 'export const a = 1;\n',
    'package.json': '{"scripts":{"guard":"node scripts/foo-guard.mjs"}}\n',
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
  assert.match(out, /scripts\/house\/foo-guard\.mjs \[unreferenced script\] vendored script is referenced by no package\.json script/);
  assert.match(out, /same name sits at scripts\/foo-guard\.mjs/);
});

test('#178: wiring the vendored script into package.json clears the warning', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockFor(['scripts/house/foo-guard.mjs']),
    'scripts/house/foo-guard.mjs': 'export const a = 1;\n',
    'scripts/foo-guard.mjs': 'export const a = 1;\n',
    'package.json': '{"scripts":{"guard":"node scripts/house/foo-guard.mjs"}}\n',
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /unreferenced script/);
});

test('#178: a vendored script imported by another vendored script counts as referenced', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockFor(['scripts/house/deploy-guards.mjs', 'scripts/house/assert-main-at-origin.mjs']),
    'scripts/house/deploy-guards.mjs': "import { a } from './assert-main-at-origin.mjs';\n",
    'scripts/house/assert-main-at-origin.mjs': 'export const a = 1;\n',
    'scripts/assert-main-at-origin.mjs': 'export const a = 1;\n',
    'package.json': '{"scripts":{"deploy":"node scripts/house/deploy-guards.mjs"}}\n',
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /unreferenced script/);
});

test('#178: an unreferenced vendored script with no same-named twin elsewhere is not warned', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockFor(['scripts/house/foo-guard.mjs']),
    'scripts/house/foo-guard.mjs': 'export const a = 1;\n',
    'scripts/myfoo-guard.mjs': 'export const a = 1;\n',
    'package.json': '{"scripts":{}}\n',
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /unreferenced script/);
});

test('#178: a same-named .mjs sharing no export with the vendored script is not a twin', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockFor(['scripts/house/retro.mjs']),
    'scripts/house/retro.mjs': 'export function runRetro() {}\n',
    'scripts/lib/retro.mjs': 'export async function runDomains() {}\n',
    'package.json': '{"scripts":{}}\n',
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /unreferenced script/);
});

test('#178: a same-named .mjs sharing an export names both', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockFor(['scripts/house/retro.mjs']),
    'scripts/house/retro.mjs': 'export function runRetro() {}\nexport const x = 1;\n',
    'scripts/lib/retro.mjs': 'const y = 2;\nexport { y as x };\n',
    'package.json': '{"scripts":{}}\n',
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
  assert.match(out, /scripts\/house\/retro\.mjs \[unreferenced script\]/);
  assert.match(out, /sits at scripts\/lib\/retro\.mjs/);
});

test('#178: a same-named .sh twin still warns by basename', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockFor(['scripts/house/hook.sh']),
    'scripts/house/hook.sh': 'echo a\n',
    'scripts/hook.sh': 'echo b\n',
    'package.json': '{"scripts":{}}\n',
  });
  const { code, out } = run(dir, ['--only=manifest']);
  assert.equal(code, 0, out);
  assert.match(out, /scripts\/house\/hook\.sh \[unreferenced script\]/);
});

// ── #243, #244, #245: a fresh bootstrap reaches one verdict, locally and in CI ──
//
// These run the real CLI (init, render) into a throwaway repo and then the
// VENDORED checker there twice: once as CI sees it (an empty
// CLAUDE_CONFIG_DIR, no plugin, no modules tree) and once as a machine with
// the plugin installed does. The two runs must agree on the exit code and on
// which messages are findings, since a finding only one machine reports reads
// as noise and a gate CI runs weaker than the local one is no gate.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'plugins/house/scripts/house');
// render --apply arms the git-hook floor in the repo it renders into, which
// then refuses these fixtures' commits on main; point git at an empty hooks
// dir so the tests exercise render's output, not the guard.
const NO_HOOKS_DIR = mkdtempSync(join(tmpdir(), 'house-no-hooks-'));
const gitIn = (cwd, ...a) => execFileSync('git', ['-c', `core.hooksPath=${NO_HOOKS_DIR}`, ...a], { cwd, stdio: 'pipe' });
const houseCli = (repo, ...a) => execFileSync('node', [CLI, ...a, '--repo', repo], { stdio: 'pipe' }).toString();

function freshBootstrap(files = { 'README.md': '# X\n' }) {
  const d = mkdtempSync(join(tmpdir(), 'house-fresh-'));
  gitIn(d, 'init', '-q'); gitIn(d, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  gitIn(d, 'config', 'user.email', 't@t'); gitIn(d, 'config', 'user.name', 't');
  addFilesIn(d, files, 'init');
  houseCli(d, 'init', '--apply');
  rerender(d);
  return d;
}
function addFilesIn(d, files, msg) {
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, dirname(p)), { recursive: true }); writeFileSync(join(d, p), c); }
  gitIn(d, 'add', '-A'); gitIn(d, 'commit', '-q', '-m', msg);
}
function rerender(d) {
  houseCli(d, 'render', '--apply');
  gitIn(d, 'add', '-A'); gitIn(d, 'commit', '-q', '--allow-empty', '-m', 'render');
}
function editHouse(d, fn) {
  const hj = JSON.parse(readFileSync(join(d, 'house.json'), 'utf8'));
  fn(hj);
  writeFileSync(join(d, 'house.json'), `${JSON.stringify(hj, null, 2)}\n`);
}
function vendoredCheck(d, withPlugin) {
  const cfg = mkdtempSync(join(tmpdir(), 'house-cfg-'));
  if (withPlugin) {
    mkdirSync(join(cfg, 'plugins'), { recursive: true });
    writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: join(ROOT, 'plugins/house') }] } }));
  }
  const r = spawnSync('node', ['.house/check.mjs', '--only=manifest', '--json'], { cwd: d, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
  return { code: r.status, json: JSON.parse(r.stdout), out: r.stdout + r.stderr };
}
// Both runs, asserted to agree; returns the CI run.
function ciAndLocal(d) {
  const ci = vendoredCheck(d, false);
  const local = vendoredCheck(d, true);
  const msgs = (r) => r.json.findings.map((f) => f.message).sort();
  assert.equal(ci.code, local.code, `CI exit ${ci.code} vs local exit ${local.code}\nCI: ${ci.out}\nlocal: ${local.out}`);
  assert.deepEqual(msgs(ci), msgs(local), 'CI and local report the same findings');
  return ci;
}
const has = (list, re) => list.some((x) => re.test(x.message));

test('#243: the bootstrap skill proposes only what the checker accepts: booleans, never "detect"', () => {
  const skill = readFileSync(join(ROOT, 'plugins/house/skills/bootstrap/SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /"detect"/, 'the skill must not tell anyone to write "detect" into house.json');
  // The contract the skill now points at: init writes booleans, and a
  // non-boolean is a finding.
  const d = freshBootstrap();
  const hj = JSON.parse(readFileSync(join(d, 'house.json'), 'utf8'));
  for (const [name, m] of Object.entries(hj.modules)) assert.equal(typeof m.enabled, 'boolean', `init wrote a boolean for ${name}`);
  editHouse(d, (h) => { h.modules.database.enabled = 'detect'; });
  gitIn(d, 'commit', '-q', '-am', 'detect');
  const r = ciAndLocal(d);
  assert.equal(r.code, 1);
  assert.ok(has(r.json.findings, /module `database`\.enabled must be boolean/), r.out);
});

test('#245/#244: a fresh bootstrap with no tests reaches a clean gate, locally and in CI', () => {
  const d = freshBootstrap();
  const r = ciAndLocal(d);
  assert.equal(r.code, 0, r.out);
  assert.ok(has(r.json.warnings, /module `testing` is enabled but vendored zero rules: none of its default paths \(tests\/\*\*, test\/\*\*\) matches a file here yet/), r.out);
  assert.ok(!has(r.json.warnings, /could not resolve module defaults/), 'CI resolves module defaults from the lock');
  const lock = JSON.parse(readFileSync(join(d, '.house/lock.json'), 'utf8'));
  assert.equal(lock.modules.testing.default, 'on', 'the lock carries the module default');
});

test('#245: once a default path matches, the unrendered module is a finding, locally and in CI', () => {
  const d = freshBootstrap();
  addFilesIn(d, { 'tests/a.test.mjs': '// a\n' }, 'first test, no re-render');
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  assert.ok(has(r.json.findings, /module `testing` is enabled but vendored zero rules, and its default path tests\/\*\* now matches a file here; re-render/), r.out);
  rerender(d);
  const after = ciAndLocal(d);
  assert.equal(after.code, 0, 'negative control: the re-render vendors the rule and clears it');
  assert.ok(!has([...after.json.findings, ...after.json.warnings], /`testing` is enabled but vendored zero rules/), after.out);
});

test('#245: paths the adopter configured that match nothing stay a finding, locally and in CI', () => {
  const d = freshBootstrap();
  editHouse(d, (h) => { h.modules.testing.config.testRoots = ['spec/**']; });
  rerender(d);
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  assert.ok(has(r.json.findings, /module `testing` is enabled but vendored zero rules \(its paths matched nothing in this repo: spec\/\*\*\)/), r.out);
});

test('#244: a default-on module disabled with no deviation is a finding in CI too', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  editHouse(d, (h) => { h.modules.testing.enabled = false; });
  rerender(d);
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  assert.ok(has(r.json.findings, /module `testing` is default-on but disabled with no deviations entry/), r.out);
});

test('#244: a lock that carries no module record changes no verdict', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  const before = ciAndLocal(d);
  const lockPath = join(d, '.house/lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  delete lock.modules;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  gitIn(d, 'commit', '-q', '--allow-empty', '-am', 'a lock written before 0.21.3');
  const after = ciAndLocal(d);
  assert.equal(after.code, before.code, after.out);
  assert.deepEqual(after.json.findings.map((x) => x.message), before.json.findings.map((x) => x.message));
});

function editLock(d, fn) {
  const lockPath = join(d, '.house/lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  fn(lock);
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

test('#245: paths set in house.json but not yet rendered are a finding, locally and in CI', () => {
  const d = freshBootstrap();
  editHouse(d, (h) => { h.modules.testing.config.testRoots = ['spec/**']; });
  gitIn(d, 'commit', '-q', '-am', 'house.json edited, no re-render');
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  assert.ok(has(r.json.findings, /module `testing` is enabled but vendored zero rules \(its paths matched nothing in this repo: spec\/\*\*\).*re-render/), r.out);
  assert.ok(!has(r.json.warnings, /none of its default paths/), 'the default paths are not the verdict once the adopter wrote their own');
});

test('#244: a module this checker does not ship is a finding that names the key and re-renders only if the installed plugin ships it, locally and in CI', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  editHouse(d, (h) => { h.modules['retired-mod'] = { enabled: false }; h.modules['old-mod'] = { enabled: true }; });
  rerender(d);
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  for (const name of ['retired-mod', 'old-mod']) {
    const re = new RegExp(`this checker's module list ships no module \`${name}\`.*run \`house render --apply\`.*otherwise remove the key or correct its name`);
    const f = r.json.findings.find((x) => re.test(x.message));
    assert.ok(f, `${name}: ${r.out}`);
    assert.doesNotMatch(f.message, /no record of module/, 're-rendering is not the only advice');
  }
});

test('#245: a house.json config edited since the last render is a finding even when the module vendored rules', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  editHouse(d, (h) => { h.modules.testing.config.testRoots = ['spec/**']; });
  gitIn(d, 'commit', '-q', '-am', 'house.json edited, no re-render');
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  assert.ok(has(r.json.findings, /its current paths match files that its vendored rules do not cover.*house render --apply/), r.out);
});

test('#245: reordering a path-glob slot is not a config change', () => {
  // A zero-rule module, so the verdict that follows the comparison shows.
  const d = freshBootstrap();
  editHouse(d, (h) => { h.modules.testing.config.testRoots = ['spec/**', 'specs/**']; });
  rerender(d);
  editHouse(d, (h) => { h.modules.testing.config.testRoots = ['specs/**', 'spec/**']; });
  gitIn(d, 'commit', '-q', '-am', 'reordered');
  const r = ciAndLocal(d);
  assert.ok(!has(r.json.findings, /its current paths match files that its vendored rules do not cover/), r.out);
  assert.ok(has(r.json.findings, /its paths matched nothing in this repo: specs\/\*\*, spec\/\*\*/), r.out);

  const v = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  editHouse(v, (h) => { h.modules.testing.config.testRoots = ['tests/**', 'test/**']; });
  rerender(v);
  editHouse(v, (h) => { h.modules.testing.config.testRoots = ['test/**', 'tests/**']; });
  gitIn(v, 'commit', '-q', '-am', 'reordered');
  assert.equal(ciAndLocal(v).code, 0, 'a vendoring module with a reordered slot passes');
});

test('#244: an installed plugin that differs from the checker only warns locally, and the verdict follows the checker', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  editHouse(d, (h) => { h.modules.testing.enabled = false; });
  rerender(d);
  // A plugin whose testing module is default-off, as another version shipped it.
  const plugin = mkdtempSync(join(tmpdir(), 'house-plugin-'));
  mkdirSync(join(plugin, 'modules/testing'), { recursive: true });
  writeFileSync(join(plugin, 'modules/testing/module.json'), JSON.stringify({ name: 'testing', default: 'off', rules: [] }));
  const cfg = mkdtempSync(join(tmpdir(), 'house-cfg-'));
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: plugin }] } }));
  const r = spawnSync('node', ['.house/check.mjs', '--only=manifest', '--json'], { cwd: d, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
  const json = JSON.parse(r.stdout);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(has(json.findings, /module `testing` is default-on but disabled with no deviations entry/), 'the checker decides, not the plugin');
  assert.ok(has(json.warnings, /installed house plugin differs from this checker's module list for module `testing`.*house render --apply/), r.stdout);
});

// #258: .house/lock.json's `modules` record is no longer read for verdicts, so
// a hand edit to it changes none. Each case builds a repo with the real CLI,
// takes the verdict, edits the record the way the issue describes, and asserts
// the verdict is the same. The first four were silent or downgraded before.
const verdict = (r) => ({ code: r.code, findings: r.json.findings.map((x) => x.message).sort(), warnings: r.json.warnings.map((x) => x.message).sort() });
function sameAfterLockEdit(d, edit, expectFinding) {
  const before = ciAndLocal(d);
  assert.equal(before.code, 1, `the repo must start with a finding: ${before.out}`);
  assert.ok(has(before.json.findings, expectFinding), before.out);
  editLock(d, edit);
  gitIn(d, 'commit', '-q', '-am', 'hand-edited lock');
  const after = ciAndLocal(d);
  assert.deepEqual(verdict(after), verdict(before), 'a hand edit to the lock record changes no verdict');
}

test('#258: setting an unvendored module record rules to 0 does not silence its zero-rule finding', () => {
  const d = freshBootstrap();
  addFilesIn(d, { 'tests/a.test.mjs': '// a\n' }, 'first test, no re-render');
  sameAfterLockEdit(d, (l) => { l.modules.testing.rules = 0; }, /vendored zero rules, and its default path tests\/\*\* now matches/);
});

test('#258: pointing an unvendored module record globs at zzz/** does not downgrade its finding to a warning', () => {
  const d = freshBootstrap();
  addFilesIn(d, { 'tests/a.test.mjs': '// a\n' }, 'first test, no re-render');
  sameAfterLockEdit(d, (l) => { l.modules.testing.globs = ['zzz/**']; }, /vendored zero rules, and its default path tests\/\*\* now matches/);
});

test('#258: an adopter glob in house.json is not downgraded by editing the record globs', () => {
  const d = freshBootstrap();
  editHouse(d, (h) => { h.modules.testing.config.testRoots = ['spec/**']; });
  rerender(d);
  sameAfterLockEdit(d, (l) => { l.modules.testing.globs = ['zzz/**']; }, /its paths matched nothing in this repo: spec\/\*\*/);
});

test('#258: deleting the whole modules record does not silence a stale-config finding on a vendoring module', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  editHouse(d, (h) => { h.modules.testing.config.testRoots = ['spec/**']; });
  gitIn(d, 'commit', '-q', '-am', 'house.json edited, no re-render');
  sameAfterLockEdit(d, (l) => { delete l.modules; }, /its current paths match files that its vendored rules do not cover/);
});

const STALE = /module `(engineering|testing)` is enabled, but its current paths match files that its vendored rules do not cover/;

test('#258: deleting a slot so its defaults return is stale when a default path matches a file the rule did not cover', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'src/a.js': '//\n', 'scripts/b.js': '//\n' });
  editHouse(d, (h) => { h.modules.engineering.config.codeRoots = ['src/**']; });
  rerender(d);
  assert.equal(ciAndLocal(d).code, 0, 'the render is current');
  editHouse(d, (h) => { delete h.modules.engineering.config.codeRoots; });
  gitIn(d, 'commit', '-q', '-am', 'slot deleted, no re-render');
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  assert.ok(has(r.json.findings, STALE), r.out);
});

test('#258: reverting a slot to {} is stale when the restored default matches a directory the render left out', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '//\n', 'test/b.test.mjs': '//\n' });
  editHouse(d, (h) => { h.modules.testing.config.testRoots = ['tests/**']; });
  rerender(d);
  assert.equal(ciAndLocal(d).code, 0, 'the render is current');
  editHouse(d, (h) => { h.modules.testing.config = {}; });
  gitIn(d, 'commit', '-q', '-am', 'config reverted, no re-render');
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  assert.ok(has(r.json.findings, STALE), r.out);
});

test('#258: a glob dropped at render that later matches a file is stale without claiming house.json changed', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '//\n' });
  editHouse(d, (h) => { h.modules.testing.config.testGlobs = ['e2e/**']; });
  rerender(d);
  assert.equal(ciAndLocal(d).code, 0, 'e2e/** matched nothing, so render dropped it');
  addFilesIn(d, { 'e2e/a.js': '//\n' }, 'e2e added, no re-render');
  const r = ciAndLocal(d);
  assert.equal(r.code, 1, r.out);
  assert.ok(has(r.json.findings, STALE), r.out);
  assert.ok(!has(r.json.findings, /config differs/), 'house.json did not change');
});

test('#258: relabelling a lock entry module does not make an unvendored module look vendored', () => {
  const d = freshBootstrap();
  addFilesIn(d, { 'tests/a.test.mjs': '// a\n' }, 'first test, no re-render');
  const before = ciAndLocal(d);
  assert.equal(before.code, 1, before.out);
  editLock(d, (l) => { l.files.find((e) => e.module === 'engineering').module = 'testing'; });
  gitIn(d, 'commit', '-q', '-am', 'relabelled entry');
  const after = ciAndLocal(d);
  assert.deepEqual(verdict(after), verdict(before));
});

test('#258: setting a disabled module record default to match does not silence the disabled-module finding', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  editHouse(d, (h) => { h.modules.testing.enabled = false; });
  rerender(d);
  sameAfterLockEdit(d, (l) => { l.modules.testing.default = 'off'; }, /module `testing` is default-on but disabled/);
});

test('#258: a lock written by 0.21.3 (record present, same module facts) checks cleanly, locally and in CI', () => {
  const d = freshBootstrap({ 'README.md': '# X\n', 'tests/a.test.mjs': '// a\n' });
  const r = ciAndLocal(d);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.findings, []);
});

// #247: a declined at-adoption step is a deviation of kind "declined-step"
// naming the module and the step id. The checker has no module.json to know
// the declared ids, so it checks the shape and that the module is in house.json.
const declinedStep = (over = {}) => ({ kind: 'declined-step', module: 'github', step: 'community-profile', what: 'Declined at-adoption step `community-profile`', why: 'internal repo, no outside contributors', decided: '2026-10-15', ...over });
const declinedHouse = (dev) => houseJson({ modules: { github: { enabled: true } }, deviations: [dev] });

test('#247 manifest: a declined-step deviation naming a module in house.json passes', () => {
  const { code, out } = run(sandbox({ 'house.json': declinedHouse(declinedStep()) }), ['--only=manifest']);
  assert.equal(code, 0, out);
});

test('#247 manifest: a declined-step deviation missing module, step, why, or a real date is a finding', () => {
  for (const [over, re] of [
    [{ module: undefined }, /deviations\[0\] \(declined-step\) must name a `module`/],
    [{ step: undefined }, /deviations\[0\] \(declined-step\) must name a `step`/],
    [{ step: 'Not Kebab' }, /deviations\[0\]\.step must be a step id/],
    [{ why: undefined }, /missing `why`/],
    [{ decided: '2026-13-40' }, /decided must be YYYY-MM-DD/],
    [{ module: 'nosuch' }, /\(declined-step\) names module `nosuch`, which is not in house\.json modules/],
  ]) {
    const { code, out } = run(sandbox({ 'house.json': declinedHouse(declinedStep(over)) }), ['--only=manifest']);
    assert.equal(code, 1, `${JSON.stringify(over)}: ${out}`);
    assert.match(out, re, JSON.stringify(over));
  }
});

// #361: the database rule's paths cover the repo root's db/ and migrations/
// by default, so a nested schema directory loads no rule and nothing said so.
const dbHouse = (config) => houseJson({ modules: { database: { enabled: true, config } } });
const dbWarnings = (res) => (res.json.warnings || []).filter((w) => /database/.test(w.message) && /dbGlobs/.test(w.message));

test('#361 manifest: a nested db/ the database paths miss warns, naming the dbGlobs entry', () => {
  const dir = sandbox({ 'house.json': dbHouse({}), 'app/db/x.sql': 'select 1;\n' });
  const res = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  const w = dbWarnings(res);
  assert.equal(w.length, 1, res.out);
  assert.match(w[0].message, /`app\/db\/`/);
  assert.match(w[0].message, /`app\/db\/\*\*`/);
  assert.match(w[0].message, /modules\.database\.config\.dbGlobs/);
});

test('#361 manifest: a nested db/ covered by dbGlobs is silent', () => {
  const dir = sandbox({
    'house.json': dbHouse({ dbGlobs: ['db/**', 'app/db/**'] }),
    'app/db/x.sql': 'select 1;\n',
  });
  assert.equal(dbWarnings(run(dir, ['--only=manifest', '--json'], NO_PLUGIN)).length, 0);
});

test('#361 manifest: a repo with only a root db/ and migrations/ is silent', () => {
  const dir = sandbox({ 'house.json': dbHouse({}), 'db/x.sql': 'select 1;\n', 'migrations/1.sql': 'select 1;\n' });
  assert.equal(dbWarnings(run(dir, ['--only=manifest', '--json'], NO_PLUGIN)).length, 0);
});

test('#361 manifest: the database module off is silent about a nested db/', () => {
  const dir = sandbox({
    'house.json': houseJson({ modules: { database: { enabled: false, config: {} } } }),
    'app/db/x.sql': 'select 1;\n',
  });
  assert.equal(dbWarnings(run(dir, ['--only=manifest', '--json'], NO_PLUGIN)).length, 0);
});

test('#361 manifest: a root db/ match plus a nested migrations/ warns for the nested one only', () => {
  const dir = sandbox({
    'house.json': dbHouse({}),
    'db/x.sql': 'select 1;\n',
    'sub/migrations/1.sql': 'select 1;\n',
    'sub/migrations/nested/db/2.sql': 'select 2;\n',
    'node_modules/pkg/db/y.sql': 'select 3;\n',
  });
  const w = dbWarnings(run(dir, ['--only=manifest', '--json'], NO_PLUGIN));
  assert.equal(w.length, 1, JSON.stringify(w));
  assert.match(w[0].message, /`sub\/migrations\/`/);
  assert.match(w[0].message, /`sub\/migrations\/\*\*`/);
});

// #388: test fixture directories are not the repo's own schema, a glob
// character in the directory name is escaped in the suggestion, and the
// escaped entry silences the warning.
test('#388 manifest: a db/ or migrations/ under a test-like segment is silent', () => {
  const dir = sandbox({
    'house.json': dbHouse({}),
    'tests/fixtures/migrations/1.sql': 'select 1;\n',
    'app/test/db/x.sql': 'select 1;\n',
    'app/__tests__/db/x.sql': 'select 1;\n',
    'spec/db/x.sql': 'select 1;\n',
    'lib/testdata/db/x.sql': 'select 1;\n',
    'lib/__fixtures__/migrations/1.sql': 'select 1;\n',
  });
  const res = run(dir, ['--only=manifest', '--json'], NO_PLUGIN);
  assert.equal(dbWarnings(res).length, 0, res.out);
});

test('#388 manifest: a glob character in the directory name is escaped in the dbGlobs suggestion, and the escaped entry silences it', () => {
  const files = { 'app[1]/db/x.sql': 'select 1;\n' };
  const w = dbWarnings(run(sandbox({ 'house.json': dbHouse({}), ...files }), ['--only=manifest', '--json'], NO_PLUGIN));
  assert.equal(w.length, 1, JSON.stringify(w));
  assert.ok(w[0].message.includes('`app[1]/db/`'), w[0].message);
  assert.ok(w[0].message.includes('`app\\[1\\]/db/**`'), w[0].message);
  const dir = sandbox({ 'house.json': dbHouse({ dbGlobs: ['db/**', 'app\\[1\\]/db/**'] }), ...files });
  assert.equal(dbWarnings(run(dir, ['--only=manifest', '--json'], NO_PLUGIN)).length, 0);
});
