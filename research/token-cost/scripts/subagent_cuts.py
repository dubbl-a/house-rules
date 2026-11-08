"""Three transcript cuts named in research/token-cost/2026-11-08.md ("What to do next").

  1. Same-type parallel launches through the Agent tool: how much of the short-TTL subagent
     write spend sits on first requests that could have read a sibling's cache. Workflow agents
     are reported separately as a control (Claude Code staggers those natively).
  2. Forks from large parents: how a fork is identified in the transcripts, then count, cost,
     parent context and turns per fork. Stops with a statement if forks cannot be identified.
  3. First-request make-up of main sessions on the newest versions: median context, then the
     breakdown by component the transcript allows (characters / 4, an estimate).

    python3 -I subagent_cuts.py [--days 30] [--dir ~/.claude/projects] [--min-version 2.1.319]

Reads only, writes nothing. Prints aggregates: no prompt text, message content, absolute paths
or project names. Total cost follows plugins/house/scripts/cost-report.mjs (same prices, dedupe
by message id plus request id keeping the highest output, window by timestamp, subagent =
a `subagents` path segment or isSidechain). All dollars are list-price estimates.
"""
import argparse, collections, glob, json, os, re, statistics, time
from datetime import datetime
from pathlib import Path

# Copied from PRICES in plugins/house/scripts/cost-report.mjs (dated 2026-10-20).
# Per MTok: input, 5m cache write, 1h cache write, cache read, output.
PRICES = {
    'claude-fable-5-1': (10, 12.5, 20, 0.25, 50), 'claude-fable-5': (10, 12.5, 20, 1, 50),
    'claude-opus-5-5': (4, 5, 8, 0.2, 20), 'claude-opus-5': (5, 6.25, 10, 0.5, 25),
    'claude-opus-4-8': (5, 6.25, 10, 0.5, 25), 'claude-sonnet-5-5': (2, 2.5, 4, 0.1, 10),
    'claude-sonnet-5': (2, 2.5, 4, 0.2, 10), 'claude-haiku-5-5': (0.1, 0.125, 0.2, 0.01, 0.5),
}
HAIKU_LONG = ('claude-haiku-5-5', 100000, (0.5, 0.625, 1, 0.05, 2.5))
FAST = {'claude-opus-5-5': 2, 'claude-opus-5': 2, 'claude-opus-4-8': 2}
US_FACTOR = 1.1

NEAR_ZERO = 1000        # first-request cache read below this many tokens counts as "near zero"
CLUSTER_SECONDS = 10    # fallback grouping: first requests within this many seconds of the group's first
FORK_BIG_PARENT = 200000
FORK_BREAKEVEN_SAME = 10    # turns, from the research note (same model as parent)
FORK_BREAKEVEN_SONNET = 4   # turns, Opus parent versus a Sonnet roster agent
BUILTIN_AGENTS = {'general-purpose', 'Explore', 'Plan', 'claude-code-guide', 'statusline-setup', 'workflow-subagent', 'fork'}
PLUGIN_PREFIX = 'house-rules:'

QS_RE = re.compile(r'"querySource":"([^"]*)"')


def price_row(r):
    p = PRICES.get(r['model'])
    if not p:
        return None
    if r['model'] == HAIKU_LONG[0] and r['in'] + r['w5'] + r['w1'] + r['read'] > HAIKU_LONG[1]:
        p = HAIKU_LONG[2]
    f = FAST.get(r['model'], 1) if r['speed'] == 'fast' else 1
    if r['geo'] == 'us':
        f *= US_FACTOR
    return [x * f for x in p]


def cost_of(r):
    p = price_row(r)
    return 0 if not p else (r['in'] * p[0] + r['w5'] * p[1] + r['w1'] * p[2] + r['read'] * p[3] + r['out'] * p[4]) / 1e6


def write_cost(r):
    p = price_row(r)
    return 0 if not p else (r['w5'] * p[1] + r['w1'] * p[2]) / 1e6


def ctx(r):
    return r['in'] + r['read'] + r['w5'] + r['w1']


def parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except Exception:
        return None


