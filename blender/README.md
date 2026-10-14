# Sunset Flight

A Blender script that builds an animated scene: a commercial jet backlit by a
low sun, flying through layered volumetric clouds with light shafts.

## Run it

**First time — use the GUI so you can see what you got:**

1. Open Blender
2. Switch to the **Scripting** workspace (tab along the top)
3. **Open** → pick `sunset_flight.py`
4. **Run Script** (or Alt+P)
5. Hover the viewport and press **Numpad 0** to look through the camera
6. Switch the viewport to **Rendered** shading (the rightmost sphere icon,
   top-right of the viewport) to see the clouds and rays

**Headless:**

```bash
blender --background --python sunset_flight.py            # build only
blender --background --python sunset_flight.py -- --render # build and render
```

Output goes to `~/blender_sunset_flight/` — an `.mp4` plus a `.blend` of the
scene so you can open and poke at it.

## Tuning

Everything adjustable is in the `CONFIG` dict at the top of the script.

| Want to change | Setting |
|---|---|
| Faster test renders | `preview: True` (960×540, low samples) |
| Final quality | `preview: False`, `engine: "CYCLES"` |
| More orange | `sky_dust` (0–10), `sun_elevation_deg` toward 0 |
| Thicker clouds | `deck_density`, `wisp_density` |
| Stronger rays | `haze_density` (small steps — 0.02 to 0.06) |
| Faster flight | `cloud_drift` |
| Shot length | `frame_end` (24 frames = 1 second) |

## Known rough edges

- **The aircraft is a stylised stand-in**, not a real airliner. It is built
  from primitives: swept tapered wings, a tube fuselage, two nacelles, nav
  lights. Backlit against a sunset it reads as a rim-lit silhouette, which
  hides a lot — but it will not survive a close, front-lit look. To use a real
  model, set `aircraft_model_path` in `CONFIG` to a `.glb`, `.fbx`, `.obj` or
  `.blend` file and adjust `aircraft_model_scale` so the fuselage is roughly
  32 m long.

- **Sky/lamp azimuth convention.** The script aims a Sun lamp and Blender's
  Sky texture from one `sun_azimuth_deg` value. If the sky's bright spot and
  the lamp's shadow direction disagree, set `sky_azimuth_offset_deg` to 90,
  180 or 270 until they line up.

- **EEVEE vs Cycles.** EEVEE renders in seconds per frame and fakes the
  volumetrics convincingly. Cycles gives true light shafts and costs 50–200×
  more time. Start in EEVEE.

- **This script has never been executed.** It was written and syntax-checked
  without Blender available; the geometry math is unit-tested but every `bpy`
  call is unverified. Expect to fix something on the first run.
