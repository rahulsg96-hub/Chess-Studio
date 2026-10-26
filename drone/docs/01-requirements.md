# 01 — Requirements

What the drone must do, written so that each line can be checked. Every requirement names how we
verify it:

- **A** — analysis (calculation or model)
- **I** — inspection (scale, measurement, review)
- **T** — test with logged data
- **D** — demonstration

The **Block** column says which roadmap stage first has to meet it (see
[02-architecture.md](02-architecture.md#roadmap)).

Numbers marked † come from the [sizing model](../analysis/sizing-report.md). They get re-checked
once real parts are on the scale and the thrust stand.

## Mission

A small quadcopter, designed and programmed by us, that flies by hand, streams live FPV video,
talks to a phone or laptop, and can hold position and fly simple missions on its own. It's a
learning platform, so things that make debugging easier (logging, a known-good reference
firmware, modular stages) count as requirements here, not extras.

## Functional

| ID | Requirement | Verify | Block |
|---|---|:-:|:-:|
| REQ-F1 | Manual flight from an RC transmitter in **rate (acro)** and **self-levelling (angle)** modes. | D | 1 |
| REQ-F2 | Live FPV video with an on-screen display (OSD) showing battery voltage, flight mode and RC link quality. | D | 2 |
| REQ-F3 | Telemetry to a phone or laptop app, and mode/setpoint commands from it, over Wi-Fi or BLE. | D | 3 |
| REQ-F4 | Indoor altitude hold and position hold **without GPS**. | T | 4 |
| REQ-F5 | Outdoor GPS position hold, return-to-launch and waypoint missions, within visual line of sight. | T | 5 |
| REQ-F6 | Onboard logging of gyro, setpoints and motor commands at ≥ 500 Hz, readable on a PC for tuning. | I | 1 |
| REQ-F7 | The same airframe and flight-controller board also fly on Betaflight, as a known-good reference. | D | 0 |

## Mass and size

| ID | Requirement | Verify | Block |
|---|---|:-:|:-:|
| REQ-M1 | Takeoff mass **< 250 g** in every configuration, including battery and prop guards. | I | all |
| REQ-M2 | Design target **≤ 230 g**, leaving 20 g for parts that come in heavier than estimated. | A, I | all |
| REQ-M3 | 3-inch (76 mm) propellers. | I | 0 |

## Performance

| ID | Requirement | Verify | Block |
|---|---|:-:|:-:|
| REQ-P1 | Thrust-to-weight ≥ **3 : 1** at 3.5 V/cell (sagged pack). Design target 4 : 1 → ≥ 200 g thrust per motor.† | A, T | 0 |
| REQ-P2 | Hover endurance ≥ **8 min** on the full build without guards (model predicts ~10 min).† | T | 5 |
| REQ-P3 | Mixed-flying endurance ≥ **5 min** (model predicts ~6.5 min).† | T | 5 |
| REQ-P4 | Angle mode, hover in still air: attitude error ≤ 2° RMS. | T | 1 |
| REQ-P5 | Indoors, over a textured floor in good light: altitude within ±0.2 m and horizontal drift ≤ 0.5 m over 30 s. | T | 4 |
| REQ-P6 | Outdoors, wind ≤ 5 m/s: GPS position hold within 2 m horizontally. | T | 5 |
| REQ-P7 | Rate (inner) control loop runs at ≥ 1 kHz with no missed cycles over a full flight. | T | 1 |

## Safety

| ID | Requirement | Verify | Block |
|---|---|:-:|:-:|
| REQ-S1 | Arming only from the RC transmitter, and only with throttle low, sensors healthy and tilt < 25°. | T | 1 |
| REQ-S2 | An RC **kill switch** stops all motors within 20 ms, in every mode, including autonomous ones. | T | 1 |
| REQ-S3 | The phone/laptop link can never arm the drone or override the kill switch. It may only send commands while the RC link is healthy. | T | 3 |
| REQ-S4 | RC link lost > 0.5 s: level out and hold altitude, or descend slowly if no altitude source. Lost > 3 s: land (or return to launch once GPS is trusted). | T | 1 |
| REQ-S5 | If the firmware hangs, the motors stop within 100 ms (hardware watchdog + ESC signal-loss timeout). | T | 1 |
| REQ-S6 | Low-battery warning at 3.5 V/cell under load; autonomous modes land at 3.3 V/cell. | T | 2 |
| REQ-S7 | Motor test outputs are available over USB only, never over a wireless link. | I | 1 |

## Operational and regulatory

| ID | Requirement | Verify | Block |
|---|---|:-:|:-:|
| REQ-R1 | Meets local rules for sub-250 g drones: registration, operator test, Remote ID, FPV spotter. **Country to be confirmed.** | I | 0 |
| REQ-R2 | Autonomous flights stay within visual line of sight, with the RC transmitter in hand. | I | 4 |
| REQ-R3 | Arms can be replaced after a crash without desoldering anything. | I | 0 |
| REQ-R4 | Firmware is flashed over USB, and Betaflight can be restored to the same board at any time. | D | 1 |
