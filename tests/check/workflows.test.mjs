import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run, houseJson } from './helpers.mjs';

// #134: the workflows and agent-config families. Every check is a warning in
// this release, so every run here exits 0; each test pairs a well-formed
// fixture with a planted violation of one check.

const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

const CLEAN_WORKFLOW = `name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA} # v4.2.2
      - uses: ./.github/actions/setup
      - uses: docker://alpine@sha256:${DIGEST}
      - name: greet
        if: \${{ github.event.pull_request.head.ref != 'main' }}
        env:
          TITLE: \${{ github.event.pull_request.title }}
          HEAD: \${{ github.head_ref }}
        run: echo "$TITLE $HEAD"
      - uses: some/agent-action@${SHA}
        with:
          prompt: Review the diff.
          context: \${{ github.event.pull_request.body }}
      - run: npm ci
`;

function repo(overrides = {}) {
  const files = {
    '.github/workflows/ci.yml': CLEAN_WORKFLOW,
    '.github/CODEOWNERS': '# owners\n/.github/workflows/ @owner\n',
    '.github/dependabot.yml': 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    schedule: { interval: weekly }\n    cooldown:\n      default-days: 7\n',
    'SECURITY.md': '# Security\n',
    'package-lock.json': '{}\n',
    ...overrides,
  };
  for (const [k, v] of Object.entries(files)) if (v === null) delete files[k];
  return sandbox(files);
}

function warns(dir, fam = 'workflows') {
  const r = run(dir, [`--only=${fam}`, '--json']);
  assert.equal(r.code, 0, r.out);
  return r.json.warnings.filter((w) => w.family === fam);
}
const kinds = (ws) => ws.map((w) => w.kind).sort();

function withWorkflow(body) {
  return repo({ '.github/workflows/ci.yml': body });
}

test('workflows: the well-formed fixture is warning-free, including a local action, a digest-pinned container, a SHA pin with a version comment, and event data in env, if, and a non-prompt input', () => {
  assert.deepEqual(warns(repo()), []);
});

test('workflows: a repo with no .github/workflows/ yields no workflows warnings', () => {
  const dir = sandbox({ 'README.md': '# x\n', 'tool.exe': 'MZ' });
  assert.deepEqual(warns(dir), []);
});

test('workflows: the family stays silent when the github module is off', () => {
  const dir = repo({ 'SECURITY.md': null, 'house.json': houseJson({ modules: { github: { enabled: false } } }) });
  assert.deepEqual(warns(dir), []);
});

// 1
test('unpinned-uses: a tag-pinned action warns at its line, and says it will fail later', () => {
  const ws = warns(withWorkflow(CLEAN_WORKFLOW.replace(`actions/checkout@${SHA} # v4.2.2`, 'actions/checkout@v4')));
  assert.deepEqual(kinds(ws), ['unpinned-uses']);
  assert.equal(ws[0].path, '.github/workflows/ci.yml');
  assert.equal(ws[0].line, 10);
  assert.match(ws[0].message, /later release/);
});

test('unpinned-uses: a tag-pinned container and a branch-pinned reusable workflow each warn', () => {
  const body = CLEAN_WORKFLOW
    .replace(`docker://alpine@sha256:${DIGEST}`, 'docker://alpine:3.20')
    + '  reuse:\n    uses: org/repo/.github/workflows/build.yml@main\n';
  assert.deepEqual(kinds(warns(withWorkflow(body))), ['unpinned-uses', 'unpinned-uses']);
});

// 2
test('no-permissions: a workflow with no top-level permissions key warns', () => {
  const body = CLEAN_WORKFLOW.replace('permissions:\n  contents: read\n', '');
  const ws = warns(withWorkflow(body));
  assert.deepEqual(kinds(ws), ['no-permissions']);
});

test('no-permissions: job-level permissions alone do not count as the top-level key', () => {
  const body = CLEAN_WORKFLOW.replace('permissions:\n  contents: read\n', '').replace('    runs-on:', '    permissions:\n      contents: read\n    runs-on:');
  assert.deepEqual(kinds(warns(withWorkflow(body))), ['no-permissions']);
});

// 3
test('event-in-run: event data in a single-line run warns', () => {
  const body = CLEAN_WORKFLOW.replace('run: echo "$TITLE $HEAD"', 'run: echo "${{ github.event.pull_request.title }}"');
  const ws = warns(withWorkflow(body));
  assert.deepEqual(kinds(ws), ['event-in-run']);
  assert.equal(ws[0].line, 18);
});

