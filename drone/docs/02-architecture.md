# 02 — Architecture and first sizing

How the drone is put together, what we're building ourselves versus buying, and the roadmap from
first hover to autonomy. This builds on the [requirements](01-requirements.md) and the
[sizing report](../analysis/sizing-report.md).

## The one-paragraph version

A 3-inch, 4S quad of about **200 g**. The airframe is our own CAD and 3D-printed. The flight
controller is an off-the-shelf all-in-one (AIO) board: an STM32 microcontroller, IMU and 4-in-1
ESC on one 20×20 mm board. We first fly it on **Betaflight** to prove the hardware, then flash
**our own firmware** onto the same board. Flight-critical work stays on the STM32. Everything
wireless that isn't the RC link goes through a small **ESP32-C3 companion**, which bridges
**MAVLink** to a phone or laptop over Wi-Fi. That gets us QGroundControl for telemetry and
mission planning without writing an app. Capabilities arrive in blocks: manual flight → FPV →
phone link → indoor autonomy → GPS autonomy.

## Block diagram

```mermaid
flowchart LR
  TX([RC transmitter]) -. ELRS 2.4 GHz .-> RX[ELRS receiver]
  BAT[4S LiPo 550-650 mAh] --> AIO
  subgraph AIO[AIO flight-controller board]
    MCU[STM32 F405 / F722<br/>our firmware]
    IMU[IMU<br/>ICM-42688-P / BMI270]
    BARO[Barometer]
    FLASH[Log flash]
    OSD[Analog OSD chip]
    ESC[4-in-1 ESC<br/>Bluejay / AM32]
  end
  IMU -- SPI --> MCU
  BARO -- I2C/SPI --> MCU
  MCU -- SPI --> FLASH
  MCU -- DShot --> ESC --> MOT[4x 1404 motors<br/>3-inch props]
  RX -- CRSF --> MCU
  FLOW[Optical flow + ToF] -- MSP --> MCU
  GPS[GPS + compass] -- UBX / I2C --> MCU
  MCU -- MAVLink --> COMP[ESP32-C3 companion]
  COMP -. Wi-Fi .-> GCS([Phone / laptop<br/>QGroundControl])
  CAM[FPV camera] --> OSD --> VTX[5.8 GHz VTX]
  MCU -- SmartAudio --> VTX
  VTX -. 5.8 GHz .-> GOG([Goggles])
```

## Key decisions and trade-offs

### Flight-controller hardware: STM32 AIO board

| Option | For | Against |
|---|---|---|
| **STM32 AIO board, our firmware on it** ✅ | Same board also flies Betaflight, so a hardware fault and a firmware bug are never tangled. IMU, ESC, baro, OSD and log flash all on one ~7 g board. | We have to work out the pin map from the board's published Betaflight target. SWD debug pads are often not exposed. No radio of its own. |
| ESP32-S3 + IMU breakout + separate ESC | Wi-Fi/BLE on the same chip. | Heavier and more wiring. No Betaflight baseline. Wi-Fi stack shares the chip with the control loop. |
| Our own PCB | Total control. | Out of scope by choice (frame + firmware, not PCB). |

If the chosen board doesn't expose SWD, we'll do early driver work on a cheap Nucleo or WeAct dev
board with the **same MCU** and a real debugger, then move to the AIO board.

### Phone/laptop link: ESP32-C3 companion speaking MAVLink

Wi-Fi lives on a separate ~2.5 g board, so the Wi-Fi stack can never stall the control loop. Our
firmware implements a small MAVLink v2 subset: heartbeat, attitude, status, position, manual
control, commands and the mission protocol. That lets us use **QGroundControl** (Android, iOS,
desktop) for telemetry, parameter tuning and waypoint missions straight away. A custom phone app
stays an option later. The companion runs an off-the-shelf UART-to-Wi-Fi MAVLink bridge, such as
DroneBridge for ESP32.

The RC transmitter stays the **primary** control with kill-switch authority (REQ-S2, REQ-S3). The
phone can command; it can't take over.

### Battery: 4S, 550–650 mAh

