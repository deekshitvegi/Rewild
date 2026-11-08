import sys, json
from faster_whisper import WhisperModel
m = WhisperModel('small.en', device='cpu', compute_type='int8')
out = {}
for p in sys.argv[1:]:
    segs, _ = m.transcribe(p, word_timestamps=True, beam_size=5)
    words = [(round(w.start, 2), round(w.end, 2), w.word.strip()) for s in segs for w in s.words]
    out[p] = words
    print('==', p); print('  ' + ' '.join(f'{w}[{a:.2f}-{b:.2f}]' for a, b, w in words))
json.dump(out, open('words.json', 'w'), indent=0)
