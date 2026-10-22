export const meta = {
  name: 'test-audit',
  description: 'Audit one repo\'s tests (prune, smells, silent skips, speed) with the house-rules test-audit method, build the confirmed changes as one commit, and review and rework it',
  whenToUse: 'Run by the /house-rules:test-audit skill. args: {root, rules, scratch, date, apply?, maxAuditors?}. One repo per run; the session pushes and opens the PR.',
  phases: [
    { title: 'Survey', detail: 'test suites, files and sizes, CI critical path' },
    { title: 'Audit', detail: 'one auditor per batch of test files, sent back for unread ranges' },
    { title: 'Merge', detail: 'one candidate list across all batches', model: 'opus' },
    { title: 'Refute', detail: 'planted defects against each removal and merge claim', model: 'opus' },
    { title: 'Build', detail: 'one builder applies the confirmed list in a worktree' },
    { title: 'Review', detail: 'refuter on the diff', model: 'opus' },
    { title: 'Rework', detail: 'builder on the must-fixes, then a refuter on that commit, at most 2 rounds', model: 'opus' },
  ],
}

// The house-rules test audit (#363, #426), as code, for any repo. The method's
// lessons are in the stages: a first pass over a large test file often reads
// only part of it, so each auditor reports the ranges it read and gets sent back
// for the rest; a "covered elsewhere" claim is not accepted until a planted
// defect makes the named covering test fail (in #363 that overturned several
// claims); a merge is only for two tests that check one behavior on one fixture,
// otherwise the fixture build is shared and the tests stay separate.
//
// Nothing here pushes, opens a PR, or merges. The builder commits on a new
// branch in a worktree under <root>/.claude/worktrees/; the session reviews the
// returned report, pushes, opens the PR, and merges only on the maintainer's yes.
//
// args:
//   root         absolute path of the git repo to audit (required)
//   rules        absolute path of the testing rule text the agents apply (required;
//                the skill passes ${CLAUDE_PLUGIN_ROOT}/modules/testing/rules/testing.md,
//                not the repo's vendored copy, which lags until the next sync)
//   scratch      absolute path of a directory for scratch copies (required; the
//                skill passes one under the session scratchpad)
//   date         YYYY-MM-DD, names the branch and worktree (required: scripts
//                cannot read the clock)
//   apply        false stops after Refute and returns the confirmed list (default true)
//   maxAuditors  cap on audit batches (default 4; a run is then about 12 agents:
//                survey, auditors and their re-reads, merge, up to 4 refuters,
//                builder, reviewer, plus 2 agents per rework round, at most 2 rounds)

const need = (name, ok, what) => {
  if (!ok) throw new Error(`args.${name} is required: ${what}`)
}
need('root', args && typeof args.root === 'string' && args.root.startsWith('/') && !/\s/.test(args.root), 'the absolute path of the git repo to audit, with no spaces')
need('rules', typeof args.rules === 'string' && args.rules.startsWith('/'), 'the absolute path of the testing rule text')
need('scratch', typeof args.scratch === 'string' && args.scratch.startsWith('/') && !/\s/.test(args.scratch), 'the absolute path of a scratch directory, with no spaces')
need('date', typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date), 'a date as YYYY-MM-DD')
const ROOT = args.root.replace(/\/+$/, '')
const RULES = args.rules
const SCRATCH = args.scratch.replace(/\/+$/, '')
const APPLY = args.apply !== false
const MAX_AUDITORS = Number.isInteger(args.maxAuditors) && args.maxAuditors > 0 ? args.maxAuditors : 4
const MAX_REWORKS = 2
const BRANCH = `tests-audit-${args.date}`
const WORKTREE = `${ROOT}/.claude/worktrees/${BRANCH}`

const COMMON_DONT = `Do not spawn subagents. Do not push, open a PR, merge, or edit anything outside what this stage names; a read-only stage edits nothing at all. Read the testing rules at ${RULES} before judging anything; the repo's vendored copy under .claude/rules/house/ may be older.`

