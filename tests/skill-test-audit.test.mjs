import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The test-audit skill's Workflow script (plugins/house/skills/test-audit/test-audit.js)
// is driven here with stub agent/pipeline/parallel functions that return canned
// objects, so the control flow (re-reads, refuted items, apply:false, the rework
// loop, argument validation) is tested without spawning an agent.

const SCRIPT = fileURLToPath(new URL('../plugins/house/skills/test-audit/test-audit.js', import.meta.url))
const source = readFileSync(SCRIPT, 'utf8')
const body = source.replace('export const meta', 'const meta')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const PARAMS = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow']

const ARGS = {
  root: '/work/repo',
  rules: '/plugin/modules/testing/rules/testing.md',
  scratch: '/scratch/test-audit',
  date: '2026-10-22',
}

const SURVEY = {
  repo: 'owner/repo',
  defaultBranch: 'main',
  headSha: 'abc123',
  suites: [{ name: 'unit', command: 'npm test', runsInCI: true, files: [{ path: 'tests/a.test.mjs', lines: 300 }] }],
  ciCriticalPath: 'run 1: 90s',
}
const FINDING = { kind: 'remove-duplicate', file: 'tests/a.test.mjs', line: 10, test: 'dup', claim: 'covered', fix: 'delete', coveringTest: 'tests/a.test.mjs:200 other' }
const ITEMS = [
  { id: 'R1', ...FINDING, test: 'dup one', needsProof: true },
  { id: 'R2', ...FINDING, line: 20, test: 'dup two', needsProof: true },
  { id: 'S1', kind: 'share-fixture', file: 'tests/a.test.mjs', line: 30, test: 'shared', claim: 'rebuilds', fix: 'share', needsProof: false },
]
const review = (verdict, mustFix = []) => ({ verdict, mustFix, attacks: ['planted'], worktreeCleanBeforeAndAfter: true })

// Runs the script against stubs. `reviews` is the verdict sequence handed to the
// review and re-review calls in order; `auditReads` is what the first audit reports.
async function run(args, { reviews = [review('ACCEPT')], firstRead = [{ path: 'tests/a.test.mjs', from: 1, to: 100 }], items = ITEMS, refuters = null, build = null, rework = null } = {}) {
  const calls = []
  const logs = []
  const phases = []
  let reworkN = 0
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts })
    const { label } = opts
    if (label === 'survey') return SURVEY
    if (label === 'audit 1') return { findings: [FINDING], read: firstRead }
    if (label.startsWith('audit 1 re-read')) return { findings: [], read: [{ path: 'tests/a.test.mjs', from: 101, to: 300 }] }
    if (label === 'merge') return { items, dropped: [] }
    if (label.startsWith('refute')) {
      if (refuters === 'dead') return null
      return { verdicts: [{ id: 'R1', verdict: 'confirmed', evidence: 'failed' }, { id: 'R2', verdict: 'refuted', evidence: 'still passes' }] }
    }
    if (label === 'build') return build ?? { branch: 'tests-audit-2026-10-22', sha: 'sha0', applied: ['R1', 'S1'], skipped: [], before: '10 tests', after: '9 tests', checks: 'ok' }
    if (label.startsWith('rework')) return rework ?? { sha: `sha${++reworkN}`, fixed: ['f'], notFixed: [], checks: 'ok' }
    if (label === 'review' || label.startsWith('re-review')) return reviews.length ? reviews.shift() : review('ACCEPT')
    throw new Error(`unexpected agent label ${label}`)
  }
  const pipeline = async (items, fn) => Promise.all(items.map((it, i) => fn(it, it, i)))
  const parallel = async (fns) => Promise.all(fns.map(f => f()))
  const fn = new AsyncFunction(...PARAMS, body)
  const result = await fn(agent, parallel, pipeline, t => phases.push(t), m => logs.push(m), args, {}, {})
  return { result, calls, logs, phases }
}

const byLabel = (calls, re) => calls.filter(c => re.test(c.opts.label))

