import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sandbox, run, houseJson, CHECK_SRC } from './helpers.mjs';

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

// The package's own templates, copied into an adopter, must pass the checks
// they exist to model, whichever npm lockfile the adopter commits, or none.
// CODEOWNERS and SECURITY.md are the adopter's to write, so those two are
// not counted.
function templateRepo(lockfiles) {
  const dir = join(dirname(CHECK_SRC), '..', 'templates');
  const files = { 'package.json': '{"name":"x"}\n' };
  for (const l of lockfiles) files[l] = '{}\n';
  for (const name of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    files[name.startsWith('dependabot.') ? `.github/${name}` : `.github/workflows/${name}`] = readFileSync(join(dir, name), 'utf8');
  }
  assert.ok(Object.keys(files).some((p) => p.startsWith('.github/workflows/')), 'at least one workflow template is copied');
  return sandbox(files);
}
for (const locks of [['package-lock.json'], [], ['npm-shrinkwrap.json'], ['package-lock.json', 'npm-shrinkwrap.json']]) {
  test(`templates: every workflow and dependabot template the package ships is clean with ${locks.length ? locks.join(' and ') : 'no lockfile'}`, () => {
    const ws = warns(templateRepo(locks)).filter((w) => !['codeowners', 'security-policy'].includes(w.kind));
    assert.deepEqual(ws.map((w) => `${w.kind} ${w.path}:${w.line}`), []);
  });
}

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

