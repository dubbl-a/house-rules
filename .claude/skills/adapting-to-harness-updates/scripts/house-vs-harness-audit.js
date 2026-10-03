export const meta = {
  name: 'house-vs-harness-audit',
  description: 'Deep research: classify every house rule and mechanism against native Claude Code behavior as duplicate, conflict, complement, or unique, with adversarial verification and a synthesis report',
  phases: [
    { title: 'Harness research', detail: 'eight parallel readers of the official Claude Code docs and CLI help' },
    { title: 'Classify', detail: 'one judge per rule module, plus one for hooks, skills, and the checker' },
    { title: 'Verify', detail: 'two skeptics with distinct lenses per duplicate-or-conflict claim' },
    { title: 'Synthesize', detail: 'disposition report plus a completeness critic' },
  ],
}

const REPO = args && args.repo ? args.repo : (() => { throw new Error('pass args.repo: an absolute path to a clean checkout of origin/main') })()
const DATE = args && args.date ? args.date : (() => { throw new Error('pass args.date as YYYY-MM-DD') })()

const AREAS = [
  { key: 'memory-rules', title: 'CLAUDE.md, memory, rule files, path scoping, imports, /doctor, /init, managed CLAUDE.md, auto-memory',
    pages: ['https://code.claude.com/docs/en/memory', 'https://code.claude.com/docs/en/memory.md', 'https://code.claude.com/docs/en/common-workflows'] , cli: [] },
  { key: 'hooks-permissions', title: 'hooks (events, matchers, blocking semantics, JSON output), permissions, settings layering, managed policy settings',
    pages: ['https://code.claude.com/docs/en/hooks', 'https://code.claude.com/docs/en/hooks-guide', 'https://code.claude.com/docs/en/settings', 'https://code.claude.com/docs/en/configuration', 'https://code.claude.com/docs/en/permissions', 'https://code.claude.com/docs/en/iam'], cli: [] },
  { key: 'plugins', title: 'plugins, plugin components, marketplaces, plugin validate, plugin details and token cost, whether plugins can ship rules or CLAUDE.md',
    pages: ['https://code.claude.com/docs/en/plugins', 'https://code.claude.com/docs/en/plugins-reference', 'https://code.claude.com/docs/en/plugin-marketplaces'], cli: ['claude plugin --help', 'claude plugin validate --help', 'claude plugin details --help'] },
  { key: 'skills-commands', title: 'skills, slash commands, disable-model-invocation, skill frontmatter, skill-doctor, plugin init scaffolding',
    pages: ['https://code.claude.com/docs/en/skills', 'https://code.claude.com/docs/en/slash-commands'], cli: ['claude plugin init --help'] },
  { key: 'evals', title: 'the plugin eval runner: case format, grader types, runs, ablation, thresholds, reports, availability; Anthropic eval guidance',
    pages: ['https://code.claude.com/docs/en/plugins-reference', 'https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents', 'https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills'], cli: ['claude plugin eval --help'] },
  { key: 'sessions-worktrees', title: 'sessions and resume, worktrees and their cleanup, sandboxing, checkpoints, background tasks, what carries between sessions',
    pages: ['https://code.claude.com/docs/en/sessions', 'https://code.claude.com/docs/en/worktrees', 'https://code.claude.com/docs/en/sandboxing', 'https://code.claude.com/docs/en/checkpointing', 'https://code.claude.com/docs/en/interactive-mode'], cli: ['claude --help'] },
  { key: 'agents-models', title: 'subagents, agent definitions, model and effort selection, agent teams, workflows, how an omitted model is resolved',
    pages: ['https://code.claude.com/docs/en/sub-agents', 'https://code.claude.com/docs/en/agent-teams', 'https://code.claude.com/docs/en/model-config', 'https://code.claude.com/docs/en/costs'], cli: [] },
  { key: 'git-github', title: 'git and GitHub integration: commits, PR creation, the GitHub app and Actions integration, code review, branch handling, worktree branches',
    pages: ['https://code.claude.com/docs/en/github-actions', 'https://code.claude.com/docs/en/common-workflows', 'https://code.claude.com/docs/en/code-review', 'https://code.claude.com/docs/en/cli-reference'], cli: [] },
  { key: 'settings-admin', title: 'settings precedence and merge chain, managed settings, model allow and deny lists, auto mode configuration, enterprise lockout',
    pages: ['https://code.claude.com/docs/en/settings', 'https://code.claude.com/docs/en/settings-reference', 'https://code.claude.com/docs/en/managed-settings', 'https://code.claude.com/docs/en/auto-mode-config'], cli: [] },
  { key: 'security-data', title: 'security model, secrets handling, data usage and retention, security guidance for agents',
    pages: ['https://code.claude.com/docs/en/security', 'https://code.claude.com/docs/en/security-guidance', 'https://code.claude.com/docs/en/data-usage'], cli: [] },
  { key: 'checkpointing', title: 'checkpointing and rewind of file edits, what a checkpoint does and does not restore, how it relates to git',
    pages: ['https://code.claude.com/docs/en/checkpointing'], cli: [] },
  { key: 'best-practices', title: "Anthropic's own best-practices and common-workflows guidance for Claude Code, and the prompt audit that flags prompting patterns written for older models",
    pages: ['https://code.claude.com/docs/en/best-practices', 'https://code.claude.com/docs/en/common-workflows', 'https://code.claude.com/docs/en/troubleshooting'], cli: ['claude doctor --help'] },
  { key: 'tools-context', title: 'the tools reference, the context window and compaction, prompt caching, and what they imply for instruction-file size and tool behavior',
    pages: ['https://code.claude.com/docs/en/tools-reference', 'https://code.claude.com/docs/en/context-window', 'https://code.claude.com/docs/en/prompt-caching'], cli: [] },
]

