"""Effect materials for the fight (first fight, milestone 3), in /Game/FirstFight/FX. build_fight_level.py runs it.

All unlit glow, sized against the exposure for sunlit Earth (EV 14.5: an emissive of about 28,000 is mid-grey, so a
hot bolt needs a few hundred thousand). The C++ loads them by path: RewildBolts (bolts), RewildExplosion
(fireball, embers), RewildFighter (shield).
"""

import unreal

DEST = "/Game/FirstFight/FX"

tools = unreal.AssetToolsHelpers.get_asset_tools()
assets = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary


def fresh(cls, name, factory):
    path = f"{DEST}/{name}"
    if assets.does_asset_exist(path):
        assets.delete_asset(path)
    return tools.create_asset(name, DEST, cls, factory)


def node(mat, cls, x, y, **props):
    n = mel.create_material_expression(mat, cls, x, y)
    for k, v in props.items():
        n.set_editor_property(k, v)
    return n


def param(mat, cls, name, x, y, value):
    p = node(mat, cls, x, y, parameter_name=name)
    p.set_editor_property("default_value", value)
    return p


def multiply(mat, a, b, x, y, a_pin="", b_pin=""):
    m = node(mat, unreal.MaterialExpressionMultiply, x, y)
    mel.connect_material_expressions(a, a_pin, m, "A")
    mel.connect_material_expressions(b, b_pin, m, "B")
    return m


def unlit(name, blend=unreal.BlendMode.BLEND_OPAQUE, two_sided=False):
    mat = fresh(unreal.Material, name, unreal.MaterialFactoryNew())
    mat.set_editor_property("blend_mode", blend)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("two_sided", two_sided)
    # Instanced meshes draw the bolts and embers; a game run cannot add the usage itself and fell back to the
    # default material (first fight run, 8 Nov 2026).
    mat.set_editor_property("used_with_instanced_static_meshes", True)
    return mat


