#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "InputActionValue.h"
#include "RewildFighter.generated.h"

class UCameraComponent;
class UInstancedStaticMeshComponent;
class UInputAction;
class UInputMappingContext;
class UMaterialInstanceDynamic;
class USpringArmComponent;
class UStaticMeshComponent;

/**
 * The player's fighter (first fight, milestone 2: flying).
 *
 * Arcade space flight with flight assist: the ship turns at fixed rates, and its velocity swings round toward where
 * the nose points over about a second, so it drifts a little in hard turns. The mouse is a virtual stick: moving it
 * offsets an aim cursor, and the ship turns toward the cursor in proportion to the offset. Throttle sets cruising
 * speed; boost runs hotter and faster until the engines overheat.
 *
 * Keyboard and mouse: mouse to steer, W/S throttle, A/D roll, Shift boost, C chase or cockpit camera, Esc quit.
 * Gamepad: left stick steers, triggers throttle, shoulders roll, A boost, right stick press camera.
 *
 * -RewildDemo on the command line flies a scripted run, takes HighResShots from both cameras and quits.
 */
UCLASS()
class REWILD_API ARewildFighter : public APawn
{
	GENERATED_BODY()

public:
	ARewildFighter();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	/** The aim cursor, -1..1 on each axis (the HUD draws it). */
	FVector2D GetAimCursor() const { return AimCursor; }
	float GetSpeedMetresPerSecond() const { return Velocity.Size() / 100.f; }
	float GetThrottle() const { return Throttle; }
	float GetBoostHeat() const { return BoostHeat; }
	bool IsCockpitView() const { return bCockpitView; }

protected:
	virtual void BeginPlay() override;

	// Flight figures. Speeds in metres per second, rates in degrees per second.
	UPROPERTY(EditAnywhere, Category = "Flight") float CruiseSpeedMax = 220.f;  // about 800 km/h relative to the fight
	UPROPERTY(EditAnywhere, Category = "Flight") float BoostSpeed = 420.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float PitchRate = 80.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float YawRate = 55.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float RollRate = 160.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float BankIntoTurns = 25.f;   // roll added by steering sideways
	UPROPERTY(EditAnywhere, Category = "Flight") float Assist = 1.6f;          // how fast velocity follows the nose (1/s)
	UPROPERTY(EditAnywhere, Category = "Flight") float ThrottleRate = 0.6f;    // throttle travel per second
	UPROPERTY(EditAnywhere, Category = "Flight") float MouseSensitivity = 0.0025f; // cursor travel per mouse count
	UPROPERTY(EditAnywhere, Category = "Flight") float BoostHeatRate = 0.25f;  // full heat in 4 s of boost
	UPROPERTY(EditAnywhere, Category = "Flight") float BoostCoolRate = 0.15f;
	UPROPERTY(EditAnywhere, Category = "Engines") float GlowIdle = 8000.f;     // M_FighterEngine Glow at idle
	UPROPERTY(EditAnywhere, Category = "Engines") float GlowFull = 100000.f;   // full throttle (x1.6 on boost): reads hot at EV 14.5

private:
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Hull;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Canopy;
	UPROPERTY(VisibleAnywhere) TObjectPtr<USpringArmComponent> ChaseArm;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> ChaseCamera;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> CockpitCamera;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Dust;

	UPROPERTY() TObjectPtr<UInputMappingContext> Mapping;
	UPROPERTY() TObjectPtr<UInputAction> LookAction;
	UPROPERTY() TObjectPtr<UInputAction> StickAction;
	UPROPERTY() TObjectPtr<UInputAction> RollAction;
	UPROPERTY() TObjectPtr<UInputAction> ThrottleAction;
	UPROPERTY() TObjectPtr<UInputAction> BoostAction;
	UPROPERTY() TObjectPtr<UInputAction> CameraAction;
	UPROPERTY() TObjectPtr<UInputAction> QuitAction;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> EngineGlow;

	void BuildInput();
	void OnLook(const FInputActionValue& Value);
	void OnStick(const FInputActionValue& Value);
	void OnStickReleased(const FInputActionValue& Value);
	void OnRoll(const FInputActionValue& Value);
	void OnRollReleased(const FInputActionValue& Value);
	void OnThrottle(const FInputActionValue& Value);
	void OnThrottleReleased(const FInputActionValue& Value);
	void OnBoost(const FInputActionValue& Value);
	void OnBoostReleased(const FInputActionValue& Value);
	void OnCamera(const FInputActionValue& Value);
	void OnQuit(const FInputActionValue& Value);

	void SetCockpitView(bool bCockpit);
	void Fly(float DeltaSeconds);
	void UpdateDust();
	void TickDemo(float DeltaSeconds);

	FVector Velocity = FVector::ZeroVector;  // cm/s, world
	FVector2D AimCursor = FVector2D::ZeroVector;
	FVector2D Stick = FVector2D::ZeroVector;
	float RollInput = 0.f;
	float ThrottleInput = 0.f;
	float Throttle = 0.5f;
	float BoostHeat = 0.f;
	bool bBoostHeld = false;
	bool bOverheated = false;
	bool bCockpitView = false;

	TArray<FVector> DustOffsets;  // speck positions relative to the camera, wrapped inside a box

	bool bDemo = false;
	float DemoTime = 0.f;
	int32 DemoStep = 0;
};
