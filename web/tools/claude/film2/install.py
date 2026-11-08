"""Copy the built films into the game and write their captions into films.ts."""
import json, os, shutil
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out2')
REPO = '/home/user/deekshitthvegiportfolio'
NAMES = ['opening-haven', 'opening-solar', 'crossing-out', 'crossing-home']
for n in NAMES:
    for e in ('.mp4', '.webm'):
        shutil.copy(os.path.join(OUT, n + e), os.path.join(REPO, 'public/films', n + e))
def q(s): return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"
def ts(name):
    cues = json.load(open(os.path.join(OUT, name + '.cues.json')))
    return '[\n' + ''.join(f"        {{ at: {c['at']}, end: {c['end']}, who: {q(c['who'])}, text: {q(c['text'])} }},\n" for c in cues) + '    ]'
p = os.path.join(REPO, 'components/expedition/films.ts')
s = open(p).read()
a = s.index('export const FILMS = {')
b = s.index("    'quick-out'")
s = s[:a] + 'export const FILMS = {\n' + ''.join(f"    {q(n)}: {{ src: 'films/{n}', cues: {ts(n)} }},\n" for n in NAMES) + s[b:]
open(p, 'w').write(s)
print('installed', NAMES)
