# Waits until each Aha 3D Workshop project reaches a version count (polls project.json).
# Usage: aha-watch.py <projectId>=<min versions> ...
import json, sys, time, os
targets = dict(a.split('=') for a in sys.argv[1:])
root = os.path.expanduser('~/Documents/Aha/Models3D')
deadline = time.time() + 45 * 60
last = None
while time.time() < deadline:
    rows, done = [], 0
    for pid, want in targets.items():
        p = json.load(open(f'{root}/{pid}/project.json'))
        vs = p.get('versions', [])
        failed = [j for j in p.get('jobs', []) if j.get('status') not in ('succeeded', 'running', 'queued', None)]
        if len(vs) >= int(want): done += 1
        rows.append(f"{p['name']} v{len(vs)}/{want}" + (f" failed={len(failed)}" if failed else ''))
    line = ' | '.join(rows)
    if line != last:
        print(time.strftime('%H:%M:%S'), line, flush=True); last = line
    if done == len(targets): break
    time.sleep(20)
