import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

/**
 * Post-processing chain for the practice trainer: a subtle bloom (caustic
 * filaments, sun sparkle and headlights glow instead of clipping) and an
 * underwater finish pass (vignette + cool rim tint). Imported ONLY by the 3D
 * widget — it needs a live WebGL renderer, so it is not unit-testable and must
 * stay out of the scene-graph modules the tests load.
 */

/** Handle to the post chain. */
export interface PracticePost {
  /** Resize the chain (call with the canvas CSS size + device pixel ratio). */
  setSize: (width: number, height: number, pixelRatio: number) => void
  /** Render one frame through the chain. */
  render: () => void
  /** Free GPU resources. */
  dispose: () => void
}

const UNDERWATER_FINISH_SHADER = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      // Cool blue tint creeping in from the edges, then a soft vignette.
      vec3 tinted = mix(color.rgb, color.rgb * vec3(0.75, 0.92, 1.0), smoothstep(0.35, 0.95, d));
      float vig = 1.0 - 0.35 * smoothstep(0.55, 0.95, d);
      gl_FragColor = vec4(tinted * vig, color.a);
    }
  `,
}

/**
 * Build the post chain: render → bloom → underwater finish → output (tone
 * mapping + sRGB). The composer renders into an MSAA half-float target so
 * antialiasing survives post-processing.
 * @param {THREE.WebGLRenderer} renderer The widget's renderer.
 * @param {THREE.Scene} scene The practice scene.
 * @param {THREE.Camera} camera The active camera.
 * @returns {PracticePost} The chain handle.
 */
export const buildPracticePost = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): PracticePost => {
  const size = renderer.getSize(new THREE.Vector2())
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, target)
  const renderPass = new RenderPass(scene, camera)
  // Subtle: only the brightest spots (caustics, sparkle, lights) bloom.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.4, 0.85)
  const finish = new ShaderPass(UNDERWATER_FINISH_SHADER)
  const output = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(bloom)
  composer.addPass(finish)
  composer.addPass(output)

  return {
    setSize: (width: number, height: number, pixelRatio: number): void => {
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
    },
    render: (): void => composer.render(),
    dispose: (): void => {
      composer.dispose()
      bloom.dispose()
      finish.dispose()
      output.dispose()
      target.dispose()
    },
  }
}
