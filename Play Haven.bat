@echo off
rem Fly Haven: the planet system (docs/unreal/HAVEN.md). Needs the D: drive (Unreal 5.8) plugged in and unlocked.
rem You start in orbit, 400 km up, nose down toward the colony. Travel speed grows with height: from orbit to the
rem ground takes about two minutes; under 3 km the fighter flies as it does in the first fight. Hit the ground too
rem steeply and the fighter is lost. No Harrow here yet: this is the world on its own.
rem Mouse to steer, W/S throttle, A/D roll, Shift boost, C chase or cockpit camera, Esc pause, Alt+Enter full screen.
if not exist "D:\Unreal\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe" (
    echo Unreal Engine was not found on D:. Plug in the Seagate drive, unlock it, and try again.
    pause
    exit /b 1
)
start "" "D:\Unreal\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe" "%~dp0Unreal\Rewild\Rewild.uproject" /Game/Worlds/Haven/L_Haven -game -windowed -ResX=1920 -ResY=1080
