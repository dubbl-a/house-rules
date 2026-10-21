# Builder tier table: model x majority effort. Run: PROJECT_GLOB='*' python3 -I builder_tier.py
# Extends research/token-cost/scripts/verdicts.py; pairing heuristic unchanged (refuter -> most recent earlier builder in same parent session).
import json, glob, os, collections, re, statistics as st
P = {  # in, w5, w1, read, out per MTok (copied from cost.py)
 'claude-fable-5-1':(10,12.5,20,.25,50),'claude-fable-5':(10,12.5,20,1,50),'claude-opus-5-5':(4,5,8,.2,20),
 'claude-opus-5':(5,6.25,10,.5,25),'claude-opus-4-8':(5,6.25,10,.5,25),'claude-sonnet-5-5':(2,2.5,4,.1,10),'claude-sonnet-5':(2,2.5,4,.2,10)}
roots = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ.get('PROJECT_GLOB', '*')))
BANDS = [('<30', 0, 30), ('30-80', 30, 81), ('>80', 81, 10**9)]
def band(n): return next(b for b, lo, hi in BANDS if lo <= n < hi)
runs = collections.defaultdict(list); seen_global = {}; dup_cross = 0
for f in (f for r in roots for f in glob.glob(r + '/**/subagents/**/*.jsonl', recursive=True)):
    try: t = json.load(open(f[:-6] + '.meta.json')).get('agentType') or ''
    except Exception: continue
    if t not in ('house-rules:builder', 'house-rules:refuter'): continue
    parent = f.split('/subagents/')[0]
    ts0 = None; resp = {}; last_text = ''; handback = ''
    for line in open(f, errors='replace'):
        try: e = json.loads(line)
        except Exception: continue
        if ts0 is None and e.get('timestamp'): ts0 = e['timestamp']
        m = e.get('message') or {}
        if e.get('type') == 'assistant' and isinstance(m, dict):
            for c in m.get('content') or []:
                if not isinstance(c, dict): continue
                if c.get('type') == 'text' and c.get('text'): last_text = c['text']
                elif c.get('type') == 'tool_use' and c.get('name') == 'SubagentHandback': handback = (c.get('input') or {}).get('message') or handback
            u = m.get('usage')
            if not u or not str(m.get('model', '')).startswith('claude'): continue
            cc = u.get('cache_creation') or {}; cw = u.get('cache_creation_input_tokens') or 0
            w1 = cc.get('ephemeral_1h_input_tokens') or 0
            rec = dict(model=m['model'], eff=e.get('effort'), inp=u.get('input_tokens') or 0, w5=cw - w1, w1=w1,
                       rd=u.get('cache_read_input_tokens') or 0, out=u.get('output_tokens') or 0)
            k = (m.get('id'), e.get('requestId'))
            if k not in resp or rec['out'] > resp[k]['out']: resp[k] = rec
    v = None
    if t.endswith('refuter'):
        hits = re.findall(r'## VERDICT[\s*]*(ACCEPT|REWORK)\b', handback or last_text)
        v = hits[-1] if hits else None
    rs = list(resp.values())
    if not (ts0 and rs): continue
    def cost(r):
        p = P.get(r['model'])
        return 0 if not p else (r['inp']*p[0] + r['w5']*p[1] + r['w1']*p[2] + r['rd']*p[3] + r['out']*p[4]) / 1e6
    mdl = collections.Counter(r['model'] for r in rs).most_common(1)[0][0].replace('claude-', '')
    effs = collections.Counter(r['eff'] for r in rs if r['eff'])
    runs[parent].append(dict(ts=ts0, t=t.split(':')[1], model=mdl, v=v, n=len(rs), cost=sum(map(cost, rs)),
        tok=sum(r['inp']+r['w5']+r['w1']+r['rd']+r['out'] for r in rs), eff=effs.most_common(1)[0][0] if effs else None,
        mixed=len(effs) > 1, unpriced=any(r['model'] not in P for r in rs)))
B = []; refcost = []; esc = collections.Counter(); unpaired = 0; nob = 0
for parent, rs in runs.items():
    rs.sort(key=lambda r: r['ts']); lastb = None
    for i, r in enumerate(rs):
        if r['t'] == 'builder': r['first'] = None; r['idx'] = i; B.append(r); lastb = r
        else:
            refcost.append(r['cost'])
            if r['v'] and lastb:
                if lastb['first'] is None:
                    lastb['first'] = r['v']
                    if r['v'] == 'REWORK':
                        nxt = next((x for x in rs[i+1:] if x['t'] == 'builder'), None)
                        esc[(lastb['model'], 'none' if not nxt else 'same' if nxt['model'] == lastb['model'] else 'different:' + nxt['model'])] += 1
            elif r['v']: unpaired += 1
fmt = lambda x: '%.2f' % x
def row(lbl, bs):
    ref = [b for b in bs if b['first']]; rw = sum(b['first'] == 'REWORK' for b in ref); n = len(bs)
    cs = [b['cost'] for b in bs]; flag = ' *' if n < 10 else ''
    return '%-26s n=%3d%s | refuted %3d REWORK %3d rate %3.0f%% | $/build med %s mean %s | tokens med %dk' % (
        lbl, n, flag, len(ref), rw, 100*rw/max(1, len(ref)), fmt(st.median(cs)), fmt(st.mean(cs)), st.median(b['tok'] for b in bs)/1e3)
print('builder runs total %d; no detectable effort %d; mixed-effort runs %d; runs with unpriced model %d; refuter verdicts with no earlier builder %d' % (
    len(B), sum(b['eff'] is None for b in B), sum(b['mixed'] for b in B), sum(b['unpriced'] for b in B), unpaired))
print('(* = n<10)\n== by model ==')
for m in sorted({b['model'] for b in B}): print(row(m, [b for b in B if b['model'] == m]))
print('== by model x majority effort ==')
cells = sorted({(b['model'], b['eff'] or 'none') for b in B})
for m, e in cells: print(row('%s / %s' % (m, e), [b for b in B if b['model'] == m and (b['eff'] or 'none') == e]))
print('== size bands (deduped responses per build) ==')
for bl, _, _ in BANDS:
    print('-- band', bl)
    for m, e in cells:
        bs = [b for b in B if b['model'] == m and (b['eff'] or 'none') == e and band(b['n']) == bl]
        if bs: print(row('%s / %s' % (m, e), bs))
print('== by model x band (all efforts) ==')
for m in sorted({b['model'] for b in B}):
    for bl, _, _ in BANDS:
        bs = [b for b in B if b['model'] == m and band(b['n']) == bl]
        if bs: print(row('%s %s' % (m, bl), bs))
print('median responses per build by cell:')
for m, e in cells:
    print('  %s / %s: %d' % (m, e, st.median(b['n'] for b in B if b['model'] == m and (b['eff'] or 'none') == e)))
print('refuter runs %d  mean cost $%.2f  median $%.2f' % (len(refcost), st.mean(refcost), st.median(refcost)))
print('== escalation after first-verdict REWORK (next builder run in same session) ==')
for k, v in sorted(esc.items()): print(k, v)
