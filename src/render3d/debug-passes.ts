import {
  AdditiveBlending,
  Color,
  Line,
  LinearSRGBColorSpace,
  Material,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import type { DebugShading } from '../render/debug-settings';

/** TASK-379: the 3D debug shadings and the wireframe, as variants of each drawn material that
 * keep its vertex stage (instancing, the models' own shader patches) and replace its colour. */
type Mode = Exclude<DebugShading, 'normal'> | 'wireframe';

const builtIn = (m: Material) => !(m instanceof ShaderMaterial);

/** The view-space position, for face normals and heights from screen derivatives. */
function withViewPosition(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader =
    'varying vec3 vDebugView;\n' +
    shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nvDebugView = mvPosition.xyz;',
    );
  shader.fragmentShader = 'varying vec3 vDebugView;\n' + shader.fragmentShader;
}
/** Code run last in the fragment shader, after every built-in chunk has set the colour. */
const atEnd = (shader: WebGLProgramParametersWithUniforms, code: string) => {
  shader.fragmentShader = shader.fragmentShader.replace(/\}\s*$/, `${code}\n}`);
};

const rampGlsl = `
uniform vec3 debugRamp[5];
vec3 debugRampAt(float t) {
  float u = clamp(t, 0.0, 1.0) * 4.0;
  int i = int(min(3.0, floor(u)));
  vec3 a = debugRamp[0], b = debugRamp[1];
  if (i == 1) { a = debugRamp[1]; b = debugRamp[2]; }
  else if (i == 2) { a = debugRamp[2]; b = debugRamp[3]; }
  else if (i == 3) { a = debugRamp[3]; b = debugRamp[4]; }
  return mix(a, b, u - float(i));
}`;

export class DebugPasses {
  /** Shared by every variant: the ramp, the height range and the camera's world matrix. */
  readonly uniforms = {
    debugRamp: { value: [0, 1, 2, 3, 4].map(() => new Color()) },
    debugLow: { value: 0 },
    debugHigh: { value: 10 },
    debugWire: { value: new Color() },
    debugCameraWorld: { value: null as unknown },
  };
  private readonly variants = new Map<Material, Map<Mode, Material | null>>();
  private readonly size = new Vector2();
  private readonly clear = new Color();
  private heat?: {
    target: WebGLRenderTarget;
    scene: Scene;
    quad: Mesh<PlaneGeometry, ShaderMaterial>;
  };

  setColours(ramp: readonly number[], wire: number) {
    // The variants write these straight to the screen, after the colour-space step: keep the
    // tokens' sRGB values rather than converting them to linear.
    ramp.forEach((c, i) => this.uniforms.debugRamp.value[i]!.setHex(c, LinearSRGBColorSpace));
    this.uniforms.debugWire.value.setHex(wire, LinearSRGBColorSpace);
  }