// ── Survey ────────────────────────────────────────────────────────────
phase('Survey')
const SURVEY = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'GitHub owner/name' },
    defaultBranch: { type: 'string' },
    headSha: { type: 'string' },
    suites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          command: { type: 'string', description: 'how the suite runs, from the package dir' },
          runsInCI: { type: 'boolean' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, lines: { type: 'integer' } },
              required: ['path', 'lines'],
            },
          },
        },
        required: ['name', 'command', 'runsInCI', 'files'],
      },
    },
    ciCriticalPath: { type: 'string', description: 'latest green PR run: total wall time and the slowest job and steps, with the run id' },
    notes: { type: 'string' },
  },
  required: ['repo', 'defaultBranch', 'headSha', 'suites', 'ciCriticalPath'],
}
const survey = await agent(
  `Survey the test suites of the git repo at ${ROOT}. Read only; change nothing.

0. Report its GitHub owner/name: \`cd ${ROOT} && gh repo view --json nameWithOwner -q .nameWithOwner\`. If the repo has no GitHub remote, report the folder name and say so in notes.
1. Run \`git -C ${ROOT} fetch -q origin\`, then report the default branch (\`git -C ${ROOT} symbolic-ref --short refs/remotes/origin/HEAD\`, without "origin/") and its sha.
2. Find every test suite: each package.json (or pyproject) with a test script, ignoring node_modules, dist, build and gitignored paths. For each suite give its command, whether .github/workflows runs it on pull requests, and every test file it runs (resolve its globs with \`git -C ${ROOT} ls-files\` at origin/<default>, not the working tree) with its line count (\`wc -l\`). Include fixture-only and helper files only if the suite runs them as tests.
3. CI critical path: \`gh run list -R <owner/name> --event pull_request --status success --limit 1\`, then the job and step timestamps of that run (\`gh run view <id> -R <owner/name> --json jobs\`). Report total wall time, the slowest job, its slowest steps, and the run id.

Do not spawn subagents. Report data only.`,
  { label: 'survey', phase: 'Survey', schema: SURVEY, model: 'sonnet', effort: 'medium' },
)
if (!survey) throw new Error('survey returned nothing; nothing to audit')
const files = survey.suites.flatMap(s => s.files.map(f => ({ ...f, suite: s.name, command: s.command })))
const REPO = survey.repo
log(`${REPO}: ${survey.suites.length} suite(s), ${files.length} test file(s), ${files.reduce((n, f) => n + f.lines, 0)} lines; CI: ${survey.ciCriticalPath}`)
if (!files.length) return { repo: REPO, survey, note: 'no test files found' }

// Batches by line count, largest first into the lightest batch, so no auditor
// gets a pile it reads only part of. A file over the per-batch share gets a
// batch to itself.
const totalLines = files.reduce((n, f) => n + f.lines, 0)
const nBatches = Math.min(MAX_AUDITORS, files.length, Math.max(1, Math.ceil(totalLines / 1500)))
const batches = Array.from({ length: nBatches }, () => ({ files: [], lines: 0 }))
for (const f of [...files].sort((a, b) => b.lines - a.lines)) {
  const b = batches.reduce((lo, x) => (x.lines < lo.lines ? x : lo))
  b.files.push(f)
  b.lines += f.lines
}
if (nBatches < Math.ceil(totalLines / 1500)) {
  log(`capped at ${MAX_AUDITORS} auditors; batches average ${Math.round(totalLines / nBatches)} lines, so expect re-read rounds`)
}

// ── Audit ─────────────────────────────────────────────────────────────
const FINDING = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['remove-duplicate', 'remove-obsolete', 'merge', 'share-fixture', 'eager-test', 'assertion-roulette', 'silent-skip', 'wall-clock-bound', 'slow', 'other'],
    },
    file: { type: 'string' },
    line: { type: 'integer' },
    test: { type: 'string', description: 'the test name' },
    claim: { type: 'string', description: 'what is wrong, in one or two sentences' },
    coveringTest: { type: 'string', description: 'for remove-duplicate and merge: file:line and name of the test that still covers this behavior' },
    fix: { type: 'string', description: 'the simplest change' },
  },
  required: ['kind', 'file', 'line', 'test', 'claim', 'fix'],
}
const AUDIT = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: FINDING },
    read: {
      type: 'array',
      description: 'every line range actually read, per file',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' } },
        required: ['path', 'from', 'to'],
      },
    },
  },
  required: ['findings', 'read'],
}

