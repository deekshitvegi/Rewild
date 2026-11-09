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


def glow_material(name, colour, intensity, soft_edges=False):
    """Additive streak glow, Colour x Intensity, hot at the head (+Z of the engine cylinder, the way it flies) and
    fading down the tail. Bolts and sparks as evenly lit rods looked like toys (8 Nov 2026). soft_edges fades it
    toward its silhouette and fades the tail more gently: missile flames, drawn on a widening cone (a cylinder of
    flame read as a glowing rod, 9 Nov 2026)."""
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
    if soft_edges:
        code = ("float h = saturate(Z / 100.0 + 0.5); float d = abs(dot(normalize(N), normalize(V)));"
                " return exp(-4.0 * (1.0 - h)) * d * sqrt(d);")
    else:
        code = "float h = saturate(Z / 100.0 + 0.5); return exp(-6.0 * (1.0 - h));"  # 1 at the head, 0.05 mid, 0.0025 tail
    head = node(mat, unreal.MaterialExpressionCustom, -700, 400, description="Streak", code=code,
                output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT1)
    pins = ["Z", "N", "V"] if soft_edges else ["Z"]
    ins = []
    for n in pins:
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", n)
        ins.append(ci)
    head.set_editor_property("inputs", ins)
    mel.connect_material_expressions(z, "", head, "Z")
    if soft_edges:
        mel.connect_material_expressions(node(mat, unreal.MaterialExpressionVertexNormalWS, -1100, 550), "", head, "N")
        mel.connect_material_expressions(node(mat, unreal.MaterialExpressionCameraVectorWS, -1100, 650), "", head, "V")
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
    """Additive shield flash, scaled by Strength (1 at the hit, fading to 0): a bright spot where the hit landed
    (HitPoint, world space, set by RewildFighter) and a ring spreading out from it across the bubble, brighter at
    grazing angles. Lit all over at once, the bubble read as a hard-edged glass egg, and at 3x this a white blob
    over half the screen (9 Nov 2026): peak about 1.5x mid-grey, a 1.5 m spot, a 1 m ring travelling 7 m."""
    mat = unlit("M_FX_Shield", unreal.BlendMode.BLEND_ADDITIVE, two_sided=True)  # visible from the cockpit too
    c = param(mat, unreal.MaterialExpressionVectorParameter, "Colour", -900, 0, unreal.LinearColor(0.5, 0.8, 1.0, 1))
    i = param(mat, unreal.MaterialExpressionScalarParameter, "Intensity", -900, 150, 20000.0)
    s = param(mat, unreal.MaterialExpressionScalarParameter, "Strength", -900, 300, 0.0)
    hit = param(mat, unreal.MaterialExpressionVectorParameter, "HitPoint", -1300, 600, unreal.LinearColor(0, 0, 0, 0))
    rim = node(mat, unreal.MaterialExpressionFresnel, -900, 450, exponent=2.0, base_reflect_fraction=0.0)
    wp = node(mat, unreal.MaterialExpressionWorldPosition, -1300, 450)
    dist = node(mat, unreal.MaterialExpressionDistance, -1100, 500)
    hitp = node(mat, unreal.MaterialExpressionComponentMask, -1150, 650, r=True, g=True, b=True)
    mel.connect_material_expressions(hit, "", hitp, "")
    mel.connect_material_expressions(wp, "", dist, "A")
    mel.connect_material_expressions(hitp, "", dist, "B")
    cust = node(mat, unreal.MaterialExpressionCustom, -700, 400, description="Ripple",
                code="float t = 1.0 - saturate(Strength);"
                     " float ring = exp(-pow((D - t * 700.0) / 100.0, 2.0));"
                     " float spot = exp(-pow(D / 150.0, 2.0)) * Strength;"
                     " return (spot * 1.5 + ring * 0.6) * Strength * (0.5 + 0.5 * Rim);",
                output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT1)
    ins = []
    for n in ("Strength", "D", "Rim"):
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", n)
        ins.append(ci)
    cust.set_editor_property("inputs", ins)
    for name, src in zip(("Strength", "D", "Rim"), (s, dist, rim)):
        mel.connect_material_expressions(src, "", cust, name)
    e = multiply(mat, multiply(mat, c, i, -450, 50), cust, -300, 200)
    mel.connect_material_property(e, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)


