# drone/ — a small quadcopter, from scratch

An engineering design project: a sub-250 g, 3-inch quadcopter with our own frame and our own
flight-control firmware. It flies by hand, streams FPV video, talks to a phone or laptop, and
works up to indoor and GPS autonomy.

**Project facts:** flying in France, indoors and outdoors. Budget €1,000, up to €1,500 if
needed. Starting with no equipment.

| Document | What's in it |
|---|---|
| [docs/01-requirements.md](docs/01-requirements.md) | What it must do, each line testable, including French rules |
| [docs/02-architecture.md](docs/02-architecture.md) | System design, trade-offs, firmware plan, test ladder, roadmap, risks |
| [docs/03-components.md](docs/03-components.md) | Every part chosen and why, French rules, power budget, sources |
| [docs/04-buy-vs-build.md](docs/04-buy-vs-build.md) | What an off-the-shelf drone with the same features would cost |
| [firmware/README.md](firmware/README.md) | Our flight controller and the simulator it's tested in |
| [analysis/sizing-report.md](analysis/sizing-report.md) | Mass, power, flight time and motor KV by configuration and battery |
| [analysis/bom-report.md](analysis/bom-report.md) | Shopping list and costs against the budget |

## Status

- [x] Phase 1 — Requirements
- [x] Phase 2 — Architecture and first sizing
- [x] Phase 3 — Component selection (shopping list approved; **ready to order**)
- [ ] Phase 4 — Frame design: CAD, arm stiffness check, print
- [ ] Phase 5 — Build + Betaflight baseline (**Block 0**)
- [ ] Phase 6 — Firmware (**Blocks 1–5**)
  - [x] Simulator and flight-controller core: ANGLE/ACRO modes, arming and failsafe pass 28
    of 28 requirement checks
  - [ ] Drivers on the dev board, then on the drone

Current numbers for the full build: **206 g**, ~9 min hover, ~6 min mixed flying.

Cost: ~€970 to fly with FPV (Blocks 0–2). ~€1,240 with spares, the firmware dev kit and test
gear. ~€1,300 with everything up to Block 5.

## Decisions

| # | Date | Decision | Why |
|---|---|---|---|
| D-001 | 2026-10-26 | Own frame + own firmware, on off-the-shelf electronics | Deep learning value without a PCB's lead time and extra debug layer |
| D-002 | 2026-10-26 | Sub-250 g, 3-inch props | Room for sensors; forgiving in crashes; light regulation |
| D-003 | 2026-10-26 | Goals: manual flight, FPV, phone link, autonomy, delivered in blocks | One capability at a time, each tested before the next |
| D-004 | 2026-10-26 | STM32 AIO board; prove it on Betaflight, then run our firmware on the same board | Hardware and firmware faults are never tangled |
| D-005 | 2026-10-26 | Wi-Fi on an ESP32-C3 companion, speaking MAVLink | Wi-Fi can't stall the control loop; QGroundControl works out of the box |
| D-006 | 2026-10-26 | RC transmitter stays primary, with kill-switch authority over everything | Safety (REQ-S2, REQ-S3) |
| D-007 | 2026-10-26 | Baseline battery 4S 650 mAh | Meets mass and endurance targets with the most common 3-inch motor class |
| D-008 | 2026-10-26 | Flight controller: GEPRC Taker F405 20A AIO with built-in ELRS | Best F405 board we checked against Betaflight's pin maps: 5 free UARTs, ICM-42688-P, baro, 16 MB flash |
| D-009 | 2026-10-26 | FPV: digital, DJI O4 Air Unit Lite + Goggles N3 | Clear image for a new pilot, onboard recording, simple OSD protocol; fits the budget |
| D-010 | 2026-10-26 | Motors BetaFPV 1404 3800KV; two prop types decided on the thrust stand | 11% above the minimum KV; our first real test data |
| D-011 | 2026-10-26 | Radio: RadioMaster Pocket ELRS, EU LBT version | Enough switches; doubles as the simulator controller; EU-legal |
| D-012 | 2026-10-26 | F405 (not F7/H7) as the target for our firmware | No data cache to fight with DMA; best documented; enough compute |
| D-013 | 2026-10-26 | Build rather than buy | A DJI Neo 2 kit costs about half as much, but no product covers all seven goals or can be programmed ([04](docs/04-buy-vs-build.md)) |
| D-014 | 2026-10-26 | Firmware is a hardware-free C core, tested in a simulator and in CI before it flies | Every change is checked against the requirements before it reaches a propeller |

## Learning to fly

You've never flown, so pilot training runs alongside the build. It also keeps the test ladder
safe: by the time our own firmware flies, the pilot isn't learning at the same time.

1. **Simulator, 15–20 hours, while the parts ship.** Use Liftoff or Uncrashed with the
   RadioMaster Pocket plugged in by USB, in this order:
   1. Hover and gentle circles in angle (self-levelling) mode.
   2. Slow laps in FPV view.
   3. The basics of acro.
2. **First real flights: Block 0 on Betaflight.** Angle mode, line of sight (no goggles), an
   open field, low and slow.
3. **Goggles next, with a spotter beside you** (a legal requirement for FPV in France).
4. **Our firmware flies only after this feels easy.** Its first flights also go through the
   test rig and a tether first ([test ladder](docs/02-architecture.md#test-ladder)).

## Open questions

1. **Ready to order?** The list is in [analysis/bom-report.md](analysis/bom-report.md). Buy the
   EU LBT version of the radio, and confirm prices at checkout; about half are estimates.

## Running the models

```bash
python3 drone/analysis/sizing.py > drone/analysis/sizing-report.md
python3 drone/analysis/bom.py > drone/analysis/bom-report.md
```

The simulator has its own instructions in [firmware/README.md](firmware/README.md). CI
(`.github/workflows/drone.yml`) builds the firmware, runs the unit tests and the requirement
checks, and confirms both reports above match their inputs.

- When a part is chosen or weighed, edit [`analysis/mass_budget.csv`](analysis/mass_budget.csv)
  and set its `status` to `datasheet` or `measured`. The growth margin shrinks from 10% to 5%
  or 0%.
- When you buy something, put the real price in [`analysis/bom.csv`](analysis/bom.csv).
- Model assumptions are constants at the top of [`analysis/sizing.py`](analysis/sizing.py).
