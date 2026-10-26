# 04 — Buy vs build

What would it cost to buy a drone that does what ours will do? Here's what we want, from the
[requirements](01-requirements.md):

1. Manual stick flight, including acro
2. FPV video in goggles
3. Control from a phone or laptop
4. Indoor autonomy: hold position without GPS
5. Outdoor GPS autonomy: return-to-home and waypoint missions
6. Under 250 g
7. Programmable: we write and change the flight code

Prices are from shop and deal listings found in October 2026. They move around, so treat them
as ±10%.

## The options

| | DJI Neo 2 kit | DJI Mini 5 Pro | Hobby 3-inch FPV + INAV | Crazyflie 2.1 Brushless | **Our build** |
|---|---|---|---|---|---|
| What you buy | Neo 2 Motion Fly More Combo (Goggles N3, RC Motion 3, 3 batteries) + FPV Remote Controller 3 | Drone + RC-N3 controller | GEPRC CineLog30 V3 O4 Pro + goggles, radio, charger, batteries, GPS | Drone + Flow deck v2 + USB radio | Everything in the [BOM](../analysis/bom-report.md) |
| Price | **~€600–700** | **~€660–760** | **~€1,060–1,090** | **~€630** | **~€970** to fly with FPV, **~€1,300** with everything |
| Mass | 151 g | ~249 g | ~265 g with a 4S pack | ~40 g | ~206 g |
| 1. Manual stick flight | ~ "manual mode" via the FPV RC 3, a trainer rather than full acro | ✗ | ✓ | ~ gamepad | ✓ |
| 2. FPV goggles | ✓ | ✗ not confirmed | ✓ better camera (O4 Pro) | ✗ | ✓ |
| 3. Phone/laptop control | ✓ DJI Fly app | ✓ | ✗ unless you add our ESP32 bridge | ✓ BLE app, Python API | ✓ (Block 3) |
| 4. Indoor position hold | ✓ vision + sensors | ✓ | ✗ | ✓ flow deck | ✓ (Block 4) |
| 5. GPS return-home / waypoints | ~ return-home yes, waypoints not found | ✓ both | ✓ both, after setup and tuning | ✗ indoor only | ✓ (Block 5) |
| 6. Under 250 g | ✓ | ✓ just | ✗ | ✓ | ✓ |
| 7. Programmable | ✗ no SDK found | ✗ no SDK yet | ~ open firmware, but you configure it rather than write it | ✓ fully open | ✓ every line is ours |
| Works on day one | ✓ | ✓ | ✓ mostly | ✓ | ✗ we have to make it work |

✓ = yes, ~ = partly, ✗ = no.

## What the numbers say

- **If you just want a drone that does these things, buying is cheaper.** A DJI Neo 2 kit with
  the FPV controller costs about half our full budget and flies well on day one. It's under
  250 g, has goggles, phone control and holds position on its own. What you don't get:
  - waypoint missions (we found no evidence it has them);
  - real acro flying (DJI calls its manual mode a trainer);
  - any way to change how it flies.
- **No off-the-shelf drone covers all seven.** The open options each miss about half. The
  Crazyflie is programmable and holds position indoors, but has no FPV and no GPS. An INAV
  hobby quad does FPV and GPS missions, but has no phone link, no indoor hold, and comes in
  over 250 g, which brings more paperwork in France.
- **Our ~€1,300 isn't all drone:**

  | Part of the €1,300 | Cost | Notes |
  |---|---:|---|
  | Ground gear (radio, goggles, charger, safety kit, simulator) | ~€480 | Reusable with any future FPV drone |
  | Spares, firmware dev kit and test gear | ~€270 | |
  | Parts for the drone itself | ~€550 | |

  The hobby-quad route needs the same ground gear, which is why it costs as much as our build
  while doing less.

## What the extra money buys

- **The engineering.** You'll understand and own every layer: why it's 206 g, why the rate loop
  has the gains it has, what happens when the radio link drops. That's the project.
- **Repairs at part prices.** A crash costs a €4 prop set or a €15 motor, not a send-back to DJI.
- **Room to grow.** Every behaviour is code we can change, test in the simulator, and fly.
- **The goggles aren't wasted** if you change your mind: Goggles N3 also work with the DJI Neo 2.

A buy-first route would be the DJI Neo 2 kit (~€650): it flies on day one, and you'd keep the
goggles. But nothing on it is programmable, and it uses DJI's controllers, so it teaches
neither the engineering nor the stick skills that transfer to our drone. For learning to fly,
the simulator plus the RadioMaster Pocket is the cheaper and more transferable trainer.

## Sources

- DJI Neo 2: [TechRadar review](https://www.techradar.com/cameras/drones/dji-neo-2-review),
  [DroneCompare specs](https://dronecompare.org/dji-neo-2/),
  [Motion Fly More Combo price (monsterdealz)](https://www.monsterdealz.de/hobby-freizeit/drohnen-fahrraeder-sport/dji-neo-2-motion-fly-more-combo-goggles-n3-amazon-deal/1517153),
  [PCGH deal report](https://www.pcgameshardware.de/Amazon-Firma-17639/News/dji-neo-2-motion-fly-more-combo-4k-drohne-bestpreis-1545070/),
  [manual mode firmware (DroneDJ)](https://dronedj.com/2025/11/27/dji-neo-2-manual-fpv/),
  [manual mode needs FPV RC 3 (HireDronePilot)](https://hiredronepilot.uk/blog/how-to-fly-dji-neo-2-in-manual-mode/)
- DJI Mini 5 Pro: [PriceRunner specs](https://www.pricerunner.se/pl/1559-3432747913/Radiostyrda-leksaker/DJI-Mini-5-Pro-priser),
  [Fnac bundle price (Chollometro)](https://www.chollometro.com/ofertas/dji-mini-5-pro-certificado-c0-dron-ultraligero-y-plegable-con-camara-cmos-de-1-deteccion-obstaculos-omnidireccional-activetrack-360-1947272),
  [goggles pairing report (Drohnen-Forum)](https://www.drohnen-forum.de/index.php/Thread/69583-Welche-Goggles-f%C3%BCr-die-Mini-5-Pro/),
  [SDK status (Litchi forum)](https://forum.flylitchi.com/t/availability-mini-5-pro/28574)
- GEPRC CineLog30 V3: [Rotorama](https://www.rotorama.com/product/geprc-cinelog30-v3-o4-elrs2-4g),
  [FPV24](https://www.fpv24.com/en/geprc/geprc-cinelog30-v3-dji-o4-pro-quadcopter-elrs-24g);
  INAV navigation: [INAV docs](https://github.com/iNavFlight/inav/blob/master/docs/Navigation.md)
- Crazyflie: [Crazyflie 2.1 Brushless (RobotShop UK)](https://uk.robotshop.com/products/crazyflie-21-brushless-version-open-source-micro-quadcopter-drone),
  [Flow deck v2 (RobotShop EU)](https://eu.robotshop.com/products/bitcraze-crazyflie-2x-flow-deck-v2),
  [Crazyflie ecosystem overview](https://community.robotshop.com/blog/show/exploring-bitcraze-crazyflie-a-modular-micro-drone-ecosystem)
- Not found, estimated: the FPV Remote Controller 3 (~€100) and the Crazyradio (~€40).
