"""
Motion library for carrying captured motion onto the explorer (astronaut.glb).

Quaternions are (x, y, z, w) numpy arrays, broadcast over leading axes (frames, joints).
Positions are numpy (..., 3). Every skeleton is posed by forward kinematics from local
rotations and translations; the retarget works in world space, one bone at a time:

    target_world(t) = source_world(t) * inv(source_world_ref) * F_s * inv(F_t) * target_world_rest

where F_s and F_t are frames built on the bone in the source's reference pose and the
target's rest pose (the bone's direction, and the character's forward or up to fix its
twist). So the source's T-pose and the explorer's A-pose need not match: each limb is
first turned from the explorer's rest onto the source's reference, then moved as the
source moves. Bones of the trunk (hips, spine, neck, head) use the identity frame: the
change from the source's rest is applied to the explorer's own rest posture.
"""
import json
import math
import os
import struct

import numpy as np

# ------------------------------------------------------------------ quaternions

IDENTITY = np.array([0.0, 0.0, 0.0, 1.0])


def qmul(a, b):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], -1)


def qinv(q):
    return np.asarray(q, float) * np.array([-1.0, -1.0, -1.0, 1.0])


def qnorm(q):
    q = np.asarray(q, float)
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def qrot(q, v):
    """Rotate vectors v by quaternions q."""
    q = np.asarray(q, float)
    v = np.asarray(v, float)
    u = q[..., :3]
    w = q[..., 3:4]
    t = 2.0 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def qaxis(axis, angle):
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis, axis=-1, keepdims=True)
    angle = np.asarray(angle, float)[..., None]
    return np.concatenate([axis * np.sin(angle / 2), np.cos(angle / 2)], -1)


