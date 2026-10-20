import json, glob, os, collections, datetime
P = {'claude-fable-5-1':(10,12.5,20,.25,50),'claude-fable-5':(10,12.5,20,1,50),'claude-opus-5-5':(4,5,8,.2,20),'claude-opus-5':(5,6.25,10,.5,25),'claude-opus-4-8':(5,6.25,10,.5,25),'claude-sonnet-5-5':(2,2.5,4,.1,10),'claude-sonnet-5':(2,2.5,4,.2,10)}
roots = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + ''))
seen = {}
for f in (f for r in roots for f in glob.glob(r + '/**/*.jsonl', recursive=True)):
    sub = '/subagents/' in f
    for line in open(f, errors='replace'):
        if '"usage"' not in line: continue
        try: e = json.loads(line)
        except Exception: continue
        m = e.get('message') or {}
        if e.get('type') != 'assistant' or not isinstance(m, dict) or not m.get('usage') or m.get('model') not in P: continue
        u = m['usage']; cc = u.get('cache_creation') or {}
        cw = u.get('cache_creation_input_tokens') or 0; w1 = cc.get('ephemeral_1h_input_tokens') or 0
        rec = (u.get('output_tokens') or 0, m['model'], sub, cw-w1, w1, u.get('cache_read_input_tokens') or 0, e.get('timestamp') or '', f)
        k = (m.get('id'), e.get('requestId'))
        if k not in seen or rec[0] > seen[k][0]: seen[k] = rec
R = list(seen.values())
wc = lambda r: (r[3]*P[r[1]][1] + r[4]*P[r[1]][2]) / 1e6
for s in (False, True):
    rs = [r for r in R if r[2] == s]
    print('subagent' if s else 'main', 'cache-write $%.0f' % sum(map(wc, rs)), '1h share of write tokens %.2f' % (sum(r[4] for r in rs)/max(1,sum(r[3]+r[4] for r in rs))))
# main-chain rebuilds: a write of >50k tokens on a turn that is not the first in its file
main = sorted((r for r in R if not r[2]), key=lambda r: (r[7], r[6]))
prev = {}; reb = []; gaps = collections.Counter(); prevmodel = {}
for r in main:
    f = r[7]
    if f in prev and r[3]+r[4] > 50000:
        dt = (datetime.datetime.fromisoformat(r[6].replace('Z','+00:00')) - datetime.datetime.fromisoformat(prev[f].replace('Z','+00:00'))).total_seconds()
        why = 'model switch' if prevmodel[f] != r[1] else ('idle >1h' if dt > 3600 else ('idle 5m-1h' if dt > 300 else 'no idle gap'))
        reb.append((why, wc(r)))
    prev[f] = r[6]; prevmodel[f] = r[1]
agg = collections.defaultdict(lambda: [0, 0.0])
for w, c in reb: agg[w][0] += 1; agg[w][1] += c
print('main rebuilds (>50k write):', {k: (v[0], round(v[1])) for k, v in agg.items()})
