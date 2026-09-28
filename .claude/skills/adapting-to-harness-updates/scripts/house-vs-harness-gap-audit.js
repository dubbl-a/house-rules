export const meta = {
  name: 'house-vs-harness-gap-audit',
  description: 'Close the completeness critic gaps from the harness audit: research MCP, output styles, plan mode, headless mode, and observability; classify the affected house rules including the one the first pass skipped; verify claims adversarially; write an addendum',
  phases: [
    { title: 'Gap research', detail: 'three readers over the harness areas the first audit missed' },
    { title: 'Classify', detail: 'four targeted judges over the rules those areas could touch' },
    { title: 'Verify', detail: 'two skeptics per duplicate-or-conflict claim' },
    { title: 'Addendum', detail: 'one synthesis agent' },
  ],
}

const REPO = args && args.repo ? args.repo : (() => { throw new Error('pass args.repo: an absolute path to a clean checkout of origin/main') })()
const DATE = args && args.date ? args.date : (() => { throw new Error('pass args.date as YYYY-MM-DD') })()

// args.areas and args.targets replace the defaults below, which are the 2026-09-20 gap run kept as a worked example.
// A target path is relative to the repo root.
const AREAS = args && args.areas ? args.areas : [
  { key: 'mcp', title: 'MCP servers: .mcp.json and settings scopes, tool permissioning and allow/deny rules for MCP tools, enterprise-managed MCP settings, how MCP tool calls interact with PreToolUse hooks and permission prompts',
    pages: ['https://code.claude.com/docs/en/mcp', 'https://code.claude.com/docs/en/settings', 'https://code.claude.com/docs/en/permissions', 'https://code.claude.com/docs/en/hooks'], cli: ['claude mcp --help'] },
  { key: 'styles-plan', title: 'output styles (/output-style, custom styles, what they change in the system prompt), plan mode (what it is, what it restricts, how it interacts with instruction files), and CLAUDE.md or rule guidance about planning',
    pages: ['https://code.claude.com/docs/en/output-styles', 'https://code.claude.com/docs/en/common-workflows', 'https://code.claude.com/docs/en/interactive-mode', 'https://code.claude.com/docs/en/memory'], cli: [] },
  { key: 'headless-observability', title: 'headless and programmatic use (claude -p, output formats, the Agent SDK, bare mode, what hooks and rules apply headless), plus cost reporting, statusline, and telemetry',
    pages: ['https://code.claude.com/docs/en/headless', 'https://code.claude.com/docs/en/sdk', 'https://code.claude.com/docs/en/costs', 'https://code.claude.com/docs/en/statusline', 'https://code.claude.com/docs/en/monitoring-usage', 'https://code.claude.com/docs/en/cli-reference'], cli: ['claude --help'] },
]