const auditPrompt = (batch, ranges) => `Audit these test files in ${ROOT} (read them at origin/${survey.defaultBranch}, sha ${survey.headSha}; \`git -C ${ROOT} show ${survey.headSha}:<path>\` if the working tree differs). Read only.

${ranges
  ? `This is a re-read. Read ONLY these line ranges you have not read yet, and report findings only from them:\n${ranges.map(r => `- ${r.path}:${r.from}-${r.to}`).join('\n')}`
  : `Files (suite, path, lines):\n${batch.files.map(f => `- ${f.suite}: ${f.path} (${f.lines})`).join('\n')}`}

Find, with file:line and the test name:
- remove-duplicate: a test whose behavior another test already checks through the same entry point. Name the covering test (file:line and name). Not a duplicate if the two use different inputs that take different code paths.
- remove-obsolete: a test for behavior or code that no longer exists.
- merge: two tests that check ONE behavior on ONE fixture. Two tests that build the same fixture but check different behaviors are share-fixture instead, never merge.
- share-fixture: tests that rebuild an identical fixture; say whether any of them writes to it (then it cannot be shared).
- eager-test (checks several behaviors at once) and assertion-roulette (many assertions, none saying which failed), only where it hides what broke.
- silent-skip: a test that returns early or passes when a tool, database, build or env var is missing, without skipping visibly and naming where it does run.
- wall-clock-bound: a timing assertion on elapsed time that load can fail with nothing wrong.
- slow: a test or setup that dominates the file's run time (say how you know).
Do not report style nits. Report every range you read in "read". ${COMMON_DONT}`

// The default workflow agent, not the researcher: auditors need Bash for `git show`
// when the adopter's checkout is behind its default branch. The prompt keeps them read-only.
const AUDIT_OPTS = (label) => ({ label, phase: 'Audit', schema: AUDIT, model: 'sonnet', effort: 'high' })

// Unread ranges per file in a batch, from the ranges an auditor says it read.
function unread(batch, readRanges) {
  const out = []
  for (const f of batch.files) {
    const got = readRanges.filter(r => r.path === f.path || f.path.endsWith(r.path) || r.path.endsWith(f.path))
      .map(r => [Math.max(1, r.from), Math.min(f.lines, r.to)]).sort((a, b) => a[0] - b[0])
    let next = 1
    for (const [a, b] of got) {
      if (a > next) out.push({ path: f.path, from: next, to: a - 1 })
      next = Math.max(next, b + 1)
    }
    if (next <= f.lines) out.push({ path: f.path, from: next, to: f.lines })
  }
  return out.filter(r => r.to - r.from >= 5) // a few trailing lines are a closing brace, not a test
}

const audited = await pipeline(
  batches,
  async (batch, _b, i) => {
    const findings = []
    let read = []
    let gaps = null
    for (let round = 0; round < 4; round++) {
      const r = await agent(auditPrompt(batch, gaps), AUDIT_OPTS(`audit ${i + 1}${round ? ` re-read ${round}` : ''}`))
      if (!r) break
      findings.push(...r.findings)
      read = read.concat(r.read)
      gaps = unread(batch, read)
      if (!gaps.length) break
    }
    if (gaps && gaps.length) log(`audit ${i + 1}: still unread after 4 rounds: ${gaps.map(g => `${g.path}:${g.from}-${g.to}`).join(', ')}`)
    return { batch: i + 1, findings, unread: gaps || [] }
  },
)
const allFindings = audited.filter(Boolean).flatMap(a => a.findings)
const stillUnread = audited.filter(Boolean).flatMap(a => a.unread)
log(`${allFindings.length} raw finding(s) across ${batches.length} batch(es)`)
if (!allFindings.length) return { repo: REPO, survey, findings: [], unread: stillUnread }

// ── Merge ─────────────────────────────────────────────────────────────
// A barrier on purpose: the merge needs every batch's findings to dedupe and to
// catch a covering test named in one batch and removed in another.
phase('Merge')
const MERGED = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short stable id like R1, S2' },
          ...FINDING.properties,
          needsProof: { type: 'boolean', description: 'true for remove-duplicate and merge, and any claim the code does not make obvious' },
        },
        required: ['id', 'kind', 'file', 'line', 'test', 'claim', 'fix', 'needsProof'],
      },
    },
    dropped: { type: 'array', items: { type: 'string' }, description: 'findings dropped, each with the reason' },
  },
  required: ['items', 'dropped'],
}
const merged = await agent(
  `Merge these test-audit findings for ${ROOT} into one list. Dedupe; drop any finding that is wrong on its face (say why in "dropped"); turn a "merge" of tests that check different behaviors into "share-fixture"; flag a removal whose covering test is itself proposed for removal (keep at most one of the pair). Keep every positive and negative control pair whole: never remove one half. Set needsProof for every remove-duplicate and merge, and for any other claim the code does not make obvious. Read the cited code where you need to decide.

Findings:
${JSON.stringify(allFindings, null, 1)}

${COMMON_DONT}`,
  { label: 'merge', phase: 'Merge', schema: MERGED, model: 'opus', effort: 'high' },
)
if (!merged) throw new Error('merge returned nothing')

