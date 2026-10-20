import json, glob, os, collections, re
roots = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + ''))
runs = collections.defaultdict(list)  # parent session -> [(start_ts, type, model_majority, verdict, tokens)]
for f in (f for r in roots for f in glob.glob(r + '/**/subagents/**/*.jsonl', recursive=True)):
    try: t = json.load(open(f[:-6] + '.meta.json')).get('agentType') or ''
    except Exception: continue
    if t not in ('house-rules:builder', 'house-rules:refuter'): continue
    parent = f.split('/subagents/')[0]
    ts0 = None; models = collections.Counter(); last_text = ''; out = 0
    for line in open(f, errors='replace'):
        try: e = json.loads(line)
        except Exception: continue
        if ts0 is None and e.get('timestamp'): ts0 = e['timestamp']
        m = e.get('message') or {}
        if e.get('type') == 'assistant' and isinstance(m, dict):
            if m.get('model', '').startswith('claude'): models[m['model']] += 1
            for c in m.get('content') or []:
                if isinstance(c, dict) and c.get("type") in ("text", "tool_use"): last_text += json.dumps(c.get("text") or c.get("input") or "")
    v = None
    if t.endswith('refuter'):
        hits = re.findall(r'\b(ACCEPT|REWORK)\b', last_text)
        v = hits[-1] if hits else None
    if ts0 and models: runs[parent].append((ts0, t.split(':')[1], models.most_common(1)[0][0].replace('claude-', ''), v, sum(models.values())))
pairs = collections.Counter(); bturns = collections.defaultdict(list)
for parent, rs in runs.items():
    rs.sort(); lastb = None
    for ts, t, mdl, v, n in rs:
        if t == 'builder': lastb = mdl; bturns[mdl].append(n)
        elif v and lastb: pairs[(lastb, v)] += 1
for mdl in sorted({k[0] for k in pairs}):
    a, r = pairs[(mdl, 'ACCEPT')], pairs[(mdl, 'REWORK')]
    print('builder %-12s reviews %3d  ACCEPT %3d  REWORK %3d  rework rate %.0f%%' % (mdl, a + r, a, r, 100 * r / max(1, a + r)))
for mdl, ns in bturns.items(): print('builder %-12s runs %3d  median responses %d' % (mdl, len(ns), sorted(ns)[len(ns)//2]))
