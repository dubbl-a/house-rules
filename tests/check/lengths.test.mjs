import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandbox, run, houseJson, cleanup, writeUntracked } from './helpers.mjs';

function linesOf(n) {
  return Array.from({ length: n }, (_, i) => `Line ${i + 1}.`).join('\n') + '\n';
}

// The checker derives the auto-memory index path from the repo root the same
// way the harness names its project directory: every `/` becomes `-`. Derive
// it here from the sandbox path rather than importing the checker, so the two
// derivations are independent and a change to either one shows up as a failure.
function memoryConfigDir(repoDir, indexBody) {
  const cfg = mkdtempSync(join(tmpdir(), 'house-mem-'));
  if (indexBody !== undefined) {
    const dir = join(cfg, 'projects', repoDir.replace(/\//g, '-'), 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'MEMORY.md'), indexBody);
  }
  return cfg;
}

test('lengths: a file under its configured limit passes', () => {
  const dir = sandbox({
    'CLAUDE.md': linesOf(10),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'CLAUDE.md': 100 } } } } }),
  });
  const { code } = run(dir, ['--only=lengths']);
  assert.equal(code, 0);
});

test('lengths: a file over its configured limit is a finding', () => {
  // README.md is a normal limited file. CLAUDE.md is deliberately excluded
  // here: it is a warning, never a blocking finding (its own tests below).
  const dir = sandbox({
    'README.md': linesOf(150),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 1, out);
  assert.match(out, /\[length\]/);
});

test('lengths: a glob-pattern limit applies to every matching file', () => {
  const dir = sandbox({
    '.claude/rules/a.md': linesOf(250),
    '.claude/rules/b.md': linesOf(50),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { '.claude/rules/*.md': 200 } } } } }),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 1, out);
  assert.match(out, /\.claude\/rules\/a\.md/);
  assert.doesNotMatch(out, /\.claude\/rules\/b\.md/);
});

test('lengths: growth past the base limit but under a recorded ratchet ceiling passes', () => {
  // CLAUDE.md is barred from ratchet and is warning-only, so exercise the
  // ratchet-ceiling path on README.md instead.
  const dir2 = sandbox({
    'README.md': linesOf(120),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchet: { 'README.md': 150 },
    }),
  });
  assert.equal(run(dir2, ['--only=lengths']).code, 0, 'growth under the ratchet ceiling must pass');
});

test('lengths: growth past the ratchet ceiling is still a finding', () => {
  const dir = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchet: { 'README.md': 150 },
    }),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 1, out);
});

test('lengths: CLAUDE.md appearing in `ratchet` is itself a finding', () => {
  const dir = sandbox({
    'CLAUDE.md': linesOf(10),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'CLAUDE.md': 100 } } } },
      ratchet: { 'CLAUDE.md': 150 },
    }),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 1, out);
  assert.match(out, /must never appear in `ratchet`/);
});

test('lengths: shrinking back under a recorded ratchet ceiling auto-tightens house.json (only on a clean run)', () => {
  const dir = sandbox({
    'README.md': linesOf(80), // now well under both the ratchet (150) and the base limit (100)
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchet: { 'README.md': 150 },
    }),
  });
  const { code } = run(dir, ['--only=lengths']);
  assert.equal(code, 0);
  const written = JSON.parse(readFileSync(join(dir, 'house.json'), 'utf8'));
  assert.equal(written.ratchet['README.md'], 80);
});

test('lengths: auto-tighten never writes when the run has any findings', () => {
  // README.md over its limit is the blocking finding; docs/x.md under a
  // ratchet ceiling would otherwise auto-tighten, and must not while a
  // finding stands.
  const dir = sandbox({
    'README.md': linesOf(150), // over its 100 limit, no ratchet: a finding
    'docs/x.md': linesOf(120),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100, 'docs/x.md': 100 } } } },
      ratchet: { 'docs/x.md': 150 },
    }),
  });
  const before = readFileSync(join(dir, 'house.json'), 'utf8');
  const { code } = run(dir, ['--only=lengths']);
  assert.equal(code, 1);
  const after = readFileSync(join(dir, 'house.json'), 'utf8');
  assert.equal(before, after);
});

test('lengths: --accept-lengths accepts growth only with a matching non-empty-why ratchetRaises entry', () => {
  const dirNoRaise = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  });
  assert.equal(run(dirNoRaise, ['--only=lengths', '--accept-lengths']).code, 1);

  const dirRaised = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchetRaises: [{ path: 'README.md', from: 100, to: 210, why: 'legitimately grew', decided: '2026-08-24' }],
    }),
  });
  const { code, out } = run(dirRaised, ['--only=lengths', '--accept-lengths']);
  assert.equal(code, 0, out);
  const written = JSON.parse(readFileSync(join(dirRaised, 'house.json'), 'utf8'));
  assert.equal(written.ratchet['README.md'], 210);
});

test('lengths: --accept-lengths without the flag still fails growth even if a ratchetRaises entry exists', () => {
  const dir = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchetRaises: [{ path: 'README.md', from: 100, to: 210, why: 'legitimately grew', decided: '2026-08-24' }],
    }),
  });
  const { code } = run(dir, ['--only=lengths']);
  assert.equal(code, 1);
});

test('lengths: length count excludes YAML frontmatter', () => {
  const frontmatter = '---\npaths:\n  - "src/**"\n---\n\n';
  const body = linesOf(50);
  const dir = sandbox({
    '.claude/rules/a.md': frontmatter + body,
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { '.claude/rules/a.md': 100 } } } } }),
  });
  const { code } = run(dir, ['--only=lengths']);
  assert.equal(code, 0); // ~50 body lines, well under 100, even though frontmatter adds more raw lines
});

