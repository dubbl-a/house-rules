import json, glob, os, collections
P = {'claude-fable-5-1':(10,12.5,20,.25,50),'claude-fable-5':(10,12.5,20,1,50),'claude-opus-5-5':(4,5,8,.2,20),'claude-opus-5':(5,6.25,10,.5,25),'claude-opus-4-8':(5,6.25,10,.5,25),'claude-sonnet-5-5':(2,2.5,4,.1,10),'claude-sonnet-5':(2,2.5,4,.2,10)}
roots = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + ''))
agg = collections.defaultdict(lambda: [0.0, 0, collections.Counter()])
for f in (f for r in roots for f in glob.glob(r + '/**/subagents/**/*.jsonl', recursive=True)):
    try: t = json.load(open(f[:-6] + '.meta.json')).get('agentType') or '?'
    except Exception: t = 'workflow/other'
    seen = {}
    for line in open(f, errors='replace'):
        if '"usage"' not in line: continue
        try: e = json.loads(line)
        except Exception: continue
        m = e.get('message') or {}
        if e.get('type') != 'assistant' or m.get('model') not in P: continue
        u = m['usage']; cc = u.get('cache_creation') or {}; cw = u.get('cache_creation_input_tokens') or 0; w1 = cc.get('ephemeral_1h_input_tokens') or 0
        p = P[m['model']]
        c = ((u.get('input_tokens') or 0)*p[0] + (cw-w1)*p[1] + w1*p[2] + (u.get('cache_read_input_tokens') or 0)*p[3] + (u.get('output_tokens') or 0)*p[4]) / 1e6
        k = (m.get('id'), e.get('requestId'))
        if k not in seen or c > seen[k][1]: seen[k] = (m['model'], c)
    if not seen: continue
    a = agg[t]; a[1] += 1
    for mdl, c in seen.values(): a[0] += c; a[2][mdl.replace('claude-','')] += c
for t, (c, n, mm) in sorted(agg.items(), key=lambda x: -x[1][0])[:14]:
    print('%-34s runs %4d  $%6.0f  %s' % (t, n, c, {k: round(v) for k, v in mm.most_common(3)}))
