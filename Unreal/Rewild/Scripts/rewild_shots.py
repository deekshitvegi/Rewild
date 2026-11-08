"""Shared helpers for unattended editor scripts: keep the editor alive, take HighResShots, quit.

Run a script that uses it like this (PowerShell; the -ini override keeps the editor drawing while another
window, such as the Claude app, is in front, or a HighResShot waits forever):

  Start-Process "D:\\Unreal\\UE_5.8\\Engine\\Binaries\\Win64\\UnrealEditor.exe" -PassThru -ArgumentList
    '"<repo>\\Unreal\\Rewild\\Rewild.uproject"', '-ExecutePythonScript="<abs path to script>"',
    '-ini:EditorSettings:[/Script/UnrealEd.EditorPerformanceSettings]:bThrottleCPUWhenNotForeground=False'

Rules learned on 8 Nov 2026 (see CLAUDE.md, "The PC"):
- -ExecutePythonScript closes the editor as soon as the script returns: start() keeps it alive, finish() lets go.
- Never change levels inside the per-frame callback: build the level first, then call take_shots().
"""

import unreal

editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)


def log(msg):
    unreal.log("[rewild] " + msg)


def start():
    """Call first: keep the editor open until finish() even after the script returns."""
    unreal.EditorPythonScripting.set_keep_python_script_alive(True)


def finish(ok=True):
    log("done" if ok else "FAILED")
    unreal.EditorPythonScripting.set_keep_python_script_alive(False)
    unreal.SystemLibrary.quit_editor()


def fail(e):
    import traceback

    unreal.log_error("[rewild] " + repr(e) + "\n" + traceback.format_exc())
    finish(False)


class _ShotRunner:
    def __init__(self, shots, size, settle, on_done):
        self.shots, self.size, self.settle, self.on_done = shots, size, settle, on_done
        self.index, self.wait, self.step, self.task, self.busy = 0, settle, "settle", None, False
        self.handle = unreal.register_slate_post_tick_callback(self.tick)

    def tick(self, dt):
        if self.busy:  # an engine call below ticked Slate again; let it return first
            return
        self.busy = True
        try:
            self._tick(dt)
        except Exception as e:
            unreal.unregister_slate_post_tick_callback(self.handle)
            fail(e)
        finally:
            self.busy = False

    def _tick(self, dt):
        name, cam = self.shots[self.index][:2]
        if self.step == "settle" and self.wait == self.settle and len(self.shots[self.index]) > 2:
            self.shots[self.index][2]()  # this shot's setup: change lights or settings (never the level)
        if self.step == "settle":
            editor.set_level_viewport_camera_info(cam.get_actor_location(), cam.get_actor_rotation())
            self.wait -= dt
            if self.wait <= 0:
                self.task = unreal.AutomationLibrary.take_high_res_screenshot(
                    self.size[0], self.size[1], name, camera=cam, delay=1.5
                )
                self.step = "shooting"
        elif self.step == "shooting" and (self.task is None or self.task.is_task_done()):
            log("shot taken: " + name)
            self.index += 1
            if self.index < len(self.shots):
                self.step, self.wait = "settle", self.settle
            else:
                unreal.unregister_slate_post_tick_callback(self.handle)
                self.on_done()


def take_shots(shots, size=(1920, 1080), settle=6.0, on_done=finish):
    """shots: [(file name, CameraActor)] or [(file name, CameraActor, setup)], where setup() runs once before
    that shot settles (for A/B comparisons). Each camera is held for `settle` seconds (exposure and temporal
    history settle), then shot. Files land in Saved/Screenshots/WindowsEditor/. Calls on_done() at the end."""
    unreal.AutomationLibrary.finish_loading_before_screenshot()
    return _ShotRunner(shots, size, settle, on_done)
