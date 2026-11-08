"""
Carries captured motion onto the explorer and writes motions.json for build.mjs.

    <bpy python> retarget.py -- <work dir> [clip names...]

<work dir> holds astronaut-decoded.glb (decode.mjs), cmu/ (the CMU BVH files, by subject folder)
and ual/ (Quaternius's Universal Animation Library glTF); see fetch.sh and README.md. Naming
clips rebuilds only those (the others are kept from the last run).

Each clip in clips.py is cut from its source, low-passed, resampled to 30 frames a second,
turned to face +Z (the explorer's forward), retargeted (motionlib.retarget), its legs bent so
the ankles follow the source's own (scaled) ankles exactly, so planted feet stay planted, and:
- a cycle is cut at two left-heel strikes and closed so it loops without a seam; its steady
  travel is taken out of the hips and kept as its speed (the game plays it in step with the
  ground covered);
- a loop (standing) is cut where its end pose best matches its start, and closed the same way;
- a once clip starts over the explorer's feet.
A clip with `moon` set is retimed for low gravity: every moment with both feet off the ground is
stretched and its hips given the ballistic arc of that gravity (the Apollo lope).
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import motionlib as ml  # noqa: E402
from clips import CLIPS  # noqa: E402

FPS = 30.0
CM = 0.01
# The BVH conversion labels every take 120 frames a second, but some sessions were captured at 60:
# free fall in their jumps comes out at four times Earth's gravity (143_06), and their strides take
# half the time a person's can (77_10/139_10, 141_19, 143_32). Their real rates:
SOURCE_FPS = {'077': 60.0, '139': 60.0, '140': 60.0, '141': 60.0, '143': 60.0}


def load_source(work, spec, cache):
    """(Motion, reference lq, reference lt, mapping) for a clip spec."""
    if spec['src'] == 'cmu':
        path = os.path.join(work, 'cmu', spec['file'])
        if path not in cache:
            cache[path] = ml.load_bvh(path)
        skel, m = cache[path]
        m.fps = SOURCE_FPS.get(spec['file'].split('/')[0], m.fps)
        # Frame 0 is the T-pose the BVH conversion added: the reference.
        ref_lq, ref_lt = m.lq[0], m.lt[0]
        a, b = spec.get('frames', (1, m.frames))
        motion = m.slice(max(1, a), min(b, m.frames)).smooth(spec.get('smooth', 2)).resample(FPS)
        return motion, ref_lq, ref_lt, ml.CMU_MAP
    path = os.path.join(work, 'ual', 'AnimationLibrary_Godot_Standard.gltf')
    if path not in cache:
        doc, buffers = ml.read_gltf(path)
        cache[path] = (doc, buffers, ml.gltf_skeleton(doc, 'root'))
    doc, buffers, skel = cache[path]
    motion = ml.gltf_motion(doc, buffers, skel, spec['anim'], FPS)
    if 'frames' in spec:
        a, b = spec['frames']
        motion = motion.slice(a, min(b, motion.frames))
    return motion, skel.rest_q, skel.offsets, ml.UAL_MAP


def source_turn(motion, mapping, how):
    """Yaw that turns the source to face (or travel along) +Z."""
    if isinstance(how, (int, float)):
        return math.radians(how)
    gq, gp = ml.fk(motion.skel, motion.lq, motion.lt)
    hips = motion.skel.index[mapping['Hips'][0]]
    if how == 'travel':
        d = gp[-1, hips] - gp[0, hips]
        return -math.atan2(d[0], d[2])
    heading = ml.heading_of(gq, hips)
    if how == 'start':
        heading = heading[:6]
    elif how == 'end':
        heading = heading[-6:]
    return -math.atan2(np.mean(np.sin(heading)), np.mean(np.cos(heading)))


def source_floor(motion, mapping):
    """The source's ankle height standing on the ground: low in the take, as a planted foot is."""
    _, gp = ml.fk(motion.skel, motion.lq, motion.lt)
    s = motion.skel
    ankles = gp[:, [s.index[mapping['LeftFoot'][0]], s.index[mapping['RightFoot'][0]]], 1]
    return float(np.percentile(ankles, 3))