test('unfrozen-install: a version or help query is not an install', () => {
  const dir = repo({ 'yarn.lock': '# yarn\n', '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace('run: npm ci', 'run: |\n          yarn -v\n          yarn --version\n          yarn --help\n          npm install --help') });
  assert.deepEqual(warns(dir), []);
});

test('unfrozen-install: a step whose if: says the lockfile is absent may install plainly; the same step without that if: warns', () => {
  const guarded = CLEAN_WORKFLOW.replace('      - run: npm ci\n', "      - if: hashFiles('package-lock.json') != ''\n        run: npm ci\n      - if: \${{ hashFiles('package-lock.json') == '' }}\n        run: npm install\n");
  assert.deepEqual(warns(withWorkflow(guarded)), []);
  const unguarded = CLEAN_WORKFLOW.replace('      - run: npm ci\n', "      - if: hashFiles('package-lock.json') != ''\n        run: npm install\n");
  assert.deepEqual(kinds(warns(withWorkflow(unguarded))), ['unfrozen-install']);
});

function gatedInstall(cond, extra = {}) {
  return repo({ ...extra, '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace('      - run: npm ci\n', `      - if: ${cond}\n        run: npm install\n`) });
}

test('unfrozen-install: two && clauses naming every tracked npm lockfile are silent', () => {
  assert.deepEqual(warns(gatedInstall("hashFiles('package-lock.json') == '' && hashFiles('npm-shrinkwrap.json') == ''", { 'npm-shrinkwrap.json': '{}\n' })), []);
});

test('unfrozen-install: a condition that is not only lockfile-absent clauses, or names another path, warns', () => {
  for (const cond of [
    "hashFiles('package-lock.json') == '' || github.event_name == 'push'",
    "\"!(hashFiles('package-lock.json') == '')\"",
    "hashFiles('sub/package-lock.json') == ''",
    "\${{ hashFiles('**/package-lock.json') == '' }}",
    "hashFiles('package-lock.json') == '' && always()",
  ]) {
    assert.deepEqual(kinds(warns(gatedInstall(cond))), ['unfrozen-install'], cond);
  }
});

test('unfrozen-install: an if: that continues onto a second line never skips, and neither does the same condition on one line', () => {
  const multi = CLEAN_WORKFLOW.replace('      - run: npm ci\n', "      - if: hashFiles('package-lock.json') == ''\n          || true\n        run: npm install\n");
  assert.deepEqual(kinds(warns(withWorkflow(multi))), ['unfrozen-install']);
  assert.deepEqual(kinds(warns(gatedInstall("hashFiles('package-lock.json') == '' || true"))), ['unfrozen-install']);
});

test('unfrozen-install: only repo-root lockfiles are examined', () => {
  assert.deepEqual(warns(repo({ 'package-lock.json': null, 'site/package-lock.json': '{}\n', '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace('run: npm ci', 'run: npm install') })), []);
  assert.deepEqual(kinds(warns(repo({ 'site/package-lock.json': '{}\n', '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace('run: npm ci', 'run: npm install') }))), ['unfrozen-install']);
});

function gatedRun(cond, cmd, extra = {}) {
  return repo({ ...extra, '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace('      - run: npm ci\n', `      - if: ${cond}\n        run: ${cmd}\n`) });
}

// Round 4: the skip compares the raw if: text against forms generated from
// the tracked lockfiles, so anything but those exact forms warns.
for (const cond of [
    "hashFiles('package-lock.json') == '' && hashFiles('${{ github.sha }}') == ''",
    "${{ hashFiles('package-lock.json') == '' && hashFiles('}} x ${{') == '' }}",
    "\"${{ hashFiles('package-lock.json') == '' }} \"",
    "\" ${{ hashFiles('package-lock.json') == '' }}\"",
    "hashFiles('package-lock.json')  ==  ''",
    "hashFiles(\"package-lock.json\") == ''",
    "hashFiles('package-lock.json') == \"\"",
    "hashFiles('package-lock.json') == '' # only without a lockfile",
  "'hashFiles(''package-lock.json'') == '''''",
]) {
  test(`unfrozen-install: if: ${cond} is not a generated form and warns`, () => {
    assert.deepEqual(kinds(warns(gatedInstall(cond))), ['unfrozen-install']);
  });
}

test('unfrozen-install: the exact single-clause form is silent for npm, yarn, and pnpm with their own lockfile', () => {
  assert.deepEqual(warns(gatedRun("hashFiles('package-lock.json') == ''", 'npm install')), []);
  assert.deepEqual(warns(gatedRun("${{ hashFiles('package-lock.json') == '' }}", 'npm install')), []);
  assert.deepEqual(warns(gatedRun("hashFiles('yarn.lock') == ''", 'yarn install', { 'yarn.lock': '# yarn\n' })), []);
  assert.deepEqual(warns(gatedRun("hashFiles('pnpm-lock.yaml') == ''", 'pnpm install', { 'pnpm-lock.yaml': 'lockfileVersion: 9\n' })), []);
});

test('unfrozen-install: the two-clause npm form is silent in either order', () => {
  for (const cond of [
    "hashFiles('npm-shrinkwrap.json') == '' && hashFiles('package-lock.json') == ''",
    "${{ hashFiles('npm-shrinkwrap.json') == '' && hashFiles('package-lock.json') == '' }}",
  ]) {
    assert.deepEqual(warns(gatedInstall(cond, { 'npm-shrinkwrap.json': '{}\n' })), [], cond);
    assert.deepEqual(warns(gatedInstall(cond)), [], cond);
  }
});

test('unfrozen-install: a bare carriage return does not hide the step after it', () => {
  const body = CLEAN_WORKFLOW.replace('      - run: npm ci\n', '      - run: echo hi\r      - run: npm install\n');
  const ws = warns(withWorkflow(body));
  assert.deepEqual(kinds(ws), ['unfrozen-install']);
  assert.equal(ws[0].line, 24);
});

// YAML parsers also break lines on NEL, LS, and PS; a reader that does not
// would fold the next step into the gated one above it.
for (const [label, gated, line] of [
  ['LS in a name: value', "        name: gated\u2028      - name: ungated\n        run: npm install\n", 27],
  ['NEL in a name: value', "        name: gated\u0085      - name: ungated\n        run: npm install\n", 27],
  ['PS at the end of a comment', "        # gated\u2029      - run: npm install\n", 26],
]) {
  test(`unfrozen-install: ${label} does not hide the next step from the reader`, () => {
    const body = CLEAN_WORKFLOW.replace('      - run: npm ci\n', `      - if: hashFiles('package-lock.json') == ''\n        run: echo gated\n${gated}`);
    const ws = warns(withWorkflow(body));
    assert.deepEqual(kinds(ws), ['unfrozen-install']);
    assert.equal(ws[0].line, line);
  });
}

test('event-in-run: an LS line break does not hide a run: from the reader', () => {
  const body = CLEAN_WORKFLOW.replace('      - run: npm ci\n', '      - name: a\u2028        run: echo "${{ github.event.issue.title }}"\n');
  const ws = warns(withWorkflow(body));
  assert.deepEqual(kinds(ws), ['event-in-run']);
  assert.equal(ws[0].line, 24);
});

test('unfrozen-install: an alias to an install anchored in a gated step warns at the ungated alias', () => {
  const body = CLEAN_WORKFLOW.replace('      - run: npm ci\n', "      - if: hashFiles('package-lock.json') == ''\n        run: &install npm install\n      - run: *install\n");
  const ws = warns(withWorkflow(body));
  assert.deepEqual(kinds(ws), ['unfrozen-install']);
  assert.equal(ws[0].line, 25);
});

test('templates: clean with only a nested lockfile, and with a root and a nested one', () => {
  for (const locks of [['site/package-lock.json'], ['package-lock.json', 'site/package-lock.json']]) {
    const ws = warns(templateRepo(locks)).filter((w) => !['codeowners', 'security-policy'].includes(w.kind));
    assert.deepEqual(ws.map((w) => `${w.kind} ${w.path}:${w.line}`), [], locks.join(', '));
  }
});

test('unfrozen-install: a tracked npm-shrinkwrap.json the condition does not name warns', () => {
  assert.deepEqual(kinds(warns(gatedInstall("hashFiles('package-lock.json') == ''", { 'package-lock.json': null, 'npm-shrinkwrap.json': '{}\n' }))), ['unfrozen-install']);
  assert.deepEqual(kinds(warns(gatedInstall("hashFiles('package-lock.json') == ''", { 'npm-shrinkwrap.json': '{}\n' }))), ['unfrozen-install']);
});

test('unfrozen-install: an `npm ci || npm install` fallback still warns on the fallback', () => {
  assert.deepEqual(kinds(warns(withWorkflow(CLEAN_WORKFLOW.replace('run: npm ci', 'run: npm ci || npm install')))), ['unfrozen-install']);
});

// Known gap, pinned: `open-pull-requests-limit: 0` is not read as "version
// updates off", because nothing in this repo confirms that semantics.
test('dependabot-cooldown: an entry with open-pull-requests-limit 0 still warns (known gap)', () => {
  const dir = repo({ '.github/dependabot.yml': 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    open-pull-requests-limit: 0\n' });
  assert.deepEqual(kinds(warns(dir)), ['dependabot-cooldown']);
});

// 10
test('binary: a UTF-16 text file with a byte order mark is not a binary', () => {
  const dir = repo({
    'docs/le.txt': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello\r\n', 'utf16le')]),
    'docs/be.txt': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('hello\r\n', 'utf16le').swap16()]),
  });
  assert.deepEqual(warns(dir), []);
});

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

test('waivers: a waivers slot that is not an array clears nothing and warns', () => {
  for (const waivers of ['codeowners', { check: 'codeowners', why: 'solo repo' }]) {
    const dir = repo({ '.github/CODEOWNERS': null, 'house.json': houseJson({ modules: { github: { enabled: true, config: { waivers } } } }) });
    assert.deepEqual(kinds(warns(dir)), ['codeowners', 'waiver']);
  }
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
