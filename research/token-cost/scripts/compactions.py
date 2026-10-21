import json, glob, os, sys, collections
# Positive control for idle_versions.py: how does compaction appear in the transcripts, and is idle compaction configured?
# Optional arguments: extra settings.json paths to check, besides ~/.claude/settings.json.
fs = glob.glob(os.path.expanduser('~/.claude/projects/' + os.environ['PROJECT_GLOB'] + '/*.jsonl'))
c = collections.Counter()
for f in fs:
    for line in open(f, errors='replace'):
        if 'ompact' not in line: continue
        try: e = json.loads(line)
        except Exception: continue
        c[(e.get('type'), e.get('subtype'))] += 1
print('records mentioning compaction by (type, subtype):', dict(c) or 'none')
for name, p in [('user', '~/.claude/settings.json')] + [('arg %d' % i, a) for i, a in enumerate(sys.argv[1:], 1)]:
    p = os.path.expanduser(p)
    if os.path.exists(p):
        s = json.load(open(p))
        print(name, 'idleCompaction =', s.get('idleCompaction', 'unset'), '| env IDLE:', {k: v for k, v in (s.get('env') or {}).items() if 'IDLE' in k})
print('process env IDLE:', {k: v for k, v in os.environ.items() if 'IDLE' in k})
