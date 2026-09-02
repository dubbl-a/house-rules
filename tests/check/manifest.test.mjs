import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
  const dir = sandbox({
    'house.json': houseJson({ modules: { mymod: { enabled: false } } }),
    'plugins/house/modules/mymod/module.json': JSON.stringify({ name: 'mymod', default: 'on', rules: [] }),
  });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 1, out);
  assert.match(out, /module `mymod` is default-on but disabled/);
});

test('manifest: disabling a default-on module WITH a matching deviations entry passes', () => {
  const dir = sandbox({
    'house.json': houseJson({
      modules: { mymod: { enabled: false } },
      deviations: [{ kind: 'disabled-module', module: 'mymod', what: 'not used here', why: 'single-file repo', decided: '2026-08-24' }],
    }),
    'plugins/house/modules/mymod/module.json': JSON.stringify({ name: 'mymod', default: 'on', rules: [] }),
  });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 0, out);
});

test('manifest: disabling a default-OFF module needs no deviations entry', () => {
  const dir = sandbox({
    'house.json': houseJson({ modules: { experimental: { enabled: false } } }),
    'plugins/house/modules/experimental/module.json': JSON.stringify({ default: "off" }),
  });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 0, out);
});

// P8: the disabled-module deviation check reads module defaults from the
// installed plugin OR the local package tree. When NEITHER is reachable it used
// to pass silently, so a default-on module disabled without a deviation could
// slip through. It still cannot be VERIFIED from the repo alone (no false
// positive), but the un-run check is now surfaced as a warning instead of
// vanishing. Exit stays 0: a warning does not block.
test('P8: an unreachable defaults sub-check WARNS about a disabled module (positive control)', () => {
  // No plugins/house/modules/ dir and no installed_plugins.json: defaults can't
  // be resolved, but there IS a disabled module, so the check warns.
  const dir = sandbox({ 'house.json': houseJson({ modules: { 'git-workflow': { enabled: false } } }) });
  const { code, json } = run(dir, ['--only=manifest', '--json'], { CLAUDE_CONFIG_DIR: '/definitely/does/not/exist' });
  assert.equal(code, 0, JSON.stringify(json));
  assert.ok((json.warnings || []).some((w) => /could not resolve module defaults/.test(w.message) && /git-workflow/.test(w.message)),
    'an unverifiable disabled module must surface a warning, not silently pass');
});

test('P8: reachable defaults run the real check and emit no unresolved-defaults warning (negative control)', () => {
  // A local plugins/house/modules tree makes defaults resolvable, so the real
  // deviation check runs (default-off module needs no deviation) and the P8
  // fallback warning must NOT appear.
  const dir = sandbox({
    'house.json': houseJson({ modules: { experimental: { enabled: false } } }),
    'plugins/house/modules/experimental/module.json': JSON.stringify({ default: 'off' }),
  });
  const { code, json } = run(dir, ['--only=manifest', '--json'], { CLAUDE_CONFIG_DIR: '/definitely/does/not/exist' });
  assert.equal(code, 0, JSON.stringify(json));
  assert.ok(!(json.warnings || []).some((w) => /could not resolve module defaults/.test(w.message)),
    'resolvable defaults must not emit the P8 fallback warning');
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
    const extra = kind === 'coload-ceiling' ? { ceiling: 500 } : {};
    const dir = sandbox({ 'house.json': houseJson({ deviations: [{ kind, ...extra, what: 'x', why: 'y', decided: '2026-08-25' }] }) });
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

// Ultra review of v0.2.1: readModuleDefaultsFrom keyed by directory name while
// readModuleRuleCountsFrom, the CLI's moduleName(), and house.json itself key
// by module.json `name`; a module whose name differs from its directory made
// the disabled-module deviation check pass silently.
test('manifest: a default-on module whose module.json name differs from its directory still needs a deviation when disabled', () => {
  const dir = sandbox({
    'house.json': houseJson({ modules: { 'git-workflow': { enabled: false } } }),
    'plugins/house/modules/branching/module.json': JSON.stringify({ name: 'git-workflow', default: 'on', rules: [] }),
  });
  const { code, out } = run(dir, ['--only=manifest'], NO_PLUGIN);
  assert.equal(code, 1, out);
  assert.match(out, /module `git-workflow` is default-on but disabled/);
});

// ── v0.3.0: ADR 0009 shapes ──────────────────────────────────────────────

test('manifest: a well-formed guard record passes; each malformed shape is a finding', () => {
  const good = sandbox({ 'house.json': houseJson({ guard: { by: 'plugin', decided: '2026-08-31', why: 'plugin supplies the hook' } }) });
  const goodRes = run(good, ['--only=manifest'], NO_PLUGIN);
  assert.equal(goodRes.code, 0, goodRes.out);

  const cases = [
    [{ by: 'repo', decided: '2026-08-31', why: 'x' }, /`guard\.by` must be "plugin"/],
    [{ by: 'plugin', decided: 'yesterday', why: 'x' }, /`guard\.decided` must be YYYY-MM-DD/],
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
