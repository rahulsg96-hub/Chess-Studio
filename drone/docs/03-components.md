# 03 — Component selection

Each part is picked against the [requirements](01-requirements.md) and the
[architecture](02-architecture.md), then checked in the
[sizing model](../analysis/sizing-report.md). Prices and the shopping plan are in the
[cost report](../analysis/bom-report.md).

**Project facts:** flying in France, indoors and outdoors. Budget €1,000, up to €1,500 if
needed. No equipment yet, so the list includes the radio, goggles, charger and safety gear.

## Summary

| Subsystem | Choice | Mass | ~Price | Why |
|---|---|---:|---:|---|
| Flight controller + ESC + receiver | GEPRC Taker F405 20A AIO, ELRS 2.4 GHz built in | 7 g | €80 | Best F405 board we checked: 5 free UARTs, the right gyro, baro, 16 MB log flash |
| Motors | BetaFPV 1404 3800KV | 4 × 9.7 g | €60 | 11% above the minimum KV; made for 3–4-inch, 3–4S |
| Props | HQProp T3×1.8×3 vs Gemfan 3028 | 4 × 1.2–1.5 g | €24 | Buy both, pick on the thrust stand |
| Battery | Tattu R-Line 650 mAh 4S 95C, XT30 | 72–82 g | €22 each | The baseline from the battery trade |
| FPV | DJI O4 Air Unit Lite + DJI Goggles N3 | 8.2 g | €384 | Clear image for a new pilot, onboard recording, simple OSD protocol |
| Radio | RadioMaster Pocket ELRS (EU LBT) | — | €78 | Enough switches; doubles as the simulator controller |
| Charger | ToolkitRC M7AC | — | €85 | Mains or DC, XT30 built in, measures pack resistance |
| Phone link | Seeed XIAO ESP32C3 + DroneBridge | ~3 g | €6 | Runs a ready-made MAVLink Wi-Fi bridge |
| Indoor sensors | MicoAir MTF-01 (optical flow + 8 m ToF) | 4.5 g | €26 | Both sensors in one 4.5 g part; speaks MSP or MAVLink |
| GPS + compass | HGLRC M100-5883 (M10) | 7.7 g | €20 | Sold in France; 2.6 g NewBeeDrone M10Q if we need to save mass |
| Firmware dev kit | Adafruit Feather STM32F405 + STLINK-V3MINIE + ICM-42688-P breakout | — | €60 | Same MCU and IMU as the drone, with a real debugger |

