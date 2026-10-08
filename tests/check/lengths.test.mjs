import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandbox, run, houseJson, cleanup, writeUntracked } from './helpers.mjs';

function linesOf(n) {
  return Array.from({ length: n }, (_, i) => `Line ${i + 1}.`).join('\n') + '\n';
}

// The checker derives the auto-memory index path from the repo root the same
// way the harness names its project directory: every character that is not
// an ASCII letter or digit becomes `-`. Derive it here from the sandbox path
// rather than importing the checker, so the two derivations are independent
// and a change to either one shows up as a failure.
function memoryConfigDir(repoDir, indexBody) {
  const cfg = mkdtempSync(join(tmpdir(), 'house-mem-'));
  if (indexBody !== undefined) {
    const dir = join(cfg, 'projects', repoDir.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
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

test('lengths: a matching non-empty-why ratchetRaises entry takes effect on its own; without one growth fails', () => {
  const dirNoRaise = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  });
  assert.equal(run(dirNoRaise, ['--only=lengths']).code, 1);

  const dirRaised = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchetRaises: [{ path: 'README.md', from: 100, to: 210, why: 'legitimately grew', decided: '2026-08-24' }],
    }),
  });
  const { code, out } = run(dirRaised, ['--only=lengths']);
  assert.equal(code, 0, out);
  const written = JSON.parse(readFileSync(join(dirRaised, 'house.json'), 'utf8'));
  assert.equal(written.ratchet['README.md'], 210);
});

test('lengths: a ratchetRaises entry applies only when its from is the current ceiling (#231)', () => {
  const files = (raise) => ({
    'README.md': linesOf(187),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchet: { 'README.md': 186 },
      ratchetRaises: [{ path: 'README.md', ...raise, why: 'grew', decided: '2026-08-24' }],
    }),
  });
  const stale = sandbox(files({ from: 100, to: 210 }));
  const before = readFileSync(join(stale, 'house.json'), 'utf8');
  assert.equal(run(stale, ['--only=lengths']).code, 1);
  assert.equal(readFileSync(join(stale, 'house.json'), 'utf8'), before);

  const fresh = sandbox(files({ from: 186, to: 195 }));
  const { code, out } = run(fresh, ['--only=lengths']);
  assert.equal(code, 0, out);
  assert.equal(JSON.parse(readFileSync(join(fresh, 'house.json'), 'utf8')).ratchet['README.md'], 195);
});

test('lengths: a raise from the configured limit is spent once a ratchet entry sits below it', () => {
  const dir = sandbox({
    'README.md': linesOf(150),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchet: { 'README.md': 90 },
      ratchetRaises: [{ path: 'README.md', from: 100, to: 150, why: 'grew once', decided: '2026-08-24' }],
    }),
  });
  assert.equal(run(dir, ['--only=lengths']).code, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, 'house.json'), 'utf8')).ratchet['README.md'], 90);
});

test('lengths: a file over only its byte limit keeps passing on a raise, run after run', () => {
  const dir = sandbox({
    'README.md': Array.from({ length: 90 }, () => 'x'.repeat(8)).join('\n') + '\n',
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': { lines: 100, bytes: 500 } } } } },
      ratchetRaises: [{ path: 'README.md', from: 100, to: 120, why: 'bytes', decided: '2026-08-24' }],
    }),
  });
  assert.equal(run(dir, ['--only=lengths']).code, 0);
  assert.equal(run(dir, ['--only=lengths']).code, 0);
});

test('lengths: --accept-lengths is still accepted, changes nothing, and says it is no longer needed', () => {
  const dir = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchetRaises: [{ path: 'README.md', from: 100, to: 210, why: 'legitimately grew', decided: '2026-08-24' }],
    }),
  });
  const { code, out } = run(dir, ['--only=lengths', '--accept-lengths']);
  assert.equal(code, 0, out);
  assert.match(out, /--accept-lengths is no longer needed/);
});

test('lengths: a ratchetRaises entry missing from or decided does not apply', () => {
  for (const entry of [{ path: 'README.md', to: 210, why: 'w', decided: '2026-08-24' }, { path: 'README.md', from: 100, to: 210, why: 'w' }]) {
    const dir = sandbox({
      'README.md': linesOf(200),
      'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } }, ratchetRaises: [entry] }),
    });
    assert.equal(run(dir, ['--only=lengths']).code, 1, JSON.stringify(entry));
  }
});

test('lengths: a ratchetRaises entry below the current count does not apply', () => {
  const dir = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchetRaises: [{ path: 'README.md', from: 100, to: 150, why: 'too small', decided: '2026-08-24' }],
    }),
  });
  assert.equal(run(dir, ['--only=lengths']).code, 1);
});

function skillWith(body, front = 'name: demo\ndescription: Does a thing. Use when asked.\n') {
  return `---\n${front}---\n${body}`;
}

