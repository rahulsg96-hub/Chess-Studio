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
| [analysis/sizing-report.md](analysis/sizing-report.md) | Mass, power, flight time and motor KV by configuration and battery |
| [analysis/bom-report.md](analysis/bom-report.md) | Shopping list and costs against the budget |

## Status

- [x] Phase 1 — Requirements
- [x] Phase 2 — Architecture and first sizing
- [x] Phase 3 — Component selection (**ready to order**)
- [ ] Phase 4 — Frame design: CAD, arm stiffness check, print
- [ ] Phase 5 — Build + Betaflight baseline (**Block 0**)
- [ ] Phase 6 — Firmware: simulator first, then on the board (**Blocks 1–5**)

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

## Open questions

1. **Are you happy with the shopping list?** The main swaps are:
   - Boxer instead of Pocket (+€90).
   - Analog instead of DJI video (−€230).
   - Skip the spare flight controller (−€80). Not recommended.
2. **Have you flown a drone before?** This decides how much simulator time to plan before the
   first real flight.

## Running the models

```bash
python3 drone/analysis/sizing.py > drone/analysis/sizing-report.md
python3 drone/analysis/bom.py > drone/analysis/bom-report.md
```

- When a part is chosen or weighed, edit [`analysis/mass_budget.csv`](analysis/mass_budget.csv)
  and set its `status` to `datasheet` or `measured`. The growth margin shrinks from 10% to 5%
  or 0%.
- When you buy something, put the real price in [`analysis/bom.csv`](analysis/bom.csv).
- Model assumptions are constants at the top of [`analysis/sizing.py`](analysis/sizing.py).
