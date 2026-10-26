# drone/ — a small quadcopter, from scratch

An engineering design project: a sub-250 g, 3-inch quadcopter with our own frame and our own
flight-control firmware. It flies by hand, streams FPV video, talks to a phone or laptop, and
works up to indoor and GPS autonomy.

| Document | What's in it |
|---|---|
| [docs/01-requirements.md](docs/01-requirements.md) | What it must do, each line testable |
| [docs/02-architecture.md](docs/02-architecture.md) | System design, trade-offs, firmware plan, test ladder, roadmap, risks |
| [analysis/sizing-report.md](analysis/sizing-report.md) | Mass, power, flight time and motor KV by configuration and battery |

## Status

- [x] Phase 1 — Requirements
- [x] Phase 2 — Architecture and first sizing
- [ ] Phase 3 — Component selection: flight controller, motors, props, battery, RX, FPV, sensors
- [ ] Phase 4 — Frame design: CAD, arm stiffness check, print
- [ ] Phase 5 — Build + Betaflight baseline (**Block 0**)
- [ ] Phase 6 — Firmware: simulator first, then on the board (**Blocks 1–5**)

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

## Open questions

1. **Country:** sets registration, operator test, Remote ID and FPV-spotter rules (REQ-R1).
2. **Budget**, roughly.
3. **What you already own:** RC transmitter (and its protocol), FPV goggles (analog, DJI,
   Walksnail or HDZero), LiPo charger. The goggles decide analog vs digital FPV.
4. **Where you can fly:** an indoor room for Block 4, and an open outdoor field.

## Running the sizing model

```bash
python3 drone/analysis/sizing.py > drone/analysis/sizing-report.md
```

Edit [`analysis/mass_budget.csv`](analysis/mass_budget.csv) when a part is chosen or weighed.
Set its `status` to `datasheet` or `measured` (the growth margin shrinks from 10% to 5% or 0%),
then re-run. Model assumptions are constants at the top of
[`analysis/sizing.py`](analysis/sizing.py).
