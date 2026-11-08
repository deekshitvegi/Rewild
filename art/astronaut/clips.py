"""
The explorer's motions: where each one comes from and how it is cut.

src 'cmu': a BVH file of the CMU Graphics Lab Motion Capture Database (path under cmu/, as the
una-dinosauria/cmu-mocap repository lays them out), frames at 120 a second, frame 0 being the
T-pose of the BVH conversion; `frames` (first, last) cuts it, in those 120 fps frames.
src 'ual': an animation of Quaternius's Universal Animation Library (standard, CC0).

kind 'cycle': a loop of locomotion, cut from one left-heel strike to the next (`strides` of them;
or `cycle` [first, last] in 30 fps frames of the cut; or `whole` for a source that already
loops), played by the game in step with the ground covered, blended with its neighbours by speed.
kind 'loop': standing, about `length` seconds from `start` (seconds into the cut), closed.
kind 'once': played from its start (`start`/`end`, seconds into the cut) and held at its end.
face: 'travel' (default for cycles: turned so the motion goes along +Z), 'start' (default
otherwise: the hips face +Z at the start), 'pelvis' (on average), or a yaw in degrees.
moon: retimed for that gravity (m/s^2): flights stretched (`stretch` air, ground), ballistic hips.
spread: degrees the arms are held out from the body (the suit's bulk; default 6).
gaze: the neck and head turned by one steady amount so the face looks ahead, this many degrees
below level on average (some actors watched the floor or looked off to one side).
"""

CLIPS = [
    # ---- on foot, by speed (the game blends neighbours by speed over the ground, in step)
    dict(name='walk', src='cmu', file='035/35_01.bvh', kind='cycle', gaze=4),
    dict(name='walk-brisk', src='cmu', file='132/132_17.bvh', kind='cycle', gaze=4),
    dict(name='jog', src='cmu', file='035/35_17.bvh', kind='cycle', gaze=3),
    # Second takes of the walk and the jog, mixed in by a wandering share so no two strides match.
    dict(name='walk-b', src='cmu', file='035/35_02.bvh', kind='cycle', gaze=4),
    dict(name='jog-b', src='cmu', file='035/35_18.bvh', kind='cycle', gaze=3),
    dict(name='run', src='cmu', file='016/16_46.bvh', kind='cycle', gaze=3),
    dict(name='sprint', src='ual', anim='Sprint_Loop', kind='cycle', whole=True, inplace=True, gaze=3),
    # ---- weak gravity: the jog retimed for the Moon, long floating strides (the Apollo lope)
    dict(name='lope', src='cmu', file='035/35_17.bvh', kind='cycle', moon=1.62, stretch=(2.8, 1.3), gaze=3),
    # ---- standing: a quiet stance (weight settling from foot to foot), and now and then something else
    dict(name='idle', src='cmu', file='077/77_02.bvh', kind='loop', start=0.5, length=4.5, face='pelvis', gaze=8),
    dict(name='idle-shift', src='cmu', file='077/77_02.bvh', frames=(480, 935), kind='once', face='pelvis', gaze=8),
    dict(name='idle-stretch', src='cmu', file='141/141_13.bvh', kind='once'),
    # A glance at the wrist display: the standing take with the arm and head moved (retarget.py glance_at_wrist).
    dict(name='idle-wrist', src='cmu', file='077/77_02.bvh', frames=(60, 330), kind='once', face='pelvis', wrist=True, gaze=8),
    # ---- jumping and landing
    dict(name='jump', src='cmu', file='016/16_01.bvh', kind='once'),
    dict(name='land-heavy', src='cmu', file='082/82_02.bvh', frames=(1262, 1650), kind='once'),
    # ---- other things
    dict(name='pickup', src='ual', anim='Interact', kind='once'),
    dict(name='swim', src='cmu', file='126/126_10.bvh', kind='loop', start=2.0, length=2.0, face='pelvis', flip=True, ik=False),
    dict(name='tread', src='ual', anim='Swim_Idle_Loop', kind='loop', start=0, length=3.3, ik=False),
]
