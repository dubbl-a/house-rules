# Build blinded judge input for one question: fetch extractions per URL from both arms, plus both final reports.
# usage: python3 -I pairs.py <final-run-dir> <A.output> <B.output> <out-prefix>
import json, os, random, re, sys
run, a_out, b_out, prefix = sys.argv[1:]
arms = {'sonnet': {}, 'haiku': {}}
for f in os.listdir(run):
    if not (f.startswith('agent-') and f.endswith('.meta.json')):
        continue
    meta = json.load(open(os.path.join(run, f)))
    if meta.get('workflowPhase') != 'Fetch':
        continue
    url, res = None, None
    for line in open(os.path.join(run, f.replace('.meta.json', '.jsonl'))):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        c = (r.get('message') or {}).get('content')
        if not isinstance(c, list):
            continue
        for b in c:
            if b.get('type') == 'text' and url is None:
                m = re.search(r'\*\*URL:\*\* +(\S+)', b['text'])
                if m:
                    url = m.group(1)
            if b.get('type') == 'tool_use' and isinstance(b.get('input'), dict) and 'claims' in b['input']:
                res = b['input']
    if url and meta.get('model') in arms:
        arms[meta['model']][url] = res or {'claims': [], 'sourceQuality': 'no-output'}

def report(p):
    o = json.load(open(p))['result']
    return {k: o.get(k) for k in ('summary', 'findings', 'caveats')}

rng = random.Random(prefix)
key, pairs = {}, []
shared = sorted(set(arms['sonnet']) & set(arms['haiku']))
for u in shared:
    s, h = arms['sonnet'][u], arms['haiku'][u]
    if not s['claims'] and not h['claims']:
        continue
    flip = rng.random() < 0.5
    pairs.append({'url': u, 'X': h if flip else s, 'Y': s if flip else h})
    key[u] = 'X=haiku' if flip else 'X=sonnet'
flip = rng.random() < 0.5
ra, rb = report(a_out), report(b_out)
judge = {
    'pairs': pairs,
    'reportX': rb if flip else ra, 'reportY': ra if flip else rb,
    'onlyInOneArm': {'urlsWithClaims': sorted(u for arm in arms.values() for u, r in arm.items() if u not in shared and r['claims'])},
}
key['report'] = 'X=haiku' if flip else 'X=sonnet'
stats = {m: {'fetched': len(d), 'withClaims': sum(1 for r in d.values() if r['claims']),
             'claims': sum(len(r['claims']) for r in d.values())} for m, d in arms.items()}
json.dump(judge, open(prefix + '.judge.json', 'w'), indent=1)
json.dump({'key': key, 'stats': stats, 'shared': len(shared)}, open(prefix + '.key.json', 'w'), indent=1)
print(json.dumps(stats), 'shared urls', len(shared), 'judged pairs', len(pairs))
