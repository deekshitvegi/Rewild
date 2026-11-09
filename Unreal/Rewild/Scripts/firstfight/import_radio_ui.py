"""Brings in what the radio and the menus need (first fight, milestone 5): the mission's voice lines
(art/audio/radio/FC_<id>.wav, made by make_radio.py) as /Game/Audio/Radio/FC_<id>, and the Inter font
(art/fonts/inter, SIL Open Font Licence) as /Game/UI/Fonts/Inter (a font face; RewildUI builds its fonts from it).
Run it like the other scripts (UnrealEditor.exe Rewild.uproject -ExecutePythonScript=<this file>)."""

import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import unreal  # noqa: E402

import rewild_shots as shots  # noqa: E402

REPO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
assets = unreal.EditorAssetLibrary


def import_files(files, dest):
    tasks = []
    for f in files:
        t = unreal.AssetImportTask()
        t.filename = f
        t.destination_path = dest
        t.automated = True
        t.replace_existing = True
        t.save = True
        tasks.append(t)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)
    out = []
    for t in tasks:
        out += list(t.imported_object_paths)
    return out


if __name__ == "__main__":
    shots.start()
    try:
        wavs = sorted(glob.glob(os.path.join(REPO, "art", "audio", "radio", "FC_*.wav")))
        done = import_files(wavs, "/Game/Audio/Radio")
        shots.log(f"{len(done)} radio lines imported (of {len(wavs)})")
        font = import_files([os.path.join(REPO, "art", "fonts", "inter", "Inter-Variable.ttf")], "/Game/UI/Fonts")
        for p in font:
            a = unreal.load_asset(p)
            shots.log(f"font: {p} ({a.get_class().get_name()})")
            if isinstance(a, unreal.FontFace) and a.get_name() != "Inter":
                assets.rename_asset(p.split(".")[0], "/Game/UI/Fonts/Inter")
        shots.finish(True)
    except Exception as e:
        shots.fail(e)