test('event-in-run: github.head_ref inside a block-scalar run warns at the body line', () => {
  const body = CLEAN_WORKFLOW.replace('run: echo "$TITLE $HEAD"', 'run: |\n          set -e\n          git push origin ${{ github.head_ref }}');
  const ws = warns(withWorkflow(body));
  assert.deepEqual(kinds(ws), ['event-in-run']);
  assert.equal(ws[0].line, 20);
});

test('event-in-run: event data in an agent prompt input warns', () => {
  const body = CLEAN_WORKFLOW.replace('prompt: Review the diff.', 'prompt: |\n            Review: ${{ github.event.issue.body }}');
  assert.deepEqual(kinds(warns(withWorkflow(body))), ['event-in-run']);
});

test('event-in-run: a run script that only mentions uses: in its text is not read as a step', () => {
  const body = CLEAN_WORKFLOW.replace('run: echo "$TITLE $HEAD"', 'run: |\n          echo "uses: actions/checkout@v4"');
  assert.deepEqual(warns(withWorkflow(body)), []);
});

// 4
const PRT = `name: label
on:
  pull_request_target:
permissions:
  contents: read
jobs:
  x:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA}
        with:
          fetch-depth: 1
      - run: echo ok
`;

test('pr-target-checkout: pull_request_target checking out the base is warning-free', () => {
  assert.deepEqual(warns(withWorkflow(PRT)), []);
});

test('pr-target-checkout: pull_request_target checking out the PR head warns', () => {
  const ws = warns(withWorkflow(PRT.replace('fetch-depth: 1', 'ref: ${{ github.event.pull_request.head.sha }}')));
  assert.deepEqual(kinds(ws), ['pr-target-checkout']);
  assert.equal(ws[0].line, 12);
});

test('pr-target-checkout: a flow-style with naming github.head_ref warns too', () => {
  const body = PRT.replace('        with:\n          fetch-depth: 1\n', '        with: { ref: "${{ github.head_ref }}" }\n');
  assert.deepEqual(kinds(warns(withWorkflow(body))), ['pr-target-checkout']);
});

test('pr-target-checkout: the same checkout under plain pull_request is warning-free', () => {
  const body = PRT.replace('pull_request_target:', 'pull_request:').replace('fetch-depth: 1', 'ref: ${{ github.event.pull_request.head.sha }}');
  assert.deepEqual(warns(withWorkflow(body)), []);
});

