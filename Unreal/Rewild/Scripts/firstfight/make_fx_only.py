"""Remakes only the effect materials (make_fx) and the fighter paint, without rebuilding the level: the quick loop
for tuning the fight's look. Run it like build_fight_level.py (UnrealEditor.exe Rewild.uproject
-ExecutePythonScript=<this file>), then play or run -RewildDemo."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import unreal
import make_fx, import_fighter, rewild_shots as shots
shots.start()
try:
    make_fx.make()
    ao, cav = import_fighter.mask_texture("T_Fighter_AO"), import_fighter.mask_texture("T_Fighter_Cavity")
    paint = import_fighter.paint_material(ao, cav)
    for slot, v in import_fighter.PAINT.items():
        import_fighter.paint_instance(paint, slot, *v)
    shots.finish(True)
except Exception as e:
    shots.fail(e)
