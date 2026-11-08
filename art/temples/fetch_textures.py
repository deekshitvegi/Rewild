# python3 -I fetch_textures.py <texture dir>
# Downloads the scanned Poly Haven textures (CC0) that maketemple.py paints with, as <id>_d.jpg (diffuse) and
# <id>_h.jpg (height). They stay out of the repository; their ids are listed in
# public/models/expedition/ATTRIBUTION.md.
import json, os, sys, urllib.request

TEXTURES = {
    'marble_cliff_05': ('2k', 'dh'),       # weathered marble: Greek temple
    'sandstone_blocks_04': ('2k', 'dh'),   # buff sandstone: Nagara temple, kund
    'rock_01': ('2k', 'dh'),               # fine grey stone: granite lanterns and footings, roof tiles
    'rock_surface': ('2k', 'dh'),          # sandy bed under the water in the renders
    'rough_wood': ('2k', 'dh'),            # weathered wood: under the lacquer, floors, doors
    'japanese_cedar_bark': ('2k', 'dh'),   # cypress-bark (hiwadabuki) roof of the honden
    'japanese_sycamore': ('1k', 'd'),      # its peeling-bark pattern masks worn patches of lacquer
    'painted_plaster_wall': ('2k', 'dh'),  # white plaster walls
    'leafy_grass': ('2k', 'd'),            # ground in the renders only
}

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'rewild-temples/1.0 (CC0 texture fetch)')]
urllib.request.install_opener(opener)
KEYS = {'d': 'Diffuse', 'h': 'Displacement'}
for aid, (res, maps) in TEXTURES.items():
    files = json.load(urllib.request.urlopen(f'https://api.polyhaven.com/files/{aid}', timeout=30))
    for m in maps:
        entry = files[KEYS[m]][res]
        url = entry['jpg']['url'] if 'jpg' in entry else entry['png']['url']
        dst = os.path.join(out, f'{aid}_{m}.' + url.rsplit('.', 1)[1])
        if not os.path.exists(dst):
            urllib.request.urlretrieve(url, dst)
        print(aid, m, os.path.getsize(dst), url)