def pose_distance(lq, a, b):
    """How far apart two frames' poses are (sum of each bone's angle, radians)."""
    return float(np.sum(ml.qangle(ml.qmul(lq[a], ml.qinv(lq[b])))))


def choose_cycle(spec, lq, left_strikes):
    """First and last frame of one stride (or `strides`), from a left-heel strike to the one after, mid-take."""
    n = spec.get('strides', 1)
    if 'cycle' in spec:
        return spec['cycle']
    s = [int(x) for x in left_strikes]
    if len(s) < n + 1:
        raise RuntimeError('%s: only %d left strikes' % (spec['name'], len(s)))
    mid = spec.get('middle', lq.shape[0] / 2)
    best = min(range(len(s) - n), key=lambda i: abs((s[i] + s[i + n]) / 2 - mid))
    a, b = s[best], s[best + n]
    # Nudge the end to the frame whose pose best matches the start.
    b = min(range(max(a + 4, b - 3), min(lq.shape[0] - 1, b + 3) + 1), key=lambda f: pose_distance(lq, a, f))
    return a, b


def roll_to_left(lq, hips, down):
    """A loop (last frame repeating the first) started instead at its left-heel strike."""
    n = lq.shape[0] - 1
    ring = down[:n, 0]
    starts = [i for i in range(n) if ring[i] and not ring[i - 1]]
    k = starts[0] if starts else 0
    order = [(k + i) % n for i in range(n)] + [k]
    travel = hips[n] - hips[0]
    rolled = np.array([hips[i] + (travel if j >= n - k and i < k else 0) for j, i in enumerate(order)])
    rolled[-1] = rolled[0] + travel
    return lq[order], rolled, down[order], k


def choose_loop(spec, lq, hips):
    """A stretch of standing about `length` seconds long whose last pose best matches its first."""
    if 'cycle' in spec:
        return spec['cycle']
    length = int(spec.get('length', 4.0) * FPS)
    a = int(spec.get('start', 0) * FPS)
    lo, hi = a + int(length * 0.75), min(lq.shape[0] - 1, a + int(length * 1.3))
    vel = np.zeros(lq.shape[0])
    vel[1:] = np.sum(ml.qangle(ml.qmul(lq[1:], ml.qinv(lq[:-1]))), -1)
    best = min(range(lo, hi + 1), key=lambda f: pose_distance(lq, a, f) + 4 * abs(vel[f] - vel[a]) + 0.02 * np.linalg.norm(hips[f, [0, 2]] - hips[a, [0, 2]]))
    return a, best


