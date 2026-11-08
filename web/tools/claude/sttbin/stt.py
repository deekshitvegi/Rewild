import sys
from faster_whisper import WhisperModel
m = WhisperModel('small.en', device='cpu', compute_type='int8')
for p in sys.argv[1:]:
    segs, _ = m.transcribe(p, word_timestamps=True, vad_filter=False, beam_size=5)
    print('==', p)
    for s in segs:
        print(f'  {s.start:6.2f}-{s.end:6.2f} {s.text.strip()}')
