import * as THREE from 'three'

import { type RoverProfile } from '@/types/rover-profile'

/**
 * Full 3D rover model for the practice trainer, built ENTIRELY from the active
 * rover profile: the hull is sized from the real length/width/height and every
 * thruster is placed at its real mounted position with its real orientation
 * (vertical vs. vectored, from the mix weights). Import a different
 * rover-profile.json and the visible vehicle changes with it.
 *
 * Local frame matches the first-person camera convention: nose = -Z, up = +Y,
 * right = +X. Profile body coords (x fwd, y right, z down) map to (y, -z, -x).
 */

/** Handle to the built rover model. */
export interface RoverModel {
  /** The rover scene group (origin at vehicle center). */
  group: THREE.Group
  /** Set claw closure, 0 = open .. 1 = closed. */
  setClawClosure: (closure: number) => void
  /** Advance propeller spin by the given angle (radians). */
  spinProps: (angle: number) => void
}

const PLASTIC = { color: 0x171f24, roughness: 0.85, metalness: 0.05 }
const ACCENT = { color: 0x1b6f9e, roughness: 0.7, metalness: 0.1 }
const FOAM = { color: 0xe8a13a, roughness: 0.95, metalness: 0 }

/**
 * Whether a thruster is a vertical (heave) unit, judged from its mix weights.
 * @param {RoverProfile['thrusters'][number]} t The thruster.
 * @returns {boolean} True when heave-dominant.
 */
const isVertical = (t: RoverProfile['thrusters'][number]): boolean =>
  Math.abs(t.contribution.heave) >= Math.max(Math.abs(t.contribution.surge), Math.abs(t.contribution.sway), 0.01)

/**
 * Build the full rover model from a profile.
 * @param {RoverProfile} profile The rover profile (dimensions + thrusters).
 * @returns {RoverModel} Group plus claw/prop animators.
 */
export const buildRoverModel = (profile: RoverProfile): RoverModel => {
  const L = Math.max(profile.dimensions.length, 0.15)
  const W = Math.max(profile.dimensions.width, 0.15)
  const H = Math.max(profile.dimensions.height, 0.1)

  const group = new THREE.Group()
  group.name = 'rover'
  const plastic = new THREE.MeshStandardMaterial(PLASTIC)
  const accent = new THREE.MeshStandardMaterial(ACCENT)
  const foam = new THREE.MeshStandardMaterial(FOAM)

  // Side plates (the classic open-frame fairings).
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.014, H * 0.85, L * 0.95), accent)
    plate.position.set(side * (W / 2 - 0.012), 0, 0)
    group.add(plate)
  }
  // Top plate.
  const top = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.014, L * 0.8), plastic)
  top.position.y = H / 2 - 0.01
  group.add(top)

  // Main electronics enclosure (horizontal tube) with a clear front dome.
  const tubeR = H * 0.21
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR, L * 0.62, 20), plastic)
  tube.rotation.x = Math.PI / 2
  tube.position.y = H * 0.18
  group.add(tube)
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(tubeR, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0 })
  )
  dome.rotation.x = -Math.PI / 2
  dome.position.set(0, H * 0.18, -L * 0.31)
  group.add(dome)

  // Battery tube below.
  const battery = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.13, H * 0.13, L * 0.5, 14), plastic)
  battery.rotation.x = Math.PI / 2
  battery.position.y = -H * 0.24
  group.add(battery)

  // Buoyancy foam blocks, top corners.
  for (const side of [-1, 1]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(W * 0.2, H * 0.3, L * 0.55), foam)
    block.position.set(side * W * 0.3, H * 0.33, 0)
    group.add(block)
  }

  // Headlights: two emissive pods at the top front corners.
  for (const side of [-1, 1]) {
    const light = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.022, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2cc, emissiveIntensity: 1.6 })
    )
    light.rotation.x = Math.PI / 2
    light.position.set(side * W * 0.32, H * 0.42, -L * 0.45)
    group.add(light)
  }

  // Thrusters at their REAL mounted positions, oriented from the mix weights.
  const props: THREE.Group[] = []
  profile.thrusters.forEach((t, i) => {
    const thruster = new THREE.Group()
    thruster.name = `thruster-${t.port ?? i + 1}`
    const [px, py, pz] = t.position ?? [0, 0, 0]
    thruster.position.set(py, -pz, -px)
    const axis = isVertical(t)
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(t.contribution.sway, 0, -t.contribution.surge)
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, -1)
    thruster.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize())

    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.1, 12), plastic)
    thruster.add(housing)
    const duct = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 8, 20), plastic)
    duct.rotation.x = Math.PI / 2
    thruster.add(duct)
    const prop = new THREE.Group()
    for (let blade = 0; blade < 3; blade++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.004, 0.07), accent)
      b.position.z = 0.02
      const holder = new THREE.Group()
      holder.rotation.y = (blade * 2 * Math.PI) / 3
      holder.add(b)
      prop.add(holder)
    }
    thruster.add(prop)
    props.push(prop)
    group.add(thruster)
  })

  // Claw at the nose: wrist + two jaws that close together.
  const claw = new THREE.Group()
  claw.name = 'claw'
  claw.position.set(0, -H * 0.28, -L / 2 - 0.02)
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.07, 12), plastic)
  wrist.rotation.x = Math.PI / 2
  wrist.position.z = 0.05
  claw.add(wrist)
  const jawPivots: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.x = side * 0.035
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.034, 0.17), plastic)
    jaw.position.z = -0.085
    pivot.add(jaw)
    claw.add(pivot)
    jawPivots.push(pivot)
  }
  group.add(claw)

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })

  const setClawClosure = (closure: number): void => {
    const angle = (1 - closure) * 0.5
    jawPivots[0].rotation.y = -angle
    jawPivots[1].rotation.y = angle
  }
  setClawClosure(0)

  const spinProps = (angle: number): void => {
    for (const prop of props) prop.rotation.y += angle
  }

  return { group, setClawClosure, spinProps }
}
