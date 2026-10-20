import json, glob, os, statistics as st
roots = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + ''))
main, sub, subturns = [], [], 0
for f in (f for r in roots for f in glob.glob(r + '/**/*.jsonl', recursive=True)):
    first = None; n = 0
    for line in open(f, errors='replace'):
        if '"usage"' not in line: continue
        try: e = json.loads(line)
        except Exception: continue
        m = e.get('message') or {}
        if e.get('type') != 'assistant' or not isinstance(m, dict) or not m.get('usage') or m.get('model') == '<synthetic>': continue
        u = m['usage']; c = (u.get('input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0)
        if first is None: first = c
        n += 1
    if first is None: continue
    if '/subagents/' in f: sub.append(first); subturns += n
    else: main.append(first)
for name, xs in (('main', main), ('subagent', sub)):
    xs.sort(); print(name, 'n', len(xs), 'first-request context: median', int(st.median(xs)), 'p10', xs[len(xs)//10], 'p90', xs[9*len(xs)//10])
print('subagent responses', subturns)
