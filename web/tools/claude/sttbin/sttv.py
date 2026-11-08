import sys
from faster_whisper import WhisperModel
m = WhisperModel('small.en', device='cpu', compute_type='int8')
for p in sys.argv[1:]:
    segs, _ = m.transcribe(p, word_timestamps=True, beam_size=5, vad_filter=True, vad_parameters=dict(min_silence_duration_ms=250))
    print('==', p)
    for s in segs:
        print('  ' + ' '.join(f'{w.word.strip()}[{w.start:.2f}-{w.end:.2f}]' for w in s.words))
