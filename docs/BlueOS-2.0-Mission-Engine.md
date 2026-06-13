# BlueOS 2.0 — V2 Mission Engine (record · replay · re-fly · instruct)

> The leap from "a 3D trainer" to "a training **system**." Inspired by full-flight
> simulators (CAE 7000XR-class instructor stations) and the marine-sim research
> stack (UNav-Sim, UWSim, SeaDroneSim, NaviSuite): the value isn't only the
> picture, it's the **loop** — fly, record, replay, debrief, inject failures,
> re-fly the moment that went wrong.

## What it does (operator view)

Open the **🎛 Mission** panel (top-left of the PracticeView3D widget).

- **Black box (always on).** Every practice run is recorded automatically. Every
  real **armed** dive of a connected vehicle is recorded too (attitude, depth,
  heading, speed, and a local-meters track when a position source exists).
- **Runs list.** All stored runs (🎮 practice + 🌊 real dives), newest first.
  Export any run to a `.dive.json` file to share; import a teammate's run.
- **▶ Watch.** Replay a run — the 3D vehicle *becomes* the recording. Scrub,
  change speed (0.5–4×), pause.
- **👻 Ghost.** Race a recording: it flies alongside you as a translucent ghost
  while you fly the same course live. Beat your own best run.
- **⏎ Re-fly from here.** The headline. Scrub to any moment in a run and take
  control of the vehicle **right there** — the simulator repositions to that
  pose and hands you the controls (the full-flight-sim "reposition + unfreeze").
  Practice the hard part of a dive over and over.
- **Instructor.** Inject failures live while a pilot flies: kill individual
  thrusters (T1, T2…), dial a thrust **brownout**, open a **ballast leak**
  (drags the vehicle down), or **freeze** the sim. The CAE IOS, in miniature.
- **Debrief.** After each run, a metrics card: time, distance, average speed,
  collisions, hoops passed, grabs.

## How it's built (developer view)

Plain, shareable JSON and pure, unit-tested cores. New modules:

| Module | Role |
|---|---|
| `src/types/dive-log.ts` | `DiveLog` schema (`cockpit-dive-log/v1`): frames + events + metrics + an embedded environment snapshot. `validateDiveLog`. |
| `src/libs/dive-metrics.ts` | `computeDiveMetrics(log)` — debrief numbers from a finished run (pure). |
| `src/libs/dive-replay.ts` | `createReplay(log)` — a tickable playback clock (play/pause/speed/seek) with interpolated frames and shortest-arc heading (pure; reuses `lerpAngle` from `practice-interp.ts`). |
| `src/libs/dive-recorder.ts` | `startDiveRecording` (accumulate frames/events → `finish()` computes metrics) + IndexedDB persistence via localforage (`saveDiveLog`/`listDiveLogs`/`loadDiveLog`/`deleteDiveLog`, pruned to 24 runs) + export/import text. |
| `src/libs/dive-vehicle-recorder.ts` | `installVehicleDiveRecorder(...)` — records real armed sessions; installed once from the mainVehicle store, skipped while Practice mode is simulating. |
| `src/libs/actions/dive-session-state.ts` | Shared refs: `activeReplay`, `replayMode`, `lastDiveSummary`, `diveLogsVersion`, and `instructorState` (frozen / disabledThrusters / thrustScale / extraBallastN). |
| `src/components/PracticeMissionPanel.vue` | The instructor/replay UI, mounted inside PracticeView3D. |

**Sim integration** (`rover-simulator.ts`): `SimControls.failures` adds dead
thrusters (zeroed outputs), a global `thrustScale`, and `extraBallastN` (extra
downward force). The demo loop (`demo-mode.ts`) skips `stepSimulation` while
`instructorState.frozen`, records a 10 Hz frame + edge-triggered events into the
active recording, and ticks `activeReplay`. `repositionPracticeSim(frame)`
teleports the sim to a recorded pose with velocities/tether/claw reset.

**3D integration** (`practice-3d-scene.ts`): a second translucent rover model
(`ghost-rover`) is driven by `WorldUpdateOptions.ghostPose`; the widget feeds it
the replay frame in ghost mode, or replaces the live pose with the replay frame
in watch mode.

**Real-dive caveat:** underwater vehicles often have no global fix, so a real
dive's track may be depth/attitude only (no XY). Metrics fall back to
depth-only distance; replay/re-fly still work (re-fly into the practice pool
uses whatever position is available). When a DVL/USBL position *is* present, the
recorder lays down a local-meters track from the first fix.

## Tests

`dive-replay.test.ts` (7), `dive-metrics.test.ts` (4), `dive-recorder.test.ts`
(4, pure record + export/import round-trip), instructor-failure cases in
`rover-simulator.test.ts` (3), ghost-pose in `practice-3d-scene.test.ts` (1).
IndexedDB save/load/list is covered by the manual checklist (needs a browser).

## Roadmap (V2 continues)

- Score against a reference/par run; leaderboards per course.
- Replay-driven event markers on the scrubber (jump to each collision/pass).
- MAVLink telemetry-log (`.tlog`/`.bin`) import → DiveLog, to re-fly historical
  real missions captured outside Cockpit.
- Multi-vehicle ghosts (a whole team's runs at once).
- Save/share instructor "scenarios" (a failure script on a timeline).
