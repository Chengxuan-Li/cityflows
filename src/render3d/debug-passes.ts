import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Line,
  Material,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  NoBlending,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';
import type { DebugShading } from '../render/debug-settings';

type Mode = Exclude<DebugShading, 'normal'> | 'wireframe';

const ordinaryVertex = `
void main() {
  vec4 p = vec4(position, 1.);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;

const fragment: Record<'wireframe' | 'overdraw' | 'normals' | 'heights', string> = {
  wireframe: 'gl_FragColor = vec4(0.13, 0.55, 0.78, 1.);',
  overdraw: 'gl_FragColor = vec4(vec3(1./255.), 1.);',
  normals: `vec3 n = normalize(cross(dFdx(debugWorld), dFdy(debugWorld)));
    gl_FragColor = vec4(.5 + .5 * (gl_FrontFacing ? n : -n), 1.);`,
  heights: `float relative = debugWorld.y - datum;
    vec3 c = mix(vec3(.12,.31,.62), vec3(.25,.72,.55), smoothstep(-12.,2.,relative));
    c = mix(c, vec3(.96,.75,.25), smoothstep(2.,30.,relative));
    c = mix(c, vec3(.84,.32,.20), smoothstep(30.,80.,relative));
    gl_FragColor = vec4(c,1.);`,
};

/** Shader-driven labels and billboards keep their own vertex placement in geometry passes. */
function geometryMaterial(source: Material, mode: keyof typeof fragment, datum: { value: number }) {
  let vertex = source instanceof ShaderMaterial ? source.vertexShader : ordinaryVertex;
  const world = mode === 'normals' || mode === 'heights';
  if (world)
    vertex =
      'varying vec3 debugWorld;\n' +
      vertex.replace(
        /}\s*$/,
        `
      vec4 w = inverse(viewMatrix) * inverse(projectionMatrix) * gl_Position;
      debugWorld = w.xyz / w.w;
    }`,
      );
  const count = mode === 'overdraw';
  const wire = mode === 'wireframe';
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: `${world ? 'varying vec3 debugWorld; uniform float datum;' : ''}
      void main() { ${fragment[mode]} }`,
    uniforms: { ...(source instanceof ShaderMaterial ? source.uniforms : {}), datum },
    defines: source instanceof ShaderMaterial ? source.defines : {},
    wireframe: wire,
    side: wire || world ? DoubleSide : source.side,
    depthTest: !count,
    depthWrite: !wire && !count,
    transparent: count,
    blending: count ? AdditiveBlending : NoBlending,
    forceSinglePass: true,
    polygonOffset: wire,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

export class DebugPasses {
  readonly datum = { value: 0 };
  private variants = new Map<Material, Map<Mode, Material>>();
  private readonly clear = new Color();
  private readonly size = new Vector2();
  private heat?: {
    target: WebGLRenderTarget;
    scene: Scene;
    quad: Mesh<PlaneGeometry, ShaderMaterial>;
  };

  private material(source: Material, mode: Mode) {
    if (!source.visible || !source.colorWrite) return source;
    if (mode === 'unlit' && source instanceof ShaderMaterial) return source;
    let variants = this.variants.get(source);
    if (!variants) {
      this.variants.set(source, (variants = new Map()));
      source.addEventListener('dispose', this.onDispose);
    }
    let copy = variants.get(mode);
    if (!copy) {
      if (mode === 'light') {
        copy = new MeshLambertMaterial({
          color: 0xffffff,
          side: source.side,
          transparent: source.transparent,
          opacity: source.opacity,
          depthTest: source.depthTest,
          depthWrite: source.depthWrite,
          polygonOffset: source.polygonOffset,
          polygonOffsetFactor: source.polygonOffsetFactor,
          polygonOffsetUnits: source.polygonOffsetUnits,
        });
        copy.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '');
        };
      } else if (mode === 'unlit') {
        // Keep procedural surface paint and textures, bypassing the lighting calculation.
        copy = source.clone();
        copy.onBeforeCompile = (shader, renderer) => {
          source.onBeforeCompile(shader, renderer);
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            'outgoingLight = diffuseColor.rgb;\n#include <opaque_fragment>',
          );
        };
        copy.customProgramCacheKey = () => 'debug-unlit:' + source.customProgramCacheKey();
      } else copy = geometryMaterial(source, mode, this.datum);
      variants.set(mode, copy);
    }
    if (
      mode === 'unlit' &&
      'color' in source &&
      source.color instanceof Color &&
      'color' in copy &&
      copy.color instanceof Color
    ) {
      copy.color.copy((source.userData.baseColor as Color | undefined) ?? source.color);
    }
    return copy;
  }

  private readonly onDispose = ({ target }: { target: Material }) => {
    for (const material of this.variants.get(target)!.values()) material.dispose();
    this.variants.delete(target);
    target.removeEventListener('dispose', this.onDispose);
  };

  draw(renderer: WebGLRenderer, scene: Scene, camera: Camera, mode: Mode) {
    const changed: [Mesh | Line, Material | Material[]][] = [];
    const shadows = renderer.shadowMap.enabled;
    const target = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    try {
      if (mode !== 'light') renderer.shadowMap.enabled = false;
      scene.traverseVisible((object) => {
        if (!(object instanceof Mesh || object instanceof Line)) return;
        changed.push([object, object.material]);
        object.material = Array.isArray(object.material)
          ? object.material.map((m) => this.material(m, mode))
          : this.material(object.material, mode);
      });
      if (mode === 'overdraw') {
        this.heat ??= this.makeHeat();
        renderer.getDrawingBufferSize(this.size);
        this.heat.target.setSize(this.size.x, this.size.y);
        renderer.setRenderTarget(this.heat.target);
        renderer.setClearColor(0, 0);
        renderer.clear();
      }
      renderer.render(scene, camera);
      if (mode === 'overdraw') {
        renderer.setRenderTarget(target);
        renderer.setClearColor(this.clear, alpha);
        renderer.render(this.heat!.scene, camera);
      }
    } finally {
      for (const [object, material] of changed) object.material = material;
      renderer.shadowMap.enabled = shadows;
      renderer.setRenderTarget(target);
      renderer.setClearColor(this.clear, alpha);
    }
  }

  private makeHeat() {
    const target = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    const quad = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: { counts: { value: target.texture } },
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader: `varying vec2 vUv; uniform sampler2D counts; void main() {
        float n=floor(texture2D(counts,vUv).r*255.+.5);
        if(n<.5) discard;
        vec3 c=mix(vec3(.12,.29,.65),vec3(.2,.78,.59),clamp((n-1.)/3.,0.,1.));
        c=mix(c,vec3(1.,.81,.16),clamp((n-4.)/4.,0.,1.));
        c=mix(c,vec3(.91,.16,.12),clamp((n-8.)/8.,0.,1.));
        c=mix(c,vec3(1.),clamp((n-16.)/16.,0.,1.));
        gl_FragColor=vec4(c,1.);
      }`,
        depthTest: false,
        depthWrite: false,
      }),
    );
    quad.frustumCulled = false;
    const scene = new Scene();
    scene.add(quad);
    return { target, quad, scene };
  }

  dispose() {
    for (const target of this.variants.keys()) this.onDispose({ target });
    this.heat?.target.dispose();
    this.heat?.quad.geometry.dispose();
    this.heat?.quad.material.dispose();
    this.heat = undefined;
  }
}
