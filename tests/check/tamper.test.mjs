import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sandbox, run, houseJson, fakeClaudeConfigDir, writeTree, CHECK_SRC } from './helpers.mjs';

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

// ADR 0015: the AGENTS.md block is a lock entry of kind "block". Only the
// lines between the two markers are the managed body; everything outside them
// is the adopter's and is never read.
const BLOCK_BEGIN = '<!-- house-managed:begin v0.1.0 DO NOT EDIT -->';
const BLOCK_END = '<!-- house-managed:end -->';
const BLOCK_INNER = '## House rules\n\n### docs\nApplies to: `README.md`\n- Anchor every claim';
const blockHash = createHash('sha256').update(BLOCK_INNER, 'utf8').digest('hex');
const blockFile = (above = '', below = '') => `${above}${BLOCK_BEGIN}\n${BLOCK_INNER}\n${BLOCK_END}\n${below}`;
const blockLock = () => lockJson([{ path: 'AGENTS.md', module: '_targets', source: 'targets', kind: 'block', bodySha256: blockHash }]);

test('tamper: an unedited AGENTS.md block passes, and an edit outside the markers is never read', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': blockLock(), 'AGENTS.md': blockFile('# Ours\n\n', '\nOurs below, edited freely.\n') });
  const { code, out } = run(dir, ['--only=tamper']);
  assert.equal(code, 0, out);
});

// The marker lines are reserved: one quoted in the adopter's own text, a code
// example included, makes the file malformed rather than being parsed around.
test('tamper: a stray marker line outside the block is malformed, a finding naming every marker line', () => {
  const quoted = `\n\`\`\`md\n${BLOCK_END}\n\`\`\`\n`;
  const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': blockLock(), 'AGENTS.md': blockFile('# Ours\n\n', quoted) });
  const { code, out } = run(dir, ['--only=tamper']);
  assert.equal(code, 1, out);
  assert.match(out, /AGENTS\.md \[tamper\].*AGENTS\.md:3, AGENTS\.md:9, AGENTS\.md:12/);
  assert.match(out, /reserved for the house block/);
  assert.match(out, /by hand/);
  assert.doesNotMatch(out, /--force-managed/, 'force repairs only a single lone marker, so it is not offered here');
});

test('tamper: an indented stray marker is reserved too; a single lone marker is offered --force-managed', () => {
  const indented = sandbox({ 'house.json': houseJson(), '.house/lock.json': blockLock(), 'AGENTS.md': blockFile('# Ours\n\n', '\n  <!-- house-managed:end -->\n') });
  const a = run(indented, ['--only=tamper']);
  assert.equal(a.code, 1, a.out);
  assert.match(a.out, /AGENTS\.md:11\b/);

  const lone = sandbox({ 'house.json': houseJson(), '.house/lock.json': blockLock(), 'AGENTS.md': blockFile('# Ours\n\n').replace(`${BLOCK_END}\n`, '') });
  const b = run(lone, ['--only=tamper']);
  assert.equal(b.code, 1, b.out);
  assert.match(b.out, /AGENTS\.md:3\b/);
  assert.match(b.out, /--force-managed AGENTS\.md/);
});

// The CLI writes the lock hash and the checker recomputes it, so the block
// parser exists twice. This pins the two copies to the same text, and pins
// that neither carries the fence parsing the reserved-marker rule replaced.
test('tamper: the block parser is textually identical in the house CLI and check.mjs', () => {
  const cli = readFileSync(join(dirname(CHECK_SRC), '..', 'scripts', 'house'), 'utf8');
  const chk = readFileSync(CHECK_SRC, 'utf8');
  for (const src of [cli, chk]) assert.doesNotMatch(src, /fencedLines|FENCE_RE|FENCE_CLOSE_RE|'unclosed'/);
  const pick = (src, re) => { const m = src.match(re); assert.ok(m, `missing ${re}`); return m[0]; };
  for (const re of [
    /^const BLOCK_BEGIN_RE = .*$/m,
    /^const BLOCK_END_RE = .*$/m,
    /^function agentsBlock\(raw\) \{\n[^]*?\n\}$/m,
  ]) {
    assert.equal(pick(cli, re), pick(chk, re), `${re} differs between the two copies`);
  }
});

test('tamper: a hand edit inside the AGENTS.md block is a finding naming --force-managed', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': blockLock(), 'AGENTS.md': blockFile('# Ours\n\n').replace('Anchor every claim', 'Anchor most claims') });
  const { code, out } = run(dir, ['--only=tamper']);
  assert.equal(code, 1, out);
  assert.match(out, /AGENTS\.md \[tamper\]/);
  assert.match(out, /--force-managed AGENTS\.md/);
});

test('tamper: a removed block, a missing end marker, and a duplicated begin marker are each a finding', () => {
  for (const body of [
    '# Ours only\n',
    `${BLOCK_BEGIN}\n${BLOCK_INNER}\n`,
    `${BLOCK_BEGIN}\n${blockFile()}`,
  ]) {
    const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': blockLock(), 'AGENTS.md': body });
    const { code, out } = run(dir, ['--only=tamper']);
    assert.equal(code, 1, `${JSON.stringify(body)}: ${out}`);
    assert.match(out, /AGENTS\.md \[(missing|tamper)\]/);
  }
});