  private make(source: Material, mode: Mode): Material | null {
    const shader = source instanceof ShaderMaterial;
    if (shader && (mode === 'unlit' || mode === 'light')) return source;
    if (shader && (mode === 'normals' || mode === 'heights' || mode === 'wireframe')) return null;
    const lines = source.type.startsWith('Line') || source.type === 'PointsMaterial';
    if (lines && (mode === 'normals' || mode === 'heights' || mode === 'light')) return null;
    if (lines && mode === 'unlit') return source;
    const copy = source.clone();
    const uniforms = this.uniforms;
    const patch = (program: WebGLProgramParametersWithUniforms) => {
      Object.assign(program.uniforms, uniforms);
      if (mode === 'unlit' && source.type === 'MeshBasicMaterial') return;
      if (mode === 'unlit')
        program.fragmentShader = program.fragmentShader.replace(
          '#include <opaque_fragment>',
          'outgoingLight = diffuseColor.rgb + totalEmissiveRadiance;\n#include <opaque_fragment>',
        );
      else if (mode === 'light')
        program.fragmentShader = program.fragmentShader
          .replace(
            '#include <emissivemap_fragment>',
            'diffuseColor.rgb = vec3(1.0);\n#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(0.0);',
          )
          .replace(
            '#include <opaque_fragment>',
            source.type === 'MeshBasicMaterial'
              ? 'outgoingLight = vec3(1.0);\n#include <opaque_fragment>'
              : '#include <opaque_fragment>',
          );
      else if (mode === 'normals') {
        withViewPosition(program);
        // Flat face normals in world space: east red, north green, up blue.
        atEnd(
          program,
          `vec3 debugN = normalize(cross(dFdx(vDebugView), dFdy(vDebugView)));
  debugN = normalize((vec4(debugN, 0.0) * viewMatrix).xyz);
  gl_FragColor = vec4(0.5 + 0.5 * vec3(debugN.x, -debugN.z, debugN.y), 1.0);`,
        );
      } else if (mode === 'heights') {
        withViewPosition(program);
        program.fragmentShader = program.fragmentShader.replace(
          'void main() {',
          `uniform float debugLow;\nuniform float debugHigh;\nuniform mat4 debugCameraWorld;\n${rampGlsl}\nvoid main() {`,
        );
        // Elevation on the ramp, a contour every metre and a darker one every 5 m, and
        // steeper faces a shade darker.
        atEnd(
          program,
          `vec3 debugWorld = (debugCameraWorld * vec4(vDebugView, 1.0)).xyz;
  vec3 debugN = normalize(cross(dFdx(vDebugView), dFdy(vDebugView)));
  float debugUp = abs((vec4(debugN, 0.0) * viewMatrix).y);
  vec3 debugC = debugRampAt((debugWorld.y - debugLow) / max(1.0, debugHigh - debugLow));
  float debugStep = fwidth(debugWorld.y);
  float debugLine = 1.0 - smoothstep(0.0, 1.5 * debugStep, abs(fract(debugWorld.y + 0.5) - 0.5));
  float debugMajor = 1.0 - smoothstep(0.0, 1.5 * debugStep, abs(fract(debugWorld.y / 5.0 + 0.5) - 0.5) * 5.0);
  debugC *= 1.0 - 0.18 * debugLine - 0.25 * debugMajor;
  debugC *= mix(0.72, 1.0, debugUp);
  gl_FragColor = vec4(debugC, 1.0);`,
        );
      } else if (mode === 'overdraw')
        atEnd(program, 'gl_FragColor = vec4(1.0 / 255.0, 0.0, 0.0, 1.0);');
      else if (mode === 'wireframe') {
        program.vertexShader = program.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\ngl_Position.z -= 0.0008 * gl_Position.w;',
        );
        program.fragmentShader = 'uniform vec3 debugWire;\n' + program.fragmentShader;
        atEnd(program, 'gl_FragColor = vec4(debugWire, 1.0);');
      }
    };
    if (shader) {
      // Overdraw counts the custom shaders' fragments too.
      const material = copy as ShaderMaterial;
      material.fragmentShader = material.fragmentShader.replace(
        /\}\s*$/,
        'gl_FragColor = vec4(1.0 / 255.0, 0.0, 0.0, 1.0);\n}',
      );
    } else {
      copy.onBeforeCompile = (program, renderer) => {
        source.onBeforeCompile(program, renderer);
        patch(program);
      };
      copy.customProgramCacheKey = () => `debug-${mode}:${source.customProgramCacheKey()}`;
    }
    if (mode === 'wireframe' && 'wireframe' in copy) copy.wireframe = true;
    if (mode === 'overdraw') {
      copy.blending = AdditiveBlending;
      copy.transparent = true;
      copy.depthTest = false;
      copy.depthWrite = false;
    }
    if (mode === 'wireframe') {
      copy.transparent = false;
      copy.depthWrite = true;
    }
    source.addEventListener('dispose', this.forget);
    return copy;
  }

  private material(source: Material, mode: Mode) {
    let variants = this.variants.get(source);
    if (!variants) this.variants.set(source, (variants = new Map()));
    if (!variants.has(mode)) variants.set(mode, this.make(source, mode));
    const variant = variants.get(mode)!;
    // The scene changes its materials' colours (appearance, night); the copies follow.
    if (variant && variant !== source && builtIn(source)) {
      const from = source as Material & { color?: Color; map?: unknown };
      const to = variant as Material & { color?: Color; map?: unknown };
      // Unlit surfaces keep their colour before the light's ambient darkens it (`applyLight`).
      const base = mode === 'unlit' ? (source.userData.baseColor as Color | undefined) : undefined;
      if (from.color && to.color && mode !== 'wireframe') to.color.copy(base ?? from.color);
      if ('map' in from) to.map = from.map;
      if (mode !== 'overdraw') to.opacity = source.opacity;
      to.visible = source.visible;
    }
    return variant;
  }

  private readonly forget = ({ target }: { target: Material }) => {
    for (const variant of this.variants.get(target)?.values() ?? [])
      if (variant && variant !== target) variant.dispose();
    this.variants.delete(target);
    target.removeEventListener('dispose', this.forget);
  };

  /** Draws `scene` with every material swapped for its `mode` variant (those without one are
   *  left out), then puts the materials back. */
  draw(renderer: WebGLRenderer, scene: Scene, camera: Camera, mode: Mode) {
    this.uniforms.debugCameraWorld.value = camera.matrixWorld;
    const swapped: [Mesh | Line | Points, Material | Material[]][] = [];
    const hidden: Object3D[] = [];
    scene.traverseVisible((object) => {
      if (!(object instanceof Mesh || object instanceof Line || object instanceof Points)) return;
      const original = object.material as Material | Material[];
      const variant = Array.isArray(original)
        ? original.map((m) => this.material(m, mode) ?? m)
        : this.material(original, mode);
      if (variant === null) {
        object.visible = false;
        hidden.push(object);
        return;
      }
      swapped.push([object, original]);
      object.material = variant;
    });
    const target = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    try {
      if (mode === 'overdraw') {
        this.heat ??= this.makeHeat();
        renderer.getDrawingBufferSize(this.size);
        this.heat.target.setSize(this.size.x, this.size.y);
        renderer.setRenderTarget(this.heat.target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(target);
        renderer.setClearColor(this.clear, alpha);
        renderer.render(this.heat.scene, camera);
      } else renderer.render(scene, camera);
    } finally {
      for (const [object, material] of swapped) object.material = material;
      for (const object of hidden) object.visible = true;
      renderer.setRenderTarget(target);
      renderer.setClearColor(this.clear, alpha);
    }
  }

  /** Counts drawn into a render target, shown on the ramp: 1 at its foot, 16 or more at its top. */
  private makeHeat() {
    const target = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    const quad = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: { counts: { value: target.texture }, debugRamp: this.uniforms.debugRamp },
        vertexShader:
          'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `varying vec2 vUv;
uniform sampler2D counts;
${rampGlsl}
void main() {
  float n = floor(texture2D(counts, vUv).r * 255.0 + 0.5);
  if (n < 0.5) discard;
  gl_FragColor = vec4(debugRampAt((n - 1.0) / 15.0), 1.0);
}`,
        depthTest: false,
        depthWrite: false,
      }),
    );
    quad.frustumCulled = false;
    const scene = new Scene();
    scene.add(quad);
    return { target, scene, quad };
  }

  dispose() {
    for (const target of [...this.variants.keys()]) this.forget({ target });
    this.heat?.target.dispose();
    this.heat?.quad.geometry.dispose();
    this.heat?.quad.material.dispose();
    this.heat = undefined;
  }
}