def glow_material(name, colour, intensity):
    """Additive streak glow, Colour x Intensity, hot at the head (+Z of the engine cylinder, the way it flies) and
    fading down the tail. Bolts and sparks as evenly lit rods looked like toys (8 Nov 2026)."""
    mat = unlit(name, unreal.BlendMode.BLEND_ADDITIVE)
    c = param(mat, unreal.MaterialExpressionVectorParameter, "Colour", -600, 0, unreal.LinearColor(*colour, 1))
    i = param(mat, unreal.MaterialExpressionScalarParameter, "Intensity", -600, 200, intensity)
    # Height along the cylinder in its own space: -50 at the tail, +50 at the head, whatever the instance's scale.
    wp = node(mat, unreal.MaterialExpressionWorldPosition, -1300, 400)
    local = node(mat, unreal.MaterialExpressionTransformPosition, -1100, 400,
                 transform_source_type=unreal.MaterialPositionTransformSource.TRANSFORMPOSSOURCE_WORLD,
                 transform_type=unreal.MaterialPositionTransformSource.TRANSFORMPOSSOURCE_LOCAL)
    mel.connect_material_expressions(wp, "", local, "")
    z = node(mat, unreal.MaterialExpressionComponentMask, -900, 400, r=False, g=False, b=True)
    mel.connect_material_expressions(local, "", z, "")
    head = node(mat, unreal.MaterialExpressionCustom, -700, 400, description="Streak",
                code="float h = saturate(Z / 100.0 + 0.5); return exp(-6.0 * (1.0 - h));",  # 1 at the head, 0.05 mid, 0.0025 tail
                output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT1)
    zin = unreal.CustomInput()
    zin.set_editor_property("input_name", "Z")
    head.set_editor_property("inputs", [zin])
    mel.connect_material_expressions(z, "", head, "Z")
    e = multiply(mat, multiply(mat, c, i, -400, 100), head, -250, 250)
    mel.connect_material_property(e, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def instance(parent, name, colour, intensity):
    mi = fresh(unreal.MaterialInstanceConstant, name, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, parent)
    mel.set_material_instance_vector_parameter_value(mi, "Colour", unreal.LinearColor(*colour, 1))
    mel.set_material_instance_scalar_parameter_value(mi, "Intensity", intensity)
    mel.update_material_instance(mi)
    assets.save_loaded_asset(mi)
    return mi


FIREBALL_HLSL = """
// One billow of the fireball (RewildExplosion overlaps five): white-hot at the core, soft at the rim, eaten away by
// slow noise as it fades (Fade 0 born, 1 gone). A single sphere with fine turbulent noise read as a glitter ball,
// and before that a flat orange disc (8 Nov 2026).
float core = 1.0 - Rim;                                     // 1 facing the camera, 0 at the silhouette
float soft = core * core;                                   // a soft edge, no hard outline
float alive = saturate((Noise - Fade) * 3.0 + 0.9 - Fade);  // whole when born, breaks up as it fades
float hot = soft * soft * (1.0 - Fade);
float3 c = lerp(Colour, float3(1.0, 0.93, 0.8), hot);       // white-yellow in the middle, the colour outside
return c * Intensity * (1.0 - Fade) * (1.0 - Fade) * soft * alive * (0.75 + 0.5 * Noise);
"""


def fireball():
    """Additive fireball for RewildExplosion: Colour, Intensity, Fade (0 born, 1 gone)."""
    mat = unlit("M_FX_Fireball", unreal.BlendMode.BLEND_ADDITIVE)
    c = param(mat, unreal.MaterialExpressionVectorParameter, "Colour", -1100, 0, unreal.LinearColor(1, 0.55, 0.2, 1))
    i = param(mat, unreal.MaterialExpressionScalarParameter, "Intensity", -1100, 150, 300000.0)
    fade = param(mat, unreal.MaterialExpressionScalarParameter, "Fade", -1100, 300, 0.0)
    rim = node(mat, unreal.MaterialExpressionFresnel, -1100, 450, exponent=1.5, base_reflect_fraction=0.0)
    # Slow billowing noise in world space, drifting so it churns while it lives (features about 4 m).
    wp = node(mat, unreal.MaterialExpressionWorldPosition, -1500, 600)
    t = node(mat, unreal.MaterialExpressionTime, -1500, 700)
    drift = multiply(mat, t, node(mat, unreal.MaterialExpressionConstant3Vector, -1500, 780,
                                  constant=unreal.LinearColor(120, -80, 260, 0)), -1300, 720)
    pos = node(mat, unreal.MaterialExpressionAdd, -1150, 650)
    mel.connect_material_expressions(wp, "", pos, "A")
    mel.connect_material_expressions(drift, "", pos, "B")
    noise = node(mat, unreal.MaterialExpressionNoise, -950, 650, scale=0.0025, levels=3, turbulence=False,
                 output_min=0.0, output_max=1.0)
    mel.connect_material_expressions(pos, "", noise, "Position")
    comp = node(mat, unreal.MaterialExpressionComponentMask, -900, 0, r=True, g=True, b=True)
    mel.connect_material_expressions(c, "", comp, "")
    pins = ["Colour", "Intensity", "Fade", "Rim", "Noise"]
    cust = node(mat, unreal.MaterialExpressionCustom, -600, 300, code=FIREBALL_HLSL, description="Fireball",
                output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    inputs = []
    for n in pins:
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", n)
        inputs.append(ci)
    cust.set_editor_property("inputs", inputs)
    for name, src in zip(pins, (comp, i, fade, rim, noise)):
        mel.connect_material_expressions(src, "", cust, name)
    mel.connect_material_property(cust, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)


def shield():
    """Additive, seen mostly at grazing angles (a field bubble reads at its rim), scaled by Strength (hit flash)."""
    mat = unlit("M_FX_Shield", unreal.BlendMode.BLEND_ADDITIVE, two_sided=True)  # visible from the cockpit too
    c = param(mat, unreal.MaterialExpressionVectorParameter, "Colour", -900, 0, unreal.LinearColor(0.5, 0.8, 1.0, 1))
    i = param(mat, unreal.MaterialExpressionScalarParameter, "Intensity", -900, 150, 40000.0)
    s = param(mat, unreal.MaterialExpressionScalarParameter, "Strength", -900, 300, 0.0)
    rim = node(mat, unreal.MaterialExpressionFresnel, -900, 450, exponent=2.5, base_reflect_fraction=0.06)
    e = multiply(mat, multiply(mat, c, i, -650, 50), multiply(mat, s, rim, -650, 350), -350, 150)
    mel.connect_material_property(e, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)


def make():
    bolt = glow_material("M_FX_Glow", (1, 1, 1), 1.0)
    instance(bolt, "MI_Bolt_Cannon", (1.0, 0.62, 0.3), 600000.0)    # warm white-orange tracer
    instance(bolt, "MI_Bolt_Training", (0.35, 0.75, 1.0), 250000.0)  # the drones' pale blue training bolts
    instance(bolt, "MI_FX_Ember", (1.0, 0.5, 0.15), 400000.0)
    fireball()
    shield()
    unreal.log("[rewild] effect materials made in " + DEST)
