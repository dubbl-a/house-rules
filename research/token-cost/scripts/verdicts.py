import json, glob, os, collections, re
roots = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + ''))
runs = collections.defaultdict(list)  # parent session -> [(start_ts, type, model_majority, verdict, tokens)]
for f in (f for r in roots for f in glob.glob(r + '/**/subagents/**/*.jsonl', recursive=True)):
    try: t = json.load(open(f[:-6] + '.meta.json')).get('agentType') or ''
    except Exception: continue
    if t not in ('house-rules:builder', 'house-rules:refuter'): continue
    parent = f.split('/subagents/')[0]
    ts0 = None; models = collections.Counter(); last_text = ''; handback = ''
    for line in open(f, errors='replace'):
        try: e = json.loads(line)
        except Exception: continue
        if ts0 is None and e.get('timestamp'): ts0 = e['timestamp']
        m = e.get('message') or {}
        if e.get('type') == 'assistant' and isinstance(m, dict):
            if m.get('model', '').startswith('claude'): models[m['model']] += 1
            for c in m.get('content') or []:
                if not isinstance(c, dict): continue
                if c.get('type') == 'text' and c.get('text'): last_text = c['text']
                elif c.get('type') == 'tool_use' and c.get('name') == 'SubagentHandback': handback = (c.get('input') or {}).get('message') or handback
    v = None
    if t.endswith('refuter'):
        hits = re.findall(r'## VERDICT[\s*]*(ACCEPT|REWORK)\b', handback or last_text)
        v = hits[-1] if hits else None
    if ts0 and models: runs[parent].append((ts0, t.split(':')[1], models.most_common(1)[0][0].replace('claude-', ''), v, sum(models.values())))
pairs = collections.Counter(); firsts = collections.Counter(); builders = collections.Counter(); bturns = collections.defaultdict(list); unpaired = 0
for parent, rs in runs.items():
    rs.sort(); lastb = None; seen = set()
    for i, (ts, t, mdl, v, n) in enumerate(rs):
        if t == 'builder': lastb = (i, mdl); builders[mdl] += 1; bturns[mdl].append(n)
        elif v and lastb:
            pairs[(lastb[1], v)] += 1
            if lastb[0] not in seen: seen.add(lastb[0]); firsts[(lastb[1], v)] += 1
        elif v: unpaired += 1
for mdl in sorted({k[0] for k in pairs}):
    a, r = pairs[(mdl, 'ACCEPT')], pairs[(mdl, 'REWORK')]
    print('builder %-12s reviews %3d  ACCEPT %3d  REWORK %3d  rework rate %.0f%%' % (mdl, a + r, a, r, 100 * r / max(1, a + r)))
print('first verdict per builder, builders launched in brackets')
for mdl in sorted(builders):
    a, r = firsts[(mdl, 'ACCEPT')], firsts[(mdl, 'REWORK')]
    print('builder %-12s [%3d]  refuted %3d  first REWORK %3d  rework rate %.0f%%' % (mdl, builders[mdl], a + r, r, 100 * r / max(1, a + r)))
print('verdicts with no earlier builder in the session: %d' % unpaired)
for mdl, ns in bturns.items(): print('builder %-12s runs %3d  median responses %d' % (mdl, len(ns), sorted(ns)[len(ns)//2]))