const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    facts: { type: 'array', items: { type: 'object', properties: {
      feature: { type: 'string' },
      behavior: { type: 'string' },
      limits: { type: 'string' },
      enforcement: { type: 'string', enum: ['advisory', 'warns', 'blocks', 'automatic', 'none'] },
      citation: { type: 'string' },
    }, required: ['feature', 'behavior', 'limits', 'enforcement', 'citation'] } },
    unreachable: { type: 'array', items: { type: 'string' } },
  },
  required: ['area', 'facts', 'unreachable'],
}

const CLASS_SCHEMA = {
  type: 'object',
  properties: {
    item: { type: 'string' },
    rules: { type: 'array', items: { type: 'object', properties: {
      heading: { type: 'string' },
      disposition: { type: 'string', enum: ['DUPLICATE', 'CONFLICT', 'COMPLEMENT', 'UNIQUE'] },
      nativeFeature: { type: 'string' },
      evidence: { type: 'string' },
      citation: { type: 'string' },
      action: { type: 'string', enum: ['keep', 'reword-to-cite-native-floor', 'delete', 'declare-intentional-duplicate', 'resolve-conflict'] },
      proposedWording: { type: 'string' },
    }, required: ['heading', 'disposition', 'nativeFeature', 'evidence', 'citation', 'action', 'proposedWording'] } },
    notes: { type: 'string' },
  },
  required: ['item', 'rules', 'notes'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    citation: { type: 'string' },
    downgradeTo: { type: 'string', enum: ['COMPLEMENT', 'UNIQUE', 'none'] },
  },
  required: ['refuted', 'reason', 'citation', 'downgradeTo'],
}

function researchPrompt(a) {
  return `You are researching what Claude Code provides natively, for one area, as of ${DATE}. Area: ${a.title}.

Read these sources with WebFetch (try each URL; the docs site serves markdown when you append .md to a page path, and some pages may have moved, so also try the site's sitemap or search if a page 404s): ${a.pages.join(' ; ')}. Run these CLI commands with Bash and read their output: ${a.cli.length ? a.cli.join(' ; ') : 'none'}.

For every distinct feature in this area return one fact: the feature name, what the harness does (behavior), what it does not do (limits), how it is enforced (advisory guidance in docs, warns, blocks, automatic, or none), and a citation (the exact URL or the CLI command). Be precise about scope: for example, if a feature applies only to files under .claude/worktrees/ or only to the auto-memory index, say so. Prefer the documentation's own words in the behavior field. Do not speculate and do not fill gaps from memory; if a page is unreachable, list it under unreachable. Aim for completeness within the area: a downstream judge will classify roughly a hundred house rules against these facts and can only use what you return.`
}

const MODULES = ['claude-code', 'docs', 'engineering', 'github', 'testing', 'database', 'deployment', 'data-pipelines', 'llm-output', 'evals']
const ITEMS = MODULES.map(m => ({ key: m, kind: 'module', path: `${REPO}/plugins/house/modules/${m}/rules/${m}.md` }))
ITEMS.push({ key: 'mechanisms', kind: 'mechanisms', path: `${REPO}/README.md` })

