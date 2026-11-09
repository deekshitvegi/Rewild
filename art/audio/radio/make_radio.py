"""The first mission's radio voices (docs/missions/first_contact.md): raw takes in raw/FC_<id>.mp3 (ElevenLabs v4 through
Higgsfield, the owner's cast) become FC_<id>.wav, 48 kHz mono, ready for Unreal (import_radio.py).

- ARGO stays dry (she is the ship): only levelled.
- The crew go through the fighters' radio, the films' intercom chain (art/audio/README.md): high-pass 320 Hz,
  low-pass 3.4 kHz, 5:1 compression, tanh soft clip, faint band-limited pink noise; plus a mic click at each end.
- The Holdout at Svalbard, from the ground through 300-year-old kit: narrower (500 Hz-2.6 kHz), crushed to 8 kHz,
  louder static with crackle, and short drop-outs.

Needs ffmpeg (decoding mp3) and numpy/scipy. Run: python art/audio/radio/make_radio.py
"""

import os
import subprocess
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
RATE = 48000
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")

# who says each line (the script's table)
SPEAKER = {}
for ids, who in [
    ("i01 s01 s05 w2a w3a e01 f01 a1 a2 a3 a4 x4", "argo"),
    ("i02 i05 s06 w3b e02", "dev"),
    ("i03 s04 k2 p3 t3 h2 x2 oa2 oc2 of2 oe3", "noor"),
    ("i04 d01 w2b k1 p1 t1 h1 x1 oa1 oc1 of1 oe1", "kai"),
    ("d02 s03 k3 p2 t2 h3 x3 oa3 oc3 of3 oe2", "amara"),
    ("s02 e03", "holdout"),
]:
    for i in ids.split():
        SPEAKER[i] = who


def decode(path):
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def band(x, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], btype="bandpass", fs=RATE, output="sos")
    return signal.sosfilt(sos, x)


def compress(x, ratio=5.0, threshold_db=-24.0, attack=0.004, release=0.08):
    env = np.abs(x)
    a, r = np.exp(-1.0 / (attack * RATE)), np.exp(-1.0 / (release * RATE))
    out = np.empty_like(env)
    level = 0.0
    for n, e in enumerate(env):  # a simple peak follower
        level = a * level + (1 - a) * e if e > level else r * level + (1 - r) * e
        out[n] = level
    db = 20 * np.log10(np.maximum(out, 1e-6))
    over = np.maximum(db - threshold_db, 0.0)
    gain_db = -over * (1 - 1 / ratio)
    return x * 10 ** (gain_db / 20)


def pink(n, rng):
    white = rng.standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]  # Paul Kellet's pink filter
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return signal.lfilter(b, a, white)


def level(x, rms_db=-20.0, peak_db=-1.0):
    rms = np.sqrt(np.mean(x[np.abs(x) > 1e-4] ** 2)) if np.any(np.abs(x) > 1e-4) else 1.0
    x = x * 10 ** (rms_db / 20) / max(rms, 1e-6)
    peak = np.max(np.abs(x))
    limit = 10 ** (peak_db / 20)
    return np.tanh(x / limit) * limit if peak > limit else x


def click(rng, ms, strength):
    n = int(RATE * ms / 1000)
    burst = band(rng.standard_normal(n), 900, 3200) * np.exp(-np.linspace(0, 6, n)) * strength
    return burst


def radio(x, rng):
    x = band(x, 320, 3400)
    x = compress(x)
    x = np.tanh(x * 2.2) / np.tanh(2.2)
    x = level(x, -19.0)
    pad_a, pad_b = int(RATE * 0.06), int(RATE * 0.12)
    y = np.concatenate([np.zeros(pad_a), x, np.zeros(pad_b)])
    noise = band(pink(len(y), rng), 400, 3000)
    y += noise / np.std(noise) * 10 ** (-42 / 20)
    y[:len(click(rng, 45, 0.25))] += click(rng, 45, 0.25)           # mic key down
    tail = click(rng, 70, 0.18)
    y[-len(tail):] += tail                                            # and up
    return level(y, -19.0)


def ground(x, rng):
    x = band(x, 500, 2600, order=6)
    x = compress(x, ratio=8.0, threshold_db=-30.0)
    # crushed to 8 kHz, as old kit would carry it
    step = RATE // 8000
    x = np.repeat(x[::step], step)[:len(x)]
    x = band(x, 500, 2600)
    x = np.tanh(x * 3.0)
    x = level(x, -21.0)
    # short drop-outs: a few 60-150 ms holes where the signal fades
    for _ in range(max(1, len(x) // (RATE * 2))):
        at = rng.integers(int(0.3 * RATE), max(int(0.31 * RATE), len(x) - int(0.3 * RATE)))
        n = int(rng.uniform(0.06, 0.15) * RATE)
        env = 1 - 0.85 * np.hanning(n)
        x[at:at + n] *= env[:len(x[at:at + n])]
    pad = int(RATE * 0.25)
    y = np.concatenate([np.zeros(pad), x, np.zeros(pad)])
    noise = band(pink(len(y), rng), 300, 3500)
    noise = noise / np.std(noise) * 10 ** (-27 / 20) * (0.7 + 0.3 * np.sin(np.linspace(0, 9, len(y))) ** 2)
    crackle = np.zeros(len(y))
    hits = rng.integers(0, len(y), size=len(y) // 2400)
    crackle[hits] = rng.uniform(-0.25, 0.25, size=len(hits))
    y += noise + band(crackle, 800, 5000)
    return level(y, -21.0)


def dry(x, rng):
    x = signal.sosfilt(signal.butter(2, 70, btype="highpass", fs=RATE, output="sos"), x)
    return level(x, -18.0)


def main():
    raw_dir = os.path.join(HERE, "raw")
    rng = np.random.default_rng(1717)
    made = 0
    for name in sorted(os.listdir(raw_dir)):
        if not name.endswith(".mp3"):
            continue
        line = name[3:-4]  # FC_<id>.mp3
        who = SPEAKER.get(line)
        if not who:
            print("unknown line", name)
            continue
        x = decode(os.path.join(raw_dir, name))
        y = dry(x, rng) if who == "argo" else ground(x, rng) if who == "holdout" else radio(x, rng)
        wavfile.write(os.path.join(HERE, f"FC_{line}.wav"), RATE, (np.clip(y, -1, 1) * 32767).astype(np.int16))
        made += 1
    print(f"{made} lines made")


if __name__ == "__main__":
    sys.exit(main())