const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    facts: { type: 'array', items: { type: 'object', properties: {
      feature: { type: 'string' }, behavior: { type: 'string' }, limits: { type: 'string' },
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
      nativeFeature: { type: 'string' }, evidence: { type: 'string' }, citation: { type: 'string' },
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
    refuted: { type: 'boolean' }, reason: { type: 'string' }, citation: { type: 'string' },
    downgradeTo: { type: 'string', enum: ['COMPLEMENT', 'UNIQUE', 'none'] },
  },
  required: ['refuted', 'reason', 'citation', 'downgradeTo'],
}

function researchPrompt(a) {
  return `You are researching what Claude Code provides natively, for one area, as of ${DATE}. Area: ${a.title}.

Read these sources with WebFetch (try each URL; append .md for the markdown rendering if the HTML is hard to read; if a page 404s, look for the moved page via the docs site's navigation or search and say what you found): ${a.pages.join(' ; ')}. Run with Bash and read: ${a.cli.length ? a.cli.join(' ; ') : 'none'}.

For every distinct feature return one fact: feature, behavior (the docs' own words where possible), limits (what it does not do), enforcement (advisory, warns, blocks, automatic, none), citation (URL or command). Be precise about scope and about which surfaces a feature reaches (for example whether a permission rule can see inside an MCP tool call, whether a hook fires headless, whether an output style rewrites the system prompt or only appends). Do not speculate; list unreachable pages. A judge will classify house rules against these facts and can only use what you return.`
}

const TARGETS = args && args.targets ? args.targets.map(t => ({ ...t, path: `${REPO}/${t.path}` })) : [
  { key: 'docs-skipped-rule', path: `${REPO}/plugins/house/modules/docs/rules/docs.md`,
    scope: 'exactly one rule, the heading "Don\'t document a command that does not exist" (it was skipped by the first audit because it begins with the word Don\'t; it is a full rule with a body, Anchor, and Receipts)' },
  { key: 'llm-output-vs-styles', path: `${REPO}/plugins/house/modules/llm-output/rules/llm-output.md`,
    scope: 'every rule in the file, judged against output styles, plan mode, and headless mode only; the first audit already judged them against memory, hooks, plugins, skills, evals, sessions, agents, and git' },
  { key: 'guard-vs-mcp', path: `${REPO}/plugins/house/modules/claude-code/rules/claude-code.md`,
    scope: 'the rules about hooks, permissions, settings, model selection, and subagents (headings containing hook, settings, model, subagent, peer session, or git state), judged against MCP permissioning and headless mode only; also the PreToolUse branch guard at ' + REPO + '/plugins/house/hooks/no-direct-master.sh as one extra entry with heading "PreToolUse branch guard"' },
  { key: 'engineering-vs-plan', path: `${REPO}/plugins/house/modules/engineering/rules/engineering.md`,
    scope: 'the rules about building the simplest thing, prior art, decision records, and measurement (headings containing simplest, prior art, decision, measuring, or reproducible), judged against plan mode, headless mode, and cost or telemetry reporting only' },
]

function classifyPrompt(t, factsText) {
  return `You are judging house rules against Claude Code native features that a first audit did not research. The owner's standard: complement and improve the harness, never duplicate or conflict unless very intentionally.

Read ${t.path}. Scope: ${t.scope}. Use each heading verbatim as the heading field.

Native harness facts for the newly researched areas (your only evidence; do not research further):
${factsText}

Definitions, strictly: DUPLICATE (the harness already does what the rule asks with equal or stronger enforcement); CONFLICT (the rule contradicts documented behavior or fights a native mechanism); COMPLEMENT (builds on a native primitive and adds posture, scope, or enforcement the harness lacks; name the feature it should cite); UNIQUE (no counterpart in these facts). If a rule is untouched by these areas, mark it UNIQUE with nativeFeature "none in the new areas" and action keep. Give evidence tied to a citation, an action, and proposed wording only for a reword or conflict resolution (no em dashes, no dates or numbers in rule prose, heading unchanged). Notes: what you were unsure about.`
}

const LENSES = [
  { key: 'doc-accuracy', text: 'Documentation accuracy: fetch the cited page or run the cited command and check the harness really says or does what the claim asserts, at the scope asserted. If not, refute.' },
  { key: 'enforcement', text: 'Enforcement reality: a docs recommendation or a warning does not make a mechanical house rule redundant, and a feature scoped to one surface does not cover a rule about another. If the house rule still adds enforcement, scope, or posture, refute and say what to downgrade to.' },
]

function verifyPrompt(t, c, l) {
  return `Adversarially verify one claim about a house rule; try to refute it and default to refuted=true if uncertain.
Item: ${t.key}. Rule: "${c.heading}". Claim: ${c.disposition}, native feature "${c.nativeFeature}". Evidence: ${c.evidence} Citation: ${c.citation}. Proposed action: ${c.action}.
Your lens: ${l.text}
You may read the rule file (${t.path}). Return refuted, a one-paragraph reason, the citation you checked, and downgradeTo if refuted.`
}

function synthPrompt(facts, results) {
  return `Write a short addendum (markdown, plain language, no em dashes) to an audit of the house-rules package against Claude Code's native features, dated ${DATE}. The first audit found no confirmed duplicates or conflicts across 133 items; a completeness critic then named five unresearched areas (MCP configuration and permissioning, output styles, plan mode, headless mode, observability) and one skipped rule. This addendum reports what those areas change.

Facts gathered: ${JSON.stringify(facts)}

Classifications with skeptic votes (a DUPLICATE or CONFLICT is confirmed only if neither skeptic refuted it; otherwise downgrade to the skeptic's downgradeTo, or COMPLEMENT if they disagree): ${JSON.stringify(results)}

Shape: 1. What changed (two sentences). 2. Confirmed duplicates or conflicts, if any, as a table with item, heading, native feature, citation, action, and a resolution sentence. 3. New complements worth a reword, each with the proposed wording. 4. The skipped docs rule's disposition. 5. Facts from these areas that the main report's rewords should cite (for example whether hooks fire headless, whether MCP tool calls reach PreToolUse, what an output style changes), one line each with the citation. 6. Anything still unreachable. Under 700 words.`
}

phase('Gap research')
const facts = (await parallel(AREAS.map(a => () =>
  agent(researchPrompt(a), { label: `research:${a.key}`, phase: 'Gap research', schema: FACTS_SCHEMA, model: 'sonnet' })
))).filter(Boolean)
log(`gap research: ${facts.length}/${AREAS.length} areas, ${facts.reduce((n, f) => n + f.facts.length, 0)} facts, unreachable ${facts.flatMap(f => f.unreachable).length}`)
const factsText = JSON.stringify(facts)
const short = s => String(s).slice(0, 40).replace(/[^A-Za-z0-9 ]/g, '')

const results = await pipeline(TARGETS,
  t => agent(classifyPrompt(t, factsText), { label: `classify:${t.key}`, phase: 'Classify', schema: CLASS_SCHEMA, model: 'opus', effort: 'high' }),
  async (cls, t) => {
    if (!cls) return null
    const claims = cls.rules.filter(r => r.disposition === 'DUPLICATE' || r.disposition === 'CONFLICT')
    log(`${t.key}: ${cls.rules.length} rules, ${claims.length} claims to verify`)
    const verified = await parallel(claims.map(c => () =>
      parallel(LENSES.map(l => () => agent(verifyPrompt(t, c, l), { label: `verify:${t.key}:${short(c.heading)}:${l.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, model: 'sonnet' })))
        .then(vs => ({ heading: c.heading, votes: LENSES.map((l, i) => ({ lens: l.key, ...(vs[i] || { refuted: true, reason: 'skeptic did not return', citation: '', downgradeTo: 'COMPLEMENT' }) })) }))
    ))
    return { ...cls, verified: verified.filter(Boolean) }
  }
)

phase('Addendum')
const clean = results.filter(Boolean)
const addendum = await agent(synthPrompt(facts, clean), { label: 'addendum', phase: 'Addendum', model: 'opus', effort: 'high' })
return { addendum, facts, results: clean }