function classifyPrompt(item, factsText) {
  const target = item.kind === 'module'
    ? `Read the rule file ${item.path}. Classify every rule (each "## " heading except "## Don't"), using the heading text verbatim as the heading field.`
    : `Classify these house mechanisms, reading the named files: the PreToolUse branch guard (${REPO}/plugins/house/hooks/no-direct-master.sh and hooks.json); every skill under ${REPO}/plugins/house/skills/ (read each SKILL.md's first 40 lines); the pinned agent roster under ${REPO}/plugins/house/agents/ and the session-start orchestration defaults in ${REPO}/plugins/house/orchestration/ORCHESTRATION.md; the checker's families as documented in the header comment of ${REPO}/plugins/house/payload/check.mjs; the render and vendor step, the lock file, the deviations ledger and ratchets, the upstream-first sync, the handoff skill, and the eval cases under ${REPO}/plugins/house/evals/ (read one prompt.md and its graders). Use one entry per mechanism, with the mechanism's name as the heading field.`
  return `You are judging whether house-rules duplicates, conflicts with, complements, or is unique relative to Claude Code's native behavior. The owner's standard: the package should complement and improve the harness, never duplicate or conflict unless very intentionally.

${target}

Native harness facts, gathered from the official docs and CLI help today (your only evidence about the harness; do not research further, do not use memory of older docs):
${factsText}

Definitions, apply strictly:
- DUPLICATE: the harness already does what the rule asks, with equal or stronger enforcement, so the rule adds nothing beyond restating it.
- CONFLICT: the rule contradicts documented harness behavior or guidance, or fights a native mechanism (for example tells the assistant to do by hand what the harness does automatically, in a way that would collide).
- COMPLEMENT: the rule builds on a native primitive and adds posture, scope, or enforcement the harness lacks; name the native feature it should cite.
- UNIQUE: no native counterpart in the facts.

For each rule give: disposition; the native feature involved (or "none"); one sentence of evidence tied to a fact by its citation; the action (keep, reword-to-cite-native-floor, delete, declare-intentional-duplicate, resolve-conflict); and, when the action is a reword or a conflict resolution, the proposed wording for the affected clause or Anchor line (one or two sentences, no em dashes, no dates or numbers in rule prose, heading unchanged). For keep, proposedWording is an empty string. In notes, say which rules you were unsure about and why. Cover every heading; do not skip any.`
}

const LENSES = [
  { key: 'doc-accuracy', text: 'Documentation accuracy: fetch the cited page or run the cited command yourself and check that the harness really says or does what the claim asserts, at the scope asserted. If the citation does not support the claim as stated, refute.' },
  { key: 'enforcement', text: 'Enforcement reality: even if the documentation says it, check whether the harness enforces it the way the rule needs. A warning or a docs recommendation does not make a blocking or mechanical house rule redundant; a feature scoped to one directory does not cover a rule about another. If the house rule still adds enforcement, scope, or posture the harness lacks, refute the duplicate-or-conflict claim and say what it should be downgraded to.' },
]

function verifyPrompt(item, claim, lens) {
  return `Adversarially verify one claim about a house rule. Try to refute it; default to refuted=true if you are uncertain.

Item: ${item.key}. Rule or mechanism: "${claim.heading}".
Claim: disposition ${claim.disposition}, native feature "${claim.nativeFeature}". Evidence offered: ${claim.evidence} Citation: ${claim.citation}. Proposed action: ${claim.action}.

Your lens: ${lens.text}

You may read the rule file to see the rule's full text (${item.path}). Return refuted (true or false), a one-paragraph reason, the citation you checked, and downgradeTo (COMPLEMENT, UNIQUE, or none) if you refute.`
}