def usd(x):
    return '$%.2f' % x


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def dist(xs, unit=''):
    if not xs:
        return 'n=0'
    return 'n=%d min %s p25 %s median %s p75 %s p90 %s max %s%s' % (
        len(xs), *(('%g' % round(v, 1)) for v in (min(xs), pct(xs, .25), pct(xs, .5), pct(xs, .75), pct(xs, .9), max(xs))), unit)


def label_type(t):
    return t if t in BUILTIN_AGENTS or (t or '').startswith(PLUGIN_PREFIX) else '(custom, other)'


def vtuple(v):
    try:
        return tuple(int(x) for x in v.split('.'))
    except Exception:
        return ()


class Scan:
    skipped = 0   # lines that matched a prefilter but were not valid JSON


def load(path, rel_parts):
    """One pass over one transcript: deduped assistant usage records, Agent tool_use blocks, query sources."""
    in_sub = 'subagents' in rel_parts
    kind = 'main'
    if in_sub:
        kind = 'workflow' if 'workflows' in rel_parts[rel_parts.index('subagents') + 1:] else 'agent'
    reqs, uses, qsrc, shape_fork, n = {}, {}, collections.Counter(), 0, 0
    with open(path, errors='replace') as fh:
        for line in fh:
            if line.startswith('{"type":"api-request'):
                if line.startswith('{"type":"api-request",'):
                    m = QS_RE.search(line)
                    qsrc[m.group(1) if m else '?'] += 1
                elif line.startswith('{"type":"api-request-shape"') and 'forks yourself' in line:
                    shape_fork += 1
                continue
            if '"usage"' not in line and '"name":"Agent"' not in line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                Scan.skipped += 1
                continue
            m = e.get('message') if isinstance(e, dict) else None
            if e.get('type') != 'assistant' or not isinstance(m, dict):
                continue
            mid, rid = m.get('id'), e.get('requestId')
            key = (mid, rid) if mid or rid else (path, n)
            ct = m.get('content')
            if isinstance(ct, list):
                for b in ct:
                    if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') == 'Agent':
                        inp = b.get('input') if isinstance(b.get('input'), dict) else {}
                        uses[b.get('id')] = dict(key=key if mid or rid else None, stype=(inp.get('subagent_type') or '').lower(),
                                                 ts=parse_ts(e.get('timestamp') or ''))
            u = m.get('usage')
            if not isinstance(u, dict) or m.get('model') == '<synthetic>':
                continue
            n += 1
            cc = u.get('cache_creation') or {}
            cw = u.get('cache_creation_input_tokens') or 0
            w1 = cc.get('ephemeral_1h_input_tokens') or 0
            rec = dict(file=path, kind=kind if in_sub else ('sidechain' if e.get('isSidechain') is True else 'main'),
                       model=m.get('model'), ts=parse_ts(e.get('timestamp') or ''), out=u.get('output_tokens') or 0,
                       w5=cw - w1, w1=w1, read=u.get('cache_read_input_tokens') or 0, speed=u.get('speed'),
                       geo=u.get('inference_geo'), ref=e.get('requestRef'), **{'in': u.get('input_tokens') or 0})
            if key not in reqs or rec['out'] > reqs[key]['out']:
                reqs[key] = rec
    return reqs, uses, qsrc, shape_fork


def read_meta(path):
    try:
        with open(path[:-len('.jsonl')] + '.meta.json') as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


# ---------------------------------------------------------------- cut 1

def group_stats(groups):
    """Stats over groups (lists of agents) of same-type, same-model agents launched together."""
    s = dict(groups=0, agents=0, first_write=0.0, later=0, later_zero=0, later_near=0, first_near=0, save=0.0, gaps=[], sizes=[])
    for g in groups:
        g.sort(key=lambda a: (a['first']['ts'], a['id']))
        smin = min(ctx(a['first']) for a in g)
        s['groups'] += 1
        s['agents'] += len(g)
        s['sizes'].append(len(g))
        for i, a in enumerate(g):
            r = a['first']
            s['first_write'] += write_cost(r)
            if i == 0:
                s['first_near'] += r['read'] < NEAR_ZERO
                continue
            s['later'] += 1
            s['later_zero'] += r['read'] == 0
            s['later_near'] += r['read'] < NEAR_ZERO
            s['gaps'].append(r['ts'] - g[0]['first']['ts'])
            w, p = r['w5'] + r['w1'], price_row(r)
            if w and p:
                s['save'] += min(w, smin) * ((r['w5'] * p[1] + r['w1'] * p[2]) / w - p[3]) / 1e6
    return s


