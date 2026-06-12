# BlueOS 2.0 — Controller & Video Features

> Part of the **BlueOS 2.0** ROV-redesign fork. Companion guide:
> BlueOS's `docs/BlueOS-2.0-Motors.md` (onboard motor-setup feature).
> This document covers the Cockpit ground-station changes only.

Branch: `feature/controller-video-redesign`

| Phase | Feature | Commit |
|---|---|---|
| 2 | Dynamic controller image | `aa209b7` |
| 3 | Import/export controller setup (hardening) | `b1be1b7` |
| 4 | Multi-stream video layouts (VideoGrid) | `e633449` |
| 5 | "Cycle video stream" joystick action | `21d5808` |

---

## Phase 2 — Controller image matches your gamepad

**What it does:** the Joystick configuration page now shows a controller
illustration that matches the *model* of the connected pad, instead of always
drawing a PlayStation pad.

**For operators**
- Go to **Settings → Joystick** and plug in a gamepad.
- Xbox-family pads (Xbox One/Series/360, Steam Deck, 8BitDo) → Xbox layout.
- PlayStation pads (DualSense/DualShock) → PS layout.
- Flight sticks (Logitech Extreme 3D Pro, Thrustmaster SimTask) → stick layout.
- **Anything unrecognised → a clean generic gamepad** (no more wrong PS image).
- Buttons/sticks light up live on whichever image is shown.

**For developers**
- Detection already existed: `src/libs/joystick/manager.ts` → `getModel()` maps the
  Gamepad API `id` → `VID:PID` → `JoystickModel`.
- The model→image resolver lives in `src/components/joysticks/JoystickPS.vue`
  (`joystickSvgModel`). Add a model to a `case` to map it to a layout.
- New assets: `public/images/Xbox.svg`, `public/images/Generic.svg`. Each carries
  the full interaction anatomy (`path_bN` clickable buttons, `path_line_bN`
  connector lines, `text_bN` labels) so highlighting/labels work on them.
- **To add a brand-new controller image:** create `public/images/<Name>.svg` using
  PS4.svg as the anatomy reference (same `path_bN`/`text_bN`/`path_line_bN` ids,
  viewBox `0 0 1250 650`), add an `SVGModel` enum entry, and map the model in
  `joystickSvgModel`. If stick travel looks off, add a `case` in `setAxes`.
- Note: upstream `PS5.svg` is a plain illustration without interaction anatomy,
  so DualSense intentionally renders on the PS4 layout.

---

## Phase 3 — Import / export controller setup

**What it does:** save your whole joystick mapping (axes, buttons, actions) to a
JSON file and load it back — to share a profile or move it between machines.

**For operators** (Settings → Joystick, top-right toolbar)
- **Download** (tray-down icon): saves
  `cockpit-joystick-functions-mapping-<name>.json`.
- **Upload** (tray-up icon): loads a profile JSON and applies it immediately.
- A malformed or wrong-shape file is now **rejected with a clear error dialog**
  instead of silently doing nothing.

**For developers**
- Export/import live in `src/stores/controller.ts`:
  `exportFunctionsMapping` / `importFunctionsMapping`, wired to the toolbar in
  `src/views/ConfigurationJoystickView.vue`.
- Our change hardened both import handlers: `JSON.parse` is wrapped in try/catch
  with an error dialog, and validation now requires `axesCorrespondencies` and
  `buttonsCorrespondencies.regular` (the fields the store dereferences) so a bad
  file fails at import time rather than crashing later.

---

## Phase 4 — Multi-stream video layouts (VideoGrid widget)

**What it does:** a new widget that shows **all** your camera streams at once,
with switchable layouts and a concept of the "active" feed.

**For operators**
1. Enter **Edit mode** (pencil / edit-menu), open the widget gallery, add
   **VideoGrid**.
2. Hover the widget's top-left corner for the **layout switcher**:
   - **Grid** — every stream as an equal tile. Click a tile to make it *active*
     (highlighted blue).
   - **Picture-in-picture** — the active feed fills the widget; the other feeds
     are small clickable thumbnails in the corner.
   - **Focused** — only the active feed is shown; click it to advance to the next.
3. The "active" feed is shared app-wide and is what the joystick cycle button
   (Phase 5) advances.

> Without a connected vehicle/RTSP source the tiles show "connecting" spinners,
> but every layout, the active-feed highlight, and switching all work for UI review.

**For developers**
- Widget: `src/components/widgets/VideoGrid.vue`. Registered in
  `src/types/widgets.ts` (`WidgetType.VideoGrid` + the three config maps).
- **Active-feed state** is in the video store (`src/stores/video.ts`):
  `activeStreamName`, `setActiveStream(name)`, `cycleActiveStream()`.
- Stream attachment reuses `videoStore.getMediaStream()` (same WebRTC/RTSP
  machinery as the existing `VideoPlayer` widget) — nothing new in the transport.

---

## Phase 5 — Cycle cameras from a controller button

**What it does:** a joystick button that advances the active video feed.

**For operators**
1. **Settings → Joystick**, click the button you want to bind.
2. Choose the **"Cycle video stream"** action.
3. With a VideoGrid widget on screen (PiP or focused mode), pressing that button
   cycles which camera is shown. Wraps around at the end.

**For developers**
- The action `cycle_video_stream` is defined in
  `src/libs/joystick/protocols/cockpit-actions.ts` and its callback
  (`cycleActiveStream`, 300 ms throttle) is registered in `src/stores/video.ts`.
- It shows up in the mapping UI automatically because the available-actions list
  spreads `availableCockpitActions`.

---

## Running Cockpit for review (no rover needed)

```bash
yarn install                 # first time
git submodule update --init  # first time (m2r, mavlink-json, ParameterRepository)

yarn dev                     # dev server, http://localhost:5173
# or test the real production bundle:
yarn build && yarn vite preview --port 4173   # http://localhost:4173
```

What works fully offline: controller-image matching, mapping import/export,
VideoGrid layouts/switching, and binding + firing the cycle-camera action.
Live video frames require a reachable vehicle or RTSP source.

## Hardware verification checklist

- [ ] Plugging Xbox / PS / unknown pads swaps the on-screen image; unknown → generic
- [ ] Export → reset mappings → import restores them exactly; bad file → error dialog
- [ ] Two live WebRTC streams display in grid / PiP / focused layouts
- [ ] A bound joystick button cycles the active feed on the vehicle
