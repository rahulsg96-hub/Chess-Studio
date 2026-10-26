# 02 — Architecture and first sizing

How the drone is put together, what we're building ourselves versus buying, and the roadmap from
first hover to autonomy. This builds on the [requirements](01-requirements.md) and the
[sizing report](../analysis/sizing-report.md). The specific parts are chosen in
[03-components.md](03-components.md).

## The one-paragraph version

A 3-inch, 4S quad of about **205 g**. The airframe is our own CAD and 3D-printed. The flight
controller is an off-the-shelf all-in-one (AIO) board, the GEPRC Taker F405: an STM32
microcontroller, IMU, 4-in-1 ESC and ELRS receiver on one board. We first fly it on
**Betaflight** to prove the hardware, then flash **our own firmware** onto the same board.

Flight-critical work stays on the STM32. Video is digital (DJI O4 Lite). Everything wireless
that isn't the RC link goes through a small **ESP32-C3 companion**, which bridges **MAVLink** to
a phone or laptop over Wi-Fi. That gets us QGroundControl for telemetry and mission planning
without writing an app.

Capabilities arrive in blocks: manual flight → FPV → phone link → indoor autonomy → GPS autonomy.

## Block diagram

```mermaid
flowchart LR
  TX([RC transmitter]) -. ELRS 2.4 GHz .-> RX
  BAT[4S LiPo 650 mAh] --> AIO
  subgraph AIO[GEPRC Taker F405 AIO]
    MCU[STM32F405<br/>our firmware]
    IMU[ICM-42688-P IMU]
    BARO[DPS310 baro]
    FLASH[16 MB log flash]
    RX[ELRS receiver]
    ESC[4-in-1 ESC<br/>Bluejay]
    BEC[5 V BEC]
  end
  IMU -- SPI --> MCU
  BARO -- I2C --> MCU
  MCU -- SPI --> FLASH
  RX -- CRSF --> MCU
  MCU -- DShot --> ESC --> MOT[4x 1404 motors<br/>3-inch props]
  FLOW[Optical flow + ToF] -- MSP --> MCU
  GPS[GPS + compass] -- UBX / I2C --> MCU
  MCU -- MAVLink --> COMP[ESP32-C3 companion]
  COMP -. Wi-Fi .-> GCS([Phone / laptop<br/>QGroundControl])
  MCU -- MSP DisplayPort --> O4[DJI O4 Air Unit Lite]
  BEC --> O4
  O4 -. 5.8 GHz .-> GOG([DJI Goggles N3])
```

## Key decisions and trade-offs

### Flight-controller hardware: STM32 AIO board

| Option | For | Against |
|---|---|---|
| **STM32 AIO board, our firmware on it** ✅ | Same board also flies Betaflight, so a hardware fault and a firmware bug are never tangled. IMU, ESC, baro, receiver and log flash all on one ~7 g board. | We have to work out the pin map from the board's published Betaflight target. SWD debug pads are often not exposed. |
| ESP32-S3 + IMU breakout + separate ESC | Wi-Fi/BLE on the same chip. | Heavier and more wiring. No Betaflight baseline. Wi-Fi stack shares the chip with the control loop. |
| Our own PCB | Total control. | Out of scope by choice (frame + firmware, not PCB). |

Driver work starts on an Adafruit Feather STM32F405 with a real debugger. It has the **same
MCU**, so the code then moves to the AIO board.

### Phone/laptop link: ESP32-C3 companion speaking MAVLink

Wi-Fi lives on a separate ~3 g board, so the Wi-Fi stack can never stall the control loop. Our
firmware implements a small MAVLink v2 subset: heartbeat, attitude, status, position, manual
control, commands and the mission protocol. That lets us use **QGroundControl** (Android, iOS,
desktop) for telemetry, parameter tuning and waypoint missions straight away. A custom phone app
stays an option later. The companion runs DroneBridge for ESP32, an off-the-shelf UART-to-Wi-Fi
MAVLink bridge.

The RC transmitter stays the **primary** control with kill-switch authority (REQ-S2, REQ-S3). The
phone can command; it can't take over.

### Battery: 4S, 650 mAh