def print_group_stats(label, s, show_save=True):
    print('  %s' % label)
    if not s['groups']:
        print('    no groups of 2 or more')
        return
    print('    groups %d, agents %d (group size median %g, max %d)' % (s['groups'], s['agents'], statistics.median(s['sizes']), max(s['sizes'])))
    print('    cache-write dollars on those agents\' first requests: %s' % usd(s['first_write']))
    print('    later-launched agents: %d; first request cache read zero: %d, under %d tokens: %d (%.0f%%)' % (
        s['later'], s['later_zero'], NEAR_ZERO, s['later_near'], 100 * s['later_near'] / max(1, s['later'])))
    print('    first-launched agents with first-request read under %d tokens: %d of %d' % (NEAR_ZERO, s['first_near'], s['groups']))
    print('    launch gap of later agents behind the first (s): %s' % dist(s['gaps']))
    if show_save:
        print('    upper-bound saving: %s' % usd(s['save']))


def cluster(agents):
    """Chain agents (already one session/type/model) into clusters whose first requests fall within CLUSTER_SECONDS of the cluster's first."""
    agents = sorted(agents, key=lambda a: (a['first']['ts'], a['id']))
    out, cur = [], []
    for a in agents:
        if cur and a['first']['ts'] - cur[0]['first']['ts'] > CLUSTER_SECONDS:
            out.append(cur)
            cur = []
        cur.append(a)
    if cur:
        out.append(cur)
    return out