// ── Refute ────────────────────────────────────────────────────────────
// At most four Opus refuters, each over whole files and its own scratch copy,
// so a planted defect in one copy cannot disturb another's claims.
phase('Refute')
const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'corrected'] },
          evidence: { type: 'string', description: 'the planted defect, the command, and which test failed or passed' },
          correctedCoveringTest: { type: 'string' },
        },
        required: ['id', 'verdict', 'evidence'],
      },
    },
  },
  required: ['verdicts'],
}
const byFile = {}
// Proof is mandatory for a removal or a merge, whatever the merge agent set.
const items = merged.items.map(it => ({ ...it, needsProof: it.needsProof || it.kind === 'remove-duplicate' || it.kind === 'merge' }))
for (const it of items) (byFile[it.file] ||= []).push(it)
const proveFiles = Object.entries(byFile).filter(([, items]) => items.some(it => it.needsProof))
const nRefuters = Math.min(4, proveFiles.length)
const toProve = Array.from({ length: nRefuters }, () => [])
proveFiles.forEach((entry, i) => toProve[i % nRefuters].push(entry))

const refuted = await pipeline(toProve, (group, _o, i) =>
  agent(
    `Try to refute each claim below about tests in ${ROOT}. For every remove-duplicate and merge: plant the defect the removed test would catch (change the code under test, not the test), run the named covering test, and report whether it fails. A covering test that still passes means the claim is refuted; if another test does catch it, mark "corrected" and name that test. For other claims with needsProof, run what settles them.

Work ONLY in a scratch copy, never in ${ROOT}: \`mkdir -p ${SCRATCH}/refute/r${i + 1} && git -C ${ROOT} archive ${survey.headSha} | tar -x -C ${SCRATCH}/refute/r${i + 1}\`, install there as the suite's CI does, run there. Remove the scratch copy when done.

Claims:
${JSON.stringify(group.flatMap(([, items]) => items.filter(it => it.needsProof)), null, 1)}

Default to refuted when you cannot show the covering test failing. ${COMMON_DONT}`,
    { label: `refute ${i + 1}/${nRefuters}`, phase: 'Refute', schema: VERDICTS, model: 'opus', effort: 'high', agentType: 'house-rules:refuter' },
  ),
)
const verdicts = Object.fromEntries(refuted.filter(Boolean).flatMap(r => r.verdicts).map(v => [v.id, v]))
const confirmed = items
  .filter(it => !it.needsProof || ['confirmed', 'corrected'].includes(verdicts[it.id]?.verdict))
  .map(it => ({ ...it, proof: verdicts[it.id] || null }))
const rejected = items.filter(it => it.needsProof && !['confirmed', 'corrected'].includes(verdicts[it.id]?.verdict))
  .map(it => ({ id: it.id, test: it.test, why: verdicts[it.id]?.evidence || 'no verdict returned' }))
log(`${confirmed.length} confirmed, ${rejected.length} refuted or unproven`)

const result = { repo: REPO, survey, confirmed, rejected, dropped: merged.dropped, unread: stillUnread }
if (!APPLY || !confirmed.length) return result

