# python3 filesdelta.py <site-dir> <published-list.txt>: which files to send in a delta publish.
# published-list.txt: lines "path size" (from the Artifact files listing). Prints a JSON map for `files`
# (new or changed paths -> source) and the published paths that no longer exist locally (to null).
import json, os, sys
site, listing = sys.argv[1], sys.argv[2]
published = {}
for line in open(listing):
    parts = line.split()
    if len(parts) >= 2 and parts[-1].isdigit(): published[parts[0]] = int(parts[-1])
local = {}
for root, _, files in os.walk(site):
    for f in files:
        full = os.path.join(root, f); rel = os.path.relpath(full, site)
        if rel == 'page.html': continue
        local[rel] = os.path.getsize(full)
send = {p: os.path.join(site, p) for p, s in sorted(local.items()) if published.get(p) != s}
gone = sorted(p for p in published if p not in local and p != 'index.html')
total = sum(local[p] for p in send)
print(json.dumps({'send': send, 'null': gone, 'count': len(send), 'mb': round(total / 1e6, 1)}, indent=1))