def cut1(agents, uses, den):
    print('\n== Cut 1: same-type parallel launches through the Agent tool ==')
    pool = [a for a in agents if a['kind'] == 'agent' and not a['is_fork']]
    work = [a for a in agents if a['kind'] == 'workflow']
    print('Agents whose first request is in the window: Agent-tool %d (forks excluded), workflow %d.' % (len(pool), len(work)))
    linked = collections.defaultdict(list)
    unlinked = []
    for a in pool:
        u = uses.get(a['meta'].get('toolUseId'))
        if u and u['key']:
            linked[(u['key'], a['type'], a['model'])].append(a)
        else:
            unlinked.append(a)
    ga = [g for g in linked.values() if len(g) >= 2]
    by_sess = collections.defaultdict(list)
    for a in unlinked:
        by_sess[(a['session'], a['type'], a['model'])].append(a)
    gb = [g for v in by_sess.values() for g in cluster(v) if len(g) >= 2]
    by_all = collections.defaultdict(list)
    for a in pool:
        by_all[(a['session'], a['type'], a['model'])].append(a)
    gx = [g for v in by_all.values() for g in cluster(v) if len(g) >= 2]
    print('Methods (agent = one subagent transcript; group = 2+ agents of the same type and model):')
    print('  A. tool_use link: the agent\'s meta toolUseId resolves to an Agent tool_use block in a parent transcript, and agents sharing')
    print('     one parent assistant message form a group. Linked: %d of %d agents; grouped by A: %d agents in %d groups.' % (
        len(pool) - len(unlinked), len(pool), sum(map(len, ga)), len(ga)))
    print('  B. fallback for agents with no resolvable link (%d): same session, type and model, first requests within %ds of the' % (len(unlinked), CLUSTER_SECONDS))
    print('     cluster\'s first. Grouped by B: %d agents in %d groups.' % (sum(map(len, gb)), len(gb)))
    print('  Cross-check, B applied to all %d Agent-tool agents: %d agents in %d groups (A+B used below: %d agents in %d groups).' % (
        len(pool), sum(map(len, gx)), len(gx), sum(map(len, ga)) + sum(map(len, gb)), len(ga) + len(gb)))
    print('Results (Agent-tool agents):')
    print_group_stats('Method A groups', group_stats(ga))
    print_group_stats('Method B groups', group_stats(gb))
    used = group_stats(ga + gb)
    print_group_stats('A+B used (headline)', used)
    ing = {id(a) for g in ga + gb for a in g}
    solo = [a for a in pool if id(a) not in ing]
    near = sum(a['first']['read'] < NEAR_ZERO for a in solo)
    print('  Context: Agent-tool agents in no group: %d, with first-request read under %d tokens: %d (%.0f%%)' % (
        len(solo), NEAR_ZERO, near, 100 * near / max(1, len(solo))))
    byt = collections.defaultdict(lambda: [0, 0, 0.0])
    for g in ga + gb:
        t = byt[label_type(g[0]['type'])]
        t[0] += 1
        t[1] += len(g)
        t[2] += sum(write_cost(a['first']) for a in g)
    for t, (ng, na, wc) in sorted(byt.items(), key=lambda x: -x[1][2]):
        print('    by type %-24s groups %3d, agents %3d, first-request write %s' % (t, ng, na, usd(wc)))
    print('Control, workflow agents (Claude Code staggers a fan-out natively):')
    by_phase = collections.defaultdict(list)
    for a in work:
        by_phase[(a['session'], a['run'], a['meta'].get('workflowPhase'), a['type'], a['model'])].append(a)
    print_group_stats('Groups = same run, phase, type and model', group_stats([g for g in by_phase.values() if len(g) >= 2]), False)
    print_group_stats('Same, split into %ds clusters (comparable to method B)' % CLUSTER_SECONDS,
                      group_stats([g for v in by_phase.values() for g in cluster(v) if len(g) >= 2]), False)
    print('Denominators (window, all subagent requests):')
    print('  total cost %s; subagent %s (Agent-tool %s, workflow %s, other sidechain %s)' % (
        usd(den['total']), usd(den['sub']), usd(den['agent']), usd(den['workflow']), usd(den['sidechain'])))
    print('  subagent cache-write dollars: 5-minute TTL %s (the "short-TTL" figure), 1-hour TTL %s' % (usd(den['w5']), usd(den['w1'])))
    print('  headline upper-bound saving is %.1f%% of 5-minute subagent write dollars and %.2f%% of total cost' % (
        100 * used['save'] / max(1e-9, den['w5']), 100 * used['save'] / max(1e-9, den['total'])))
    print('Assumptions: first request = earliest deduped request in the agent transcript; "later-launched" = after the first by first-request')
    print('  timestamp; saving = per later agent, min(tokens it wrote, smallest first-request context in its group) x (its blended write price')
    print('  minus its read price), assuming the first agent finished its write before the others started and the prefix is shared. It is an')
    print('  upper bound: it ignores agents that already read some cache, and stagger delay costs wall-clock time. Same type does not prove')
    print('  an identical prefix (the prompt differs). Linking relies on meta toolUseId, an internal field.')


# ---------------------------------------------------------------- cut 2

