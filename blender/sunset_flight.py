"""
Sunset Flight - a procedural Blender scene: a commercial jet backlit by a low
sun, flying through layered volumetric clouds with light shafts.

HOW TO RUN
----------
GUI (recommended the first time):
    Open Blender -> Scripting tab -> Open -> this file -> Run Script
    Then look through the camera with Numpad 0.

Headless, build only:
    blender --background --python sunset_flight.py

Headless, build and render the animation:
    blender --background --python sunset_flight.py -- --render

Tested against the bpy API for Blender 3.6 through 4.x. Version differences are
handled defensively: anything optional is set through set_if_exists() or
pick_enum() so a renamed or removed property degrades the look instead of
crashing the script.
"""

import os
import sys
from math import radians, tan, sin, cos, pi

import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------
# CONFIG - everything you'd want to tweak lives here
# ---------------------------------------------------------------------------

CONFIG = {
    # --- quality -----------------------------------------------------------
    # 'EEVEE' renders in seconds per frame and fakes volumetrics convincingly.
    # 'CYCLES' gives true volumetric light shafts but is 50-200x slower.
    "engine": "EEVEE",
    "preview": True,          # True = 960x540, low samples. Flip to False for final.
    "samples": 64,            # raised automatically when preview is False

    # --- timing ------------------------------------------------------------
    "fps": 24,
    "frame_start": 1,
    "frame_end": 120,         # 120 frames @ 24fps = 5 seconds

    # --- the sun -----------------------------------------------------------
    # Elevation near 0 puts the sun on the horizon. Azimuth 180 puts it dead
    # behind the aircraft (nose points +Y); 168 nudges it off-axis so the disc
    # peeks past the fuselage, which is what creates the rays.
    "sun_elevation_deg": 2.0,
    "sun_azimuth_deg": 168.0,
    # If the sky's bright spot and the lamp's shadows disagree, Blender's sky
    # azimuth convention differs from what I assumed - try 90, 180 or 270 here.
    "sky_azimuth_offset_deg": 0.0,
    "sun_lamp_energy": 6.0,
    "sun_lamp_color": (1.0, 0.42, 0.16),
    "sun_softness_deg": 2.5,  # larger = softer shadow edges = hazier rays
    "sky_strength": 0.9,
    "sky_dust": 6.0,          # 0-10. This is the orange dial. Higher = oranger.
    "sky_altitude_m": 1500.0, # low altitude keeps the warm thick-atmosphere look

    # --- camera ------------------------------------------------------------
    "lens_mm": 50.0,
    "camera_location": (24.0, -46.0, 2.5),
    "camera_target": (0.0, 2.0, 0.5),

    # --- clouds ------------------------------------------------------------
    "cloud_drift": 900.0,     # metres of cloud travel over the shot = speed
    "deck_density": 7.0,
    "wisp_density": 3.0,
    "haze_density": 0.025,    # the thin stuff the rays actually show up in

    # --- aircraft ----------------------------------------------------------
    # Leave as None to build the simple procedural jet below. Point it at a
    # .glb / .gltf / .fbx / .obj / .blend to use a real model instead -
    # see "WHAT'S MISSING" in the README. This is the single biggest upgrade.
    "aircraft_model_path": None,
    "aircraft_model_scale": 1.0,

    # --- output ------------------------------------------------------------
    "output_dir": os.path.expanduser("~/blender_sunset_flight"),
    "video": True,            # True = one .mp4, False = numbered PNGs
    "save_blend": True,
}

if not CONFIG["preview"]:
    CONFIG["samples"] = 256


# ---------------------------------------------------------------------------
# VERSION-SAFETY HELPERS
# ---------------------------------------------------------------------------

def set_if_exists(owner, attr, value):
    """Set owner.attr only if this Blender version has it. Returns success."""
    if not hasattr(owner, attr):
        return False
    try:
        setattr(owner, attr, value)
        return True
    except Exception:
        return False


def pick_enum(owner, prop, candidates):
    """Return the first candidate that is a legal enum value here, else None.

    This is how the script survives renames like BLENDER_EEVEE ->
    BLENDER_EEVEE_NEXT without knowing your Blender version in advance.
    """
    try:
        valid = {item.identifier for item in owner.bl_rna.properties[prop].enum_items}
    except Exception:
        return candidates[0] if candidates else None
    for candidate in candidates:
        if candidate in valid:
            return candidate
    return None