def qeuler(order, angles):
    """Intrinsic rotations in the order written (BVH): 'ZYX' is Rz * Ry * Rx. Angles in radians, (..., 3) in that order."""
    axes = {'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}
    q = None
    for i, letter in enumerate(order):
        r = qaxis(np.broadcast_to(axes[letter], angles.shape[:-1] + (3,)), angles[..., i])
        q = r if q is None else qmul(q, r)
    return q


def qfrommat(m):
    """Quaternion from a 3x3 rotation matrix (columns are the rotated axes)."""
    m = np.asarray(m, float)
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    return qnorm(np.array(q))


def qbetween(u, v):
    """Shortest rotation taking direction u onto direction v (broadcast)."""
    u = np.asarray(u, float)
    v = np.asarray(v, float)
    u = u / np.linalg.norm(u, axis=-1, keepdims=True)
    v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    d = np.sum(u * v, -1, keepdims=True)
    c = np.cross(u, v)
    q = np.concatenate([c, 1.0 + d], -1)
    # Opposite directions: half a turn about any axis at right angles to u.
    opposite = (d[..., 0] < -0.999999)
    if np.any(opposite):
        alt = np.cross(u, np.array([1.0, 0, 0]))
        small = np.linalg.norm(alt, axis=-1) < 1e-6
        alt = np.where(small[..., None], np.cross(u, np.array([0, 1.0, 0])), alt)
        alt = alt / np.linalg.norm(alt, axis=-1, keepdims=True)
        q = np.where(opposite[..., None], np.concatenate([alt, np.zeros(alt.shape[:-1] + (1,))], -1), q)
    return qnorm(q)


def qslerp(a, b, t):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    t = np.asarray(t, float)
    d = np.sum(a * b, -1, keepdims=True)
    b = np.where(d < 0, -b, b)
    d = np.abs(d)
    t = t[..., None] if t.ndim == a.ndim - 1 else t
    theta = np.arccos(np.clip(d, -1, 1))
    s = np.sin(theta)
    near = s < 1e-6
    wa = np.where(near, 1 - t, np.sin((1 - t) * theta) / np.where(near, 1, s))
    wb = np.where(near, t, np.sin(t * theta) / np.where(near, 1, s))
    return qnorm(wa * a + wb * b)


def qangle(q):
    q = qnorm(q)
    return 2 * np.arccos(np.clip(np.abs(q[..., 3]), 0, 1))


def qcontinuous(q, axis=0):
    """Flip signs so consecutive quaternions along `axis` stay in the same hemisphere."""
    q = np.array(q, float)
    q = np.moveaxis(q, axis, 0)
    for i in range(1, q.shape[0]):
        flip = np.sum(q[i] * q[i - 1], -1) < 0
        q[i][flip] *= -1
    return np.moveaxis(q, 0, axis)


def frame_from(direction, hint):
    """Rotation whose X axis is `direction` and whose Y axis is `hint` made square to it."""
    x = np.asarray(direction, float)
    x = x / np.linalg.norm(x)
    h = np.asarray(hint, float)
    y = h - np.dot(h, x) * x
    if np.linalg.norm(y) < 1e-4:
        h = np.array([0.0, 1.0, 0.0]) if abs(x[1]) < 0.9 else np.array([0.0, 0.0, 1.0])
        y = h - np.dot(h, x) * x
    y = y / np.linalg.norm(y)
    z = np.cross(x, y)
    return qfrommat(np.stack([x, y, z], 1))


def yaw(angle):
    return qaxis(np.array([0.0, 1.0, 0.0]), angle)


# ------------------------------------------------------------------ skeletons and motion


class Skeleton:
    """Joints in an order where every parent comes before its children."""

    def __init__(self, names, parents, offsets, rest_q=None):
        self.names = list(names)
        self.parents = list(parents)
        self.offsets = np.asarray(offsets, float)
        self.rest_q = np.tile(IDENTITY, (len(names), 1)) if rest_q is None else np.asarray(rest_q, float)
        self.index = {n: i for i, n in enumerate(self.names)}
        self.ends = {}

    def __len__(self):
        return len(self.names)


class Motion:
    """Local rotations (F, J, 4) and translations (F, J, 3) of a skeleton, sampled at fps."""

    def __init__(self, skel, fps, lq, lt):
        self.skel = skel
        self.fps = float(fps)
        self.lq = np.asarray(lq, float)
        self.lt = np.asarray(lt, float)

    @property
    def frames(self):
        return self.lq.shape[0]

    def slice(self, a, b):
        return Motion(self.skel, self.fps, self.lq[a:b], self.lt[a:b])

    def resample(self, fps):
        """Resample to another frame rate (slerp between neighbouring frames)."""
        n = self.frames
        duration = (n - 1) / self.fps
        count = int(round(duration * fps)) + 1
        t = np.arange(count) / fps * self.fps
        i0 = np.clip(np.floor(t).astype(int), 0, n - 1)
        i1 = np.clip(i0 + 1, 0, n - 1)
        f = (t - i0)[:, None]
        lq = qslerp(self.lq[i0], self.lq[i1], np.broadcast_to(f, (count, self.lq.shape[1])))
        lt = self.lt[i0] * (1 - f[..., None]) + self.lt[i1] * f[..., None]
        return Motion(self.skel, fps, lq, lt)

    def smooth(self, radius):
        """Low-pass the captured jitter: a moving average of each joint's rotation over 2r+1 frames."""
        if radius <= 0:
            return self
        lq = qcontinuous(self.lq)
        k = np.ones(2 * radius + 1) / (2 * radius + 1)
        out = np.empty_like(lq)
        for j in range(lq.shape[1]):
            for c in range(4):
                padded = np.pad(lq[:, j, c], radius, mode='edge')
                out[:, j, c] = np.convolve(padded, k, mode='valid')
        lt = self.lt.copy()
        for c in range(3):
            padded = np.pad(lt[:, 0, c], radius, mode='edge')
            lt[:, 0, c] = np.convolve(padded, k, mode='valid')
        return Motion(self.skel, self.fps, qnorm(out), lt)


def fk(skel, lq, lt):
    """World rotations and positions of every joint, for every frame."""
    lq = np.asarray(lq, float)
    lt = np.asarray(lt, float)
    gq = np.empty_like(lq)
    gp = np.empty_like(lt)
    for j, p in enumerate(skel.parents):
        if p < 0:
            gq[..., j, :] = lq[..., j, :]
            gp[..., j, :] = lt[..., j, :]
        else:
            gq[..., j, :] = qmul(gq[..., p, :], lq[..., j, :])
            gp[..., j, :] = gp[..., p, :] + qrot(gq[..., p, :], lt[..., j, :])
    return gq, gp


def to_local(skel, gq):
    lq = np.empty_like(gq)
    for j, p in enumerate(skel.parents):
        lq[..., j, :] = gq[..., j, :] if p < 0 else qmul(qinv(gq[..., p, :]), gq[..., j, :])
    return qnorm(lq)


# ------------------------------------------------------------------ BVH


def load_bvh(path):
    """A BVH file as (Skeleton, Motion). Rotations from each joint's channel order."""
    with open(path) as f:
        tokens = f.read().split()
    i = 0
    names, parents, offsets, channels, ends = [], [], [], [], {}
    stack = []
    pending_end = False
    while tokens[i] != 'MOTION':
        tok = tokens[i]
        if tok in ('ROOT', 'JOINT'):
            names.append(tokens[i + 1])
            parents.append(stack[-1] if stack else -1)
            i += 2
        elif tok == 'End':
            pending_end = True
            i += 2
        elif tok == '{':
            if pending_end:
                stack.append(-2)
            else:
                stack.append(len(names) - 1)
            i += 1
        elif tok == '}':
            stack.pop()
            i += 1
        elif tok == 'OFFSET':
            v = [float(tokens[i + 1]), float(tokens[i + 2]), float(tokens[i + 3])]
            if pending_end:
                ends[stack[-2]] = np.array(v)
                pending_end = False
            else:
                offsets.append(v)
            i += 4
        elif tok == 'CHANNELS':
            n = int(tokens[i + 1])
            channels.append(tokens[i + 2:i + 2 + n])
            i += 2 + n
        else:
            i += 1
    i += 1
    frames = int(tokens[i + 1])
    frame_time = float(tokens[i + 4])
    i += 5
    data = np.array(tokens[i:i + frames * sum(len(c) for c in channels)], float).reshape(frames, -1)
    skel = Skeleton(names, parents, offsets)
    skel.ends = ends
    J = len(names)
    lq = np.tile(IDENTITY, (frames, J, 1))
    lt = np.tile(skel.offsets, (frames, 1, 1))
    col = 0
    for j, chans in enumerate(channels):
        rot = [c for c in chans if c.endswith('rotation')]
        order = ''.join(c[0] for c in rot)
        values = {}
        for c in chans:
            values[c] = data[:, col]
            col += 1
        if 'Xposition' in values:
            lt[:, j] = np.stack([values['Xposition'], values['Yposition'], values['Zposition']], -1) + skel.offsets[j]
        if rot:
            angles = np.radians(np.stack([values[c] for c in rot], -1))
            lq[:, j] = qeuler(order, angles)
    return skel, Motion(skel, 1.0 / frame_time, lq, lt)


# ------------------------------------------------------------------ glTF

_COMPONENTS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
_WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
_NORMALIZE = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


def read_gltf(path):
    """(json, list of buffers) for a .gltf with external buffers or a .glb (no meshopt)."""
    if path.endswith('.glb'):
        data = open(path, 'rb').read()
        length = struct.unpack('<I', data[12:16])[0]
        doc = json.loads(data[20:20 + length])
        rest = data[20 + length:]
        bin_length = struct.unpack('<I', rest[0:4])[0]
        return doc, [rest[8:8 + bin_length]]
    doc = json.load(open(path))
    base = os.path.dirname(path)
    return doc, [open(os.path.join(base, b['uri']), 'rb').read() for b in doc['buffers']]


def accessor(doc, buffers, index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    fmt, size = _COMPONENTS[a['componentType']]
    width = _WIDTH[a['type']]
    stride = view.get('byteStride', size * width)
    start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    buf = buffers[view.get('buffer', 0)]
    if stride == size * width:
        out = np.frombuffer(buf, dtype='<' + fmt, count=a['count'] * width, offset=start).reshape(a['count'], width).astype(float)
    else:
        out = np.empty((a['count'], width))
        for i in range(a['count']):
            out[i] = struct.unpack_from('<' + fmt * width, buf, start + i * stride)
    if a.get('normalized'):
        out = np.maximum(out / _NORMALIZE[a['componentType']], -1.0)
    return out


def gltf_skeleton(doc, root_name):
    """The node tree under (and including) the node called root_name, parents first."""
    nodes = doc['nodes']
    by_name = {n.get('name'): i for i, n in enumerate(nodes)}
    order, parents = [], []

    def walk(i, parent):
        order.append(i)
        parents.append(parent)
        me = len(order) - 1
        for c in nodes[i].get('children', []):
            if 'mesh' not in nodes[c]:
                walk(c, me)

    walk(by_name[root_name], -1)
    names = [nodes[i].get('name') for i in order]
    offsets = [nodes[i].get('translation', [0, 0, 0]) for i in order]
    rest_q = [nodes[i].get('rotation', [0, 0, 0, 1]) for i in order]
    skel = Skeleton(names, parents, offsets, rest_q)
    skel.node_index = order
    return skel


def gltf_motion(doc, buffers, skel, anim_name, fps=30.0):
    """One animation of a glTF file, sampled at fps (rest values where a joint has no channel)."""
    anim = next(a for a in doc['animations'] if a['name'] == anim_name)
    node_to_joint = {n: j for j, n in enumerate(skel.node_index)}
    tracks = {}
    end = 0.0
    for ch in anim['channels']:
        node = ch['target'].get('node')
        if node not in node_to_joint or ch['target']['path'] not in ('rotation', 'translation'):
            continue
        s = anim['samplers'][ch['sampler']]
        times = accessor(doc, buffers, s['input'])[:, 0]
        values = accessor(doc, buffers, s['output'])
        if s.get('interpolation') == 'CUBICSPLINE':
            values = values[1::3]
        tracks[(node_to_joint[node], ch['target']['path'])] = (times, values, s.get('interpolation', 'LINEAR'))
        end = max(end, times[-1])
    count = int(round(end * fps)) + 1
    t = np.arange(count) / fps
    J = len(skel)
    lq = np.tile(skel.rest_q, (count, 1, 1))
    lt = np.tile(skel.offsets, (count, 1, 1))
    for (j, path), (times, values, interp) in tracks.items():
        idx = np.clip(np.searchsorted(times, t, side='right') - 1, 0, len(times) - 1)
        nxt = np.clip(idx + 1, 0, len(times) - 1)
        span = np.where(nxt > idx, times[nxt] - times[idx], 1.0)
        f = np.clip((t - times[idx]) / span, 0, 1) if interp != 'STEP' else np.zeros_like(t)
        if path == 'rotation':
            lq[:, j] = qslerp(values[idx], values[nxt], f)
        else:
            lt[:, j] = values[idx] * (1 - f[:, None]) + values[nxt] * f[:, None]
    return Motion(skel, fps, qnorm(lq), lt)


# ------------------------------------------------------------------ the explorer and the retarget

FORWARD = np.array([0.0, 0.0, 1.0])
UP = np.array([0.0, 1.0, 0.0])

# Target bone <- (source joint, joint or 'end' its segment runs to, frame mode, twist hint).
# 'world': the source's change from its reference is applied to the explorer's rest (trunk).
# 'dir': the bone is first turned onto the source's reference direction (limbs: T-pose vs A-pose).
CMU_MAP = {
    'Hips': ('Hips', None, 'world', None),
    'Spine02': ('LowerBack', None, 'world', None),
    'Spine01': ('Spine', None, 'world', None),
    'Spine': ('Spine1', None, 'world', None),
    'neck': ('Neck', None, 'world', None),
    'Head': ('Head', None, 'world', None),
}
UAL_MAP = {
    'Hips': ('DEF-hips', None, 'world', None),
    'Spine02': ('DEF-spine.001', None, 'world', None),
    'Spine01': ('DEF-spine.002', None, 'world', None),
    'Spine': ('DEF-spine.003', None, 'world', None),
    'neck': ('DEF-neck', None, 'world', None),
    'Head': ('DEF-head', None, 'world', None),
}
for _side, _s in (('Left', 'L'), ('Right', 'R')):
    CMU_MAP.update({
        _side + 'UpLeg': (_side + 'UpLeg', _side + 'Leg', 'dir', FORWARD),
        _side + 'Leg': (_side + 'Leg', _side + 'Foot', 'dir', FORWARD),
        _side + 'Foot': (_side + 'Foot', _side + 'ToeBase', 'dir', UP),
        _side + 'ToeBase': (_side + 'ToeBase', 'end', 'dir', UP),
        _side + 'Shoulder': (_side + 'Shoulder', _side + 'Arm', 'dir', FORWARD),
        _side + 'Arm': (_side + 'Arm', _side + 'ForeArm', 'dir', FORWARD),
        _side + 'ForeArm': (_side + 'ForeArm', _side + 'Hand', 'dir', FORWARD),
        _side + 'Hand': (_side + 'Hand', _side + 'HandIndex1', 'dir', FORWARD),
    })
    UAL_MAP.update({
        _side + 'UpLeg': ('DEF-thigh.' + _s, 'DEF-shin.' + _s, 'dir', FORWARD),
        _side + 'Leg': ('DEF-shin.' + _s, 'DEF-foot.' + _s, 'dir', FORWARD),
        _side + 'Foot': ('DEF-foot.' + _s, 'DEF-toe.' + _s, 'dir', UP),
        _side + 'ToeBase': ('DEF-toe.' + _s, 'axis', 'dir', UP),
        _side + 'Shoulder': ('DEF-shoulder.' + _s, 'DEF-upper_arm.' + _s, 'dir', FORWARD),
        _side + 'Arm': ('DEF-upper_arm.' + _s, 'DEF-forearm.' + _s, 'dir', FORWARD),
        _side + 'ForeArm': ('DEF-forearm.' + _s, 'DEF-hand.' + _s, 'dir', FORWARD),
        _side + 'Hand': ('DEF-hand.' + _s, 'DEF-f_middle.01.' + _s, 'dir', FORWARD),
    })


class Explorer:
    """The explorer's skeleton from astronaut.glb (meshopt-decoded), in its armature's space (cm)."""

    def __init__(self, path):
        doc, _ = read_gltf(path)
        self.skel = gltf_skeleton(doc, 'Hips')
        s = self.skel
        self.rest_gq, self.rest_gp = fk(s, s.rest_q, s.offsets)
        j = s.index
        self.hips = j['Hips']
        self.ankle_rest = 0.5 * (self.rest_gp[j['LeftFoot']] + self.rest_gp[j['RightFoot']])
        self.toe_rest = 0.5 * (self.rest_gp[j['LeftToeBase']] + self.rest_gp[j['RightToeBase']])
        self.leg = self.rest_gp[self.hips, 1] - self.ankle_rest[1]
        # Each bone's direction: the rig's bones run along their local +Y.
        self.dirs = qrot(self.rest_gq, np.array([0.0, 1.0, 0.0]))


def source_dir(skel, gq, gp, joint, child):
    """Direction of a source bone in its reference pose."""
    j = skel.index[joint]
    if child == 'end':
        return qrot(gq[j], skel.ends[j])
    if child == 'axis':
        return qrot(gq[j], np.array([0.0, 1.0, 0.0]))
    return gp[skel.index[child]] - gp[j]


def heading_of(gq, hips):
    """Yaw (radians, about +Y from +Z) the pelvis faces, per frame."""
    f = qrot(gq[:, hips], FORWARD)
    return np.arctan2(f[:, 0], f[:, 2])


def retarget(src, ref_lq, ref_lt, explorer, mapping, turn=0.0, scale=None, floor=None):
    """
    The explorer posed as the source moves: world rotations per bone, hips position (cm).
    turn: yaw (radians) added to the whole motion. scale: source units -> cm (default: by leg length).
    floor: the source's ankle height when standing on the ground (default: from the reference).
    Returns gq (F, J, 4) world rotations, hips (F, 3), and the source's ankles and toes placed the same way.
    """
    S = src.skel
    T = explorer.skel
    gq_s, gp_s = fk(S, src.lq, src.lt)
    rq_s, rp_s = fk(S, ref_lq, ref_lt)
    # The motion is turned; the reference pose is not (it faces +Z, as the explorer's rest does).
    spin = yaw(turn)
    gq_s = qmul(spin, gq_s)
    gp_s = qrot(spin, gp_s)
    hips_s = S.index[mapping['Hips'][0]]
    ankles_s = [S.index[mapping['LeftFoot'][0]], S.index[mapping['RightFoot'][0]]]
    if scale is None:
        src_leg = rp_s[hips_s, 1] - 0.5 * (rp_s[ankles_s[0], 1] + rp_s[ankles_s[1], 1])
        scale = explorer.leg / src_leg
    if floor is None:
        floor = 0.5 * (rp_s[ankles_s[0], 1] + rp_s[ankles_s[1], 1])
    F = src.frames
    gq = np.empty((F, len(T), 4))
    for b, name in enumerate(T.names):
        if name in mapping:
            joint, child, mode, hint = mapping[name]
            j = S.index[joint]
            if mode == 'world':
                c = qmul(qinv(rq_s[j]), explorer.rest_gq[b])
            else:
                fs = frame_from(source_dir(S, rq_s, rp_s, joint, child), hint)
                ft = frame_from(explorer.dirs[b], hint)
                c = qmul(qmul(qinv(rq_s[j]), fs), qmul(qinv(ft), explorer.rest_gq[b]))
            gq[:, b] = qmul(gq_s[:, j], c)
        else:
            p = T.parents[b]
            gq[:, b] = qmul(gq[:, p], T.rest_q[b]) if p >= 0 else T.rest_q[b]
    origin_s = np.array([gp_s[0, hips_s, 0], floor, gp_s[0, hips_s, 2]])
    origin_t = np.array([explorer.rest_gp[explorer.hips, 0], explorer.ankle_rest[1], explorer.rest_gp[explorer.hips, 2]])

    def place(p):
        return (p - origin_s) * scale + origin_t

    hips = place(gp_s[:, hips_s])
    ankles = np.stack([place(gp_s[:, a]) for a in ankles_s], 1)
    toes = np.stack([place(gp_s[:, S.index[mapping[n][0]]]) for n in ('LeftToeBase', 'RightToeBase')], 1)
    return {'gq': qnorm(gq), 'hips': hips, 'ankles': ankles, 'toes': toes, 'scale': scale, 'fps': src.fps}


def pose(explorer, gq, hips):
    """Local rotations and translations, and world positions (cm), of the explorer for world rotations and hips."""
    T = explorer.skel
    lq = to_local(T, gq)
    lt = np.tile(T.offsets, (gq.shape[0], 1, 1))
    lt[:, explorer.hips] = hips
    _, gp = fk(T, lq, lt)
    return lq, lt, gp


def leg_ik(explorer, gq, hips, targets, weight=None):
    """Bend each leg so its ankle reaches targets[:, side] (cm), the knee kept in its own plane; feet keep their world turn."""
    T = explorer.skel
    gq = gq.copy()
    _, _, gp = pose(explorer, gq, hips)
    for side, prefix in enumerate(('Left', 'Right')):
        a, b, c = T.index[prefix + 'UpLeg'], T.index[prefix + 'Leg'], T.index[prefix + 'Foot']
        A, B, C = gp[:, a], gp[:, b], gp[:, c]
        target = targets[:, side]
        if weight is not None:
            w = weight[:, side, None]
            target = C * (1 - w) + target * w
        l1 = np.linalg.norm(B - A, axis=-1)
        l2 = np.linalg.norm(C - B, axis=-1)
        to = target - A
        d = np.clip(np.linalg.norm(to, axis=-1), np.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-2)
        dir_t = to / np.linalg.norm(to, axis=-1, keepdims=True)
        ac = C - A
        ac = ac / np.linalg.norm(ac, axis=-1, keepdims=True)
        knee = B - A
        pole = knee - np.sum(knee * ac, -1, keepdims=True) * ac
        fwd = qrot(gq[:, explorer.hips], FORWARD)
        weak = np.linalg.norm(pole, axis=-1) < 1e-3 * l1
        pole = np.where(weak[:, None], fwd, pole)
        n = pole - np.sum(pole * dir_t, -1, keepdims=True) * dir_t
        n = n / np.linalg.norm(n, axis=-1, keepdims=True)
        cos_a = np.clip((l1 ** 2 + d ** 2 - l2 ** 2) / (2 * l1 * d), -1, 1)
        sin_a = np.sqrt(1 - cos_a ** 2)
        B2 = A + dir_t * (l1 * cos_a)[:, None] + n * (l1 * sin_a)[:, None]
        r1 = qbetween(B - A, B2 - A)
        C1 = A + qrot(r1, C - A)
        T2 = A + dir_t * d[:, None]
        r2 = qbetween(C1 - B2, T2 - B2)
        foot = gq[:, c].copy()
        gq[:, a] = qmul(r1, gq[:, a])
        gq[:, b] = qmul(r2, qmul(r1, gq[:, b]))
        gq[:, c] = foot
    return qnorm(gq)


def contacts(points, fps, height=4.0, speed=60.0):
    """Frames where each point (F, P, 3; cm) is down and still: near its lowest and moving slowly (cm/s)."""
    floor = np.percentile(points[..., 1], 5, axis=0)
    v = np.zeros(points.shape[:-1])
    v[1:-1] = np.linalg.norm(points[2:, :, :][..., [0, 2]] - points[:-2, :, :][..., [0, 2]], axis=-1) * fps / 2
    v[0], v[-1] = v[1], v[-2]
    return (points[..., 1] < floor + height) & (v < speed)


def strikes(contact, gap=4, least=3):
    """Frames where a run of contact begins (gaps of up to `gap` frames bridged, runs shorter than `least` ignored)."""
    c = contact.astype(bool).copy()
    n = len(c)
    i = 0
    while i < n:
        if not c[i]:
            j = i
            while j < n and not c[j]:
                j += 1
            if 0 < i and j < n and j - i <= gap:
                c[i:j] = True
            i = j
        else:
            i += 1
    out = []
    i = 0
    while i < n:
        if c[i] and (i == 0 or not c[i - 1]):
            j = i
            while j < n and c[j]:
                j += 1
            if j - i >= least and i > 0:
                out.append(i)
            i = j
        else:
            i += 1
    return np.array(out, int)


def close_loop(lq, hips, fps):
    """Make the last frame equal the first (the error spread over the clip); the hips' steady travel taken out."""
    n = lq.shape[0] - 1
    t = np.arange(n + 1) / n
    lq = qcontinuous(lq)
    err = qmul(lq[-1], qinv(lq[0]))
    fix = qslerp(np.broadcast_to(IDENTITY, lq.shape), np.broadcast_to(qinv(err), lq.shape), np.broadcast_to(t[:, None], lq.shape[:2]))
    lq = qnorm(qmul(fix, lq))
    travel = hips[-1] - hips[0]
    hips = hips - travel[None, :] * t[:, None]
    return qcontinuous(lq), hips, travel