def cut2(agents, uses, best, qsrc_all, shape_fork_files, since):
    print('\n== Cut 2: forks from large parents ==')
    stypes = collections.Counter()
    for u in uses.values():
        if u['ts'] is not None and u['ts'] >= since:
            stypes[label_type(u['stype']) if u['stype'] else '(omitted)'] += 1
    fork_uses = sum(1 for u in uses.values() if u['stype'] == 'fork' and u['ts'] is not None and u['ts'] >= since)
    meta_forks = sum(1 for a in agents if (a['type'] or '').lower() == 'fork')
    qs_forks = sum(v for k, v in qsrc_all.items() if 'fork' in k.lower())
    pool = [a for a in agents if a['kind'] == 'agent' and not a['is_fork']]
    big = [a for a in pool if ctx(a['first']) >= 100000]
    print('How a fork is identified: the Agent tool schema in the transcripts says `subagent_type: "fork"` forks the caller (inherits its full')
    print('context, always runs on the caller\'s model), and any other type or an omitted type starts a fresh agent. So the identifier is')
    print('an Agent tool_use block with subagent_type "fork", linked to its subagent transcript by meta toolUseId.')
    print('Evidence checked (window):')
    print('  sessions whose recorded Agent tool schema advertises fork: %d files' % shape_fork_files)
    print('  Agent tool_use blocks by subagent_type: %s' % ', '.join('%s %d' % kv for kv in stypes.most_common()))
    print('  Agent tool_use blocks with subagent_type "fork": %d' % fork_uses)
    print('  subagent meta files with agentType "fork": %d' % meta_forks)
    print('  api-request querySource values containing "fork": %d (all-window query sources: %s)' % (
        qs_forks, ', '.join('%s %d' % (k, v) for k, v in sorted(Counter_class(qsrc_all).items(), key=lambda x: -x[1]))))
    print('  Agent-tool agents whose first request is >= 100k tokens of context (a large inherited prefix would show here): %d of %d' % (len(big), len(pool)))
    forks = [a for a in agents if a['is_fork']]
    if not forks:
        print('RESULT: not measurable. Zero forks were launched in the window: the schema offers the fork type, but no Agent call used it, and')
        print('no subagent transcript is marked as a fork. Spend from forks is $0.00 here, and break-even turns cannot be checked. Stopping this cut')
        print('rather than inferring forks from first-request size (a heuristic would also catch ordinary large-brief agents).')
        return
    cost = collections.Counter()
    turns = collections.defaultdict(list)
    over = collections.Counter()
    for a in forks:
        u = uses.get(a['meta'].get('toolUseId'))
        pr = best.get(u['key']) if u and u['key'] else None
        band = 'unknown parent' if not pr else ('parent >= 200k' if ctx(pr) >= FORK_BIG_PARENT else 'parent < 200k')
        cost[band] += sum(cost_of(r) for r in a['reqs'] if r['ts'] is not None and r['ts'] >= since)
        turns[band].append(len(a['reqs']))
        over[(band, 'same')] += len(a['reqs']) > FORK_BREAKEVEN_SAME
        if pr and 'opus' in (pr['model'] or ''):
            over[(band, 'sonnet')] += len(a['reqs']) > FORK_BREAKEVEN_SONNET
    print('RESULT: %d forks (%s total)' % (len(forks), usd(sum(cost.values()))))
    for band in sorted(turns):
        print('  %s: %d forks, %s; turns per fork %s; past %d turns (same-model break-even): %d; Opus-parent forks past %d turns (vs a Sonnet agent): %d' % (
            band, len(turns[band]), usd(cost[band]), dist(turns[band]), FORK_BREAKEVEN_SAME, over[(band, 'same')],
            FORK_BREAKEVEN_SONNET, over[(band, 'sonnet')]))
    print('Assumptions: parent context = input + cache read + cache write of the parent request that issued the Agent call; turns = deduped')
    print('  requests in the fork transcript; cost counts requests in the window only; break-even turns are the research note\'s arithmetic.')


def Counter_class(c):
    out = collections.Counter()
    for k, v in c.items():
        if k.startswith('agent:builtin:'):
            out['agent:builtin:*'] += v
        elif k.startswith('agent:custom:'):
            out['agent:custom:*'] += v
        else:
            out[k] += v
    return out


# ---------------------------------------------------------------- cut 3

OTHER, SYS, TOOLS = 'other harness text', 'system prompt', 'tool definitions'
C_DEFER, C_RULES, C_MEM = 'deferred tool list', 'CLAUDE.md and rules', 'auto-memory'
C_HOUSE, C_SS, C_SKILLS = 'house-orchestration (SessionStart)', 'SessionStart other', 'skills listing'
C_ROSTER, C_MCP, C_ENV = 'agent roster', 'MCP server instructions', 'environment'
C_CTX, C_USER = 'session context, git status, attribution', 'user prompt and other'
ORDER = [SYS, TOOLS, C_DEFER, C_RULES, C_MEM, C_HOUSE, C_SS, C_SKILLS, C_ROSTER, C_MCP, C_ENV, C_CTX, C_USER, OTHER]
SYSTEM_MARKERS = [
    (C_HOUSE, re.compile(r'<house-orchestration>')), ('end-house', re.compile(r'</house-orchestration>')),
    (C_ENV, re.compile(r'^# Environment$', re.M)), (C_DEFER, re.compile(r'The following deferred tools are now available via ToolSearch')),
    (C_ROSTER, re.compile(r'Available agent types for the Agent tool')), (C_MCP, re.compile(r'^# MCP Server Instructions$', re.M)),
    (C_SKILLS, re.compile(r'The following skills are available for use with the Skill tool')), (OTHER, re.compile(r'^## Exited Plan Mode', re.M)),
]
USER_MARKERS = [m for m in SYSTEM_MARKERS if m[0] in (C_DEFER, C_ROSTER, C_SKILLS)]


