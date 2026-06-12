# BlueOS 2.0 — Operator Experience (Practice mode, HUD overlay, Pilot-assist)

> Phases 6–8 of the BlueOS 2.0 redesign. Branch `feature/operator-assist`.
> Research-driven: Greensea/Skydio assistive autonomy, Abyssal OS / ROV HUD Borey
> video HUDs, VideoRay's training simulator. All three are usable **offline**.

| Phase | Feature | Commit |
|---|---|---|
| 6 | Practice / Demo mode (simulate your rover, no hardware) | `21c8520` |
| 7 | Video HUD overlay (heading/depth/attitude on the feed) | `57e9cd9` |
| 8 | Pilot-assist quick controls (one-tap modes) | `3368214` |

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
