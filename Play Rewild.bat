@echo off
rem Play Rewild: the first fight, 400 km above Egypt. Needs the D: drive (Unreal 5.8) plugged in and unlocked.
rem Mouse to steer, left button guns, right button missile (hold the nose on a target until the ring locks), F flares,
rem W/S throttle, A/D roll, Shift boost, C chase or cockpit camera, Alt+Enter full screen, Esc quit.
rem The Harrow's Reapers come after 35 s of practice; add -RewildHarrow to the line below to meet them at once.
rem The first start takes about a minute while Unreal loads Earth.
if not exist "D:\Unreal\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe" (
    echo Unreal Engine was not found on D:. Plug in the Seagate drive, unlock it, and try again.
    pause
    exit /b 1
)
start "" "D:\Unreal\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe" "%~dp0Unreal\Rewild\Rewild.uproject" /Game/FirstFight/Maps/L_FirstFight -game -windowed -ResX=1920 -ResY=1080