def segment(text, markers, default):
    """Split text at the first occurrence of each marker into (label, text) segments. The house-orchestration
    segment runs from its open tag through its close tag; text after the close tag reverts to SessionStart other."""
    marks = []
    for label, rx in markers:
        m = rx.search(text)
        if m:
            marks.append((m.end() if label == 'end-house' else m.start(), label))
    marks.sort()
    out, cur, pos = [], default, 0
    for start, label in marks:
        out.append((cur, text[pos:start]))
        cur, pos = (C_SS if label == 'end-house' else label), start
    out.append((cur, text[pos:]))
    return out


def classify(first):
    """Chars per component for one first request, plus house-attributable chars. None when a blob is missing."""
    comp, house = collections.Counter(), collections.Counter()
    sysb = first['shape'].get('system')
    comp[SYS] += sum(len(b.get('text') or '') for b in sysb if isinstance(b, dict)) if isinstance(sysb, list) else len(sysb or '')
    comp[TOOLS] += len(json.dumps(first['shape'].get('tools') or [], separators=(',', ':')))
    for m in first['msgs']:
        c = m.get('content')
        c = [{'type': 'text', 'text': c}] if isinstance(c, str) else (c or [])
        for b in c:
            if not isinstance(b, dict):
                continue
            if b.get('type') != 'text':
                comp[TOOLS if b.get('type') == 'tool_addition' else C_USER] += len(json.dumps(b, separators=(',', ':')))
                continue
            t = b.get('text') or ''
            if m.get('role') == 'system':
                segs = segment(t, SYSTEM_MARKERS, C_SS if t.startswith('SessionStart') else OTHER)
            elif t.startswith('<system-reminder>\nCodebase and user instructions'):
                for part in re.split(r'(?m)^(?=Contents of )', t):
                    head = part.split('\n', 1)[0]
                    if part.startswith('Contents of ') and 'auto-memory' in head:
                        comp[C_MEM] += len(part)
                    else:
                        comp[C_RULES] += len(part)
                        if part.startswith('Contents of ') and '/rules/house/' in head:
                            house['rules'] += len(part)
                continue
            elif t.startswith('<system-reminder>\nAs you answer the user') or t.startswith('<system-reminder>\nAttribution for git'):
                comp[C_CTX] += len(t)
                continue
            else:
                segs = segment(t, USER_MARKERS, C_USER)
            for lab, seg in segs:
                comp[lab] += len(seg)
                if lab in (C_ROSTER, C_SKILLS):
                    house['entries'] += sum(len(x) for x in re.split(r'\n(?=- )', seg) if x.startswith('- ' + PLUGIN_PREFIX))
                if lab == C_HOUSE:
                    house['orchestration'] += len(seg)
    return comp, house


def first_main_request(path):
    """The first main-thread api-request in a transcript with its shape and message blobs, or None."""
    blobs, shapes = {}, {}
    with open(path, errors='replace') as fh:
        for line in fh:
            try:
                if line.startswith('{"type":"api-request-blob"'):
                    e = json.loads(line)
                    blobs[e['hash']] = e['message']
                elif line.startswith('{"type":"api-request-shape"'):
                    e = json.loads(line)
                    shapes[e['shapeHash']] = e['shape']
                elif line.startswith('{"type":"api-request",'):
                    e = json.loads(line)
                    qs = e.get('querySource') or ''
                    if not (qs.startswith('repl_main_thread') or qs == 'sdk'):
                        continue
                    tail = e.get('tail') or []
                    msgs = [blobs.get(h) for h in tail]
                    shape = shapes.get(e.get('shapeHash'))
                    ok = shape is not None and all(isinstance(m, dict) for m in msgs)
                    return dict(id=e.get('id'), version=e.get('version') or '', qs=qs, ts=parse_ts(e.get('timestamp') or ''),
                                tail=len(tail), keep=e.get('keep') or 0, shape=shape, msgs=msgs if ok else None)
            except Exception:
                Scan.skipped += 1
    return None