def moon_retime(spec, lq, hips, down, explorer):
    """Stretch the flights of a bounding gait for low gravity; the hips fly a ballistic arc in them."""
    g = spec['moon'] * 100.0  # cm/s^2
    stretch_air, stretch_ground = spec.get('stretch', (2.6, 1.25))
    n = lq.shape[0]
    air = ~(down[:, 0] | down[:, 1])
    # New duration of each source frame step.
    dt = np.where(air[:-1] & air[1:], stretch_air, stretch_ground) / FPS
    t_new = np.concatenate([[0], np.cumsum(dt)])
    count = int(round(t_new[-1] * FPS)) + 1
    t = np.linspace(0, t_new[-1], count)
    src = np.interp(t, t_new, np.arange(n))
    i0 = np.clip(np.floor(src).astype(int), 0, n - 1)
    i1 = np.clip(i0 + 1, 0, n - 1)
    f = src - i0
    out_q = ml.qslerp(lq[i0], lq[i1], np.broadcast_to(f[:, None], (count, lq.shape[1])))
    out_h = hips[i0] * (1 - f[:, None]) + hips[i1] * f[:, None]
    out_air = air[i0] & air[i1]
    # Across the ground the hips go as they did (a planted foot does not slide); in the air they
    # keep the speed they left the ground with, for as long as the flight now lasts: longer bounds.
    src_v = np.gradient(hips[:, [0, 2]], axis=0) * FPS
    flat = out_h[:, [0, 2]].copy()
    pos = flat[0].copy()
    for i in range(1, count):
        if out_air[i] and out_air[i - 1]:
            pos = pos + src_v[i0[i]] * (1 - f[i]) / FPS + src_v[i1[i]] * f[i] / FPS
        else:
            pos = pos + (flat[i] - flat[i - 1])
        out_h[i, [0, 2]] = pos
    out_down = down[np.rint(src).astype(int)]
    # Each flight: from lift-off height to landing height under this gravity.
    k = 0
    while k < count:
        if not out_air[k]:
            k += 1
            continue
        e = k
        while e + 1 < count and out_air[e + 1]:
            e += 1
        a, b = max(0, k - 1), min(count - 1, e + 1)
        T = (b - a) / FPS
        y0, y1 = out_h[a, 1], out_h[b, 1]
        v0 = (y1 - y0) / T + g * T / 2
        for i in range(a, b + 1):
            s = (i - a) / FPS
            arc = y0 + v0 * s - g * s * s / 2
            out_h[i, 1] = arc
        k = e + 1
    return out_q, out_h, out_down


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def level_gaze(explorer, gq, hips, down_deg):
    """
    Turn the neck and head (by one steady amount over the clip) so the face looks straight ahead
    and `down_deg` below level on average: some actors watched the floor, or looked off to a side.
    """
    T = explorer.skel
    head, neck, front = T.index['Head'], T.index['neck'], T.index['headfront']
    _, _, gp = ml.pose(explorer, gq, hips)
    v = gp[:, front] - gp[:, head]
    v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    pitch = np.degrees(np.arcsin(-v[:, 1])).mean()
    turn = np.degrees(np.arctan2(v[:, 0], v[:, 2])).mean()
    fix = ml.qmul(ml.qaxis(np.array([0.0, 1.0, 0.0]), math.radians(-turn)), ml.qaxis(np.array([1.0, 0.0, 0.0]), math.radians(down_deg - pitch)))
    gq = gq.copy()
    part = ml.qslerp(ml.IDENTITY, fix, 0.4)
    gq[:, neck] = ml.qmul(part, gq[:, neck])
    gq[:, head] = ml.qmul(fix, gq[:, head])
    return ml.qnorm(gq)


def glance_at_wrist(explorer, gq, hips, rise=0.7, hold=1.7, start=0.6):
    """
    A look at the suit's wrist display, laid over a standing take: the left forearm comes up across
    the body, the head bows and turns to it, held a moment, then down again (no capture of this).
    """
    T = explorer.skel
    n = gq.shape[0]
    t = np.arange(n) / FPS
    w = smoothstep(start, start + rise, t) * (1 - smoothstep(start + rise + hold, start + 2 * rise + hold, t))
    gq = gq.copy()
    arm, fore, hand = T.index['LeftArm'], T.index['LeftForeArm'], T.index['LeftHand']
    keep_hand = ml.qmul(ml.qinv(gq[:, fore]), gq[:, hand])
    # The upper arm hangs a little forward and out; the forearm comes across, up towards the eyes.
    for bone, aim in ((arm, (0.18, -0.8, 0.45)), (fore, (-0.78, 0.38, 0.5))):
        aim = np.array(aim) / np.linalg.norm(aim)
        here = ml.qrot(gq[:, bone], np.array([0.0, 1.0, 0.0]))
        there = ml.qmul(ml.qbetween(here, np.broadcast_to(aim, here.shape)), gq[:, bone])
        gq[:, bone] = ml.qslerp(gq[:, bone], there, w)
    gq[:, hand] = ml.qmul(gq[:, fore], keep_hand)
    # The head bows and turns to the wrist.
    _, _, gp = ml.pose(explorer, gq, hips)
    head, neck = T.index['Head'], T.index['neck']
    to = gp[:, hand] - gp[:, head]
    face = ml.qrot(gq[:, head], ml.qrot(ml.qinv(explorer.rest_gq[head]), ml.FORWARD))
    turn = ml.qbetween(face, to)
    for bone, share in ((neck, 0.35), (head, 0.65)):
        part = ml.qslerp(np.broadcast_to(ml.IDENTITY, turn.shape), turn, w * share * 0.85)
        gq[:, bone] = ml.qmul(part, gq[:, bone])
        if bone == neck:
            gq[:, head] = ml.qmul(part, gq[:, head])
    return ml.qnorm(gq)


