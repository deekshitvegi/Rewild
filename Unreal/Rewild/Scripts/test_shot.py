"""Set-up check: build a sky-only test level and take two HighResShots, then quit the editor.

Run from the repo root:
  "D:\\Unreal\\UE_5.8\\Engine\\Binaries\\Win64\\UnrealEditor.exe" Unreal\\Rewild\\Rewild.uproject
      -ExecutePythonScript="<abs path>\\Unreal\\Rewild\\Scripts\\test_shot.py"
      -ini:EditorSettings:[/Script/UnrealEd.EditorPerformanceSettings]:bThrottleCPUWhenNotForeground=False

The -ini override matters: by default ("Use Less CPU when in Background") the editor stops drawing whenever
another window is in front, and a HighResShot then never completes (8 Nov 2026: stuck 10 minutes behind the
Claude app). The override lasts only for that run.

The level (/Game/Dev/TestShot) has only Unreal's physically based sky: Sky Atmosphere, Volumetric Cloud,
a sun and a real-time sky light. Shots land in Saved/Screenshots/WindowsEditor/.

The level is built once, when the script runs; only the waiting and the shots happen in the per-frame
callback. Never change levels inside that callback: a level change ticks Slate, which calls the callback
again mid-change (8 Nov 2026: two nested NewLevel calls left a world in memory and the editor stopped).
"""

import unreal

LEVEL = "/Game/Dev/TestShot"
SHOT_SIZE = (1920, 1080)

# (file name, camera location in cm, camera rotation pitch/yaw, field of view)
SHOTS = [
    ("TestShot_golden_hour.png", unreal.Vector(0, 0, 150_000), (4.0, 160.0), 60.0),  # 1.5 km up, towards the low sun
    ("TestShot_orbit.png", unreal.Vector(0, 0, 12_000_000), (-12.0, 150.0), 60.0),  # 120 km up, the planet's curve
]

SETTLE_SECONDS = 6.0  # frames before each shot, so exposure and cloud history settle

SPAWNED = (
    unreal.DirectionalLight,
    unreal.SkyAtmosphere,
    unreal.SkyLight,
    unreal.VolumetricCloud,
    unreal.ExponentialHeightFog,
    unreal.CameraActor,
)

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)


def log(msg):
    unreal.log("[test_shot] " + msg)


def spawn(cls, loc=unreal.Vector(0, 0, 0), rot=unreal.Rotator(0, 0, 0)):
    return actors.spawn_actor_from_class(cls, loc, rot)


def make_movable(actor):
    actor.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)


def open_level():
    """Open /Game/Dev/TestShot (made if missing), with none of the actors this script spawns."""
    current = editor.get_editor_world()
    if current and current.get_path_name().startswith(LEVEL + "."):
        pass
    elif unreal.EditorAssetLibrary.does_asset_exist(LEVEL):
        levels.load_level(LEVEL)
    elif not levels.new_level(LEVEL):
        # NewLevel makes the level but can fail to save it; save it under its path ourselves.
        if not unreal.EditorLoadingAndSavingUtils.save_map(editor.get_editor_world(), LEVEL):
            raise RuntimeError("could not make " + LEVEL)
    for a in actors.get_all_level_actors():
        if isinstance(a, SPAWNED):
            actors.destroy_actor(a)


def build_level():
    open_level()

    # Sun 6 degrees above the horizon. A light shines along its forward axis, so the sun sits towards -X.
    sun = spawn(unreal.DirectionalLight, rot=unreal.Rotator(roll=0, pitch=-6, yaw=0))
    make_movable(sun)
    sc = sun.light_component
    sc.set_editor_property("intensity", 10.0)
    sc.set_editor_property("atmosphere_sun_light", True)
    sc.set_editor_property("atmosphere_sun_light_index", 0)

    spawn(unreal.SkyAtmosphere)

    sky = spawn(unreal.SkyLight)
    make_movable(sky)
    sky.light_component.set_editor_property("real_time_capture", True)

    cloud = spawn(unreal.VolumetricCloud)
    cc = cloud.get_component_by_class(unreal.VolumetricCloudComponent)
    if cc.get_editor_property("material") is None:
        cc.set_editor_property(
            "material", unreal.load_asset("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst")
        )

    # No height fog: Sky Atmosphere already gives aerial perspective, and fog at this scale painted a flat beige
    # wall over the ground at 1.5 km and over space at 120 km (first shots, 8 Nov 2026).

    cams = []
    for name, loc, (pitch, yaw), fov in SHOTS:
        cam = spawn(unreal.CameraActor, loc, unreal.Rotator(roll=0, pitch=pitch, yaw=yaw))
        cam.camera_component.set_editor_property("field_of_view", fov)
        cam.set_actor_label("Cam_" + name.replace(".png", ""))
        cams.append(cam)

    if not levels.save_current_level():
        raise RuntimeError("could not save " + LEVEL)
    log("level built and saved: " + LEVEL)
    return cams


class Runner:
    def __init__(self, cams):
        self.cams = cams
        self.step = "settle"
        self.index = 0
        self.wait = SETTLE_SECONDS
        self.task = None
        self.busy = False
        self.handle = unreal.register_slate_post_tick_callback(self.tick)

    def finish(self, ok):
        unreal.unregister_slate_post_tick_callback(self.handle)
        log("done" if ok else "FAILED")
        unreal.EditorPythonScripting.set_keep_python_script_alive(False)
        unreal.SystemLibrary.quit_editor()

    def tick(self, dt):
        if self.busy:  # an engine call below ticked Slate again; let it return first
            return
        self.busy = True
        try:
            self._tick(dt)
        except Exception as e:  # never leave the editor hanging on an error
            unreal.log_error("[test_shot] " + repr(e))
            self.finish(False)
        finally:
            self.busy = False

    def _tick(self, dt):
        if self.step == "settle":
            cam = self.cams[self.index]
            editor.set_level_viewport_camera_info(cam.get_actor_location(), cam.get_actor_rotation())
            self.wait -= dt
            if self.wait <= 0:
                name = SHOTS[self.index][0]
                self.task = unreal.AutomationLibrary.take_high_res_screenshot(
                    SHOT_SIZE[0], SHOT_SIZE[1], name, camera=cam, delay=1.5  # frames at the camera's own FOV
                )
                log("shot requested: " + name)
                self.step = "shooting"
        elif self.step == "shooting":
            if self.task is None or self.task.is_task_done():
                log("shot taken: " + SHOTS[self.index][0])
                self.index += 1
                if self.index >= len(self.cams):
                    self.step, self.wait = "quit", 3.0
                else:
                    self.step, self.wait = "settle", SETTLE_SECONDS
        elif self.step == "quit":
            self.wait -= dt
            if self.wait <= 0:
                self.finish(True)


# -ExecutePythonScript closes the editor as soon as the script returns unless it is kept alive;
# the shots are taken over the next frames, so keep it alive until Runner.finish.
unreal.EditorPythonScripting.set_keep_python_script_alive(True)

try:
    _cams = build_level()
    unreal.AutomationLibrary.finish_loading_before_screenshot()
    runner = Runner(_cams)
except Exception as e:
    unreal.log_error("[test_shot] " + repr(e))
    log("FAILED")
    unreal.EditorPythonScripting.set_keep_python_script_alive(False)
    unreal.SystemLibrary.quit_editor()
