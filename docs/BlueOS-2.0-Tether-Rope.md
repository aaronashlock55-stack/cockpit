# BlueOS 2.0 — Tether Rope Physics (V2.2) + Practice Widget UX

> Replaces the old "rubber band around pegs" tether with a real 3D rope so the
> cable attaches at the rover's **rear**, **drapes**, and genuinely gets
> **stuck and tangled** on obstacles — plus a unified UX pass over the practice
> widgets.

## The tether is now a real rope

`src/libs/rover-tether.ts` is a **Verlet / position-based-dynamics rope**: a
48-node chain integrated each sim step.

- **Rear attachment.** The last node is pinned to a body-fixed point at the
  rover's top-rear (`tetherAttachPoint()` in `rover-simulator.ts`, matched by a
  visible strain-relief **boss** on the rover model), so the cable leaves the
  back of the hull and never clips through it. Node 0 is pinned at the surface
  attach point (routed through the ice launch hole when present).
- **Drape.** Free nodes sag under a gentle catenary load and are damped by the
  water — the rope's rendered shape is the actual simulated shape, not a faked
  bezier.
- **Stuck & tangled.** Every node collides with posts/props (capsules), boxes,
  the pool walls and floor, and **contact friction** (`CONTACT_SLIP`) makes the
  rope grab and *stay* wrapped when you back off — so it genuinely snags around
  one or several objects and you must drive back the way you came to clear it.
- **Inextensible length.** The rope shares one paid-out length. When the wrapped
  path needs more cable than is out, the rope **pulls the rover up short** (a
  clamped per-step correction that kills outward momentum); a winch **pays out**
  smoothly as you swim away and gently **reels in** slack when you return (the
  take-up compares the true straight-line reach, and never reels in a rope
  that's snagged on an obstacle).

`tetherFullPath(state, env)` returns the render/measure path
(attach → [hole] → nodes → **rover rear**); the final point is forced to the
rover boss so the rope always terminates in the hull even mid-yank.
`tetherSnaggedObstacleIds()` reports which obstacles the cable is on, for
highlighting.

### Rendering

`practice-3d-scene.ts` draws the rope as a **lit** tube (`MeshStandardMaterial`)
that follows the nodes, reddens + glows as it runs taut, and highlights snagged
obstacles (their emissive pulses orange; the highlight decays back even if the
tether is toggled off). The geometry uses **pooled** point/curve buffers — no
per-frame `Vector3`/curve allocation (only the tube is rebuilt).

## Practice widget UX/UI

- **Shared design tokens** (`practice-hud.css`, imported globally so `:root`
  custom properties aren't scoped away) unify color/typography across the 3D
  view, sonar, pool map, and mission panel.
- **PracticeView3D:** unified ALT/FWD/SOG/**DEP** telemetry strip; live status
  as clean chips; a **collapsible key legend** (no more cramped, clipping hint
  bar); a camera toolbar with an always-visible Recenter + HUD toggle; and a
  **red collision flash** for peripheral-vision feedback.
- **Mission panel:** the icon-only buttons are now **labeled** (Export / Import
  / Delete) and **delete is a two-click confirm**.
- **Pool map:** a **north arrow + scale bar** (with a readable HTML label
  overlay) and obstacles **highlight** when the tether snags them.
- **Sonar:** a numeric **nearest-contact** callout (range @ bearing).

## Tests

`rover-tether.test.ts` (9): chain endpoints, disabled-clear, pay-out, hard limit
+ rover pull, **wrap/stick on a post**, ice-hole routing, **slack reel-in**,
**rope-end at the rover rear when taut**, in-pool containment.
`rover-simulator.test.ts` adds rear-attach + post-snag integration cases.
`practice-3d-scene.test.ts` adds the snag-highlight-decay case. 142 tests total.

## Roadmap

- Movable light props the tether can drag (needs obstacle mass).
- Multi-substep rope solve for very fast transits (anti-tunneling on thin posts).
- Record the tether path into dive logs so replays show the tangle.