def set_enum(owner, prop, candidates):
    choice = pick_enum(owner, prop, candidates)
    if choice is not None:
        return set_if_exists(owner, prop, choice)
    return False


def set_input(node, names, value):
    """Set the first socket that exists. Socket names move between versions,
    e.g. 'Specular' became 'Specular IOR Level' in Blender 4.0."""
    for name in names:
        if name in node.inputs:
            try:
                node.inputs[name].default_value = value
                return True
            except Exception:
                pass
    return False


def iter_fcurves(action):
    """Yield fcurves from both legacy and slotted (Blender 4.4+) actions."""
    if action is None:
        return
    try:
        for fcurve in action.fcurves:
            yield fcurve
        if len(action.fcurves):
            return
    except Exception:
        pass
    try:
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fcurve in bag.fcurves:
                        yield fcurve
    except Exception:
        pass


def set_interpolation(owner, mode):
    """Force every keyframe on owner's action to one interpolation mode."""
    try:
        action = owner.animation_data.action
    except Exception:
        return
    for fcurve in iter_fcurves(action):
        for keyframe in fcurve.keyframe_points:
            keyframe.interpolation = mode


# ---------------------------------------------------------------------------
# GEOMETRY HELPERS
# ---------------------------------------------------------------------------

def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_object(name, verts, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    return link(bpy.data.objects.new(name, mesh))


def make_box(name, size_x, size_y, size_z, location=(0, 0, 0)):
    """A box built at true dimensions, so object scale stays 1.0 and texture
    coordinates stay un-stretched. Matters a lot for the cloud volumes."""
    hx, hy, hz = size_x / 2.0, size_y / 2.0, size_z / 2.0
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = mesh_object(name, verts, faces)
    obj.location = location
    return obj


def _panel_geometry(span, root_chord, tip_chord, sweep_deg, thickness,
                    dihedral_deg, sign):
    """One tapered, swept, dihedral'd lifting surface pointing along sign*X."""
    sweep_offset = span * tan(radians(sweep_deg))
    leading = root_chord * 0.5
    planform = [
        (0.0, leading),
        (0.0, leading - root_chord),
        (span, leading - sweep_offset - tip_chord),
        (span, leading - sweep_offset),
    ]
    rise = tan(radians(dihedral_deg))
    half = thickness * 0.5
    verts = []
    for dz in (-half, half):
        for (x, y) in planform:
            verts.append((sign * x, y, dz + x * rise))
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    if sign < 0:
        faces = [tuple(reversed(face)) for face in faces]
    return verts, faces


def panel_pair(name, span, root_chord, tip_chord, sweep_deg, thickness,
               dihedral_deg, location):
    """A mirrored pair of lifting surfaces in a single mesh (wings, tailplane)."""
    right_v, right_f = _panel_geometry(span, root_chord, tip_chord, sweep_deg,
                                       thickness, dihedral_deg, 1.0)
    left_v, left_f = _panel_geometry(span, root_chord, tip_chord, sweep_deg,
                                     thickness, dihedral_deg, -1.0)
    offset = len(right_v)
    verts = right_v + left_v
    faces = right_f + [tuple(i + offset for i in f) for f in left_f]
    obj = mesh_object(name, verts, faces)
    obj.location = location
    return obj


def single_panel(name, span, root_chord, tip_chord, sweep_deg, thickness,
                 location, rotation=(0, 0, 0)):
    verts, faces = _panel_geometry(span, root_chord, tip_chord, sweep_deg,
                                   thickness, 0.0, 1.0)
    obj = mesh_object(name, verts, faces)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def cylinder(name, radius, depth, location, along_y=True, vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location,
        rotation=(radians(90), 0, 0) if along_y else (0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    return obj


def sphere(name, radius, location, scale=(1, 1, 1), segments=32):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=segments // 2, radius=radius,
        location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    return obj


def cone(name, radius1, radius2, depth, location, rotation):
    bpy.ops.mesh.primitive_cone_add(
        vertices=32, radius1=radius1, radius2=radius2, depth=depth,
        location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def shade_smooth(obj):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    set_if_exists(obj.data, "use_auto_smooth", True)


def assign(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


# ---------------------------------------------------------------------------
# SCENE SETUP
# ---------------------------------------------------------------------------

def clear_scene():
    """Wipe objects and orphaned data so re-running the script is idempotent."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                       bpy.data.cameras, bpy.data.worlds, bpy.data.actions,
                       bpy.data.node_groups, bpy.data.images):
        for item in list(collection):
            try:
                collection.remove(item)
            except Exception:
                pass


def setup_render():
    scene = bpy.context.scene
    render = scene.render

    if CONFIG["engine"].upper() == "CYCLES":
        set_enum(render, "engine", ["CYCLES"])
        cycles = scene.cycles
        set_if_exists(cycles, "samples", CONFIG["samples"])
        set_if_exists(cycles, "use_denoising", True)
        set_if_exists(cycles, "volume_bounces", 2)
        set_if_exists(cycles, "volume_step_rate", 1.0)
        set_if_exists(cycles, "transmission_bounces", 4)
        set_enum(cycles, "device", ["GPU"])
    else:
        # 'BLENDER_EEVEE_NEXT' in 4.2+, 'BLENDER_EEVEE' before that.
        set_enum(render, "engine", ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"])
        eevee = scene.eevee
        set_if_exists(eevee, "taa_render_samples", CONFIG["samples"])
        set_if_exists(eevee, "use_gtao", True)

        # Volumetric range defaults to 100m - far too small for a 1km scene.
        # Without this the clouds and rays simply do not appear.
        set_if_exists(eevee, "volumetric_start", 0.5)
        set_if_exists(eevee, "volumetric_end", 3000.0)
        set_if_exists(eevee, "volumetric_tile_size", '4' if CONFIG["preview"] else '2')
        set_if_exists(eevee, "volumetric_samples", 64 if CONFIG["preview"] else 128)
        set_if_exists(eevee, "use_volumetric_shadows", True)   # <- makes the shafts
        set_if_exists(eevee, "volumetric_shadow_samples", 32)
        set_if_exists(eevee, "use_volumetric_lights", True)
        set_if_exists(eevee, "volumetric_ray_depth", 8)        # EEVEE Next
        set_if_exists(eevee, "shadow_ray_count", 2)
        set_if_exists(eevee, "shadow_step_count", 8)
        # Bloom is handled in the compositor instead, for version consistency.
        set_if_exists(eevee, "use_bloom", False)

    width, height = (960, 540) if CONFIG["preview"] else (1920, 1080)
    render.resolution_x = width
    render.resolution_y = height
    render.resolution_percentage = 100
    render.fps = CONFIG["fps"]
    scene.frame_start = CONFIG["frame_start"]
    scene.frame_end = CONFIG["frame_end"]

    set_if_exists(render, "use_motion_blur", True)
    set_if_exists(scene.eevee, "use_motion_blur", True)

    # Blender 4.x defaults to the AgX view transform, which tames saturated
    # oranges hard. Punchy look brings the sunset back.
    set_enum(scene.view_settings, "view_transform", ["AgX", "Filmic", "Standard"])
    set_enum(scene.view_settings, "look",
             ["AgX - Punchy", "Punchy", "Filmic - Medium High Contrast", "None"])
    set_if_exists(scene.view_settings, "exposure", -0.2)

    os.makedirs(CONFIG["output_dir"], exist_ok=True)
    if CONFIG["video"]:
        render.filepath = os.path.join(CONFIG["output_dir"], "sunset_flight.mp4")
        render.image_settings.file_format = 'FFMPEG'
        set_enum(render.ffmpeg, "format", ["MPEG4"])
        set_enum(render.ffmpeg, "codec", ["H264"])
        set_enum(render.ffmpeg, "constant_rate_factor", ["HIGH"])
        set_enum(render.ffmpeg, "ffmpeg_preset", ["GOOD"])
    else:
        render.filepath = os.path.join(CONFIG["output_dir"], "frame_")
        render.image_settings.file_format = 'PNG'


def sun_direction():
    """Unit vector pointing FROM the scene TOWARD the sun."""
    elevation = radians(CONFIG["sun_elevation_deg"])
    azimuth = radians(CONFIG["sun_azimuth_deg"])
    # azimuth 0 puts the sun toward -Y; it rotates counter-clockwise about Z.
    horizontal = cos(elevation)
    return Vector((horizontal * sin(azimuth),
                   -horizontal * cos(azimuth),
                   sin(elevation)))


def build_world():
    """Nishita sky: physically-based atmosphere, which is what makes a
    believable sunset gradient rather than a hand-painted one."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new("SunsetSky")
    scene.world = world
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()

    sky = tree.nodes.new('ShaderNodeTexSky')
    sky.location = (-400, 0)
    set_enum(sky, "sky_type", ["NISHITA"])
    set_if_exists(sky, "sun_elevation", radians(CONFIG["sun_elevation_deg"]))
    set_if_exists(sky, "sun_rotation",
                  radians(CONFIG["sun_azimuth_deg"] + CONFIG["sky_azimuth_offset_deg"]))
    set_if_exists(sky, "altitude", CONFIG["sky_altitude_m"])
    set_if_exists(sky, "air_density", 1.0)
    set_if_exists(sky, "dust_density", CONFIG["sky_dust"])
    set_if_exists(sky, "ozone_density", 1.2)
    set_if_exists(sky, "sun_intensity", 0.8)
    set_if_exists(sky, "sun_size", radians(1.2))
    set_if_exists(sky, "sun_disc", True)

    background = tree.nodes.new('ShaderNodeBackground')
    background.location = (-150, 0)
    background.inputs['Strength'].default_value = CONFIG["sky_strength"]

    output = tree.nodes.new('ShaderNodeOutputWorld')
    output.location = (50, 0)

    tree.links.new(sky.outputs['Color'], background.inputs['Color'])
    tree.links.new(background.outputs['Background'], output.inputs['Surface'])


def build_sun_lamp():
    """A real Sun lamp, aimed to agree with the sky texture. The lamp (not the
    sky) is what casts shadows into the haze, and shadows in haze are rays."""
    data = bpy.data.lights.new("SunLamp", type='SUN')
    data.energy = CONFIG["sun_lamp_energy"]
    data.color = CONFIG["sun_lamp_color"]
    set_if_exists(data, "angle", radians(CONFIG["sun_softness_deg"]))
    set_if_exists(data, "use_shadow", True)

    lamp = link(bpy.data.objects.new("SunLamp", data))
    lamp.location = sun_direction() * 800.0
    look_at(lamp, (0, 0, 0))
    return lamp


# ---------------------------------------------------------------------------
# MATERIALS
# ---------------------------------------------------------------------------

def surface_material(name, base_color, metallic=0.0, roughness=0.5):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        set_input(principled, ["Base Color"], base_color)
        set_input(principled, ["Metallic"], metallic)
        set_input(principled, ["Roughness"], roughness)
        set_input(principled, ["Specular IOR Level", "Specular"], 0.5)
    return material


def emission_material(name, color, strength):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    emission = tree.nodes.new('ShaderNodeEmission')
    emission.location = (-200, 0)
    emission.inputs['Color'].default_value = color
    emission.inputs['Strength'].default_value = strength
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    output.location = (50, 0)
    tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])
    return material, emission


def cloud_material(name, density, size_z, noise_scale=2.5,
                   squash=3.5, threshold=(0.44, 0.60), anisotropy=0.35):
    """Volume shader: 4D noise -> contrast ramp -> density, multiplied by a
    vertical falloff so the containing box never shows its edges. That falloff
    is the difference between 'clouds' and 'fog in a cube'."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    nodes, links = tree.nodes, tree.links

    coords = nodes.new('ShaderNodeTexCoord')
    coords.location = (-1400, 0)

    mapping = nodes.new('ShaderNodeMapping')
    mapping.location = (-1200, 100)
    base = 1.0 / 320.0
    mapping.inputs['Scale'].default_value = (base, base, base * squash)

    noise = nodes.new('ShaderNodeTexNoise')
    noise.location = (-1000, 100)
    set_enum(noise, "noise_dimensions", ["4D"])
    noise.inputs['Scale'].default_value = noise_scale
    noise.inputs['Detail'].default_value = 10.0
    set_input(noise, ["Roughness"], 0.55)
    set_input(noise, ["Distortion"], 0.4)
    set_input(noise, ["Lacunarity"], 2.0)

    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.location = (-800, 100)
    ramp.color_ramp.elements[0].position = threshold[0]
    ramp.color_ramp.elements[1].position = threshold[1]

    # --- vertical falloff: 1 at the slab's centre, 0 at top and bottom ------
    separate = nodes.new('ShaderNodeSeparateXYZ')
    separate.location = (-1200, -250)

    normalize = nodes.new('ShaderNodeMath')
    normalize.location = (-1000, -250)
    normalize.operation = 'DIVIDE'
    normalize.inputs[1].default_value = max(size_z * 0.5, 0.001)

    absolute = nodes.new('ShaderNodeMath')
    absolute.location = (-820, -250)
    absolute.operation = 'ABSOLUTE'

    invert = nodes.new('ShaderNodeMath')
    invert.location = (-640, -250)
    invert.operation = 'SUBTRACT'
    invert.inputs[0].default_value = 1.0
    invert.use_clamp = True

    soften = nodes.new('ShaderNodeMath')
    soften.location = (-460, -250)
    soften.operation = 'POWER'
    soften.inputs[1].default_value = 0.7

    shape = nodes.new('ShaderNodeMath')
    shape.location = (-280, 0)
    shape.operation = 'MULTIPLY'

    amount = nodes.new('ShaderNodeMath')
    amount.location = (-120, 0)
    amount.operation = 'MULTIPLY'
    amount.inputs[1].default_value = density

    volume = nodes.new('ShaderNodeVolumePrincipled')
    volume.location = (80, 0)
    set_input(volume, ["Color"], (1.0, 0.98, 0.96, 1.0))
    set_input(volume, ["Anisotropy"], anisotropy)  # forward scatter = silver lining

    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (320, 0)

    links.new(coords.outputs['Object'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    links.new(coords.outputs['Object'], separate.inputs['Vector'])
    links.new(separate.outputs['Z'], normalize.inputs[0])
    links.new(normalize.outputs['Value'], absolute.inputs[0])
    links.new(absolute.outputs['Value'], invert.inputs[1])
    links.new(invert.outputs['Value'], soften.inputs[0])
    links.new(ramp.outputs['Color'], shape.inputs[0])
    links.new(soften.outputs['Value'], shape.inputs[1])
    links.new(shape.outputs['Value'], amount.inputs[0])
    links.new(amount.outputs['Value'], volume.inputs['Density'])
    # Surface is deliberately left unconnected - volume only.
    links.new(volume.outputs['Volume'], output.inputs['Volume'])

    return material, mapping


# ---------------------------------------------------------------------------
# THE AIRCRAFT
# ---------------------------------------------------------------------------

def build_procedural_jet():
    """A stylised narrow-body airliner, roughly 737-sized, in metres.

    It is deliberately simple. Backlit against a sunset the aircraft reads
    mostly as a rim-lit silhouette, which hides a lot - but it will not stand
    up to a close, front-lit look. Swap in a real model for that.
    """
    root = link(bpy.data.objects.new("Aircraft", None))
    root.empty_display_size = 4.0

    body_mat = surface_material("Fuselage", (0.82, 0.83, 0.86, 1.0),
                                metallic=0.35, roughness=0.32)
    dark_mat = surface_material("DarkTrim", (0.03, 0.03, 0.04, 1.0),
                                metallic=0.6, roughness=0.45)

    parts = []

    fuselage = cylinder("Fuselage", radius=1.9, depth=32.0, location=(0, 0, 0))
    shade_smooth(fuselage)
    parts.append((fuselage, body_mat))

    nose = sphere("Nose", radius=1.9, location=(0, 16.0, 0), scale=(1, 1.9, 1))
    shade_smooth(nose)
    parts.append((nose, body_mat))

    tailcone = cone("TailCone", radius1=1.9, radius2=0.45, depth=7.0,
                    location=(0, -19.4, 0.55), rotation=(radians(-90), 0, 0))
    shade_smooth(tailcone)
    parts.append((tailcone, body_mat))

    wings = panel_pair("Wings", span=16.0, root_chord=5.6, tip_chord=1.8,
                       sweep_deg=25.0, thickness=0.55, dihedral_deg=6.0,
                       location=(0, -1.5, -0.9))
    parts.append((wings, body_mat))

    stabilisers = panel_pair("Stabilisers", span=6.2, root_chord=3.0,
                             tip_chord=1.1, sweep_deg=30.0, thickness=0.32,
                             dihedral_deg=5.0, location=(0, -19.5, 1.6))
    parts.append((stabilisers, body_mat))

    fin = single_panel("Fin", span=6.6, root_chord=4.6, tip_chord=1.9,
                       sweep_deg=42.0, thickness=0.4,
                       location=(0, -19.0, 1.7), rotation=(0, radians(-90), 0))
    parts.append((fin, body_mat))

    for side, label in ((1.0, "R"), (-1.0, "L")):
        nacelle = cylinder("Nacelle_" + label, radius=1.55, depth=5.4,
                           location=(side * 6.6, 1.6, -2.4))
        shade_smooth(nacelle)
        parts.append((nacelle, body_mat))

        inlet = cylinder("Inlet_" + label, radius=1.35, depth=0.5,
                         location=(side * 6.6, 4.2, -2.4), vertices=24)
        parts.append((inlet, dark_mat))

        pylon = make_box("Pylon_" + label, 0.45, 3.0, 2.0,
                         location=(side * 6.6, 0.4, -1.5))
        parts.append((pylon, body_mat))

    # Navigation lights - tiny, but they sell the silhouette as an aircraft.
    port_mat, _ = emission_material("NavRed", (1.0, 0.05, 0.05, 1.0), 60.0)
    star_mat, _ = emission_material("NavGreen", (0.05, 1.0, 0.15, 1.0), 60.0)
    strobe_mat, strobe_node = emission_material("Strobe", (1.0, 1.0, 1.0, 1.0), 0.0)

    tip_rise = 16.0 * tan(radians(6.0)) - 0.9
    port = sphere("NavPort", 0.32, (-16.0, -2.6, tip_rise), segments=12)
    parts.append((port, port_mat))
    starboard = sphere("NavStarboard", 0.32, (16.0, -2.6, tip_rise), segments=12)
    parts.append((starboard, star_mat))
    strobe = sphere("Strobe", 0.3, (0, -21.0, 8.0), segments=12)
    parts.append((strobe, strobe_mat))

    for obj, material in parts:
        assign(obj, material)
        obj.parent = root

    animate_strobe(strobe_mat, strobe_node)
    return root


def import_aircraft_model(path):
    """Import a real aircraft model and parent it under an animated empty."""
    path = os.path.expanduser(path)
    if not os.path.exists(path):
        print("[sunset_flight] Model not found: %s - using procedural jet." % path)
        return None

    before = set(bpy.data.objects)
    extension = os.path.splitext(path)[1].lower()
    try:
        if extension in (".glb", ".gltf"):
            bpy.ops.import_scene.gltf(filepath=path)
        elif extension == ".fbx":
            bpy.ops.import_scene.fbx(filepath=path)
        elif extension == ".obj":
            # Blender 4.x uses wm.obj_import; 3.x used import_scene.obj.
            if hasattr(bpy.ops.wm, "obj_import"):
                bpy.ops.wm.obj_import(filepath=path)
            else:
                bpy.ops.import_scene.obj(filepath=path)
        elif extension == ".blend":
            with bpy.data.libraries.load(path) as (source, target):
                target.objects = source.objects
            for obj in target.objects:
                if obj is not None:
                    link(obj)
        else:
            print("[sunset_flight] Unsupported format %s" % extension)
            return None
    except Exception as error:
        print("[sunset_flight] Import failed (%s) - using procedural jet." % error)
        return None

    imported = [obj for obj in bpy.data.objects if obj not in before]
    if not imported:
        return None

    root = link(bpy.data.objects.new("Aircraft", None))
    root.empty_display_size = 4.0
    scale = CONFIG["aircraft_model_scale"]
    for obj in imported:
        if obj.parent is None:
            obj.parent = root
            obj.scale = tuple(component * scale for component in obj.scale)
    print("[sunset_flight] Imported %d objects from %s" % (len(imported), path))
    return root


def animate_strobe(material, emission_node):
    """Anti-collision strobe: two bright frames per second, hard on/off."""
    socket = emission_node.inputs['Strength']
    for frame in range(CONFIG["frame_start"], CONFIG["frame_end"] + 1):
        phase = (frame - CONFIG["frame_start"]) % CONFIG["fps"]
        socket.default_value = 400.0 if phase < 2 else 0.0
        socket.keyframe_insert(data_path="default_value", frame=frame)
    set_interpolation(material.node_tree, 'CONSTANT')


# ---------------------------------------------------------------------------
# CLOUDS
# ---------------------------------------------------------------------------

def build_clouds():
    """Three participating media, each doing a different job.

    deck  - the lumpy cloud layer below; this is what casts the shadows
    wisps - thin streaks at aircraft altitude; these sell the speed
    haze  - near-invisible global fog; the rays are only visible *in* this
    """
    layers = []

    deck = make_box("CloudDeck", 2400.0, 2400.0, 220.0, location=(0, 300, -150))
    deck_mat, deck_map = cloud_material(
        "CloudDeckVolume", CONFIG["deck_density"], 220.0,
        noise_scale=2.2, squash=4.0, threshold=(0.42, 0.58))
    assign(deck, deck_mat)
    layers.append((deck_map, 1.0))

    wisps = make_box("CloudWisps", 1400.0, 1800.0, 90.0, location=(0, 120, 6))
    wisp_mat, wisp_map = cloud_material(
        "CloudWispVolume", CONFIG["wisp_density"], 90.0,
        noise_scale=4.5, squash=6.0, threshold=(0.52, 0.66), anisotropy=0.5)
    assign(wisps, wisp_mat)
    layers.append((wisp_map, 2.6))   # nearer the camera, so parallax faster

    haze = make_box("Haze", 3000.0, 3000.0, 900.0, location=(0, 300, 120))
    haze_mat, haze_map = cloud_material(
        "HazeVolume", CONFIG["haze_density"], 900.0,
        noise_scale=0.8, squash=1.0, threshold=(0.0, 1.0), anisotropy=0.6)
    assign(haze, haze_mat)

    animate_cloud_drift(layers)
    return deck, wisps, haze


def animate_cloud_drift(layers):
    """Move the clouds past a stationary aircraft - the standard VFX cheat.
    Cheaper than flying the plane 900m, and it keeps framing locked."""
    for mapping, speed in layers:
        socket = mapping.inputs['Location']
        for frame, fraction in ((CONFIG["frame_start"], 0.0),
                                (CONFIG["frame_end"], 1.0)):
            travel = CONFIG["cloud_drift"] * fraction * speed
            socket.default_value = (0.0, travel, 0.0)
            socket.keyframe_insert(data_path="default_value", frame=frame)
    for mapping, _ in layers:
        set_interpolation(mapping.id_data, 'LINEAR')


# ---------------------------------------------------------------------------
# CAMERA AND ANIMATION
# ---------------------------------------------------------------------------

def build_camera():
    data = bpy.data.cameras.new("Camera")
    data.lens = CONFIG["lens_mm"]
    data.clip_start = 0.1
    # Default clip_end is 100m, which would clip the entire sky and cloud deck.
    data.clip_end = 20000.0
    camera = link(bpy.data.objects.new("Camera", data))
    camera.location = CONFIG["camera_location"]
    look_at(camera, CONFIG["camera_target"])
    bpy.context.scene.camera = camera
    return camera


def animate_aircraft(root):
    """Slow roll, gentle bob and a touch of yaw, so it looks like it is being
    carried by air rather than sliding along a rail."""
    start, end = CONFIG["frame_start"], CONFIG["frame_end"]
    span = max(end - start, 1)
    step = max(span // 8, 1)
    for frame in range(start, end + 1, step):
        t = (frame - start) / float(span)
        root.rotation_euler = (radians(1.6 * sin(t * pi * 2.0)),
                               radians(3.2 * sin(t * pi * 2.0 + 0.6)),
                               radians(0.8 * sin(t * pi * 1.3)))
        root.location = (0.0,
                         0.0,
                         0.55 * sin(t * pi * 2.0 + 1.1))
        root.keyframe_insert(data_path="rotation_euler", frame=frame)
        root.keyframe_insert(data_path="location", frame=frame)
    set_interpolation(root, 'BEZIER')


def animate_camera(camera):
    start, end = CONFIG["frame_start"], CONFIG["frame_end"]
    base = Vector(CONFIG["camera_location"])
    span = max(end - start, 1)
    step = max(span // 6, 1)
    for frame in range(start, end + 1, step):
        t = (frame - start) / float(span)
        camera.location = base + Vector((
            -3.5 * t,
            1.5 * sin(t * pi),
            0.9 * sin(t * pi * 1.7),
        ))
        look_at(camera, CONFIG["camera_target"])
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
    set_interpolation(camera, 'BEZIER')


# ---------------------------------------------------------------------------
# COMPOSITING
# ---------------------------------------------------------------------------

def setup_compositor():
    """Glare gives the sun its bloom and streaks. Wrapped in try/except because
    the Glare node's sockets were reworked in recent Blender releases - losing
    the bloom is survivable, crashing is not."""
    scene = bpy.context.scene
    try:
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()

        layers = tree.nodes.new('CompositorNodeRLayers')
        layers.location = (-600, 0)

        bloom = tree.nodes.new('CompositorNodeGlare')
        bloom.location = (-350, 120)
        set_enum(bloom, "glare_type", ["FOG_GLOW", "BLOOM"])
        set_enum(bloom, "quality", ["MEDIUM" if CONFIG["preview"] else "HIGH"])
        set_if_exists(bloom, "mix", -0.25)
        set_if_exists(bloom, "threshold", 0.85)
        set_if_exists(bloom, "size", 8)

        streaks = tree.nodes.new('CompositorNodeGlare')
        streaks.location = (-120, 120)
        set_enum(streaks, "glare_type", ["STREAKS"])
        set_enum(streaks, "quality", ["MEDIUM" if CONFIG["preview"] else "HIGH"])
        set_if_exists(streaks, "mix", -0.55)
        set_if_exists(streaks, "threshold", 0.95)
        set_if_exists(streaks, "streaks", 6)
        set_if_exists(streaks, "angle_offset", radians(12.0))
        set_if_exists(streaks, "fade", 0.88)

        composite = tree.nodes.new('CompositorNodeComposite')
        composite.location = (140, 0)

        tree.links.new(layers.outputs['Image'], bloom.inputs['Image'])
        tree.links.new(bloom.outputs['Image'], streaks.inputs['Image'])
        tree.links.new(streaks.outputs['Image'], composite.inputs['Image'])
    except Exception as error:
        print("[sunset_flight] Compositor setup skipped: %s" % error)


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    version = ".".join(str(part) for part in bpy.app.version)
    print("[sunset_flight] Blender %s" % version)

    clear_scene()
    setup_render()
    build_world()
    build_sun_lamp()

    aircraft = None
    if CONFIG["aircraft_model_path"]:
        aircraft = import_aircraft_model(CONFIG["aircraft_model_path"])
    if aircraft is None:
        aircraft = build_procedural_jet()

    build_clouds()
    camera = build_camera()

    animate_aircraft(aircraft)
    animate_camera(camera)
    setup_compositor()

    bpy.context.scene.frame_set(CONFIG["frame_start"])

    if CONFIG["save_blend"]:
        blend_path = os.path.join(CONFIG["output_dir"], "sunset_flight.blend")
        try:
            bpy.ops.wm.save_as_mainfile(filepath=blend_path)
            print("[sunset_flight] Saved scene: %s" % blend_path)
        except Exception as error:
            print("[sunset_flight] Could not save .blend: %s" % error)

    print("[sunset_flight] Scene built. Output dir: %s" % CONFIG["output_dir"])

    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--render" in argv:
        print("[sunset_flight] Rendering frames %d-%d ..."
              % (CONFIG["frame_start"], CONFIG["frame_end"]))
        bpy.ops.render.render(animation=True)
        print("[sunset_flight] Done: %s" % bpy.context.scene.render.filepath)
    else:
        print("[sunset_flight] Press Numpad 0 to look through the camera, "
              "or re-run with  -- --render  to render.")


if __name__ == "__main__":
    main()