From the [battery trade](../analysis/sizing-report.md#battery-trade-full-build):
on the full build, 3S 650 and 4S 550/650/850 all meet the mass and endurance targets. **4S** wins
for these reasons:

- It needs 25% less current for the same power, which means less sag and cooler wiring.
- It matches the most common 3-inch motor class (1404, ~3600–4000 KV). The model says we need at
  least ~3,400 KV on 4S, but at least ~4,300 KV on 3S.

The baseline is **4S 650 mAh**: about 200 g takeoff mass, ~10 min hover (range 8.4–11.7 min) and
~6.5 min mixed flying. A 4S 850 still fits under 230 g if we want longer hover tests later.

### Mass budget at a glance

| Configuration | Takeoff mass (4S 650) | Hover | Mixed |
|---|---:|---:|---:|
| Block 0–1: manual flight | 177 g | 12.9 min | 8.6 min |
| Block 5: full build | 200 g | 9.8 min | 6.5 min |
| Full build + prop guards | 213 g | 9.0 min | 6.0 min |

Everything includes a 10% growth margin on estimated masses. Even the heaviest configuration
leaves 37 g under the 250 g limit. Line items live in
[`mass_budget.csv`](../analysis/mass_budget.csv); we update them as parts are weighed.

### FPV: analog or digital — open

| | Analog | Digital (DJI O4 / Walksnail / HDZero) |
|---|---|---|
| Mass | ~8.5 g (in the budget) | heavier; re-run the model with the real part |
| Image | low-res, but very low latency | far better; most can record onboard |
| OSD from our firmware | drive the board's AT7456E OSD chip over SPI | MSP DisplayPort over UART: a simpler protocol |
| Cost | low | higher |

The deciding factor is mostly **which goggles you already have (or want)**.

### Frame: printed first, carbon if vibration demands it

The first frame is printed in PA-CF or PETG-CF, so we can iterate fast. The concern with printed
arms is stiffness. The model puts the motors at ~18,900 RPM in hover (**~315 Hz**) and ~630 Hz at the
4 : 1 design thrust. If an arm's first bending mode falls in that band, the gyro sees amplified
vibration.

- **Derived requirement:** design the arms for a first bending mode **above ~470 Hz** (1.5× hover
  motor frequency). We'll check it with a beam calculation in the frame phase.
- **Confirm in Block 0:** look at the gyro spectrum in a Betaflight blackbox log.
- **Fallback:** cut the arms from 3 mm carbon plate, using the same CAD sketch.

### Board selection criteria (input to component selection)

1. STM32 F405 or F722 (H743 is a bonus), with a published Betaflight unified target.
2. ICM-42688-P (preferred) or BMI270 IMU on SPI. Barometer on board.
3. Integrated 4-in-1 ESC, ≥ 20 A per motor, running Bluejay or AM32 with bidirectional DShot
   (needed for RPM-based noise filtering).
4. **At least 5 usable UARTs** plus an I2C pad:

   | Port | Device | Protocol |
   |---|---|---|
   | 1 | RC receiver | CRSF |
   | 2 | ESP32-C3 companion | MAVLink v2 |
   | 3 | Optical flow + ToF | MSP |
   | 4 | GPS (compass on I2C) | UBX |
   | 5 | VTX | SmartAudio (analog) / MSP DisplayPort (digital) |

5. Log flash of at least 8 MB (for REQ-F6), and an analog OSD chip if we go analog.
6. SWD pads exposed (nice to have).
7. 20×20 mm mounting, ≤ 8 g.

## Firmware architecture (proposed; we'll firm it up in the firmware phase)

```
firmware/
  core/     portable C: estimators, controllers, mixer, modes, arming, failsafe
            no hardware access, so it compiles for the STM32 and for the PC
  drivers/  STM32: IMU (SPI), DShot (timer + DMA), CRSF, baro, log flash, OSD, MAVLink
  sim/      PC: 6-DOF quadrotor model with motor lag, sensor noise and vibration that
            runs core/ in a loop (software-in-the-loop) for tests and tuning
```

Language and toolchain: C11 with the STM32 LL drivers, `arm-none-eabi-gcc` and CMake. Keeping
`core/` hardware-free means every controller change can be tested in simulation, in CI, before it
gets anywhere near a propeller.

### Control cascade

| Loop | Rate | Senses | Commands | Block |
|---|---:|---|---|:-:|
| Gyro sampling + filtering | 2 kHz | IMU (low-pass + notch filters) | — | 1 |
| Rate (inner) | 1 kHz → 2 kHz | filtered gyro | torques → mixer → DShot | 1 |
| Attitude | 500 Hz | quaternion attitude (Mahony filter) | body-rate setpoints | 1 |
| Altitude | 100 Hz | baro + accel + ToF fusion | collective thrust | 4 |
| Horizontal | 50 Hz | optical flow (indoor) / GPS (outdoor) | attitude setpoints | 4–5 |
| Navigation | 10 Hz | MAVLink missions | position setpoints | 5 |

Flight modes are added in the same order: **ACRO → ANGLE → ALT HOLD → POS HOLD → AUTO / RTL**.

## Test ladder

Each rung must pass before the next one. The drone flies on our firmware only after rung 3.

1. **Simulation:** controller in the SIL simulator, plus unit tests.
2. **Bench, props off:** sensor orientation, RC, arming, failsafe, kill switch, watchdog, motor
   order and direction.
3. **Test rig, props on:** strapped to a printed 1-axis seesaw rig, then a 3-axis gimbal. Tune
   the rate loop one axis at a time.
4. **Tethered hover:** check angle mode, the kill switch and failsafe in the air.
5. **Free flight:** outdoors, open area, line of sight, with a spotter.

Safety kit for the whole project: a LiPo-safe bag, a smoke stopper for every first power-up
(it current-limits so a short circuit can't burn anything), and safety glasses for any test
with props on.

## Roadmap

| Block | Goal | Exit criteria |
|:-:|---|---|
| **0** | Airframe + propulsion, flying on Betaflight | Weighed under 230 g; ≥ 3 : 1 thrust-to-weight on a DIY thrust stand; Betaflight hover with a blackbox baseline (vibration spectrum, hover throttle). REQ-M1–M3, P1, F7, R3 |
| **1** | Our firmware, manual flight | ACRO + ANGLE flight through the whole test ladder. REQ-F1, F6, P4, P7, S1, S2, S4, S5, S7, R4 |
| **2** | FPV + OSD | REQ-F2, S6 |
| **3** | Phone/laptop link | Telemetry in QGroundControl, then mode/setpoint commands. REQ-F3, S3 |
| **4** | Indoor autonomy | Altitude hold (baro + ToF), position hold (optical flow). REQ-F4, P5 |
| **5** | Outdoor autonomy | GPS + compass, return-to-launch, waypoints. REQ-F5, P2, P3, P6 |

## Risks

| # | Risk | L | I | Mitigation |
|:-:|---|:-:|:-:|---|
| R1 | Printed frame resonates and the gyro gets noisy → poor control | M | H | Stiffness target above; soft-mount the board; notch + RPM filtering; Betaflight baseline spectrum; carbon-arm fallback |
| R2 | Our firmware has a bug that causes a flyaway or a motor runaway | M | H | Kill switch handled first in every loop; watchdog; test ladder; tether before free flight |
| R3 | Mass creeps over the limit | L | H | Budget in CSV with growth margin; 20 g reserve; weigh every part on arrival |
| R4 | 2.4 GHz interference between ESP32 Wi-Fi and the ELRS receiver | M | M | Separate the antennas; cap Wi-Fi transmit power; fall back to ELRS 900 MHz |
| R5 | Compass disturbed by battery current | H | M | GPS/compass on a mast; current-based compensation; outdoor-only use |
| R6 | LiPo fire or prop injury | L | H | Props off on the bench; LiPo bag; smoke stopper; never charge unattended |
| R7 | AIO board pin map undocumented or SWD missing | M | M | Pick a board with a published Betaflight target; develop on a same-MCU dev board first |

L = likelihood, I = impact (L/M/H).