// ── Build ─────────────────────────────────────────────────────────────
phase('Build')
const BUILD = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    sha: { type: 'string' },
    applied: { type: 'array', items: { type: 'string' }, description: 'ids applied' },
    skipped: { type: 'array', items: { type: 'string' }, description: 'ids not applied, each with why' },
    before: { type: 'string', description: 'per suite: test count and duration, with load average' },
    after: { type: 'string' },
    checks: { type: 'string', description: 'commands run and their results' },
  },
  required: ['branch', 'sha', 'applied', 'skipped', 'before', 'after', 'checks'],
}
const built = await agent(
  `Apply the confirmed test-audit list below to ${ROOT}.

1. Create your worktree from the commit the claims were proved against, not from a fresh fetch. First check that neither branch ${BRANCH} (\`git -C ${ROOT} rev-parse --verify --quiet refs/heads/${BRANCH}\`) nor the path ${WORKTREE} exists; if either does, stop, create nothing, and report it in "checks" with an empty "sha" and every id in "skipped". Otherwise run \`git -C ${ROOT} worktree add -b ${BRANCH} ${WORKTREE} ${survey.headSha}\`. Work only there.
2. Before changing anything, run each suite (${survey.suites.map(s => `${s.name}: \`${s.command}\``).join('; ')}) and record test count and duration, with \`sysctl -n vm.loadavg\`.
3. Apply each item's fix. A removal names its covering test in the commit body. A share-fixture item shares only a read-only build. Do not change what any kept test asserts, except to fix an eager test or assertion roulette by splitting it or adding messages. A silent skip becomes a visible skip naming where the test does run.
4. Rerun every suite, record counts and durations the same way, and run the repo's own gate (its verify script if one exists, else \`node .house/check.mjs\`).
5. Commit everything on ${BRANCH}: subject "Tests: audit pass", a body listing each change with its id and, for removals, the covering test and the planted-defect evidence below; end with a blank line and the attribution lines the harness gives you.

Confirmed list:
${JSON.stringify(confirmed, null, 1)}

Skip an item you find wrong while applying it, and say why. ${COMMON_DONT}`,
  { label: 'build', phase: 'Build', schema: BUILD, model: 'sonnet', effort: 'high', agentType: 'house-rules:builder' },
)
if (!built || !built.sha) {
  log(`build produced no commit${built ? `: ${built.checks}` : ''}; nothing to review`)
  return { ...result, build: built || null, verdict: null }
}

// ── Review ────────────────────────────────────────────────────────────
phase('Review')
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ACCEPT', 'REWORK'] },
    mustFix: { type: 'array', items: { type: 'string' } },
    attacks: { type: 'array', items: { type: 'string' }, description: 'each attack with its command and result' },
    worktreeCleanBeforeAndAfter: { type: 'boolean' },
  },
  required: ['verdict', 'mustFix', 'attacks', 'worktreeCleanBeforeAndAfter'],
}
const review = await agent(
  `Review commit ${built.sha} on branch ${BRANCH} in ${WORKTREE} against the brief it answered: apply only the confirmed list below; every removal names a covering test that a planted defect showed failing; no kept test's assertions weakened; positive and negative control pairs kept whole; skips visible and naming where they run; counts and durations recorded before and after.

Confirm the commit exists (\`git -C ${WORKTREE} log -1 --format=%H\`): the builder's report can be a placeholder, so check the worktree, not the report. Run \`git -C ${WORKTREE} status --short\` first and last, and do not edit, stage or commit anything. Attack it: diff test names before and after per suite and match every missing one to a confirmed removal; reread each changed test body; rerun every suite; plant at least two defects the removed tests caught (in a scratch copy, as \`mkdir -p ${SCRATCH}/review && git -C ${WORKTREE} archive HEAD | tar -x -C ${SCRATCH}/review\`) and show the covering tests fail. Return ACCEPT or REWORK; each must-fix names a concrete failure and the simplest fix.

Confirmed list:
${JSON.stringify(confirmed.map(c => ({ id: c.id, kind: c.kind, file: c.file, test: c.test, coveringTest: c.proof?.correctedCoveringTest || c.coveringTest })), null, 1)}

${COMMON_DONT}`,
  { label: 'review', phase: 'Review', schema: REVIEW, model: 'opus', effort: 'high', agentType: 'house-rules:refuter' },
)

