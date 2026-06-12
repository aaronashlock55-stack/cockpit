# BlueOS 2.0 — Operator Experience (Practice mode, HUD overlay, Pilot-assist)

> Phases 6–8 of the BlueOS 2.0 redesign. Branch `feature/operator-assist`.
> Research-driven: Greensea/Skydio assistive autonomy, Abyssal OS / ROV HUD Borey
> video HUDs, VideoRay's training simulator. All three are usable **offline**.

| Phase | Feature | Commit |
|---|---|---|
| 6 | Practice / Demo mode (simulate your rover, no hardware) | `21c8520` |
| 6.5 | Practice environments: pool/water/ice/tether/obstacles + MATE 2026 preset | `4d2b370` |
| 7 | Video HUD overlay (heading/depth/attitude on the feed) | `57e9cd9` |
| 8 | Pilot-assist quick controls (one-tap modes) | `3368214` |
| 11 | Realism engine (profile-derived Fossen 6-DOF) + training course | — |
| 12 | Full rover model + chase view, rigid-body contacts, visual realism | — |
| 13 | Rigid-body camera (camera mounted on the rover) + tether snag physics | — |
| 14 | Adjustable camera, water currents (wave pool / jet stream), graphics pass | — |

## Phase 14 — Adjustable camera, currents & graphics

**Camera you can move.** On top of FP/chase, the operator can **drag to look
around**, **scroll to zoom**, and **double-click (or ⟳ Recenter) to reset**. In
FP it's a look-offset on the rigid mount; in chase it orbits the vehicle.

**The tether actually catches now.** The capture distance was widened and the
depth check made sag-aware, and the training-course gate posts are now
**full-height pillars** — drive the cable past one and it snags, bends around it,
and you have to back out to free yourself (`tether (snagged)` in the status line).

**Water currents — wave pool & jet stream.** New `flow` field on the
environment, driven through **relative-velocity drag** (drag acts on the rover's
speed *relative to the water*, so moving water pushes the vehicle):
- **Steady current** — a uniform push across the whole pool.
- **Wave pool** — oscillating near-surface orbital flow that calms with depth;
  the rover gets shoved around near the top (the water surface visibly chops).
- **Jet stream** — a fast band across the pool middle; cross it and you get
  swept sideways. Configure type/speed/direction in Settings → Development, or
  pick the **Wave pool** / **Jet stream channel** presets. Two new physics tests
  cover the current push and that the jet only acts inside its band.

**Graphics pass.** Environment-map reflections on clear/metal surfaces,
**god-ray light shafts** from the surface, **rising bubbles**, particulate that
**streams along the current** (so you can see flow direction), and wave chop that
scales with the wave-pool speed.

**For developers:** `flow` + `flowVelocity()` in `practice-environment.ts`,
`SimState.time` + relative-velocity drag in `rover-simulator.ts`, new FX in
`practice-3d-fx.ts`, camera adjust in `practice-3d-scene.ts` + the widget.
54 practice tests (75 total).

## Phase 13 — Rigid camera & tether snagging

**Camera is part of the rover.** The first-person camera is now mounted ON the
rover model as a fixed forward camera, so the camera and vehicle are **one rigid
body** — it inherits the vehicle's heading, pitch and roll exactly like a real
ROV's bolted-on cam (the view banks when you roll, dips when you pitch). The hull
sits behind the lens, so you look out over your own frame edges and claw. Chase
view (**C**) detaches the same camera behind the vehicle.

**The tether snags on the environment.** The cable now catches on props and
posts: when the run from the last anchor to the rover crosses an obstacle, a
**wrap point** is pinned at that obstacle's edge and the cable bends around it —
deployed length, drag, the hard length limit, and the rendered rope all follow
the wrapped path. Drive back the way you came and it **unwinds**. So you can box
yourself in by wrapping the tether around the gates, and tether management
becomes a real part of piloting (the status line shows `tether (snagged)`).

**For developers:** new `src/libs/rover-tether.ts` (wrap/snag/release + length
limit, with `SimState.tetherWraps`); the full wrapped path is published on
`practiceSimReadout.tetherPath` and drawn by both the 3D rope and the pool map.
49 practice tests (70 total).

## Phase 12 — Full rover, chase view & visual realism

