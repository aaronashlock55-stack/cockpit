# BlueOS 2.0 — Developer Onboarding

Everything you need to clone, run, and try the BlueOS 2.0 ROV-redesign work.
Two apps, two repos. You can exercise most features **without a rover**.

## The two repos

| Repo | What it is | Branch with our work | Review PR |
|---|---|---|---|
| [BlueOS](https://github.com/aaronashlock55-stack/BlueOS) | Onboard vehicle OS (Vue 2 + Python). **Motor setup.** | `feature/vex-motor-config` | [PR #1](https://github.com/aaronashlock55-stack/BlueOS/pull/1) |
| [cockpit](https://github.com/aaronashlock55-stack/cockpit) | Ground-control station (Vue 3 + TS). **Controller + video.** | `feature/controller-video-redesign` | [PR #1](https://github.com/aaronashlock55-stack/cockpit/pull/1) |

> ⚠️ **The features are NOT on `master`.** A fresh clone lands on `master`
> (plain upstream Blue Robotics). You **must** `git checkout` the feature branch
> in each repo or you'll see none of the new work.

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

## Cockpit (start here — most is testable without a rover)

```bash
git clone https://github.com/aaronashlock55-stack/cockpit.git
cd cockpit

git checkout feature/controller-video-redesign   # the work is here, not master
git submodule update --init --recursive           # m2r, mavlink-json, ParameterRepository
yarn install
yarn dev                                           # → http://localhost:5173
```

### What you can try right now (no rover)

| Feature | How to try it | Needs |
|---|---|---|
| **Controller image matches your pad** | Settings → Joystick, plug in a gamepad | a gamepad |
| **Export / import controller mappings** | Joystick page → Download / Upload (top-right). Try a junk file → graceful error | nothing |
| **Multi-stream video layouts** | Edit mode → add **VideoGrid** widget → switch grid / picture-in-picture / focused; click tiles to set the active feed | nothing* |
| **Cycle cameras from a button** | Joystick page → bind a button to **"Cycle video stream"**, then press it with VideoGrid open | a gamepad |

\* Video *layouts* work offline; live frames inside the tiles need a vehicle/RTSP source (tiles show "connecting" spinners without one).

Deep-dive guide (operator steps + code map + hardware checklist):
[`docs/BlueOS-2.0-Controller-and-Video.md`](https://github.com/aaronashlock55-stack/cockpit/blob/feature/controller-video-redesign/docs/BlueOS-2.0-Controller-and-Video.md)

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
motor, spin-test it to confirm wiring, and name it.

> The Motors tab UI renders without a vehicle, but live motor data, port
> assignment, and spin-tests need a connected BlueOS backend (your Pi, or the
> public BlueOS demo backend).

Deep-dive guide:
[`docs/BlueOS-2.0-Motors.md`](https://github.com/aaronashlock55-stack/BlueOS/blob/feature/vex-motor-config/docs/BlueOS-2.0-Motors.md)

---

## What each phase delivers

1. **Motor setup (BlueOS)** — VEX-style click-a-port board: assign `SERVOn_FUNCTION`, per-port 1-second spin test, on-vehicle motor names.
2. **Controller image (Cockpit)** — joystick page shows an image matching the detected pad (Xbox / PlayStation / flight-stick), generic fallback for unknown.
3. **Import/export setup (Cockpit)** — save/load the full joystick profile as JSON; malformed files rejected with a clear dialog.
4. **Video layouts (Cockpit)** — VideoGrid widget shows all feeds at once in grid / picture-in-picture / focused modes, with an app-wide "active feed".
5. **Camera cycle (Cockpit)** — joystick action that advances the active feed.

## Fastest way to review (no setup)

Just read the PRs in the GitHub UI — the diffs and descriptions cover everything:
- BlueOS: https://github.com/aaronashlock55-stack/BlueOS/pull/1
- cockpit: https://github.com/aaronashlock55-stack/cockpit/pull/1

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

## Hardware verification (when at the rover)

Each deep-dive guide ends with a checklist. In short: assign/name/spin motors on a
real Navigator + ArduSub, and in Cockpit confirm live WebRTC streams in the new
layouts and a bound button cycling the feed.