// ── Rework ────────────────────────────────────────────────────────────
// While the verdict is REWORK, a builder fixes the must-fixes only, as a new
// commit in the same worktree, and a refuter reviews that commit alone. Two
// rounds at most: a third would be a design problem for the maintainer, not
// another pass. Every round's verdict is returned.
const rounds = [{ round: 0, sha: built.sha, verdict: review?.verdict || null, mustFix: review?.mustFix || [] }]
const REWORK = {
  type: 'object',
  properties: {
    sha: { type: 'string', description: 'the new commit' },
    fixed: { type: 'array', items: { type: 'string' }, description: 'must-fixes fixed, each with the change made' },
    notFixed: { type: 'array', items: { type: 'string' }, description: 'must-fixes not fixed, each with why' },
    checks: { type: 'string', description: 'commands run and their results' },
  },
  required: ['sha', 'fixed', 'notFixed', 'checks'],
}
let current = review
let tip = built.sha
let reworks = 0
if (current && current.verdict === 'REWORK') phase('Rework')
while (current && current.verdict === 'REWORK' && reworks < MAX_REWORKS) {
  reworks++
  const mustFix = current.mustFix
  const fix = await agent(
    `Fix the must-fixes below in the worktree ${WORKTREE} (branch ${BRANCH}, now at ${tip}). Work only there, and fix only these: no other change, no new cleanup.

1. Run \`git -C ${WORKTREE} status --short\` and \`git -C ${WORKTREE} log -1 --format=%H\`; the tree must be clean and at ${tip}. If not, stop and say so.
2. Fix each must-fix with the simplest change that closes the failure it names. Rerun every suite and the repo's own gate (its verify script if one exists, else \`node .house/check.mjs\`).
3. Commit as a new commit on ${BRANCH} (never amend): subject "Tests: audit pass, rework ${reworks}", a body listing each must-fix and its change; end with a blank line and the attribution lines the harness gives you.

Must-fixes:
${JSON.stringify(mustFix, null, 1)}

Skip a must-fix you find wrong and say why. ${COMMON_DONT}`,
    { label: `rework ${reworks}`, phase: 'Rework', schema: REWORK, model: 'sonnet', effort: 'high', agentType: 'house-rules:builder' },
  )
  if (!fix) {
    rounds.push({ round: reworks, sha: tip, verdict: null, mustFix, note: 'rework builder returned nothing' })
    log(`rework ${reworks}: builder returned nothing; stopping with ${mustFix.length} must-fix(es) open`)
    break
  }
  const before = tip
  tip = fix.sha
  current = await agent(
    `Review commit ${tip} on branch ${BRANCH} in ${WORKTREE}, scoped to what it changed since ${before}: \`git -C ${WORKTREE} diff ${before}..${tip}\`. It answers the must-fixes below. Confirm the commit exists and the tree is clean (the builder's report can be a placeholder; check the worktree, not the report), that each must-fix is closed, that the fix weakened no kept test's assertions or a control pair, and that it touched nothing else. Run \`git -C ${WORKTREE} merge-base --is-ancestor ${before} ${tip}\`: a non-zero exit means history was rewritten, which is a must-fix. Rerun every suite; where a must-fix named a failure, reproduce that failure on ${before} (scratch copy: \`mkdir -p ${SCRATCH}/rework-${reworks} && git -C ${WORKTREE} archive ${before} | tar -x -C ${SCRATCH}/rework-${reworks}\`) and show it gone on ${tip}.

Run \`git -C ${WORKTREE} status --short\` first and last, and do not edit, stage or commit anything. Return ACCEPT or REWORK; each must-fix names a concrete failure and the simplest fix.

Must-fixes this commit answers:
${JSON.stringify(mustFix, null, 1)}

The builder says it fixed: ${JSON.stringify(fix.fixed)}; not fixed: ${JSON.stringify(fix.notFixed)}

${COMMON_DONT}`,
    { label: `re-review ${reworks}`, phase: 'Rework', schema: REVIEW, model: 'opus', effort: 'high', agentType: 'house-rules:refuter' },
  )
  rounds.push({ round: reworks, sha: tip, verdict: current?.verdict || null, mustFix: current?.mustFix || mustFix })
  if (!current) {
    log(`rework ${reworks}: reviewer returned nothing; stopping with ${mustFix.length} must-fix(es) open`)
    break
  }
}
// Open must-fixes: the last round's, whenever it did not end in ACCEPT.
const last = rounds[rounds.length - 1]
const remainingMustFix = last.verdict === 'ACCEPT' ? [] : last.mustFix
// The verdict is the last review's, and null when a review died: null is "not reviewed", never ACCEPT.
const verdict = last.verdict
if (verdict === null) log('a review returned nothing: the result is not reviewed, so it is not push-eligible')
if (remainingMustFix.length) log(`stopped after ${reworks} rework round(s) with ${remainingMustFix.length} must-fix(es) open; the maintainer decides`)

return { ...result, build: built, review, rounds, tip, branch: BRANCH, worktree: WORKTREE, verdict, remainingMustFix }
