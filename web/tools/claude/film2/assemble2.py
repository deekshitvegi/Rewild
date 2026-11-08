#!/usr/bin/env python3
"""Cut the Seedance 2.5 films together (6 Nov 2026).

python3 assemble2.py <film-name>|all
Writes out2/<name>.mp4 (H.264 + AAC), out2/<name>.webm (VP9 + Opus) and out2/<name>.cues.json.

The crew keep the voices Seedance gave them (their lips move with them). ARGO is never on screen,
so Seedance's ARGO is cut out and the recorded ARGO lines (lines/trim, one voice everywhere,
treated as the ship's computer) are laid in its place. Each clip's audio is matched to one loudness
first; a low rumble runs under everything and swells in the throat. The films fade in from black and
end on their last frame (the player holds it if the world is not ready yet, then fades itself).
"""
import copy, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SD = os.path.join(HERE, 'sd')
LINES = os.path.join(HERE, 'lines', 'trim')
OUT = os.path.join(HERE, 'out2')
os.makedirs(OUT, exist_ok=True)
FPS, W, H = 24, 1280, 720
TARGET_LUFS = -18.0
# The crew's speech inside a clip at TARGET_LUFS sits near -15; ARGO (after its filter) sits just under it.
ARGO_LUFS = -16.5

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(' '.join(cmd)); print(r.stderr[-3000:]); sys.exit(1)
    return r

def dur(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout)

def loudness(path, af=None):
    err = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-vn', '-af', (af + ',' if af else '') + 'ebur128', '-f', 'null', '-']).stderr
    tail = err[err.rfind('Summary:'):]
    return float(tail.split('I:')[1].split('LUFS')[0])

TEXT = {
    'argo-throat': ('ARGO', 'Throat in thirty seconds. Tidal load is rising.'),
    'dev-strapped': ('Dev', 'Everybody strapped in? This is it.'),
    'amara-gravity': ('Amara', "Gravity's climbing fast. Keep her dead centre, Dev."),
    'dev-deadcentre': ('Dev', 'Dead centre. Taking us in.'),
    'argo-entering': ('ARGO', 'Entering the throat.'),
    'kai-hull': ('Kai', "Hull's singing back here! She'll hold, she'll hold!"),
    'noor-light': ('Noor', "Look at the light. It's bending all around us."),
    'argo-3g': ('ARGO', 'Three g. Holding steady.'),
    'amara-other': ('Amara', 'There. The other side.'),
    'dev-out': ('Dev', 'Hold on, everyone. Bringing us out.'),
    'argo-haven': ('ARGO', 'Haven. The only world by TON 618 that can hold life. One day here is ten years on Earth.'),
    'dev-haven': ('Dev', "Haven colony, this is the Argo. We're coming down."),
    'argo-solar': ('ARGO', 'Solar System. Third planet: Earth.'),
    'dev-home': ('Dev', "Home. What's left of it."),
    'amara-back': ('Amara', "Then let's bring it back."),
}
ARGO_FILE = {'argo-throat': '00-argo-throat', 'argo-entering': '04-argo-entering', 'argo-3g': '07-argo-3g',
             'argo-haven': '10-argo-haven', 'argo-solar': '12-argo-solar'}