**Your whole rover, in the water.** A complete 3D vehicle is now built from the
imported `rover-profile.json`: hull sized from the real length/width/height,
**every thruster at its real mounted position and orientation** (spinning
props), foam, enclosure, headlights, and the claw. Press **C** (or the 🎥
button) to switch between the **ROV camera** (first person) and a **chase
view** that trails the vehicle — upload a different profile and the vehicle you
see changes with it.

**Rigid-body contacts.** The physics footprint is now the rover's real
*oriented* length×width — strafing fits through gaps the nose can't — and every
contact (walls, floor, ice, props, hoops, taut tether) **kills the momentum
into the surface**, so the vehicle thunks and stops instead of ghost-sliding.
This also fixed a mix bug where strafing made the presets spin.

**The tether is a real rope.** A 3D tube that **sags in proportion to slack**,
straightens and **turns red as it runs out**, and visibly routes through the
ice launch hole — the same cues the top-down pool map shows.

**Visual realism pass:** filmic (ACES) tone mapping, soft sun shadows, an
**animated water surface**, **caustic shimmer** on the pool floor, drifting
particulate, and physically-based materials throughout.

**For developers:** `src/libs/practice-3d-rover.ts` (profile-driven vehicle),
`src/libs/practice-3d-fx.ts` (water/caustics/particles), chase logic in
`practice-3d-scene.ts`, footprint/contacts in `rover-simulator.ts` +
`rover-hydro.ts` (`footprintRadius`). 43 vitest tests across sim/scene/rover.

## Phase 11 — Realism engine + training course

**The engine.** The practice sim now runs a full **Fossen 6-DOF marine model**
(`M ν̇ + D(ν) ν + g(η) = τ`) — the same formulation Stonefish and UNav-Sim use —
and every coefficient is **derived from the active rover profile**, not tuned
constants:

- **Your rover's real weight and dimensions drive the physics.** Drag comes from
  the actual projected areas (½ ρ Cd A), added mass from frame volume, rotational
  inertia from mass + dimensions, and the righting wobble from the
  buoyancy/gravity separation. Upload a profile with your rover's numbers and it
  handles like your rover: heavier = more sluggish, bigger = lower top speed.
- **Thrust and torque from the thruster layout.** Per-thruster max force
  (optional `thrusterMaxForceN` in `rover-profile.json`, default 35 N ≈ a T200
  at 14 V) × the mix weights; turning torques use each thruster's real moment
  arm from its mounted position.
- **Real attitude kinematics:** nose-down + forward thrust genuinely drives you
  deeper, and buoyancy resolves into the body frame when leaned.

**Tether, for real.** Toggle + length live in Settings → Development and apply
immediately. Under an ice sheet the tether **routes through the launch hole**
(deployed length, drag, and the 3D rendering all follow the real path); when it
snaps taut your outward momentum is killed — the tug you feel on a real ROV.

**Training course.** A new default environment, *"Training course — hoops, gates
& pickups"*: three **hoops** at increasing depth/angle (a green **✔ flashes** on
a clean pass; clip a hoop and you'll bounce off the rim), corner **slalom
gates**, and **pickup objects** (cube, canister, profiling float) with a
recovery basket to carry them back to.

**For developers:** `src/libs/rover-hydro.ts` (model derivation, exported for
tests), `src/libs/rover-simulator.ts` (the stepper), `ring` obstacle shape in
`practice-environment.ts`. 33 vitest tests across sim + scene.

## Phase 6.5 — Practice environments (pool, water, tether, MATE props)

**What it does:** the practice sim runs inside a configurable **environment**:
pool dimensions, water salinity/temperature (drives buoyancy — salty water
floats the rover up), an optional **ice sheet with a launch hole**, a **tether**
(hard length limit + drag that grows with deployment), and **obstacles/mission
props** with collision.

**The MATE 2026 preset is built from the official preview mission**: the NRC ice
tank (90 × 12 × 3 m), EGADS water at specific gravity ~1.025, a 1 m × 1 m launch
hole in the ice, and the vertical profiling float (18 cm × 1 m) as a prop.
Regional-pool and open-pool presets are included.

**For operators**
- Settings → Development (with Practice mode on): pick an **Environment** preset,
  tweak pool length/width/depth, salinity, temperature, and tether on/off + length.
  Upload/Download environments as JSON to share prop layouts; **Reset rover**
  re-spawns at the start (the ice hole, in the MATE preset).
- Add the **PracticePoolView** widget: live top-down view of the pool, ice +
  hole, props, the tether (dashed = slack, red = taut), and the rover (flashes
  red on contact, with the contacted object named in the status bar).