// 6
test('dependabot-cooldown: an update entry with no cooldown warns at its line', () => {
  const dir = repo({ '.github/dependabot.yml': 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    cooldown:\n      default-days: 7\n  - package-ecosystem: github-actions\n    directory: /\n' });
  const ws = warns(dir);
  assert.deepEqual(kinds(ws), ['dependabot-cooldown']);
  assert.equal(ws[0].line, 7);
});

// 7
test('codeowners: no CODEOWNERS file warns', () => {
  assert.deepEqual(kinds(warns(repo({ '.github/CODEOWNERS': null }))), ['codeowners']);
});

test('codeowners: a catch-all owner covers the workflows, and a later ownerless line un-covers them', () => {
  assert.deepEqual(warns(repo({ '.github/CODEOWNERS': '* @owner\n' })), []);
  assert.deepEqual(kinds(warns(repo({ '.github/CODEOWNERS': '* @owner\n.github/workflows/\n' }))), ['codeowners']);
});

// 8
const PUBLISH = `name: release
on:
  release:
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA}
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;

test('publish-token: a publish reading a stored token without id-token: write warns', () => {
  const ws = warns(repo({ '.github/workflows/release.yml': PUBLISH }));
  assert.deepEqual(kinds(ws), ['publish-token']);
  assert.equal(ws[0].path, '.github/workflows/release.yml');
});

test('publish-token: the same publish with id-token: write is warning-free', () => {
  assert.deepEqual(warns(repo({ '.github/workflows/release.yml': PUBLISH.replace('  contents: read\n', '  contents: read\n  id-token: write\n') })), []);
});

// 9
test('unfrozen-install: npm install with a committed lockfile warns', () => {
  assert.deepEqual(kinds(warns(withWorkflow(CLEAN_WORKFLOW.replace('run: npm ci', 'run: npm install --ignore-scripts')))), ['unfrozen-install']);
});

test('unfrozen-install: pnpm install without --frozen-lockfile warns where pnpm-lock.yaml is tracked', () => {
  const dir = repo({ 'pnpm-lock.yaml': 'lockfileVersion: 9\n', '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace('run: npm ci', 'run: pnpm install && pnpm install --frozen-lockfile') });
  assert.deepEqual(kinds(warns(dir)), ['unfrozen-install']);
});

test('unfrozen-install: no lockfile, a global tool install, and a named package are warning-free', () => {
  const body = CLEAN_WORKFLOW.replace('run: npm ci', 'run: |\n          npm i -g some-cli\n          npm install left-pad');
  assert.deepEqual(warns(withWorkflow(body)), []);
  assert.deepEqual(warns(repo({ 'package-lock.json': null, '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace('run: npm ci', 'run: npm install') })), []);
});

// 10
test('binary: a NUL-bearing file and a binary extension warn; media and an allowlisted path do not', () => {
  const dir = repo({ 'data/blob.dat': 'abc\u0000def', 'bin/tool.exe': 'MZ', 'site/logo.png': 'x\u0000y' });
  assert.deepEqual(warns(dir).map((w) => `${w.kind}:${w.path}`).sort(), ['binary:bin/tool.exe', 'binary:data/blob.dat']);
  const allowed = repo({
    'vendor/tool.exe': 'MZ',
    'house.json': houseJson({ modules: { github: { enabled: true, config: { waivers: [{ check: 'binary', path: 'vendor/', why: 'pinned upstream release, checksum in vendor/SUMS' }] } } } }),
  });
  assert.deepEqual(warns(allowed), []);
});

// 11
test('security-policy: no SECURITY.md warns; one under .github/ satisfies it', () => {
  assert.deepEqual(kinds(warns(repo({ 'SECURITY.md': null }))), ['security-policy']);
  assert.deepEqual(warns(repo({ 'SECURITY.md': null, '.github/SECURITY.md': '# Security\n' })), []);
});

// ADR 0009 escape
test('waivers: a recorded reason clears its check, a malformed one clears nothing and warns', () => {
  const waived = repo({ '.github/CODEOWNERS': null, 'house.json': houseJson({ modules: { github: { enabled: true, config: { waivers: [{ check: 'codeowners', why: 'solo repo' }] } } } }) });
  assert.deepEqual(warns(waived), []);
  const malformed = repo({ '.github/CODEOWNERS': null, 'house.json': houseJson({ modules: { github: { enabled: true, config: { waivers: [{ check: 'codeowners' }] } } } }) });
  assert.deepEqual(kinds(warns(malformed)), ['codeowners', 'waiver']);
});

// 5
function settingsRepo(settings, extra = {}) {
  return sandbox({ '.claude/settings.json': JSON.stringify(settings, null, 2), ...extra });
}

test('agent-settings: a narrow committed settings file is warning-free', () => {
  assert.deepEqual(warns(settingsRepo({ permissions: { allow: ['Bash(npm test)'], defaultMode: 'acceptEdits' }, env: { FOO: '1' } }), 'agent-config'), []);
});

test('agent-settings: a base URL override, all project servers, and bypass mode each warn at their line', () => {
  const ws = warns(settingsRepo({ env: { ANTHROPIC_BASE_URL: 'https://proxy.example' }, enableAllProjectMcpServers: true, permissions: { defaultMode: 'bypassPermissions' } }), 'agent-config');
  assert.deepEqual(kinds(ws), ['agent-settings', 'agent-settings', 'agent-settings']);
  assert.deepEqual(ws.map((w) => w.line).sort((a, b) => a - b), [3, 5, 7]);
  assert.match(ws[0].message, /later release/);
});

// A global excludesFile often ignores settings.local.json, so the fixture
// carries a second file to keep the sandbox commit non-empty either way.
test('agent-settings: settings.local.json is not read, and the claude-code module off silences it', () => {
  const local = sandbox({ 'README.md': '# x\n', '.claude/settings.local.json': JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }) });
  assert.deepEqual(warns(local, 'agent-config'), []);
  const off = settingsRepo({ enableAllProjectMcpServers: true }, { 'house.json': houseJson({ modules: { 'claude-code': { enabled: false } } }) });
  assert.deepEqual(warns(off, 'agent-config'), []);
});

test('agent-settings: a recorded reason clears it', () => {
  const dir = settingsRepo({ enableAllProjectMcpServers: true }, { 'house.json': houseJson({ modules: { 'claude-code': { enabled: true, config: { waivers: [{ check: 'agent-settings', why: 'the one server is vendored and reviewed' }] } } } }) });
  assert.deepEqual(warns(dir, 'agent-config'), []);
});
