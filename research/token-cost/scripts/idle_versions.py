import json, glob, os, sys, datetime, collections
# Same rebuild test as resumes.py (live session, >50k cache write, >1h gap), split by Claude Code version and context size.
# --gaps prints one JSON line per rebuild on >= 2.1.299 at >= 200k context (start, end, ctx_k) instead of the table.
P = {'claude-fable-5-1': 20, 'claude-fable-5': 20, 'claude-opus-5-5': 8, 'claude-opus-5': 10, 'claude-opus-4-8': 10, 'claude-sonnet-5-5': 4, 'claude-sonnet-5': 4}
fs = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + '/*.jsonl'))
ts = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
vt = lambda v: tuple(int(x) for x in v.split('.')[:3]) if v and v[0].isdigit() else None
gaps_only = '--gaps' in sys.argv[1:]
out = collections.defaultdict(lambda: [0, 0.0, []]); gaps = []
for f in fs:
    prev = None; resumed = False; seen = set()
    for line in open(f, errors='replace'):
        try: e = json.loads(line)
        except Exception: continue
        if e.get('type') != 'assistant':
            if '"SessionStart' in line or '"source":"resume"' in line or '"resume"' in line:
                if prev is not None: resumed = True
            continue
        m = e.get('message') or {}
        if not isinstance(m, dict) or not m.get('usage') or m.get('model') not in P: continue
        k = (m.get('id'), e.get('requestId'))
        if k in seen: continue
        seen.add(k)
        u = m['usage']; cw = u.get('cache_creation_input_tokens') or 0
        if prev and cw > 50000 and not resumed and (ts(e['timestamp']) - ts(prev)).total_seconds() > 3600:
            v = vt(e.get('version'))
            band = 'unknown version' if v is None else ('>= 2.1.299' if v >= (2, 1, 299) else '< 2.1.299')
            ctx = (u.get('input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0) + cw
            size = '>=200k' if ctx >= 200000 else '<200k'
            o = out[(band, size)]; o[0] += 1; o[1] += cw * P[m['model']] / 1e6; o[2].append(e['timestamp'][:10])
            if band == '>= 2.1.299' and size == '>=200k':
                gaps.append({'start': prev, 'end': e['timestamp'], 'ctx_k': ctx // 1000})
        prev = e.get('timestamp'); resumed = False
if gaps_only:
    for g in gaps: print(json.dumps(g))
else:
    for k in sorted(out):
        n, c, d = out[k]; print('%-16s %-7s %3d rebuilds  $%4.0f  %s..%s' % (k[0], k[1], n, c, min(d), max(d)))