test('the script parses as a Workflow body and its meta names the phases it calls', () => {
  assert.doesNotThrow(() => new AsyncFunction(...PARAMS, body))
  const metaText = source.slice(source.indexOf('export const meta = ') + 'export const meta = '.length, source.indexOf('\n}\n') + 2)
  const meta = new Function(`return ${metaText}`)()
  assert.equal(meta.name, 'test-audit')
  const declared = meta.phases.map(p => p.title)
  const called = [...source.matchAll(/\bphase\('([^']+)'\)/g)].map(m => m[1])
  const named = [...source.matchAll(/\bphase: '([^']+)'/g)].map(m => m[1])
  assert.ok(called.length >= 6)
  for (const title of [...called, ...named]) assert.ok(declared.includes(title), `phase ${title} is not in meta.phases`)
})

test('every agent call names its model and effort', async () => {
  const { calls } = await run(ARGS, { reviews: [review('REWORK', ['m1']), review('ACCEPT')] })
  assert.ok(calls.length >= 9)
  for (const { opts } of calls) {
    assert.ok(opts.model, `${opts.label} names no model`)
    assert.ok(opts.effort, `${opts.label} names no effort`)
  }
})

test('an auditor that read only part of a file is sent back for the unread range alone', async () => {
  const { calls } = await run(ARGS)
  const reread = byLabel(calls, /^audit 1 re-read/)
  assert.equal(reread.length, 1)
  assert.ok(reread[0].prompt.includes('tests/a.test.mjs:101-300'), 'the re-read names the unread range')
  assert.ok(!reread[0].prompt.includes('tests/a.test.mjs:1-100'), 'the re-read does not repeat the read range')
})

test('a fully read batch gets no re-read', async () => {
  const { calls } = await run(ARGS, { firstRead: [{ path: 'tests/a.test.mjs', from: 1, to: 300 }] })
  assert.equal(byLabel(calls, /re-read/).length, 0)
})

test('an item the refuter refuted is absent from the build prompt', async () => {
  const { calls, result } = await run(ARGS)
  const [build] = byLabel(calls, /^build$/)
  assert.ok(build.prompt.includes('"id": "R1"'))
  assert.ok(build.prompt.includes('"id": "S1"'))
  assert.ok(!build.prompt.includes('"id": "R2"'), 'refuted R2 must not reach the builder')
  assert.deepEqual(result.rejected.map(r => r.id), ['R2'])
})

test('a build that stopped without a commit (branch already there) is never reviewed and never ACCEPT', async () => {
  const stopped = { branch: 'tests-audit-2026-10-22', sha: '', applied: [], skipped: ['R1', 'S1'], before: '', after: '', checks: 'branch tests-audit-2026-10-22 already exists; created nothing' }
  const { calls, result, logs } = await run(ARGS, { build: stopped })
  assert.equal(byLabel(calls, /^(review|rework|re-review)/).length, 0, 'nothing to review, so no reviewer runs')
  assert.equal(result.verdict, null)
  assert.ok(logs.some(l => /no commit/.test(l)), 'the stop is logged')
})

test('a rework that produced no commit stops the loop with the must-fixes open and no re-review', async () => {
  const { calls, result } = await run(ARGS, { reviews: [review('REWORK', ['m1'])], rework: { sha: '', fixed: [], notFixed: ['m1'], checks: 'stopped' } })
  assert.equal(byLabel(calls, /^re-review/).length, 0, 'an empty commit range is never reviewed')
  assert.equal(result.verdict, null)
  assert.deepEqual(result.remainingMustFix, ['m1'])
})

test('apply:false returns the confirmed list before any build call', async () => {
  const { calls, result } = await run({ ...ARGS, apply: false })
  assert.equal(byLabel(calls, /^(build|review|rework|re-review)/).length, 0)
  assert.deepEqual(result.confirmed.map(c => c.id), ['R1', 'S1'])
  assert.equal(result.build, undefined)
})

test('ACCEPT on the first review makes no rework round', async () => {
  const { calls, result } = await run(ARGS)
  assert.equal(byLabel(calls, /^(rework|re-review)/).length, 0)
  assert.equal(result.rounds.length, 1)
  assert.deepEqual(result.remainingMustFix, [])
})

test('REWORK then ACCEPT makes exactly one rework round on the must-fixes only', async () => {
  const { calls, result, logs } = await run(ARGS, { reviews: [review('REWORK', ['fix the skip in a.test.mjs']), review('ACCEPT')] })
  const rework = byLabel(calls, /^rework/)
  const rereview = byLabel(calls, /^re-review/)
  assert.equal(rework.length, 1)
  assert.equal(rereview.length, 1)
  assert.equal(rework[0].opts.agentType, 'house-rules:builder')
  assert.equal(rereview[0].opts.agentType, 'house-rules:refuter')
  assert.equal(rereview[0].opts.model, 'opus')
  assert.ok(rework[0].prompt.includes('fix the skip in a.test.mjs'))
  assert.ok(rework[0].prompt.includes('never amend'))
  assert.ok(rereview[0].prompt.includes('sha0..sha1'), 're-review is scoped to the rework commit')
  assert.deepEqual(result.rounds.map(r => r.verdict), ['REWORK', 'ACCEPT'])
  assert.deepEqual(result.remainingMustFix, [])
  assert.equal(result.tip, 'sha1')
  assert.ok(!logs.some(l => /stopped after/.test(l)))
})

test('two rework rounds that still end in REWORK stop and return the open must-fixes', async () => {
  const { calls, result, logs } = await run(ARGS, {
    reviews: [review('REWORK', ['m1']), review('REWORK', ['m2']), review('REWORK', ['m3'])],
  })
  assert.equal(byLabel(calls, /^rework/).length, 2)
  assert.equal(byLabel(calls, /^re-review/).length, 2)
  assert.deepEqual(result.rounds.map(r => r.verdict), ['REWORK', 'REWORK', 'REWORK'])
  assert.deepEqual(result.remainingMustFix, ['m3'])
  assert.ok(logs.some(l => /stopped after 2 rework round/.test(l)))
})

test('a removal the merge agent left unflagged still needs proof, and a dead refuter rejects it', async () => {
  const unflagged = { id: 'R9', ...FINDING, test: 'unproven dup', needsProof: false }
  const { calls, result } = await run(ARGS, { items: [unflagged, ITEMS[2]], refuters: 'dead' })
  assert.deepEqual(result.rejected.map(r => r.id), ['R9'])
  assert.ok(!result.confirmed.some(c => c.id === 'R9'))
  const [build] = byLabel(calls, /^build$/)
  assert.ok(build.prompt.includes('"id": "S1"'))
  assert.ok(!build.prompt.includes('"id": "R9"'), 'an unproven removal must not reach the builder')
})

test('a review that returned nothing gives a null verdict, never ACCEPT', async () => {
  const { result, logs } = await run(ARGS, { reviews: [null] })
  assert.equal(result.verdict, null)
  assert.notEqual(result.verdict, 'ACCEPT')
  assert.ok(logs.some(l => /returned nothing/.test(l)))
})

test('a re-review that returned nothing gives a null verdict and keeps the open must-fixes', async () => {
  const { result } = await run(ARGS, { reviews: [review('REWORK', ['m1']), null] })
  assert.equal(result.verdict, null)
  assert.deepEqual(result.remainingMustFix, ['m1'])
})

test('the verdict is the last review\'s: ACCEPT, or REWORK after the last round', async () => {
  assert.equal((await run(ARGS)).result.verdict, 'ACCEPT')
  assert.equal((await run(ARGS, { reviews: [review('REWORK', ['a']), review('ACCEPT')] })).result.verdict, 'ACCEPT')
  assert.equal((await run(ARGS, { reviews: [review('REWORK', ['a']), review('REWORK', ['b']), review('REWORK', ['c'])] })).result.verdict, 'REWORK')
})

test('the builder branches from the surveyed head, stops on an existing branch, and re-review checks history', async () => {
  const { calls } = await run(ARGS, { reviews: [review('REWORK', ['m1']), review('ACCEPT')] })
  const [build] = byLabel(calls, /^build$/)
  assert.ok(build.prompt.includes('worktree add -b tests-audit-2026-10-22 /work/repo/.claude/worktrees/tests-audit-2026-10-22 abc123'))
  assert.ok(!build.prompt.includes('origin/main'), 'the build does not branch from a fresh fetch')
  assert.ok(/stop, create nothing/.test(build.prompt))
  const [rereview] = byLabel(calls, /^re-review/)
  assert.ok(rereview.prompt.includes('merge-base --is-ancestor sha0 sha1'))
})

test('missing or malformed args throw a message naming the arg', async () => {
  for (const [bad, name] of [
    [{ ...ARGS, root: undefined }, 'args.root'],
    [{ ...ARGS, root: 'relative/path' }, 'args.root'],
    [{ ...ARGS, rules: undefined }, 'args.rules'],
    [{ ...ARGS, scratch: undefined }, 'args.scratch'],
    [{ ...ARGS, date: '22 Oct' }, 'args.date'],
  ]) {
    await assert.rejects(run(bad), new RegExp(name.replace('.', '\\.')))
  }
  await assert.rejects(run(undefined), /args\.root/)
})
