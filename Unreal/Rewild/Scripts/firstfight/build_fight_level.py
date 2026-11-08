"""Build /Game/FirstFight/Maps/L_FirstFight: the playable level (first fight, milestone 2: flying).

Earth, its atmosphere, the Sun, the clouds and the exposure come from build_earth.py (shared with the Earth stills);
the player starts at the world origin, 400 km above Egypt, heading west-north-west with the Sun over the left
shoulder, flying ARewildFighter (C++). Run with rewild_shots.py's command line, then play with "Play Rewild.bat".
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "earth"))
import unreal  # noqa: E402

import build_earth as earth  # noqa: E402
import make_fx  # noqa: E402
import rewild_shots as shots  # noqa: E402

LEVEL = "/Game/FirstFight/Maps/L_FirstFight"
START_HEADING = 300.0  # degrees from north: the Sun (azimuth 225) behind the left shoulder


def build():
    make_fx.make()
    mesh, radius, clouds = earth.prepare_assets()
    earth.open_level(LEVEL, earth.TAG)
    earth.earth_stack(mesh, radius, clouds)
    heading = unreal.Rotator(roll=0, pitch=0, yaw=START_HEADING)
    earth.spawn(unreal.PlayerStart, unreal.Vector(0, 0, 0), heading, "Start")
    # The training range lays its drones out ahead of the start (milestone 3).
    earth.spawn(unreal.load_class(None, "/Script/Rewild.RewildTrainingRange"), unreal.Vector(0, 0, 0), heading,
                "Training range")

    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    settings = world.get_world_settings()
    settings.set_editor_property("default_game_mode", unreal.load_class(None, "/Script/Rewild.RewildGameMode"))
    if not unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level():
        raise RuntimeError("could not save " + LEVEL)
    shots.log("level built: " + LEVEL)


if __name__ == "__main__":
    shots.start()
    try:
        build()
        shots.finish(True)
    except Exception as e:
        shots.fail(e)
