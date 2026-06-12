# BlueOS 2.0 — Developer Onboarding

Everything you need to clone, run, and try the BlueOS 2.0 ROV-redesign work.
Two apps, two repos. You can exercise most features **without a rover**.

## The two repos

| Repo | What it is | Branch with our work | Review PR |
|---|---|---|---|
| [BlueOS](https://github.com/aaronashlock55-stack/BlueOS) | Onboard vehicle OS (Vue 2 + Python). **Motor setup + wizard.** | `feature/vex-motor-config` | [PR #1](https://github.com/aaronashlock55-stack/BlueOS/pull/1) |
| [cockpit](https://github.com/aaronashlock55-stack/cockpit) | Ground-control station (Vue 3 + TS). **Controller, video, + the practice trainer.** | **`feature/operator-assist`** | — |

> ⚠️ **The features are NOT on `master`.** A fresh clone lands on `master`
> (plain upstream Blue Robotics). You **must** `git checkout` the feature branch
> in each repo or you'll see none of the new work.
>
> 🔄 **Cockpit moved to `feature/operator-assist`.** This branch is built on top
> of the old `feature/controller-video-redesign` (so it has all the controller +
> video work) **plus** the new operator-experience features — pilot-assist, the
> video HUD overlay, and the no-hardware **3D practice trainer**. If you cloned
> the old branch earlier, just `git fetch && git checkout feature/operator-assist`.

## Prerequisites

- **git** and **Node.js** (any recent version; built/tested on Node 26)
- **Yarn** — `npm install -g yarn`  *(use yarn, not npm/bun — both repos ship `yarn.lock`)*
- A **USB or Bluetooth gamepad** (optional, but needed to try the controller features)

## (Optional) Accept your collaborator invite

Only needed if you want to **push branches or merge PRs** — not required just to
clone and run. Accept at:
- https://github.com/aaronashlock55-stack/BlueOS/invitations
- https://github.com/aaronashlock55-stack/cockpit/invitations

---

## 🖥 One desktop app — "BlueOS 2.0 Control" (no Chrome needed)

Cockpit + BlueOS now ship as **one desktop application** with its own bundled
runtime (Electron) — nothing to open in a browser:

- **Cockpit** is the app itself (flying, video, joystick, the 3D trainer).
- **BlueOS** lives inside it: ☰ menu → **Tools → BlueOS** embeds the vehicle's
  full BlueOS interface (Motors tab + wizard, parameters, networking). The
  address auto-fills from the vehicle connection — hit **Connect**.
  (BlueOS's onboard services still run on the rover's Pi, as always — this
  embeds its interface so you never leave the app.)

Build it from `cockpit/` (after the install steps below):

```bash
yarn dev:electron                                   # run it live while developing
COCKPIT_VERSION=2.0.0 yarn deploy:electron:mac:arm64:pr   # Apple-silicon .dmg (unsigned dev build)
COCKPIT_VERSION=2.0.0 yarn deploy:electron:mac:x64:pr     # Intel-mac .dmg
$env:COCKPIT_VERSION='2.0.0'; yarn deploy:electron:windows  # Windows installer (PowerShell)
```

The installer lands in `cockpit/dist/` (e.g. `BlueOS 2.0 Control-mac-arm64-2.0.0.dmg`).
Unsigned dev builds: on macOS right-click → Open the first time.

---

## Cockpit (start here — most is testable without a rover)

```bash
git clone https://github.com/aaronashlock55-stack/cockpit.git
cd cockpit

git checkout feature/operator-assist     # the work is here, not master
git submodule update --init --recursive  # m2r, mavlink-json, ParameterRepository
yarn install
yarn dev                                  # → http://localhost:5173
```

> Already cloned earlier? Just `git fetch && git checkout feature/operator-assist && git pull && yarn install`.

### 🎮 The headline feature: the 3D practice trainer (no hardware at all)

A flight-simulator-style ROV trainer that runs entirely offline:

1. ☰ menu → **Settings → Development** → toggle **"Practice / Demo mode (no vehicle)"**.
2. Pick a **rover profile** (BlueROV2 / Heavy, or upload your own — the physics
   derive from its real mass/dimensions/thrusters) and an **environment**:
   - **"Training course — hoops, gates & pickups"** (the default): fly through
     hoops (✔ flashes on a clean pass), thread the corner gates, and carry
     objects to the recovery basket with the claw.
   - **"MATE 2026 — NRC Ice Tank (Worlds)"** (built from the real preview mission:
     90×12×3 m tank, salt water, ice sheet with a 1 m launch hole, profiling float).
3. Back on the main screen, **Edit mode** → add the **PracticeView3D** widget (full-screen).
4. Fly it:
   - **Gamepad**, or keyboard **W A S D** move · **← →** turn · **↑ ↓** depth · **G** claw.
   - Realistic marine physics (Fossen 6-DOF, momentum/coasting/buoyancy, real
     tether that routes through the ice hole and tugs when taut), the vehicle
     frame visible at the edges of view, and a **working claw**.
   - Add a **PracticePoolView** widget too for a top-down map of the pool.

Also try: **PilotAssistPanel** mini-widget (one-tap Depth Hold / Stabilize), and any
VideoPlayer → enable **HUD overlay** for heading/attitude/depth burned on the feed.

### Other features (no rover)

| Feature | How to try it | Needs |
|---|---|---|
| **Controller image matches your pad** | Settings → Joystick, plug in a gamepad | a gamepad |
| **Export / import controller mappings** | Joystick page → Download / Upload (top-right). Try a junk file → graceful error | nothing |
| **Multi-stream video layouts** | Edit mode → add **VideoGrid** widget → switch grid / picture-in-picture / focused | nothing* |
| **Cycle cameras from a button** | Joystick page → bind a button to **"Cycle video stream"** | a gamepad |

\* Video *layouts* work offline; live frames inside the tiles need a vehicle/RTSP source.

Deep-dive guides:
[`docs/BlueOS-2.0-Operator-Assist.md`](https://github.com/aaronashlock55-stack/cockpit/blob/feature/operator-assist/docs/BlueOS-2.0-Operator-Assist.md)
(practice mode, environments, HUD, pilot-assist) ·
[`docs/BlueOS-2.0-Controller-and-Video.md`](https://github.com/aaronashlock55-stack/cockpit/blob/feature/operator-assist/docs/BlueOS-2.0-Controller-and-Video.md)
(controller + video)

---

## BlueOS (onboard frontend — Motor setup)

```bash
git clone https://github.com/aaronashlock55-stack/BlueOS.git
cd BlueOS

git checkout feature/vex-motor-config             # the work is here, not master
git submodule update --init --recursive           # MAVLink2Rest, ParameterRepository, etc.
cd core/frontend
yarn install
yarn dev                                           # → http://localhost:8080
```

Open **Vehicle Setup → Motors**. The new VEX-style tab: click a port to assign a
motor, spin-test it to confirm wiring, and name it — plus a **Setup wizard**
(guided spin-identify flow with a frame diagram).

> The Motors tab UI renders without a vehicle, but live motor data, port
> assignment, and spin-tests need a connected BlueOS backend (your Pi, or the
> public BlueOS demo backend).

Deep-dive guide:
[`docs/BlueOS-2.0-Motors.md`](https://github.com/aaronashlock55-stack/BlueOS/blob/feature/vex-motor-config/docs/BlueOS-2.0-Motors.md)

---

## What each phase delivers

1. **Motor setup (BlueOS)** — VEX-style click-a-port board: assign `SERVOn_FUNCTION`, per-port spin test, on-vehicle motor names.
2. **Controller image (Cockpit)** — joystick page shows an image matching the detected pad (Xbox / PlayStation / flight-stick), generic fallback.
3. **Import/export setup (Cockpit)** — save/load the full joystick profile as JSON; malformed files rejected with a clear dialog.
4. **Video layouts (Cockpit)** — VideoGrid widget shows all feeds at once in grid / picture-in-picture / focused modes.
5. **Camera cycle (Cockpit)** — joystick action that advances the active feed.
6. **Practice / Demo mode (Cockpit)** — simulate a vehicle with no hardware; loads a **rover profile** (upload/import) so it handles like your rover.
7. **Video HUD overlay (Cockpit)** — heading/attitude/depth burned onto the live feed.
8. **Pilot-assist (Cockpit)** — one-tap ArduSub mode buttons (Depth Hold, Stabilize…).
9. **Motor setup wizard (BlueOS)** — guided spin-identify flow with a frame diagram.
10. **Practice environments + 3D trainer (Cockpit)** — configurable pool/water/ice/tether/obstacles (MATE 2026 preset), a top-down **PracticePoolView**, and a first-person **PracticeView3D** flight-sim with marine physics, a visible vehicle frame, and a working claw. Keyboard or gamepad.

## Fastest way to review (no setup)

Read the PRs in the GitHub UI for the controller/video work:
- BlueOS: https://github.com/aaronashlock55-stack/BlueOS/pull/1
- cockpit: https://github.com/aaronashlock55-stack/cockpit/pull/1

The operator-assist + 3D-trainer work (Phases 6–10) is on `feature/operator-assist`
and isn't in a PR yet — `git log --oneline master..feature/operator-assist` shows it,
or just run it (above).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "I don't see any of the new features" | You're on `master`. Run the `git checkout <feature-branch>` step. |
| Build/import errors about missing modules (MAVLink2Rest, ParameterRepository…) | You skipped `git submodule update --init --recursive`. |
| `Failed to resolve import "./components/vue-tour/dist/vue-tour.css"` (or similar missing submodule file) | A submodule didn't fully initialize. From the **repo root** run `git submodule update --init --recursive --force`, confirm `ls core/frontend/src/components/vue-tour/dist/vue-tour.css` exists, then restart `yarn dev`. |
| `npm install` errors / weird dependency state | Use **yarn**, not npm. |
| Controller image stays generic | The pad model isn't in the VID:PID map yet — see the controller guide's "add a new controller" section. |
| Video tiles show only spinners | Expected without a vehicle/RTSP source; the layouts still work. |
| BlueOS says **"backend offline"** / Motors tab just spins | Expected — the frontend needs a backend + vehicle. To preview Motors with no rover, run a BlueOS backend with a **SITL** (simulated) autopilot and point the dev server at it: `BLUEOS_ADDRESS=http://<backend>/ yarn dev`. Full guide: `BlueOS/docs/BlueOS-2.0-SITL-Dev.md`. |
| Cockpit shows **"something went wrong while loading Cockpit"** after pulling | Cockpit is a PWA; its service worker is serving stale cached files. **Hard refresh** (Cmd/Ctrl+Shift+R). If it persists: DevTools → Application → Service workers → Unregister, then Clear site data, reload. Do **not** click "Reset settings" — that wipes your layouts. |
| 3D trainer / PracticeView3D shows nothing | Make sure **Practice / Demo mode** is toggled ON (Settings → Development) — the widget only renders while the sim is running. |

## Hardware verification (when at the rover)

Each deep-dive guide ends with a checklist. In short: assign/name/spin motors on a
real Navigator + ArduSub, and in Cockpit confirm live WebRTC streams in the new
layouts and a bound button cycling the feed.