# Each clip: file, then what is said in it (seconds into the clip, from word timings: faster-whisper
# small.en, checked against the loudness trace). ARGO entries are where OUR line is laid; `mute` is
# where Seedance's own ARGO is cut out; `radio` puts a stretch of the clip's audio through a radio.
CLIPS = {
    'A-out': dict(file='20-crossing-A-out.mp4', mute=[(1.10, 5.30)], said=[
        ('argo-throat', 1.25, None), ('dev-strapped', 5.94, 7.98), ('amara-gravity', 8.74, 11.52), ('dev-deadcentre', 12.32, 14.30)]),
    'A-home': dict(file='21-crossing-A-home.mp4', mute=[(0.70, 5.40)], said=[
        ('argo-throat', 1.00, None), ('dev-strapped', 6.25, 8.55), ('amara-gravity', 9.25, 12.15), ('dev-deadcentre', 12.75, 14.95)]),
    'B': dict(file='22-crossing-B.mp4', mute=[(2.15, 3.62), (10.75, 14.10)], said=[
        ('argo-entering', 2.30, None), ('kai-hull', 3.94, 6.82), ('noor-light', 7.32, 10.42), ('argo-3g', 11.00, None)]),
    # C opens on empty seats and the crew fade in over 3.9 s (a generation fault): start once they are solid.
    'C': dict(file='23-crossing-C.mp4', cut=4.05, said=[('amara-other', 4.50, 6.84), ('dev-out', 7.42, 9.30)]),
    'haven': dict(file='24-opening-haven.mp4', mute=[(0.65, 9.95)], radio=[(10.20, 14.10)], said=[
        ('argo-haven', 0.80, None), ('dev-haven', 10.58, 13.74)]),
    'solar': dict(file='25-opening-solar.mp4', mute=[(0.35, 4.45)], said=[
        ('argo-solar', 0.60, None), ('dev-home', 6.40, 8.96), ('amara-back', 10.40, 11.48)]),
}
FILMS = {
    'crossing-out': (['A-out', 'B', 'C'], 'crossing'),
    'crossing-home': (['A-home', 'B', 'C'], 'crossing'),
    'opening-haven': (['haven'], 'calm'),
    'opening-solar': (['solar'], 'calm'),
}

ARGO_FILTER = 'highpass=f=140,lowpass=f=7500,aecho=0.8:0.55:18|31:0.16|0.10'
RADIO_FILTER = 'highpass=f=300,lowpass=f=3400,acompressor=threshold=0.08:ratio=6:attack=4:release=60,volume=2.2'

