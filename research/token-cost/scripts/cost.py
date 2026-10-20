import json, glob, os, collections, datetime
P = {  # in, w5, w1, read, out  per MTok, from platform.claude.com pricing page 2026-10-20
 'claude-fable-5-1':(10,12.5,20,.25,50),'claude-fable-5':(10,12.5,20,1,50),'claude-opus-5-5':(4,5,8,.2,20),
 'claude-opus-5':(5,6.25,10,.5,25),'claude-opus-4-8':(5,6.25,10,.5,25),'claude-sonnet-5-5':(2,2.5,4,.1,10),'claude-sonnet-5':(2,2.5,4,.2,10)}
roots = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + ''))
seen = {}
for f in (f for r in roots for f in glob.glob(r + '/**/*.jsonl', recursive=True)):
    sub = '/subagents/' in f
    for line in open(f, errors='replace'):
        if '"usage"' not in line: continue
        try: e = json.loads(line)
        except Exception: continue
        m = e.get('message') or {}
        if e.get('type') != 'assistant' or not isinstance(m, dict) or not m.get('usage') or m.get('model') == '<synthetic>': continue
        u = m['usage']; cc = u.get('cache_creation') or {}
        cw = u.get('cache_creation_input_tokens') or 0
        w1 = cc.get('ephemeral_1h_input_tokens') or 0; w5 = cw - w1
        rec = (u.get('output_tokens') or 0, m.get('model'), sub or e.get('isSidechain', False), u.get('input_tokens') or 0, w5, w1, u.get('cache_read_input_tokens') or 0, e.get('timestamp') or '')
        k = (m.get('id'), e.get('requestId'))
        if k not in seen or rec[0] > seen[k][0]: seen[k] = rec
def cost(r):
    p = P.get(r[1]); 
    if not p: return 0
    return (r[3]*p[0] + r[4]*p[1] + r[5]*p[2] + r[6]*p[3] + r[0]*p[4]) / 1e6
R = list(seen.values()); unk = {r[1] for r in R if r[1] not in P}
tot = sum(map(cost, R)); print('total $%.0f' % tot, 'unpriced models', unk)
bym = collections.Counter()
for r in R: bym[r[1]] += cost(r)
print({k: round(v) for k, v in bym.most_common()})
main = [r for r in R if not r[2]]; ctx = lambda r: r[3]+r[4]+r[5]+r[6]
mc = sum(map(cost, main))
for t in (2e5, 5e5): print('main cost share ctx>%dk: %.3f' % (t/1e3, sum(cost(r) for r in main if ctx(r) > t)/mc))
print('main $%.0f subagent $%.0f' % (mc, tot-mc))
wk = collections.Counter()
for r in R:
    if r[7]: wk['W%02d' % datetime.date.fromisoformat(r[7][:10]).isocalendar()[1]] += cost(r)
print(sorted((k, round(v)) for k, v in wk.items()))
