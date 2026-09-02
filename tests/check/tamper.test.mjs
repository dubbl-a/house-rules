import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sandbox, run, houseJson, fakeClaudeConfigDir, writeTree } from './helpers.mjs';

function bodyHash(body) {
  // The managed body is everything after the first line (the header).
  return createHash('sha256').update(body.split('\n').slice(1).join('\n'), 'utf8').digest('hex');
}

const HEADER = '<!-- house:managed module=git-workflow source=modules/git-workflow/rules/branching.md -->';

function lockJson(entries) {
  return JSON.stringify({ files: entries }, null, 2);
}

// Lock is the tamper oracle (F13): a vendored body that matches the pinned
// hash render recorded is clean, even with the plugin installed at the same
// version. The installed source is NOT compared body-to-body against the
// vendored file (they differ by frontmatter + managed header by construction).
test('tamper: vendored body matches its pinned lock hash — passes, even with the plugin installed', () => {
  const body = `${HEADER}\nBranch + PR for every change.\n`;
  const installDir = fakeClaudeConfigDir(undefined); // reused as a plain scratch dir
  writeTree(installDir, { 'modules/git-workflow/rules/branching.md': body });
  const cfgDir = fakeClaudeConfigDir({
    version: 2,
    plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: installDir, version: '0.1.0' }] },
  });

  const dir = sandbox({
    'house.json': houseJson({ version: '0.1.0' }),
    '.house/lock.json': lockJson([{ path: '.claude/rules/house/branching.md', module: 'git-workflow', source: 'modules/git-workflow/rules/branching.md', bodySha256: bodyHash(body) }]),
    '.claude/rules/house/branching.md': body,
  });

  const { code, out } = run(dir, ['--only=tamper'], { CLAUDE_CONFIG_DIR: cfgDir });
  assert.equal(code, 0, out);
});

test('tamper: vendored body diverges from its pinned lock hash — finding', () => {
  const pinnedBody = `${HEADER}\nBranch + PR for every change.\n`;
  const localBody = `${HEADER}\nBranch + PR for every change, EDITED LOCALLY.\n`;

  const dir = sandbox({
    'house.json': houseJson({ version: '0.1.0' }),
    '.house/lock.json': lockJson([{ path: '.claude/rules/house/branching.md', module: 'git-workflow', source: 'modules/git-workflow/rules/branching.md', bodySha256: bodyHash(pinnedBody) }]),
    '.claude/rules/house/branching.md': localBody,
  });

  const { code, out } = run(dir, ['--only=tamper']);
  assert.equal(code, 1, out);
  assert.match(out, /\[tamper\]/);
  assert.match(out, /propose the change upstream/);
});

test('tamper: a vendored body edited away from the pin is a finding with no installed plugin at all', () => {
  const pinnedBody = `${HEADER}\nBranch + PR for every change.\n`;
  const localBody = `${HEADER}\nBranch + PR for every change, EDITED LOCALLY.\n`;
  const cfgDir = fakeClaudeConfigDir(undefined); // no installed_plugins.json written at all
  const dir = sandbox({
    'house.json': houseJson({ version: '0.1.0' }),
    '.house/lock.json': lockJson([{
      path: '.claude/rules/house/branching.md', module: 'git-workflow',
      source: 'modules/git-workflow/rules/branching.md',
      bodySha256: bodyHash(pinnedBody),
    }]),
    '.claude/rules/house/branching.md': localBody,
  });
  const { code, out } = run(dir, ['--only=tamper'], { CLAUDE_CONFIG_DIR: cfgDir });
  assert.equal(code, 1, out);
  assert.match(out, /\[tamper\]/);
});

test('tamper: lock entry pointing at a missing managed file is a finding', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockJson([{ path: '.claude/rules/house/gone.md', module: 'git-workflow', source: 'modules/git-workflow/rules/gone.md', bodySha256: 'x' }]),
  });
  const { code, out } = run(dir, ['--only=tamper']);
  assert.equal(code, 1, out);
  assert.match(out, /\[missing\]/);
});

test('tamper: no .house/lock.json at all is silently fine', () => {
  const dir = sandbox({ 'house.json': houseJson() });
  const { code } = run(dir, ['--only=tamper']);
  assert.equal(code, 0);
});

// The vendored managed header render stamps in, carrying the hash of the
// SOURCE file it came from. The pin-behind advisory compares that recorded
// source hash to the installed source's hash (source-to-source), so it is
// immune to the frontmatter/header asymmetry the body comparison suffers.
const RECORDED_SRC_HASH = 'a'.repeat(64);
const MANAGED_HEADER = `<!-- house-managed v0.1.0 module=git-workflow source=modules/git-workflow/rules/branching.md body-sha256=${RECORDED_SRC_HASH} DO NOT EDIT -->`;