def build(name):
    names, bed_kind = FILMS[name]
    clips = [copy.deepcopy(CLIPS[n]) for n in names]  # each film shifts its own copy
    starts, t = [], 0.0
    for c in clips:
        c['path'] = os.path.join(SD, c['file'])
        c['in'] = c.get('cut', 0.0)
        c['dur'] = dur(c['path']) - c['in']
        c['gain'] = TARGET_LUFS - loudness(c['path'])
        # Times below are seconds into the clip as it was generated: shift them to the cut.
        sh = c['in']
        c['said'] = [(k, a - sh, None if b is None else b - sh) for (k, a, b) in c['said']]
        for key in ('mute', 'radio'):
            if key in c: c[key] = [(a - sh, b - sh) for (a, b) in c[key]]
        starts.append(t)
        t += c['dur']
    total = t
    inputs, chains, cues = [], [], []
    # Video: scaled to 1280x720 at 24 fps, joined with hard cuts; fade in from black.
    for i, c in enumerate(clips):
        inputs += ['-ss', f'{c["in"]:.3f}', '-t', f'{c["dur"]:.3f}', '-i', c['path']]
        chains.append(f'[{i}:v]scale={W}:{H}:flags=lanczos,fps={FPS},setsar=1,format=yuv420p[v{i}]')
    chains.append(''.join(f'[v{i}]' for i in range(len(clips))) + f'concat=n={len(clips)}:v=1:a=0,fade=t=in:st=0:d=0.5[v]')
    # Each clip's own audio: loudness matched, Seedance's ARGO cut out (short fades), radio stretches.
    mix = []
    for i, c in enumerate(clips):
        f = f'[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={c["gain"]:.2f}dB'
        for (a, b) in c.get('mute', []):
            # A 120 ms ramp each side of the cut.
            f += f",volume='if(between(t,{a},{b}),0,if(between(t,{a - 0.12},{a}),({a}-t)/0.12,if(between(t,{b},{b + 0.12}),(t-{b})/0.12,1)))':eval=frame"
        if c.get('radio'):
            (a, b) = c['radio'][0]
            f += f'[s{i}];[s{i}]asplit=2[d{i}][r{i}];'
            f += f"[d{i}]volume='if(between(t,{a},{b}),0,1)':eval=frame[dd{i}];"
            f += f"[r{i}]{RADIO_FILTER},volume='if(between(t,{a},{b}),1,0)':eval=frame[rr{i}];"
            f += f'[dd{i}][rr{i}]amix=inputs=2:normalize=0'
        f += (f',atrim=0:{c["dur"]:.3f},afade=t=in:d=0.04,afade=t=out:st={c["dur"] - 0.04:.3f}:d=0.04'
              f',apad=whole_dur={c["dur"]:.3f}[c{i}]')
        chains.append(f)
    chains.append(''.join(f'[c{i}]' for i in range(len(clips))) + f'concat=n={len(clips)}:v=0:a=1[own]')
    mix.append('[own]')
    # Our ARGO lines, and the captions.
    n_in = len(clips)
    for i, c in enumerate(clips):
        for (key, a, b) in c['said']:
            who, text = TEXT[key]
            at = starts[i] + a
            if key in ARGO_FILE:
                p = os.path.join(LINES, ARGO_FILE[key] + '.wav')
                d = dur(p)
                inputs += ['-i', p]
                ms = int(at * 1000)
                g = ARGO_LUFS - loudness(p, 'aformat=channel_layouts=stereo,' + ARGO_FILTER)
                chains.append(f'[{n_in}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={g:.2f}dB,{ARGO_FILTER},adelay={ms}|{ms},apad[g{n_in}]')
                mix.append(f'[g{n_in}]')
                n_in += 1
                end = at + d
            else:
                end = starts[i] + b
            cues.append({'at': round(at - 0.1, 2), 'end': round(end + 0.5, 2), 'who': who, 'text': text})
    cues.sort(key=lambda q: q['at'])
    for q, nxt in zip(cues, cues[1:]):
        q['end'] = round(min(q['end'], nxt['at'] - 0.05), 2)
    # The bed: brown-noise rumble. A crossing swells through the throat (clip B) with a whoosh at the
    # way in; an opening is a low, calm hum.
    if bed_kind == 'crossing':
        b0, b1 = starts[1], starts[2]
        expr = f'if(lt(t,{b0}),0.22+0.18*t/{b0},if(lt(t,{b1}),0.75,max(0.18,0.75-(t-{b1})*0.08)))'
        chains.append(f"anoisesrc=color=brown:sample_rate=48000:amplitude=0.5:duration={total:.2f},lowpass=f=120,highpass=f=24,"
                      f"volume='{expr}':eval=frame,aformat=channel_layouts=stereo[bed]")
        w0 = int((b0 - 1.2) * 1000)
        chains.append(f'anoisesrc=color=pink:sample_rate=48000:amplitude=0.35:duration=2.0,highpass=f=300,lowpass=f=5000,'
                      f'afade=t=in:d=1.2,afade=t=out:st=1.2:d=0.8,adelay={w0}|{w0},apad,aformat=channel_layouts=stereo[whoosh]')
        mix += ['[bed]', '[whoosh]']
    else:
        chains.append(f'anoisesrc=color=brown:sample_rate=48000:amplitude=0.18:duration={total:.2f},lowpass=f=200,highpass=f=28,'
                      f'afade=t=in:d=1.2,aformat=channel_layouts=stereo[bed]')
        mix.append('[bed]')
    chains.append(''.join(mix) + f'amix=inputs={len(mix)}:normalize=0:duration=first,alimiter=limit=0.9:level=false,afade=t=in:d=0.3[aout]')
    graph = ';'.join(chains)
    base = os.path.join(OUT, name)
    common = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + inputs + ['-filter_complex', graph, '-map', '[v]', '-map', '[aout]', '-t', f'{total:.3f}']
    run(common + ['-c:v', 'libx264', '-crf', '22', '-preset', 'slow', '-tune', 'film', '-profile:v', 'high', '-movflags', '+faststart',
                  '-c:a', 'aac', '-b:a', '128k', base + '.mp4'])
    run(common + ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
                  '-c:a', 'libopus', '-b:a', '96k', base + '.webm'])
    json.dump(cues, open(base + '.cues.json', 'w'), indent=1)
    print(name, f'{total:.2f}s', [os.path.getsize(base + e) // 1024 for e in ('.mp4', '.webm')], 'KB',
          'gains', [round(c['gain'], 1) for c in clips])
    for q in cues: print('  ', q)

if __name__ == '__main__':
    for n in (FILMS if sys.argv[1] == 'all' else [sys.argv[1]]):
        build(n)