test('an over-limit CLAUDE.md is a warning, never a blocking finding (not ratchet-eligible)', () => {
  const dir = sandbox({
    'package.json': '{"name":"x"}',
    'CLAUDE.md': Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n') + '\n',
  }, { modules: { docs: { enabled: true, config: { lengthLimits: { 'CLAUDE.md': 100 } } } } });
  const { code, out, json } = run(dir, ['--only=lengths', '--json']);
  assert.equal(code, 0, 'over-limit CLAUDE.md must not fail the gate');
  assert.ok((json.warnings || []).some((w) => w.path === 'CLAUDE.md'), 'must warn');
  assert.equal((json.findings || []).filter((f) => f.path === 'CLAUDE.md').length, 0, 'never a finding');
});

test('a missing CLAUDE.md limit is a warning, so absence of config cannot hide the budget', () => {
  const dir = sandbox({
    'package.json': '{"name":"x"}',
    'CLAUDE.md': Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n') + '\n',
  }, { modules: { docs: { enabled: true, config: {} } } });
  const { code, json } = run(dir, ['--only=lengths', '--json']);
  assert.equal(code, 0);
  assert.ok((json.warnings || []).some((w) => w.path === 'CLAUDE.md' && /no CLAUDE.md limit/.test(w.message)), 'missing limit must warn');
});

test('P5: a bytes-only lengthLimit is enforced (not silently dropped)', () => {
  const big = 'x'.repeat(5000);
  const dir = sandbox({
    'README.md': `# r\n${big}\n`,
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': { bytes: 1000 } } } } } }),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 1, out);
  assert.match(out, /bytes \(limit 1000\)/);
});

test('P7: a repo with README.md but no configured limit gets a warning', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: {} } } }),
  });
  const { code, json } = run(dir, ['--only=lengths', '--json']);
  assert.equal(code, 0);
  assert.ok((json.warnings || []).some((w) => w.path === 'README.md' && /no README.md limit/.test(w.message)));
});

test('memory index: an over-threshold auto-memory index warns and never fails the gate', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  });
  const cfg = memoryConfigDir(dir, linesOf(180)); // 180 lines, over the 140-line warn threshold
  const { code, out } = run(dir, ['--only=lengths'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(code, 0, out); // machine-local state warns, it never blocks
  assert.match(out, /\[memory-index\]/);
  assert.match(out, /180 lines \(warn over 140, harness cap 200\)/);
  assert.match(out, /drops the rest silently/);
  cleanup(cfg);
  cleanup(dir);
});

test('memory index: an index under every threshold says nothing', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  });
  const cfg = memoryConfigDir(dir, linesOf(20));
  const { code, out } = run(dir, ['--only=lengths'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /memory-index/);
  assert.doesNotMatch(out, /MEMORY\.md/);
  cleanup(cfg);
  cleanup(dir);
});

test('memory index: no memory directory at all is silence, not a complaint (the CI case)', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  });
  const cfg = memoryConfigDir(dir); // empty config dir: no projects/ tree at all
  const { code, out } = run(dir, ['--only=lengths'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /memory-index/);
  assert.doesNotMatch(out, /MEMORY\.md/);
  cleanup(cfg);
  cleanup(dir);
});

// -- v0.3.0: P7 covers repo-authored rule files too (#33 item 3) ----------

test('P7: a tracked repo-authored rule file with no covering limit warns; one pattern covers both sets', () => {
  const files = {
    '.claude/rules/local.md': '---\npaths:\n  - "src/**"\n---\n# L\nBody.\n',
    '.claude/rules/team/deep.md': '---\npaths:\n  - "src/**"\n---\n# D\nBody.\n',
    '.claude/rules/house/vendored.md': '# V\nBody.\n',
    'src/x.ts': 'export {};\n',
  };
  const bare = sandbox({ ...files, 'house.json': houseJson() });
  const bareRes = run(bare, ['--only=lengths', '--json']);
  assert.equal(bareRes.code, 0, bareRes.out);
  assert.ok((bareRes.json.warnings || []).some((w) => /repo-authored rule file/.test(w.message) && /\.claude\/rules\/local\.md/.test(w.message)),
    `an uncovered authored rule must warn: ${bareRes.out}`);

  // Negative control: the suggested single pattern covers authored (nested
  // included) and vendored rules alike, clearing both nudges.
  const covered = sandbox({
    ...files,
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { '.claude/rules/**/*.md': 200 } } } } }),
  });
  const coveredRes = run(covered, ['--only=lengths', '--json']);
  assert.equal(coveredRes.code, 0, coveredRes.out);
  assert.ok(!(coveredRes.json.warnings || []).some((w) => /rule file/.test(w.message)),
    `one covering pattern must clear the authored and vendored nudges: ${coveredRes.out}`);
});

test('P7: a rules-directory README alone does not trigger the authored-rule nudge', () => {
  const dir = sandbox({
    '.claude/rules/README.md': '# index\n',
    'house.json': houseJson(),
  });
  const res = run(dir, ['--only=lengths', '--json']);
  assert.ok(!(res.json.warnings || []).some((w) => /repo-authored rule file/.test(w.message)), res.out);
});

test('P7: an untracked rule file does not trigger the authored-rule nudge', () => {
  const dir = sandbox({ 'README.md': '# r\n', 'house.json': houseJson() });
  writeUntracked(dir, { '.claude/rules/scratch.md': '# S\nBody.\n' });
  const res = run(dir, ['--only=lengths', '--json']);
  assert.ok(!(res.json.warnings || []).some((w) => /repo-authored rule file/.test(w.message)), res.out);
});