function synthPrompt(results) {
  return `Write the disposition report for the house-rules versus Claude Code harness audit, dated ${DATE}. Audience: the package owner, who wants the package to complement and improve the harness, not duplicate or conflict with it unless very intentionally. Plain language, no em dashes, no exclamation marks.

Input: the classification results per item, each rule with a disposition, evidence, action, proposed wording, and for every DUPLICATE or CONFLICT claim the two skeptic votes (lenses: doc-accuracy and enforcement). Treat a DUPLICATE or CONFLICT as confirmed only when neither skeptic refuted it; if either refuted, downgrade to the skeptic's downgradeTo (or COMPLEMENT if they disagree) and say so.

${JSON.stringify(results)}

Report shape (markdown):
1. Summary: counts of confirmed duplicates, confirmed conflicts, complements, uniques, and downgraded claims; the headline in two sentences.
2. Confirmed duplicates: table with item, heading, native feature, citation, recommended action.
3. Confirmed conflicts: same table, plus one sentence each on how to resolve.
4. Complements worth rewording: the rules whose action is reword-to-cite-native-floor, each with the proposed wording.
5. Unique mechanisms: a compact list, grouped (this is the package's reason to exist).
6. Downgraded claims: what the skeptics refuted and why (short).
7. A PR plan: the smallest set of pull requests that applies the confirmed actions, in order, with which files each touches, noting which changes are rule prose (minor under ADR 0011) and which would be major (a heading, slot, or hook-contract change).
8. Open questions the audit could not settle from the docs.
Return the markdown only.`
}

function criticPrompt(areas, results) {
  return `You are the completeness critic for an audit of the house-rules package against Claude Code's native features. The audit researched these harness areas: ${areas.map(a => a.title).join(' | ')}. It classified these items, with the number of rules each classifier returned: ${results.filter(Boolean).map(r => `${r.item} (${r.rules.length})`).join(', ')}, covering ${results.reduce((n, r) => n + (r ? r.rules.length : 0), 0)} rules and mechanisms.

Answer three questions, briefly and concretely: (1) Which native Claude Code features or documentation areas were NOT researched that could make a house rule redundant or conflicting (name the doc page or CLI command)? (2) Did any classifier skip headings? Compare the number of "## " headings excluding "## Don't" in each rule file under ${REPO}/plugins/house/modules/*/rules/ (count them with grep, matching "## Don't" exactly rather than as a prefix, since some real rules start with that word) against the counts per item above, and list any gap. (3) Which single follow-up research task would most change the report's conclusions? Return plain markdown, under 300 words.`
}

phase('Harness research')
const facts = (await parallel(AREAS.map(a => () =>
  agent(researchPrompt(a), { label: `research:${a.key}`, phase: 'Harness research', schema: FACTS_SCHEMA, model: 'sonnet' })
))).filter(Boolean)
log(`harness research: ${facts.length}/${AREAS.length} areas returned, ${facts.reduce((n, f) => n + f.facts.length, 0)} facts, unreachable: ${facts.flatMap(f => f.unreachable).length}`)
const factsText = JSON.stringify(facts)

const short = s => String(s).slice(0, 40).replace(/[^A-Za-z0-9 ]/g, '')

const results = await pipeline(ITEMS,
  item => agent(classifyPrompt(item, factsText), { label: `classify:${item.key}`, phase: 'Classify', schema: CLASS_SCHEMA, model: 'opus', effort: 'high' }),
  async (cls, item) => {
    if (!cls) return null
    const claims = cls.rules.filter(r => r.disposition === 'DUPLICATE' || r.disposition === 'CONFLICT')
    log(`${item.key}: ${cls.rules.length} rules, ${claims.length} duplicate-or-conflict claims to verify`)
    const verified = await parallel(claims.map(c => () =>
      parallel(LENSES.map(l => () =>
        agent(verifyPrompt(item, c, l), { label: `verify:${item.key}:${short(c.heading)}:${l.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, model: 'sonnet' })
      )).then(vs => ({ heading: c.heading, votes: LENSES.map((l, i) => ({ lens: l.key, ...(vs[i] || { refuted: true, reason: 'skeptic did not return', citation: '', downgradeTo: 'COMPLEMENT' }) })) }))
    ))
    return { ...cls, verified: verified.filter(Boolean) }
  }
)

phase('Synthesize')
const clean = results.filter(Boolean)
const [report, critic] = await parallel([
  () => agent(synthPrompt(clean), { label: 'synthesize report', phase: 'Synthesize', model: 'opus', effort: 'high' }),
  () => agent(criticPrompt(AREAS, clean), { label: 'completeness critic', phase: 'Synthesize', model: 'sonnet' }),
])
return { report, critic, itemsClassified: clean.length, rulesClassified: clean.reduce((n, r) => n + r.rules.length, 0), factsUsed: facts.reduce((n, f) => n + f.facts.length, 0), unreachable: facts.flatMap(f => f.unreachable), facts, results: clean }