def build_clip(spec, explorer, work, cache):
    motion, ref_lq, ref_lt, mapping = load_source(work, spec, cache)
    # A cycle is turned to travel along +Z; one made in place (no travel to go by) to face it.
    face = 'pelvis' if spec.get('inplace') else 'travel' if spec['kind'] == 'cycle' else 'start'
    turn = source_turn(motion, mapping, spec.get('face', face)) + (math.pi if spec.get('flip') else 0.0)
    floor = spec.get('floor', source_floor(motion, mapping))
    r = ml.retarget(motion, ref_lq, ref_lt, explorer, mapping, turn=turn, floor=floor)
    gq, hips, ankles = r['gq'], r['hips'], r['ankles']
    T = explorer.skel
    # Suit: the arms held a little away from the body, so they clear its bulk and the pack.
    spread = math.radians(spec.get('spread', 6))
    if spread:
        for side, sign in (('Left', 1), ('Right', -1)):
            arm = T.index[side + 'Arm']
            out = ml.qrot(gq[:, T.index['Spine']], ml.FORWARD)
            turn_out = ml.qaxis(out, np.full(out.shape[0], sign * spread))
            for bone in (side + 'Arm', side + 'ForeArm', side + 'Hand'):
                gq[:, T.index[bone]] = ml.qmul(turn_out, gq[:, T.index[bone]])
    # Planted feet: the ankles follow the source's, scaled (feet keep their angle).
    if spec.get('ik', True):
        gq = ml.leg_ik(explorer, gq, hips, ankles)
    if 'gaze' in spec:
        gq = level_gaze(explorer, gq, hips, spec['gaze'])
    if spec.get('wrist'):
        gq = glance_at_wrist(explorer, gq, hips)
    lq, lt, gp = ml.pose(explorer, gq, hips)
    feet = gp[:, [T.index['LeftFoot'], T.index['RightFoot']]]
    toes = gp[:, [T.index['LeftToeBase'], T.index['RightToeBase']]]
    # A loop made in place (Quaternius) slides its planted foot back at the speed it means: down is only low.
    h, v = spec.get('contact_height', 5.0), spec.get('contact_speed', 1e9 if spec.get('inplace') else 70.0)
    down = ml.contacts(feet, FPS, height=h, speed=v) | ml.contacts(toes, FPS, height=h, speed=v)
    out = {'name': spec['name'], 'kind': spec['kind'], 'fps': FPS, 'source': spec.get('credit', spec.get('file', spec.get('anim')))}
    if spec['kind'] == 'cycle' and spec.get('whole'):
        # Already a loop (Quaternius): its last frame repeats its first. Start it at a left-heel strike.
        a, b = 0, lq.shape[0] - 1
        n = b
        ring = down[:n, 0]
        starts = [i for i in range(n) if ring[i] and not ring[i - 1]]
        k = starts[0] if starts else 0
        order = [(k + i) % n for i in range(n)] + [k]
        travel_per_loop = hips[b] - hips[0]
        hips = np.array([hips[i] + (travel_per_loop if i < k and j >= n - k else 0) for j, i in enumerate(order)])
        hips[-1] = hips[0] + travel_per_loop
        lq, down = lq[order], down[order]
        if 'moon' in spec:
            lq, hips, down = moon_retime(spec, lq, hips, down, explorer)
        if spec.get('inplace'):
            # Its speed is how fast the planted foot is swept back under the body.
            lt_l = np.tile(T.offsets, (lq.shape[0], 1, 1))
            lt_l[:, explorer.hips] = hips
            _, gp_l = ml.fk(T, lq, lt_l)
            feet_l = gp_l[:, [T.index['LeftFoot'], T.index['RightFoot']]]
            sweep = -np.gradient(feet_l[:, :, 2], axis=0) * FPS
            speed_cm = float(np.median(sweep[down]))
            travel_per_loop = np.array([0.0, 0.0, speed_cm * (lq.shape[0] - 1) / FPS])
            hips = hips + travel_per_loop[None, :] * (np.arange(lq.shape[0]) / (lq.shape[0] - 1))[:, None]
        lq, hips, travel = ml.close_loop(lq, hips, FPS)
        duration = (lq.shape[0] - 1) / FPS
        out['speed'] = float(np.linalg.norm(travel[[0, 2]]) * CM / duration)
        out['stride'] = float(np.linalg.norm(travel[[0, 2]]) * CM)
        out['range'] = [int(k), int(n)]
    elif spec['kind'] == 'cycle':
        left = ml.strikes(down[:, 0])
        if len(left) >= spec.get('strides', 1) + 1 or 'cycle' in spec:
            a, b = choose_cycle(spec, lq, left)
            lq, hips, down = lq[a:b + 1], hips[a:b + 1].copy(), down[a:b + 1]
        else:
            # A short take: one stride from right heel to right heel, then started at the left's.
            a, b = choose_cycle(spec, lq, ml.strikes(down[:, 1]))
            lq, hips, down, _ = roll_to_left(lq[a:b + 1], hips[a:b + 1].copy(), down[a:b + 1])
        if 'moon' in spec:
            lq, hips, down = moon_retime(spec, lq, hips, down, explorer)
        lq, hips, travel = ml.close_loop(lq, hips, FPS)
        duration = (lq.shape[0] - 1) / FPS
        out['speed'] = float(np.linalg.norm(travel[[0, 2]]) * CM / duration)
        out['stride'] = float(np.linalg.norm(travel[[0, 2]]) * CM)
        out['range'] = [int(a), int(b)]
    elif spec['kind'] == 'loop':
        a, b = choose_loop(spec, lq, hips)
        lq, hips, down = lq[a:b + 1], hips[a:b + 1].copy(), down[a:b + 1]
        lq, hips, travel = ml.close_loop(lq, hips, FPS)
        out['range'] = [int(a), int(b)]
    else:
        a, b = int(spec.get('start', 0) * FPS), lq.shape[0] - 1
        if 'end' in spec:
            b = min(b, int(spec['end'] * FPS))
        lq, hips, down = lq[a:b + 1], hips[a:b + 1].copy(), down[a:b + 1]
        out['range'] = [int(a), int(b)]
    if True:
        # Over the explorer's feet: where the hips stand at rest, at the start (or on average, for a loop or cycle).
        at = hips[0] if spec['kind'] == 'once' else hips.mean(0)
        hips = hips - np.array([at[0] - explorer.rest_gp[explorer.hips, 0], 0, at[2] - explorer.rest_gp[explorer.hips, 2]])
    out['duration'] = float((lq.shape[0] - 1) / FPS)
    out['rotations'] = np.round(ml.qcontinuous(lq), 5).tolist()
    out['hips'] = np.round(hips, 3).tolist()
    out['contact'] = down.astype(int).tolist()
    for key in ('rate', 'gravity', 'tags', 'marks'):
        if key in spec:
            out[key] = spec[key]
    if 'moon' in spec:
        out['gravity'] = spec['moon']
    return out


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    work = args[0]
    only = set(args[1:])
    explorer = ml.Explorer(os.path.join(work, 'astronaut-decoded.glb'))
    out_path = os.path.join(work, 'motions.json')
    previous = {}
    if only and os.path.exists(out_path):
        previous = {c['name']: c for c in json.load(open(out_path))['clips']}
    cache = {}
    clips = []
    for spec in CLIPS:
        if only and spec['name'] not in only:
            if spec['name'] in previous:
                clips.append(previous[spec['name']])
            continue
        try:
            clip = build_clip(spec, explorer, work, cache)
        except Exception as error:  # noqa: BLE001 - report and go on with the others
            print('%-14s FAILED: %s' % (spec['name'], error), flush=True)
            if spec['name'] in previous:
                clips.append(previous[spec['name']])
            continue
        extra = 'range %s' % clip.get('range')
        if clip['kind'] == 'cycle':
            extra += ' speed %.2f m/s stride %.2f m' % (clip['speed'], clip['stride'])
        print('%-14s %-6s %5.2fs %s' % (clip['name'], clip['kind'], clip['duration'], extra), flush=True)
        clips.append(clip)
    json.dump({'target': os.path.join(work, 'astronaut-decoded.glb'), 'bones': explorer.skel.names, 'clips': clips}, open(out_path, 'w'))
    print('wrote', out_path, len(clips), 'clips')


if __name__ == '__main__':
    main()