From the [battery trade](../analysis/sizing-report.md#battery-trade-full-build): on the full
build, 3S 850 and 4S 550/650/850 meet the mass and endurance targets. **4S** wins for these
reasons:

- It needs 25% less current for the same power, which means less sag and cooler wiring.
- It matches the most common 3-inch motor class (1404, ~3600–4000 KV). The model says we need at
  least ~3,400 KV on 4S, but at least ~4,300 KV on 3S.

The baseline is **4S 650 mAh**, modelled with the chosen pack's listed 82 g. That gives about
206 g takeoff mass, ~9 min hover (range 7.8–10.8 min) and ~6 min mixed flying. A 4S 850 still
fits under 230 g if we want longer hover tests later.

### Mass budget at a glance

| Configuration | Takeoff mass (4S 650) | Hover | Mixed |
|---|---:|---:|---:|
| Block 0–1: manual flight | 177 g | 12.8 min | 8.6 min |
| Block 5: full build | 206 g | 9.1 min | 6.1 min |
| Full build + prop guards | 219 g | 8.4 min | 5.6 min |

Everything includes a growth margin: 10% on estimated masses, 5% on datasheet masses. Even the
heaviest configuration leaves 31 g under the 250 g limit. Line items live in
[`mass_budget.csv`](../analysis/mass_budget.csv); we update them as parts are weighed.

### FPV: digital, DJI O4 Air Unit Lite

We chose digital over analog. The reasons are a clearer image for a new pilot, onboard
recording of every test flight, an OSD over a simple UART protocol (MSP DisplayPort) instead of
driving an OSD chip, and staying within the 25 mW French limit automatically in CE mode. The
full comparison is in [03-components.md](03-components.md#fpv-dji-o4-air-unit-lite--goggles-n3).

### Frame: printed first, carbon if vibration demands it

The first frame is printed in PA-CF or PETG-CF, so we can iterate fast. The concern with printed
arms is stiffness. The model puts the motors at ~19,200 RPM in hover (**~320 Hz**) and ~640 Hz
at the 4 : 1 design thrust. If an arm's first bending mode falls in that band, the gyro sees
amplified vibration.

- **Derived requirement (REQ-D1):** design the arms for a first bending mode **above ~480 Hz**
  (1.5× hover motor frequency). We'll check it with a beam calculation in the frame phase.
- **Confirm in Block 0:** look at the gyro spectrum in a Betaflight blackbox log.
- **Fallback:** cut the arms from 3 mm carbon plate, using the same CAD sketch.

### Serial ports

The board has six UARTs. The built-in receiver takes one, which leaves five for everything else:

| UART | Device | Protocol |
|---|---|---|
| 2 | ELRS receiver (built in) | CRSF |
| free | ESP32-C3 companion | MAVLink v2 |
| free | MTF-01 optical flow + ToF | MSP |
| free | GPS (compass on I2C2) | UBX |
| free | DJI O4 Air Unit Lite | MSP DisplayPort |
| free | spare | — |

We assign specific UARTs once we have the board's pad layout in hand.

## Firmware architecture

`core/` and `sim/` exist and pass their checks; see [firmware/README.md](../firmware/README.md).
`drivers/` comes when the hardware arrives.

```
firmware/
  core/     portable C: estimators, controllers, mixer, modes, arming, failsafe
            no hardware access, so it compiles for the STM32 and for the PC
  drivers/  STM32: IMU (SPI), DShot (timer + DMA), CRSF, baro, log flash,
            MSP DisplayPort, MAVLink
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
   order and direction, 5 V rail load.
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
| **0** | Airframe + propulsion, flying on Betaflight | Weighed under 230 g; thrust stand meets REQ-P1 and REQ-D2; Betaflight hover with a blackbox baseline (vibration spectrum, hover throttle). REQ-M1–M3, P1, F7, R3, D1–D3 |
| **1** | Our firmware, manual flight | ACRO + ANGLE flight through the whole test ladder. REQ-F1, F6, P4, P7, S1, S2, S4, S5, S7, R4 |
| **2** | FPV + OSD | MSP DisplayPort OSD; arming status sent so the O4 leaves low-power mode. REQ-F2, S6 |
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
| R7 | AIO board pin map undocumented or SWD missing | M | M | Pin map from the published Betaflight target; driver work on a same-MCU dev board first |
| R8 | The single 5 V BEC is overloaded (DJI unit + companion + sensors) | M | M | Measure on the bench (REQ-D3); add a separate ~1 g regulator if needed |
| R9 | DJI unit stays in low-power mode with our firmware | M | L | Implement the MSP arming status in Block 2; check range on the ground first |

L = likelihood, I = impact (L/M/H).