def cut3(main_files, byref, since, min_version):
    print('\n== Cut 3: first-request make-up of main sessions ==')
    firsts = []
    for f in main_files:
        r = first_main_request(f)
        if r and r['ts'] is not None and r['ts'] >= since:
            rec = byref.get(r['id'])
            r['rec'] = rec if rec else None
            firsts.append(r)
    vers = collections.Counter(r['version'] for r in firsts)
    print('Main sessions with a first request in the window: %d. Newest versions: %s' % (
        len(firsts), ', '.join('%s %d' % (v, n) for v, n in sorted(vers.items(), key=lambda x: vtuple(x[0]), reverse=True)[:6])))
    sel = [r for r in firsts if vtuple(r['version']) >= vtuple(min_version)]
    note = 'version >= %s' % min_version
    if not sel and vers:
        top = max(vers, key=vtuple)
        sel, note = [r for r in firsts if r['version'] == top], 'newest version in the window (%s); none at %s' % (top, min_version)
    print('Selected: %s, n=%d' % (note, len(sel)))
    totals = [ctx(r['rec']) for r in sel if r['rec']]
    unlinked = len(sel) - len(totals)
    for label, rows in (('all selected', sel), ('fresh starts only (first request carries 3 or fewer new messages)', [r for r in sel if r['tail'] <= 3])):
        t = [ctx(r['rec']) for r in rows if r['rec']]
        if t:
            print('  First-request total context (input + cache read + cache write), %s: median %d, p10 %d, p90 %d, n=%d' % (
                label, pct(t, .5), pct(t, .1), pct(t, .9), len(t)))
        else:
            print('  First-request total context, %s: n=0' % label)
    if unlinked:
        print('  (%d selected sessions had no assistant usage record linked to the first api-request and are left out of those totals)' % unlinked)
    rows = [r for r in sel if r['rec'] and r['msgs'] is not None and r['tail'] <= 3]
    print('Breakdown (characters / 4, an estimate; JSON for tool definitions), fresh starts with all request blobs present: n=%d' % len(rows))
    if not rows:
        print('  cannot be measured: no selected session has its first request fully recorded (api-request-shape plus message blobs).')
        return
    per = []
    for r in rows:
        comp, house = classify(r)
        per.append((comp, house, ctx(r['rec'])))
    med = lambda xs: statistics.median(xs) if xs else 0
    tot_med = med([t for _, _, t in per])
    print('  median measured total for these sessions: %d tokens' % tot_med)
    for lab in ORDER:
        v = med([c[lab] / 4 for c, _, _ in per])
        if v:
            print('    %-42s %7d tokens (%4.1f%% of measured median)' % (lab, v, 100 * v / tot_med))
    est = med([sum(c.values()) / 4 for c, _, _ in per])
    gap = med([t - sum(c.values()) / 4 for c, _, t in per])
    print('    %-42s %7d tokens (median of per-session sums)' % ('estimated total', est))
    print('    %-42s %7d tokens (median of measured minus estimated: prompt-wrapping tokens, estimate error, anything not in the transcript)' % ('remainder', gap))
    hs = [h['orchestration'] / 4 + h['rules'] / 4 + h['entries'] / 4 for _, h, _ in per]
    print('Who controls it (median per session, tokens):')
    print('  house plugin can change: %d  (house-orchestration %d, house rule files in CLAUDE.md/rules %d, house-prefixed agent roster and skill entries %d)' % (
        med(hs), med([h['orchestration'] / 4 for _, h, _ in per]), med([h['rules'] / 4 for _, h, _ in per]), med([h['entries'] / 4 for _, h, _ in per])))
    user = [(c[C_RULES] + c[C_MEM] + c[C_MCP] + c[C_DEFER] + c[C_SKILLS] + c[C_ROSTER]) / 4 - h['rules'] / 4 - h['entries'] / 4 for c, h, _ in per]
    harn = [(c[SYS] + c[TOOLS] + c[C_ENV] + c[C_CTX] + c[C_SS] + c[OTHER] + c[C_USER]) / 4 for c, _, _ in per]
    print('  user and adopter config, not house (CLAUDE.md, memory, MCP servers and their deferred tools, non-house skills and agents): %d' % med(user))
    print('  harness (system prompt, built-in tool definitions, environment, git status, other): %d, plus the unattributed remainder above' % med(harn))
    print('Assumptions: the first api-request with querySource repl_main_thread or sdk; chars / 4; component order and markers come from text')
    print('  patterns in the recorded request (system-role block split at "# Environment", the deferred-tools and agent-roster and skills')
    print('  paragraphs, "# MCP Server Instructions"), so a harness text change can move text between buckets; house-prefixed entries are those')
    print('  starting "- %s"; the user prompt is in "user prompt and other"; the make-up is one user\'s setup, not an adopter average.' % PLUGIN_PREFIX)


