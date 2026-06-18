# BlueOS 2.0 — Simulated Sensor Suite (UWSim-inspired)

> What separates a research-grade underwater simulator (UWSim, UNav-Sim) from a
> good-looking trainer is that it **simulates the sensor payload** and feeds it
> to the control station exactly like real hardware. This adds that layer — and
> models it on the **BlueRobotics sensors a BlueROV actually carries**, so the
> practice instruments behave like the ones on the boat.

## What it does (operator view)

With Practice mode on, the simulated vehicle now carries a live sensor payload,
computed analytically from the pool geometry and the vehicle's pose — no
hardware:

- **Ping360 scanning sonar** — the iconic mechanical imaging sonar. Add the new
  **SonarView** widget for a polar scope: a sweep rotates around the vehicle,
  painting walls, gates, floats and the pool boundary as acoustic returns
  (bright = close), with range rings and a forward-up reference. Drive toward a
  wall and watch it come up on sonar before you can see it through the murk.
- **DVL (Doppler Velocity Log)** — altitude over the bottom + ground velocity.
  Reads out as **ALT** / **SOG** on the sonar widget and on the 3D view's sensor
  strip, with a red warning under 0.5 m altitude. Practice altitude-hold and
  bottom-following.
- **Ping echosounder (altimeter)** — single-beam distance to the bottom.
- **Forward echosounder** — range to whatever's dead ahead (**FWD**), red under
  1.5 m as a collision cue.
- **Pressure → depth**.

The DVL altitude, ground velocity, Ping altitude and forward range are also
published to the **data lake**, so any custom VeryGenericIndicator widget can
display or plot them, exactly as it would for a real vehicle's telemetry.

## How it's built (developer view)

| Piece | Where |
|---|---|
| Pure sensor math | `src/libs/sim-sensors.ts` — `rayRangeToEnvironment`, `altitudeBelow`, `computeDvl`, `sonarScan`/`sonarBeam`, `computeSensorReadout`. No three.js, fully unit-tested. |
| Sim integration | `src/libs/actions/demo-mode.ts` — a persistent Ping360 bin buffer that a sweep refreshes a few bins/tick, plus per-tick scalar sensors, published on `practiceSimReadout` (`sensors`, `sonar`) and to the data lake. |
| Sonar widget | `src/components/widgets/SonarView.vue` — a canvas polar scope (`WidgetType.SonarView`). |
| 3D sensor HUD | `src/components/widgets/PracticeView3D.vue` — ALT / FWD / SOG strip. |

**Geometry model:** the sonar and echosounders are horizontal plan-view
raycasts against the pool walls (a rectangle) and obstacle footprints (boxes →
AABBs, cylinders/hoops → circles). A return only counts if the obstacle's
vertical extent overlaps the sonar's beam at the vehicle's depth (the fan
widens with range), so you don't paint a floor crate while hovering near the
surface. The DVL altitude raycasts straight down to the floor or the top of
whatever the vehicle is over.

**Sweep:** the Ping360 buffer is a 240-bin ring (1.5° each, 20 m range); the
sweep advances 5 bins per 25 Hz tick → a full rotation about every 2 s, like a
real mechanical scanner. `practiceSimReadout` is a `shallowRef` and `sonar.bins`
is a live shared buffer the widget reads each frame (never snapshot it).

## Tests

`src/tests/libs/sim-sensors.test.ts` (12): wall ranging, obstacle ranging, the
beam depth-band gating, altitude over open floor and over obstacles, DVL
velocity + bottom-lock, forward/rear sonar bins, the bundled scalar readout.
The widget is covered by the widgets-loader import test.

## Roadmap

- Multibeam **forward-looking sonar** image (a fronto-parallel fan, not just the
  360° scope).
- Structured-light / laser-stripe profiler (UWSim has one) for close-range
  mapping practice.
- Record sonar/DVL into the dive log so a replay shows what the sensors saw.
- Feed the simulated sensors over MAVLink so BlueOS-side displays light up too.