def orb():
    """Additive soft glowing point (flares, a missile nozzle): white-hot in the middle, fading to nothing at the
    silhouette, so a sphere never shows its outline."""
    mat = unlit("M_FX_Orb", unreal.BlendMode.BLEND_ADDITIVE)
    c = param(mat, unreal.MaterialExpressionVectorParameter, "Colour", -900, 0, unreal.LinearColor(1, 0.9, 0.8, 1))
    i = param(mat, unreal.MaterialExpressionScalarParameter, "Intensity", -900, 150, 1000000.0)
    rim = node(mat, unreal.MaterialExpressionFresnel, -900, 300, exponent=1.0, base_reflect_fraction=0.0)
    cust = node(mat, unreal.MaterialExpressionCustom, -600, 200, description="Orb",
                code="float core = saturate(1.0 - Rim); float k = core * core * core;"
                     " return lerp(Colour, float3(1.0, 0.97, 0.92), k * k) * Intensity * k;",
                output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    ins = []
    for n in ("Colour", "Intensity", "Rim"):
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", n)
        ins.append(ci)
    cust.set_editor_property("inputs", ins)
    comp = node(mat, unreal.MaterialExpressionComponentMask, -750, 0, r=True, g=True, b=True)
    mel.connect_material_expressions(c, "", comp, "")
    for name, src in zip(("Colour", "Intensity", "Rim"), (comp, i, rim)):
        mel.connect_material_expressions(src, "", cust, name)
    mel.connect_material_property(cust, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def smoke():
    """Missile and flare smoke trails, drawn as ribbons (RewildMissiles turns each stretch of trail, a plane, to
    face the camera): lit translucent (the Sun and Earthshine light it, so it is white in sunlight and grey in shade,
    never a glow), opacity per instance (custom data 0, faded as it spreads), soft across its width and fading over
    the last tenth at each end so neighbouring stretches cross-fade (stretched spheres read as beads, 9 Nov 2026)."""
    mat = fresh(unreal.Material, "M_FX_Smoke", unreal.MaterialFactoryNew())
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_DEFAULT_LIT)
    mat.set_editor_property("translucency_lighting_mode",
                            unreal.TranslucencyLightingMode.TLM_VOLUMETRIC_NON_DIRECTIONAL)
    mat.set_editor_property("two_sided", True)
    mat.set_editor_property("used_with_instanced_static_meshes", True)
    col = param(mat, unreal.MaterialExpressionVectorParameter, "Colour", -900, -150, unreal.LinearColor(0.62, 0.62, 0.6, 1))
    mel.connect_material_property(col, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(node(mat, unreal.MaterialExpressionConstant, -900, 0, r=1.0), "",
                                  unreal.MaterialProperty.MP_ROUGHNESS)
    fade = node(mat, unreal.MaterialExpressionPerInstanceCustomData, -1100, 200, data_index=0, const_default_value=0.0)
    uv = node(mat, unreal.MaterialExpressionTextureCoordinate, -1100, 320)
    cust = node(mat, unreal.MaterialExpressionCustom, -700, 300, description="Ribbon",
                code="float v = abs(UV.y * 2.0 - 1.0); float side = 1.0 - v * v; side *= side;"
                     " float ends = saturate(UV.x / 0.1) * saturate((1.0 - UV.x) / 0.1);"
                     " return saturate(Fade) * side * ends;",
                output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT1)
    ins = []
    for name in ("Fade", "UV"):
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", name)
        ins.append(ci)
    cust.set_editor_property("inputs", ins)
    for name, src in zip(("Fade", "UV"), (fade, uv)):
        mel.connect_material_expressions(src, "", cust, name)
    mel.connect_material_property(cust, "", unreal.MaterialProperty.MP_OPACITY)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)


def make():
    bolt = glow_material("M_FX_Glow", (1, 1, 1), 1.0)
    instance(bolt, "MI_Bolt_Cannon", (1.0, 0.62, 0.3), 600000.0)    # warm white-orange tracer
    instance(bolt, "MI_Bolt_Training", (0.35, 0.75, 1.0), 250000.0)  # the drones' pale blue training bolts
    instance(bolt, "MI_FX_Ember", (1.0, 0.5, 0.15), 400000.0)
    # Milestone 4: the Reapers' molten slugs (deep red-orange, unlike the player's amber tracers), and the missile
    # flames: ours a white-hot solid motor, the Harrow's a deep orange like their seams.
    instance(bolt, "MI_Bolt_Slag", (1.0, 0.28, 0.06), 500000.0)
    plume = glow_material("M_FX_Plume", (1, 1, 1), 1.0, soft_edges=True)
    instance(plume, "MI_FX_PlumeRewild", (1.0, 0.82, 0.58), 120000.0)  # the white-hot point is the nozzle orb
    instance(plume, "MI_FX_PlumeHarrow", (1.0, 0.36, 0.08), 90000.0)
    point = orb()
    instance(point, "MI_FX_FlarePoint", (1.0, 0.93, 0.82), 1500000.0)  # burning magnesium: white
    instance(point, "MI_FX_NozzleRewild", (1.0, 0.88, 0.7), 1200000.0)
    instance(point, "MI_FX_NozzleHarrow", (1.0, 0.45, 0.12), 900000.0)
    smoke()
    fireball()
    shield()
    unreal.log("[rewild] effect materials made in " + DEST)
