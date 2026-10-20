import json, glob, os, datetime, collections
P = {'claude-fable-5-1': 20, 'claude-fable-5': 20, 'claude-opus-5-5': 8, 'claude-opus-5': 10, 'claude-opus-4-8': 10, 'claude-sonnet-5-5': 4, 'claude-sonnet-5': 4}
fs = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + '/*.jsonl'))
ts = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
out = collections.defaultdict(lambda: [0, 0.0]); markers = collections.Counter()
for f in fs:
    prev = None; resumed = False; seen = set()
    for line in open(f, errors='replace'):
        try: e = json.loads(line)
        except Exception: continue
        if e.get('type') != 'assistant':
            # anything that marks a session (re)start between two responses
            if '"SessionStart' in line or '"source":"resume"' in line or '"resume"' in line:
                if prev is not None: resumed = True
                for k in ('SessionStart:resume', 'source":"resume', 'SessionStart:startup', 'SessionStart:compact'):
                    if k in line: markers[k] += 1
            continue
        m = e.get('message') or {}
        if not isinstance(m, dict) or not m.get('usage') or m.get('model') not in P: continue
        k = (m.get('id'), e.get('requestId'))
        if k in seen: continue
        seen.add(k)
        u = m['usage']; cw = u.get('cache_creation_input_tokens') or 0
        if prev and cw > 50000 and (ts(e['timestamp']) - ts(prev)).total_seconds() > 3600:
            key = 'after a resume marker' if resumed else 'no resume marker (live session)'
            out[key][0] += 1; out[key][1] += cw * P[m['model']] / 1e6
        prev = e.get('timestamp'); resumed = False
for k, (n, c) in out.items(): print('%-34s %3d rebuilds  $%.0f' % (k, n, c))
print('markers seen:', dict(markers))
