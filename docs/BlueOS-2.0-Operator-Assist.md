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