- Surfacing under the ice is blocked (like the real penalty); only the launch
  hole lets you surface. Saltier water = the rover slowly floats up unless you
  push down — retune your instincts per venue.

**For developers**
- `src/types/practice-environment.ts` — env schema (`cockpit-practice-env/v1`),
  presets, `waterDensity()`.
- `src/libs/rover-simulator.ts` — environment physics (bounds, buoyancy, ice,
  obstacles, tether). **9 vitest tests** in `src/tests/libs/rover-simulator.test.ts`.
- `src/components/widgets/PracticePoolView.vue` — the top-down widget.
- `src/libs/practice-env-io.ts` — upload/download.

---

## Phase 6 — Practice / Demo mode

**What it does:** makes Cockpit fully usable with **no vehicle** — a simulated ROV
streams live telemetry so teams can train and reviewers can see the UX offline. It
loads a **rover profile** so the sim handles like *your* rover ("learn my rover").

**For operators**
1. **Settings → Development → "Practice / Demo mode (no vehicle)"**.
2. Pick/load a **rover profile**:
   - choose a built-in preset (BlueROV2 / BlueROV2 Heavy),
   - **Upload** a `rover-profile.json` you exported/crafted,
   - **Download** the active profile to share with teammates,
   - **Import from vehicle** (best-effort) when one is connected.
3. Cockpit now shows a connected ArduSub with live, moving telemetry. Plug in a
   gamepad to fly the sim; without one it runs a gentle automated patrol.
4. Add Attitude / Compass / Depth / Battery widgets, the ModeSelector, or a
   VideoPlayer with the HUD overlay — they all animate.

**For developers**
- Rover profile type + presets: `src/types/rover-profile.ts` (thrusters with
  per-axis **mix weights** — the part that makes rovers handle differently).
- Profile IO: `src/libs/rover-profile-io.ts` (upload/download/import).
- Motion model: `src/libs/rover-simulator.ts` (applies the mix forward+back).
- Driver: `src/libs/actions/demo-mode.ts` feeds **both** telemetry paths —
  the reactive `mainVehicle` store (HUD widgets) and the data lake (custom
  widgets). Toggle wired in `src/stores/development.ts`.
- The `rover-profile.json` schema is `cockpit-rover-profile/v1`; BlueOS can
  export this same shape from its motor config (future tie-in).

## Phase 7 — Video HUD overlay

**What it does:** burns a flight-style HUD (heading tape, attitude indicator,
depth, speed, battery) onto the live video feed instead of separate widgets —
reducing pilot "information overload".

**For operators**
- **VideoPlayer**: open its config → enable **"HUD overlay"**.
- **VideoGrid**: click the **gauge** icon in the layout switcher; the HUD shows
  on the active/focused feed.
- Works over a live stream, a still feed, or (in Practice mode) the demo telemetry.

**For developers**
- `src/components/VideoHudOverlay.vue` — SVG/HTML overlay reading the same
  `useMainVehicleStore()` telemetry the HUD widgets use (so Demo mode drives it).
- Wired into `VideoPlayer.vue` (config switch) and `VideoGrid.vue` (active cell + toggle).

## Phase 8 — Pilot-assist quick controls

**What it does:** a one-tap panel of ArduSub assist modes (Manual, Stabilize,
**Depth Hold**, Position Hold, Acro, Surface) so pilots can hand work to the
vehicle, the way Greensea/Skydio surface assistive autonomy.

**For operators**
- Edit mode → add the **PilotAssistPanel** mini-widget to a bar.
- Tap a mode; the active mode is highlighted. Only modes the connected vehicle
  reports are shown. Each mode is also bindable to a joystick button.

**For developers**
- `src/components/mini-widgets/PilotAssistPanel.vue` — reuses
  `vehicleStore.setFlightMode` / `modesAvailable` (same path as ModeSelector).
- Registered as `MiniWidgetType.PilotAssistPanel` in `src/types/widgets.ts`.
- *Trim sub-panel is deferred* pending a manual-control protocol spike.

## Testing (no hardware)

```bash
git checkout feature/operator-assist
yarn install && git submodule update --init --recursive
yarn dev    # http://localhost:5173
```
Turn on **Practice / Demo mode** (Dev settings), then exercise the HUD overlay
and PilotAssistPanel against the simulated rover.
