import * as THREE from 'three'

import { type AnimatedEffect } from '@/libs/practice-3d-fx'

/**
 * Custom GLSL shaders for the practice trainer's underwater atmosphere.
 * Everything is procedural (no textures/assets) and runs on the GPU:
 * - Floor caustics: an animated interference web of two layered wave fields —
 *   the bright filament pattern real sunlight makes through a water surface.
 * - Water surface: vertex-shader waves (no per-frame CPU loop) with analytic
 *   normals, fresnel toward the horizon, and a sun sparkle, fading into the
 *   murk with the same exponential falloff as the scene fog.
 */

const CAUSTICS_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vViewDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const CAUSTICS_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec2 uScale;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying float vViewDepth;

  // Two drifting wave fields; their zero-crossing web forms the caustic filaments.
  float wavePair(vec2 p, float t) {
    vec2 a = p + vec2(sin(p.y * 1.7 + t * 0.9), cos(p.x * 1.4 - t * 0.7));
    vec2 b = p * 1.31 + vec2(cos(p.y * 1.1 - t * 0.6), sin(p.x * 1.9 + t * 0.8));
    return sin(a.x + a.y) + sin(b.x - b.y + t * 0.5);
  }

  void main() {
    vec2 p = vUv * uScale;
    float v = wavePair(p, uTime) + 0.6 * wavePair(p * 1.83 + 7.3, uTime * 1.27);
    float c = pow(clamp(1.0 - abs(v) * 0.5, 0.0, 1.0), 5.0);
    c *= 0.85 + 0.15 * sin(uTime * 0.7 + p.x * 0.2);
    // Same exponential-squared falloff as the scene's FogExp2, so distant
    // caustics melt into the murk instead of glowing through it.
    float fade = exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
    gl_FragColor = vec4(vec3(0.62, 0.85, 0.95) * c * fade, c * fade);
  }
`

const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying float vViewDepth;

  void main() {
    vec3 p = position;
    float a1 = 0.045 * uAmp;
    float a2 = 0.035 * uAmp;
    float a3 = 0.016 * uAmp;
    float p1 = 0.7 * p.x + 1.3 * uTime;
    float p2 = 0.9 * p.z + 0.9 * uTime + 0.4 * p.x;
    float p3 = 1.6 * p.x + 1.1 * p.z + 2.0 * uTime;
    p.y += a1 * sin(p1) + a2 * sin(p2) + a3 * sin(p3);
    // Analytic wave normal from the height-field partial derivatives.
    float dhdx = 0.7 * a1 * cos(p1) + 0.4 * a2 * cos(p2) + 1.6 * a3 * cos(p3);
    float dhdz = 0.9 * a2 * cos(p2) + 1.1 * a3 * cos(p3);
    vNormalW = normalize(vec3(-dhdx, 1.0, -dhdz));
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vViewDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const WATER_FRAGMENT = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying float vViewDepth;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // Fresnel: looking along the surface mirrors the bright sky; straight up is clearer.
    float fresnel = pow(1.0 - abs(dot(viewDir, n)), 3.0);
    vec3 color = mix(vec3(0.32, 0.62, 0.78), vec3(0.86, 0.97, 1.0), fresnel);
    // Sun sparkle off the wave facets.
    vec3 sunDir = normalize(vec3(0.35, -1.0, 0.25));
    float spec = pow(max(dot(reflect(sunDir, n), viewDir), 0.0), 80.0);
    color += vec3(0.9, 0.95, 1.0) * spec;
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
    gl_FragColor = vec4(mix(color, uFogColor, fogF), 0.42 + 0.45 * fresnel);
  }
`

/**
 * Procedural caustics on the pool floor: a shader plane just above the floor
 * with an animated interference pattern, additively blended.
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @param {number} D Pool depth, m.
 * @returns {AnimatedEffect} Group + animator.
 */
export const buildShaderCaustics = (L: number, W: number, D: number): AnimatedEffect => {
  const group = new THREE.Group()
  group.name = 'caustics'
  const material = new THREE.ShaderMaterial({
    vertexShader: CAUSTICS_VERTEX,
    fragmentShader: CAUSTICS_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: new THREE.Vector2(L * 3, W * 3) },
      uFogDensity: { value: 0.065 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(L, W), material)
  plane.rotation.x = -Math.PI / 2
  plane.position.set(L / 2, -D + 0.02, W / 2)
  group.add(plane)
  const update = (t: number): void => {
    material.uniforms.uTime.value = t * 0.6
  }
  return { object: group, update }
}

/**
 * GPU water surface seen from below: waves displaced in the vertex shader with
 * analytic normals, fresnel sheen and sun sparkle in the fragment shader.
 * Amplitude scales with `ampScale` so a wave-pool environment visibly chops.
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @param {number} ampScale Wave amplitude multiplier (1 = calm pool).
 * @returns {AnimatedEffect} Mesh + animator.
 */
export const buildShaderWater = (L: number, W: number, ampScale = 1): AnimatedEffect => {
  const sx = Math.min(96, Math.max(24, Math.round(L * 2)))
  const sy = Math.min(96, Math.max(24, Math.round(W * 2)))
  const geometry = new THREE.PlaneGeometry(L, W, sx, sy)
  geometry.rotateX(Math.PI / 2) // lie flat; vertices in XZ, displaced along Y on the GPU
  const material = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: ampScale },
      uFogColor: { value: new THREE.Color(0x16465e) },
      uFogDensity: { value: 0.07 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'water-surface'
  mesh.position.set(L / 2, 0, W / 2)
  const update = (t: number): void => {
    material.uniforms.uTime.value = t
  }
  return { object: mesh, update }
}