The **full build comes out at 206 g** with growth margin (219 g with prop guards). That gives
**~9 min hover** (7.8–10.8 min across the model's range) and ~6 min of mixed flying. Every
mass and endurance requirement still passes.

## French rules that shape the design

From the EU drone regulation as applied in France. **Check these on AlphaTango and the DGAC
pages before the first outdoor flight.** Our sources are mostly guides, not the legal text.

| Rule | What it means for us | Req |
|---|---|:-:|
| Under 250 g **with a camera** means the operator must register on **AlphaTango**. | Register (you, as operator) and put the operator number on the drone. | R1 |
| Privately built and under 250 g means **subcategory A1**. | No exam needed, but take the free A1/A3 online course anyway. | R1 |
| Remote ID: privately built drones under 250 g appear to be exempt. | **To confirm**; if it's required, a ~1 g broadcast module fits in the margin. | R1 |
| FPV (goggles) needs an **observer next to the pilot** who can see the drone. | Bring a spotter to every goggles flight. | R6 |
| Daytime only, ≤ 120 m, not over public spaces in built-up areas, outside restricted zones. | Check the Géoportail drone map before each new site. | R7 |
| 5.8 GHz video ≤ **25 mW** EIRP; 2.4 GHz ≤ **100 mW** EIRP. | DJI runs within this in CE mode. ELRS needs **EU LBT** firmware on radio *and* receiver. Cap ESP32 Wi-Fi power. | R5 |
| Indoor flights in an enclosed private space are generally outside aviation rules. | Block 4 work indoors is the easy place to start autonomy. | — |

Two practical points:

- **Insurance:** check that your home liability insurance covers model aircraft. An FFAM or
  UFOLEP club membership includes insurance and often a field to fly at.
- **Practice:** do 10+ hours on the simulator before the first real flight, using the Pocket as
  a USB joystick. It's the cheapest crash insurance there is.

## Flight controller: GEPRC Taker F405 20A AIO (ELRS)

We scanned Betaflight's published board configs (one `config.h` per board) for every major
brand's F4/F7/H7 boards. The aim was to check our selection criteria against the actual pin
maps rather than marketing copy. A few F7/H7 AIO boards also have enough UARTs, such as the
HGLRC F722 AIO V2 and the Axisflying F7 AIO. We prefer an F405 for our own firmware, for the
reasons below. The F405 AIO boards:

| Board | MCU | Gyro | Baro | Log flash | UARTs | Verdict |
|---|---|---|---|---|---|---|
| **GEPRC Taker F405 AIO** | F405 | ICM-42688-P (with external clock) | DPS310 | 16 MB | 6 (UART2 = built-in ELRS) → **5 free**, 2 × I2C | ✅ chosen |
| SpeedyBee F405 AIO V2 | F405 | ICM-42688-P | DPS310 | 8 MB | 4 full UARTs exposed (3–6), per listings | ✗ one UART short; a 40 A, 3–6S board is bigger than we need |
| Flywoo GOKU F405 SE 20A AIO | F405 | MPU6000 or BMI270 (listings disagree) | SPL06 | 8 MB | 6, per listings | ✗ no ICM-42688-P; inconsistent specs |
| BetaFPV F405 20A AIO | F405 | ICM-42688-P | not listed | 16 MB | 4 | ✗ too few UARTs |
| EMAX F405 ELRS AIO | F405 | ICM-42688-P | no | 16 MB | 4 | ✗ too few UARTs, no baro |

Specs, from the board config and listings:

- STM32F405, 2–4S input, 20 A continuous (25 A burst) Bluejay ESC.
- 5 V 2.5 A BEC.
- 25.5 × 25.5 mm whoop-pattern mount, ~7 g.

**Why F405 rather than F7/H7, given we're writing our own firmware:** the F405 has no data
cache, so DMA (the hardware that moves sensor and motor data without the CPU) "just works". That
removes a classic source of hard bugs on F7 and H7. It's also the best-documented STM32 in the
drone world. Its 168 MHz single-precision FPU is enough for our loops, including a small EKF
(PX4 ran its estimator on similar F4-class chips for years).

**Watch-outs:**

1. **Built-in receiver firmware:** it probably ships with non-EU ELRS firmware. Reflash it to
   EU LBT before binding to the EU radio (it's a few clicks in the ELRS configurator).
2. **SWD pads:** we don't know whether they're exposed. The dev kit covers us if they aren't.
3. **One 5 V BEC feeds everything**, including the DJI unit. See the power budget below.

## Motors and props

The sizing model needs **≥ 3,420 KV** on 4S to reach 4 : 1 thrust-to-weight at 206 g. The
**BetaFPV 1404 3800KV** gives 11% headroom. It weighs 9.66 g with leads, uses a 1.5 mm shaft,
and is sold for 3–4-inch, 3–4S builds. The alternative is the iFlight XING 1404 3800KV (8.5 g
without leads).

We buy **two prop types** and let the thrust stand decide. The test is our first piece of real
engineering data:

| Prop | Mass | Expect |
|---|---:|---|
| HQProp T3×1.8×3 | 1.2 g | Low pitch: efficient hover, longer flight time |
| Gemfan 3028 tri-blade | 1.49 g | Higher pitch: more speed and punch, more current |

**Pass criteria on the stand, per motor at 14 V:**

| Measure | Requirement | Why |
|---|---|---|
| Thrust at full throttle | ≥ 154 g, target ≥ 206 g | REQ-P1 |
| Current at full throttle | ≤ 16 A | REQ-D2: 80% of the ESC's continuous rating |
| Hover efficiency | g/W around 52 g of thrust | Picks between the two props |

The stand data then replaces the model's figure-of-merit guess.

## FPV: DJI O4 Air Unit Lite + Goggles N3

The budget allows digital, and it's the better tool for this project:

- **A clear image helps a new pilot.** Analog at 25 mW in France is noisy.
- **Onboard recording** gives us video of every test flight, synced to the logs.
- **The OSD speaks MSP DisplayPort**, a simple UART protocol that is easy to implement in our
  firmware. Analog would mean driving the board's OSD chip directly.
- **CE mode keeps 5.8 GHz within 25 mW** automatically.

The O4 Lite weighs 8.2 g, takes 3.7–13.2 V and draws ~6 W at peak. It goes on the 5 V BEC,
because a 4S pack (up to 16.8 V) would exceed its input range.

> **Firmware note for Block 2:** the air unit stays in low-power mode until the flight
> controller tells it, over MSP, that the drone is armed. Our firmware has to implement that
> handshake, or the video range stays short.

The cheaper path is analog (box goggles plus a camera and transmitter, ~€150 instead of ~€384).
It's lighter on the budget but worse on every other point above.

## Radio: RadioMaster Pocket ELRS (EU LBT)

The Pocket has the switches we need: arm/kill, a 3-position flight-mode switch, return-to-launch
and a beeper button. Over USB it works as a joystick for the simulator. If you'd rather have
full-size gimbals, the Boxer costs about €90 more. Whichever you choose, buy the **EU LBT**
version: ELRS only binds between radio and receiver running the same regulatory domain.

## Phone link: Seeed XIAO ESP32C3 + DroneBridge

DroneBridge is open-source firmware that turns an ESP32 into a Wi-Fi bridge for MAVLink. It
parses MAVLink to add link-quality packets, and works with QGroundControl over UDP 14550 or
TCP 5760. It supports the ESP32-C3, C5 and C6.

The XIAO ESP32C3 is a 21 × 17.5 mm board with a u.FL connector for a proper antenna. Its Wi-Fi
transmit power must be capped so the EIRP stays ≤ 100 mW (REQ-R5).

## Sensors for autonomy

- **MicoAir MTF-01:** optical flow plus an 8 m time-of-flight rangefinder in one 4.5 g module.
  It outputs 100 Hz over UART at 115200 baud, speaking MSP or MAVLink (switchable). We'll parse
  one of the two in our firmware.
- **HGLRC M100-5883:** u-blox M10-class GPS with a QMC5883 compass, 7.7 g. If the mass budget
  gets tight, the NewBeeDrone M10Q does the same job at ~2.6 g.

## 5 V power budget (REQ-D3)

Everything except the motors runs from the AIO's single 5 V 2.5 A BEC.

| Load | Peak current | Source |
|---|---:|---|
| DJI O4 Air Unit Lite | 1.20 A | ~6 W at 5 V |
| Flight controller, gyro, baro, flash, ELRS receiver | 0.30 A | estimate |
| XIAO ESP32C3, Wi-Fi transmitting | 0.35 A | estimate (peaks during transmit bursts) |
| MTF-01 | 0.06 A | estimate |
| GPS | 0.05 A | estimate |
| **Total** | **~1.96 A** | **78% of 2.5 A** |

That's under our 2.0 A limit, but only just, and most rows are estimates. **Measure it on the
bench** with everything running. If it's over, add a separate ~1 g 5 V regulator for the
companion and sensors.

## Firmware dev kit and test gear

- **Adafruit Feather STM32F405 Express:** the same MCU as the AIO board. It has SWD pads on the
  underside, enters the USB bootloader with a jumper, and is supported by Zephyr if we ever
  want an RTOS.
- **STLINK-V3MINIE:** a real debugger, giving breakpoints and live variable views.
- **ICM-42688-P breakout:** the same IMU as the AIO board. We write and debug the SPI driver
  here, then move it to the drone unchanged.
- **Thrust stand:** a printed arm on a 1 kg load cell read by an HX711, plus an XT30 power
  meter. RPM comes from the ESC's bidirectional-DShot telemetry.
- **Safety:** a smoke stopper for every first power-up, a LiPo bag for charging and storage, and
  a multimeter.

## While the parts ship

1. **You:** register as an operator on AlphaTango, take the free A1/A3 course, and start
   simulator practice as soon as the radio arrives.
2. **Phase 4, frame CAD (together):** the board's 25.5 mm mount, 1404 motor mounts, an O4 Lite
   camera mount, and the arm stiffness check (first bending mode > ~480 Hz).
3. **Phase 6, simulator (I can start now):** a 6-DOF quadrotor model and the portable control
   core, so the firmware is tested before the hardware arrives.

## Sources

Prices and specs are from shop listings and guides, checked October 2026, so confirm them when
you buy. Board UART, gyro, baro and flash data come from Betaflight's
[unified target configs](https://github.com/betaflight/config).

- French and EU rules:
  [tele-pilote.fr, AlphaTango 2026](https://www.tele-pilote.fr/alphatango-2026-comment-senregistrer-comme-exploitant-drone-dgac/),
  [alexcursion.com, sub-250 g rules 2026](https://alexcursion.com/reglementation-drone-moins-de-250g-2026/),
  [EASA, open category FAQ](https://www.easa.europa.eu/en/the-agency/faqs/open-category),
  [EASA, open category](https://www.easa.europa.eu/en/node/119320),
  [Ministère de l'Écologie, catégorie ouverte](https://www.ecologie.gouv.fr/politiques-publiques/exploitation-drones-categorie-ouverte),
  [Studiosport, vol en immersion](https://www.studiosport.fr/guides/legislation/voler-immersion.html),
  [Studiosport, DJI FPV range / 25 mW](https://www.studiosport.fr/guides/dji-fpv/portee.html)
- GEPRC Taker F405 AIO:
  [Rotorama](https://www.rotorama.com/product/geprc-taker-f405-20a),
  [FPV24](https://www.fpv24.com/en/geprc/geprc-taker-f405-20a-elrs-24g-2-4s-aio),
  [FPVFaster](https://www.fpvfaster.com.au/products/geprc-taker-f405-20a-aio-2-4s-flight-controller-elrs-25-5x25-5mm)
- Other boards:
  [SpeedyBee F405 V2 AIO (GetFPV)](https://www.getfpv.com/speedybee-f405-v2-aio-f405-fc-40a-3-6s-bluejay-esc-25-5x25-5.html),
  [Flywoo GOKU F405 SE (Rotorama)](https://www.rotorama.com/product/flywoo-goku-f405-hd-se-2-4s-20a),
  [BetaFPV F405 20A AIO](https://betafpv.com/products/f405-4s-20a-toothpick-brushless-flight-controller-v5-blheli_s-icm42688)
- Motors and props:
  [BetaFPV 1404 3800KV](https://betafpv.com/products/1404-3800kv-brushless-motors),
  [iFlight XING 1404 (GetFPV)](https://www.getfpv.com/drone-brands/iflight/iflight-xing-1404-3800kv-4600kv-7000kv-unibell-toothpick-motor-blue-camo-1pc.html),
  [HQProp T3×1.8×3](https://www.getfpv.com/hqprop-3x1-8x3-1-5mm-3-blade-propeller-yellow-pink-set-of-4.html),
  [Gemfan 3028](https://rotorvillage.ca/gemfan-windancer-3028-tri-blade-2cw-2ccw-1-5mm-5mm-hub)
- Battery:
  [Tattu R-Line 650 4S (myfpvstore)](https://www.myfpvstore.com/y3ng),
  [Tattu R-Line 650 4S (Proshop)](https://www.proshop.nl/Drones/Gens-ace-Tattu-Tattu-R-Line-650mAh-148V-95C-4S1P-Battery-XT30/3440748)
- DJI O4 Lite and Goggles N3:
  [Oscar Liang, O4 Lite setup](https://oscarliang.com/how-to-setup-dji-o4-lite/),
  [RotorVillage, O4 Lite](https://rotorvillage.ca/dji-o4-air-unit-lite/),
  [FirstQuadcopter, O4 Lite review](https://www.firstquadcopter.com/reviews/dji-o4-air-unit-lite/?amp=1),
  [Phototrend, Goggles N3 price](https://phototrend.fr/2024/11/dji-goggles-n3/),
  [Studiosport, Goggles N3](https://www.studiosport.fr/dji-goggles-n3-a30185.html),
  [IntoFPV, O4 low-power mode and MSP](https://intofpv.com/t-no-osd-in-dji-n3-goggles-o4-air-unit-stuck-in-low-power-mode)
- Radio and charger:
  [MotionRC EU, Pocket LBT](https://www.motionrc.eu/collections/rc-radios-aircraft/products/radiomaster-pocket-16-channel-elrs-lbt-transmitter-transparent-hp0157-0053-lbt-m2),
  [Unmanned Tech, Pocket guide](https://www.unmannedtechshop.co.uk/blogs/knowledge-base/radiomaster-pocket-elrs-complete-setup-guide),
  [Oscar Liang, ToolkitRC M7](https://oscarliang.com/toolkitrc-m7),
  [Rotorama, M7AC](https://www.rotorama.com/product/toolkitrc-m7ac)
- Companion and sensors:
  [DroneBridge for ESP32](https://github.com/DroneBridge/ESP32),
  [Seeed XIAO ESP32C3 (The Pi Hut)](https://thepihut.com/collections/maker-store/products/seeed-xiao-esp32c3),
  [MicoAir MTF-01 (MicoAir store)](https://store.micoair.com/?p=2905),
  [MTF-01 (Rotorama)](https://rotorama.com/product/micoair-mtf-01-optical-flow-a-range-sensor),
  [HGLRC M100-5883 (Studiosport)](https://www.studiosport.fr/module-gps-m100-5883-hglrc-a27701.html),
  [NewBeeDrone M10Q](https://racedayquads.com/products/newbeedrone-m10q-micro-gps-w-compass-10th-gen)
- Dev board:
  [Zephyr, Feather STM32F405](https://docs.zephyrproject.org/latest/boards/adafruit/feather_stm32f405/doc/index.html)
