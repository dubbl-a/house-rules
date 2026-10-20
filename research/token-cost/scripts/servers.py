import json, glob, os, collections, re
roots = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + ''))
calls = collections.Counter(); sessions = collections.defaultdict(set); skills = collections.Counter(); last = {}
for f in (f for r in roots for f in glob.glob(r + '/**/*.jsonl', recursive=True)):
    sess = f.split('/subagents/')[0].rsplit('/', 1)[-1] if '/subagents/' in f else os.path.basename(f)[:-6]
    for line in open(f, errors='replace'):
        if '"tool_use"' not in line: continue
        try: e = json.loads(line)
        except Exception: continue
        m = e.get('message') or {}
        if not isinstance(m, dict): continue
        for c in m.get('content') or []:
            if not isinstance(c, dict) or c.get('type') != 'tool_use': continue
            n = c.get('name') or ''
            if n.startswith('mcp__'):
                srv = n.split('__')[1]
                calls[srv] += 1; sessions[srv].add(sess)
                ts = e.get('timestamp') or ''
                if ts > last.get(srv, ''): last[srv] = ts
            elif n == 'Skill':
                skills[(c.get('input') or {}).get('skill', '?')] += 1
print('MCP servers actually called (calls, sessions, last used):')
for s, n in calls.most_common():
    print('  %-34s %5d calls  %3d sessions  last %s' % (s, n, len(sessions[s]), last[s][:10]))
print('Skills invoked:')
for s, n in skills.most_common(25): print('  %-40s %d' % (s, n))