# ---------------------------------------------------------------- main

def main():
    base = os.environ.get('CLAUDE_CONFIG_DIR') or str(Path.home() / '.claude')
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=float, default=30)
    ap.add_argument('--dir', default=os.path.join(base, 'projects'))
    ap.add_argument('--min-version', default='2.1.319')
    a = ap.parse_args()
    root = os.path.expanduser(a.dir)
    since = time.time() - a.days * 86400
    files = [f for f in glob.glob(os.path.join(root, '**', '*.jsonl'), recursive=True) if os.path.getmtime(f) >= since]
    loaded, uses, qsrc_all, shape_fork_files = {}, {}, collections.Counter(), 0
    for f in files:
        reqs, u, qs, sf = load(f, Path(os.path.relpath(f, root)).parts)
        loaded[f] = reqs
        uses.update(u)
        qsrc_all.update(qs)
        shape_fork_files += sf > 0
    best = {}
    for reqs in loaded.values():
        for k, r in reqs.items():
            if k not in best or r['out'] > best[k]['out']:
                best[k] = r
    inwin = lambda r: r['ts'] is not None and r['ts'] >= since
    den = collections.Counter()
    nreq = 0
    for r in best.values():
        if not inwin(r):
            continue
        nreq += 1
        c = cost_of(r)
        den['total'] += c
        if r['kind'] != 'main':
            den['sub'] += c
            den[r['kind']] += c
            p = price_row(r)
            if p:
                den['w5'] += r['w5'] * p[1] / 1e6
                den['w1'] += r['w1'] * p[2] / 1e6
    # Agent transcripts: meta plus first request.
    agents = []
    for f, reqs in loaded.items():
        parts = Path(os.path.relpath(f, root)).parts
        if 'subagents' not in parts:
            continue
        i = parts.index('subagents')
        kind = 'workflow' if 'workflows' in parts[i + 1:] else 'agent'
        recs = sorted((r for r in reqs.values() if r['ts'] is not None and r['model'] in PRICES), key=lambda r: r['ts'])
        if not recs or recs[0]['ts'] < since:
            continue
        meta = read_meta(f)
        t = meta.get('agentType') or ''
        u = uses.get(meta.get('toolUseId'))
        agents.append(dict(id=parts[-1], kind=kind, session=parts[i - 1], run='/'.join(parts[i + 1:-1]), meta=meta, type=t,
                           model=recs[0]['model'], first=recs[0], reqs=recs,
                           is_fork=t.lower() == 'fork' or bool(u and u['stype'] == 'fork')))
    print('Subagent cuts over the last %g days (list-price estimates; aggregates only).' % a.days)
    print('Files read: %d; deduped requests in window: %d; malformed lines skipped: %d' % (len(files), nreq, Scan.skipped))
    print('Total cost in window: %s (main %s, subagent %s: Agent-tool %s, workflow %s, other sidechain %s)' % (
        usd(den['total']), usd(den['total'] - den['sub']), usd(den['sub']), usd(den['agent']), usd(den['workflow']), usd(den['sidechain'])))
    print('Reconcile with: node plugins/house/scripts/cost-report.mjs --since %gd' % a.days)
    cut1(agents, uses, den)
    cut2(agents, uses, best, qsrc_all, shape_fork_files, since)
    byref = {r['ref']: r for r in best.values() if r.get('ref')}
    main_files = [f for f in files if 'subagents' not in Path(os.path.relpath(f, root)).parts]
    cut3(main_files, byref, since, a.min_version)
    print('\nMalformed lines skipped in total: %d' % Scan.skipped)


if __name__ == '__main__':
    main()