// F13: a repo pinned to 0.1.0 with 0.1.1 installed, and vendored files that
// are UNMODIFIED relative to the pin, must not fail tamper. The newer
// installed plugin shipping different source text is a "your pin is behind"
// advisory, not a hand-edit finding, so plugin auto-update cannot red CI.
test('tamper: pinned 0.1.0, installed 0.1.1, unmodified vendored file — warning (pin behind), not a finding', () => {
  const pinnedBody = `${MANAGED_HEADER}\nBranch + PR for every change.\n`; // what render wrote at 0.1.0

  const installDir = fakeClaudeConfigDir(undefined);
  // Installed source differs from the recorded source hash (any content whose
  // sha256 is not RECORDED_SRC_HASH), so the advisory fires.
  writeTree(installDir, { 'modules/git-workflow/rules/branching.md': 'reworded source in 0.1.1\n' });
  const cfgDir = fakeClaudeConfigDir({
    version: 2,
    plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: installDir, version: '0.1.1' }] },
  });

  const dir = sandbox({
    'house.json': houseJson({ version: '0.1.0' }),
    '.house/lock.json': lockJson([{ path: '.claude/rules/house/branching.md', module: 'git-workflow', source: 'modules/git-workflow/rules/branching.md', bodySha256: bodyHash(pinnedBody) }]),
    '.claude/rules/house/branching.md': pinnedBody, // vendored copy is untouched since render at 0.1.0
  });

  const { code, out } = run(dir, ['--only=tamper'], { CLAUDE_CONFIG_DIR: cfgDir });
  assert.equal(code, 0, out);                // NOT a finding
  assert.match(out, /\(warning\)/);
  assert.match(out, /pin.*behind|behind|\/house-rules:sync/i);
});

// F13 companion: with the plugin ahead of the pin, a genuine hand-edit to the
// vendored file (diverging from the PINNED body in the lock) is still a hard
// finding — the demotion covers only the pin-behind case, not real tampering.
test('tamper: pinned 0.1.0, installed 0.1.1, but vendored file hand-edited away from the pin — finding', () => {
  const pinnedBody = `${MANAGED_HEADER}\nBranch + PR for every change.\n`;
  const editedLocal = `${MANAGED_HEADER}\nBranch + PR for every change, HAND EDITED.\n`;

  const installDir = fakeClaudeConfigDir(undefined);
  writeTree(installDir, { 'modules/git-workflow/rules/branching.md': 'reworded source in 0.1.1\n' });
  const cfgDir = fakeClaudeConfigDir({
    version: 2,
    plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: installDir, version: '0.1.1' }] },
  });
  const lockHash = bodyHash(pinnedBody);

  const dir = sandbox({
    'house.json': houseJson({ version: '0.1.0' }),
    '.house/lock.json': lockJson([{ path: '.claude/rules/house/branching.md', module: 'git-workflow', source: 'modules/git-workflow/rules/branching.md', bodySha256: lockHash }]),
    '.claude/rules/house/branching.md': editedLocal,
  });
  const { code, out } = run(dir, ['--only=tamper'], { CLAUDE_CONFIG_DIR: cfgDir });
  assert.equal(code, 1, out);
  assert.match(out, /\[tamper\]/);
});

// F9: a lock entry whose managed-file path escapes the repo root is refused
// as a manifest-level defect, not joined and read as if it were managed.
test('tamper: a lock entry path escaping the repo root is a finding, not a silent read-through', () => {
  const dir = sandbox({
    'house.json': houseJson(),
    '.house/lock.json': lockJson([{ path: '../../etc/escaped.md', module: 'git-workflow', source: 'modules/git-workflow/rules/branching.md', bodySha256: 'x' }]),
  });
  const { code, out } = run(dir, ['--only=tamper']);
  assert.equal(code, 1, out);
  assert.match(out, /escapes the repo root/);
});

test('P1: a rendered repo with no lock is a finding, a never-adopted repo is not', () => {
  const adopted = sandbox({
    'package.json': '{"name":"x"}',
    'house.json': JSON.stringify({version:"0.1.1",defaultBranch:"main",branchPolicy:"pr",modules:{docs:{enabled:true,config:{}}}}),
    '.claude/rules/house/docs.md': '---\npaths:\n  - README.md\n---\n<!-- house-managed v0.1.1 module=docs source=x body-sha256=abc -->\n# R\n',
  });
  const a = run(adopted, ['--only=tamper', '--json']);
  assert.ok((a.json.findings || []).some((f) => /lock\.json/.test(f.path) && /integrity/.test(f.message)), 'rendered-but-no-lock must be a finding');

  const bare = sandbox({ 'README.md': '# hi\n', 'house.json': JSON.stringify({version:"0.1.1",defaultBranch:"main",branchPolicy:"pr",modules:{}}) });
  const b = run(bare, ['--only=tamper', '--json']);
  assert.equal((b.json.findings || []).length, 0, 'a never-adopted repo with no lock is fine');
});

test('P2: a forged house-managed marker on an unlocked file does not demote its drift', () => {
  const repo = sandbox({
    'package.json': '{"name":"x"}',
    // a repo-authored README pasting the marker to try to demote a broken ref
    'house.json': JSON.stringify({version:"0.1.1",defaultBranch:"main",branchPolicy:"pr",modules:{docs:{enabled:true,config:{}}}}),
    'README.md': '<!-- house-managed v0.1.1 module=docs source=x body-sha256=abc -->\n# R\n\nSee `npm run does-not-exist`.\n',
    '.house/lock.json': JSON.stringify({ files: [] }),
  });
  const { json } = run(repo, ['--only=drift', '--json']);
  const fs2 = json.findings || [];
  assert.ok(fs2.some((f) => /forged managed header/.test(f.kind)), 'a marker on an unlocked file is flagged as forged');
  assert.ok(fs2.some((f) => /does-not-exist/.test(f.message)), 'its real drift stays a finding, not a warning');
});