test('lengths: a SKILL.md body over the 500-line default warns with no lengthLimits entry', () => {
  const dir = sandbox({
    '.claude/skills/demo/SKILL.md': skillWith(linesOf(501)),
    'house.json': houseJson(),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 0, out);
  assert.match(out, /\.claude\/skills\/demo\/SKILL\.md \[length\] 501 lines, over the 500-line default for a SKILL\.md body/);
  const ok = sandbox({ '.claude/skills/demo/SKILL.md': skillWith(linesOf(500)), 'house.json': houseJson() });
  assert.doesNotMatch(run(ok, ['--only=lengths']).out, /SKILL\.md/);
});

test('lengths: a SKILL.md covered by a configured limit is judged by that limit, not the default', () => {
  const dir = sandbox({
    '.claude/skills/demo/SKILL.md': skillWith(linesOf(600)),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { '.claude/skills/**/SKILL.md': 800 } } } } }),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /500-line default/);
});

test('lengths: a skill description plus when_to_use over 1,536 characters warns, in a folded block too', () => {
  const long = 'word '.repeat(250).trim();
  const dir = sandbox({
    '.claude/skills/demo/SKILL.md': skillWith('Body.\n', `name: demo\ndescription: >\n  ${long}\nwhen_to_use: Use ${'when '.repeat(100).trim()}\n`),
    'house.json': houseJson(),
  });
  const { out } = run(dir, ['--only=lengths']);
  assert.match(out, /\.claude\/skills\/demo\/SKILL\.md \[length\] description plus when_to_use is \d+ characters, over the 1536 the harness keeps/);
  const ok = sandbox({ '.claude/skills/demo/SKILL.md': skillWith('Body.\n'), 'house.json': houseJson() });
  assert.doesNotMatch(run(ok, ['--only=lengths']).out, /when_to_use/);
});

test('lengths: no ratchetRaises entry leaves the finding without the hint', () => {
  const dir = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 1, out);
  assert.match(out, /README\.md \[length\] 200 lines \(limit 100\)\n/);
});

test('lengths: a ratchetRaises entry whose `to` is under the current count does not hint', () => {
  const dir = sandbox({
    'README.md': linesOf(200),
    'house.json': houseJson({
      modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } },
      ratchetRaises: [{ path: 'README.md', from: 100, to: 150, why: 'grew a little', decided: '2026-08-24' }],
    }),
  });
  const { code, out } = run(dir, ['--only=lengths']);
  assert.equal(code, 1, out);
  assert.match(out, /README\.md \[length\] 200 lines \(limit 100\)\n/);
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

test('memory index: a linked worktree finds the index filed under the main checkout', () => {
  // realpath-canonicalize: on macOS the sandbox lives under /var, a symlink
  // to /private/var, and git itself resolves that symlink when it reports an
  // absolute --git-common-dir for a worktree (it stays relative, and
  // unresolved, for a plain repo). Canonicalizing here keeps this test's own
  // path comparisons consistent with what the checker's git calls see,
  // matching how a real checkout (never itself behind a home-directory
  // symlink) already behaves.
  const dir = realpathSync(sandbox({
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  }));
  const worktreeDir = join(dir, '.claude', 'worktrees', 'probe');
  mkdirSync(join(dir, '.claude', 'worktrees'), { recursive: true });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'worktree', 'add', '-b', 'probe', worktreeDir], { cwd: dir });
  const cfg = memoryConfigDir(dir, linesOf(180)); // filed under the MAIN checkout's name, not the worktree's
  const { code, out } = run(worktreeDir, ['--only=lengths'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(code, 0, out);
  assert.match(out, /\[memory-index\]/);
  cleanup(cfg);
  execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: dir });
  cleanup(dir);
});

test('memory index: a repo path with underscores still finds its index under the harness naming', () => {
  const dir = sandbox({
    'README.md': '# r\n',
    'house.json': houseJson({ modules: { docs: { enabled: true, config: { lengthLimits: { 'README.md': 100 } } } } }),
  });
  const underscoreDir = `${dir}_with_underscores`;
  renameSync(dir, underscoreDir);
  const cfg = memoryConfigDir(underscoreDir, linesOf(180));
  const { code, out } = run(underscoreDir, ['--only=lengths'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(code, 0, out);
  assert.match(out, /\[memory-index\]/);
  cleanup(cfg);
  cleanup(underscoreDir);
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

// Codex stops reading project docs past project_doc_max_bytes, 32 KiB by
// default, so a root AGENTS.md past it has a tail no Codex session sees.
test('lengths: a root AGENTS.md over 32768 bytes warns naming Codex\'s default cap; at the cap it does not', () => {
  const over = sandbox({ 'house.json': houseJson(), 'AGENTS.md': 'x'.repeat(32769) });
  const res = run(over, ['--only=lengths', '--json']);
  assert.equal(res.code, 0, res.out);
  const w = (res.json.warnings || []).filter((x) => x.path === 'AGENTS.md');
  assert.equal(w.length, 1, res.out);
  assert.match(w[0].message, /32769 bytes/);
  assert.match(w[0].message, /Codex's default cap/);
  const at = sandbox({ 'house.json': houseJson(), 'AGENTS.md': 'x'.repeat(32768) });
  assert.ok(!(run(at, ['--only=lengths', '--json']).json.warnings || []).some((x) => x.path === 'AGENTS.md'));
});
