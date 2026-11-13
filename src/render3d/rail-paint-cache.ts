import {
  Color,
  CustomBlending,
  FloatType,
  Matrix4,
  Mesh,
  NearestFilter,
  OneFactor,
  PlaneGeometry,
  RGFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
  type BufferAttribute,
  type Box3,
  type BufferGeometry,
  type Camera,
  type MeshBasicMaterial,
  type WebGLRenderer,
} from 'three';

export function railViewMatches(a: Matrix4, b: Matrix4, bounds: Box3, size: Vector2) {
  if (a.equals(b)) return true;
  const p = new Vector4(),
    q = new Vector4();
  let minW = Infinity,
    deltaW = 0;
  const delta = [0, 0, 0],
    extent = [0, 0, 0];
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1 ? bounds.max.x : bounds.min.x;
    const y = corner & 2 ? bounds.max.y : bounds.min.y;
    const z = corner & 4 ? bounds.max.z : bounds.min.z;
    p.set(x, y, z, 1).applyMatrix4(a);
    q.set(x, y, z, 1).applyMatrix4(b);
    minW = Math.min(minW, p.w, q.w);
    deltaW = Math.max(deltaW, Math.abs(p.w - q.w));
    for (let axis = 0; axis < 3; axis++) {
      delta[axis] = Math.max(delta[axis]!, Math.abs(p.getComponent(axis) - q.getComponent(axis)));
      extent[axis] = Math.max(extent[axis]!, Math.abs(p.getComponent(axis)));
    }
  }
  if (minW <= 0) return false;
  // Clip coordinates and their differences are linear over the box. Their corner extrema
  // bound quotient error everywhere inside it, without accumulating frame-to-frame drift.
  const error = delta.map((value, axis) => value / minW + (extent[axis]! * deltaW) / (minW * minW));
  return (
    Math.max((error[0]! * size.x) / 2, (error[1]! * size.y) / 2) <= 0.01 &&
    error[2]! / 2 <= 1 / 2 ** 24
  );
}

/** Reuse dense, unlit rail paint after the camera settles. Mutable frames use the original
 * mesh; trains, furniture and the rest of the city always retain their own depth and drawing. */
export class RailPaintCache {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly scene = new Scene();
  private readonly copy: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly size = new Vector2();
  private readonly view = new Matrix4();
  private readonly nextView = new Matrix4();
  private readonly clear = new Color();
  private target: WebGLRenderTarget | undefined;
  private initialized = false;
  private cached = false;
  private colorVersion = -1;
  private width = 0;
  private height = 0;
  private samples: number | undefined;
  private readonly bounds: Box3;

  constructor(private readonly source: Mesh<BufferGeometry, MeshBasicMaterial>) {
    source.geometry.computeBoundingBox();
    this.bounds = source.geometry.boundingBox!;
    const material = source.material.clone();
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'layout(location = 1) out vec2 railDepth;\nvoid main() {')
        .replace(
          '#include <colorspace_fragment>',
          // Match the canvas's sRGB sample values before its MSAA resolve. The float attachment
          // retains covered depth and coverage separately, including at subpixel rail edges.
          'gl_FragColor = sRGBTransferOETF(gl_FragColor); railDepth = vec2(gl_FragCoord.z, 1.0);',
        );
    };
    this.copy = new Mesh(source.geometry, material);
    this.copy.matrixAutoUpdate = false;
    this.scene.add(this.copy);
    this.mesh = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: {
          colorMap: { value: null },
          depthMap: { value: null },
          resolution: { value: this.size },
        },
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `
          uniform sampler2D colorMap;
          uniform sampler2D depthMap;
          uniform vec2 resolution;
          void main() {
            vec2 uv = gl_FragCoord.xy / resolution;
            vec2 depth = texture2D(depthMap, uv).rg;
            if (depth.g == 0.0) discard;
            vec3 color = texture2D(colorMap, uv).rgb;
            gl_FragDepth = depth.r / depth.g;
            gl_FragColor = vec4(color / depth.g, depth.g);
          }`,
        alphaToCoverage: true,
        // A2C uses output alpha as a sample mask. Preserve destination alpha so the browser
        // never composites those unpremultiplied sample colours against the page background.
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: ZeroFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
    this.mesh.name = 'rail-paint-cache';
  }

  update(renderer: WebGLRenderer, camera: Camera, enabled: boolean): boolean {
    this.source.visible = true;
    this.mesh.visible = false;
    // Small meshes cost less to draw than a screen-sized cache. Float colour attachments are
    // needed for depth precision; browsers without them keep the ordinary mesh path.
    if (!enabled || this.source.geometry.getAttribute('position').count < 30_000) return false;
    if (this.samples === undefined) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      // Keep hardware and privacy-restricted contexts on their established mesh path.
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const backend = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
      const samples = gl.getParameter(gl.SAMPLES) as number;
      this.samples =
        /swiftshader/i.test(backend) &&
        renderer.extensions.has('EXT_color_buffer_float') &&
        samples <= 4 &&
        (samples === 0 ||
          [gl.RGBA8, gl.RG32F, gl.DEPTH_COMPONENT24].every((format) =>
            (
              gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES) as Int32Array
            )?.includes(samples),
          ))
          ? samples
          : -1;
    }
    if (this.samples < 0) return false;
    renderer.getDrawingBufferSize(this.size);
    // At most the tested 1440 × 960 physical pixels, with up to four MSAA samples
    // (about 106 MiB including both colour/depth attachments and their resolved buffers).
    if (this.size.x * this.size.y > 1440 * 960) return false;
    this.source.updateWorldMatrix(true, false);
    this.nextView
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(this.source.matrixWorld);
    const version = (this.source.geometry.getAttribute('color') as BufferAttribute).version;
    // TASK-163: the scene shades the unlit paint after dark; the cached copy follows.
    if (!this.copy.material.color.equals(this.source.material.color)) {
      this.copy.material.color.copy(this.source.material.color);
      this.initialized = false;
    }
    if (
      !this.initialized ||
      !railViewMatches(this.view, this.nextView, this.bounds, this.size) ||
      this.colorVersion !== version ||
      this.width !== this.size.x ||
      this.height !== this.size.y
    ) {
      this.initialized = true;
      this.cached = false;
      this.view.copy(this.nextView);
      this.colorVersion = version;
      this.width = this.size.x;
      this.height = this.size.y;
      return false;
    }
    if (!this.cached) {
      if (!this.target) {
        this.target = new WebGLRenderTarget(this.width, this.height, {
          count: 2,
          samples: this.samples,
          minFilter: NearestFilter,
          magFilter: NearestFilter,
        });
        this.target.textures[1]!.format = RGFormat;
        this.target.textures[1]!.type = FloatType;
        this.mesh.material.uniforms.colorMap!.value = this.target.textures[0];
        this.mesh.material.uniforms.depthMap!.value = this.target.textures[1];
      }
      this.target.setSize(this.width, this.height);
      this.copy.matrix.copy(this.source.matrixWorld);
      const target = renderer.getRenderTarget();
      renderer.getClearColor(this.clear);
      const alpha = renderer.getClearAlpha();
      try {
        renderer.setClearColor(0, 0);
        renderer.setRenderTarget(this.target);
        renderer.render(this.scene, camera);
      } finally {
        renderer.setRenderTarget(target);
        renderer.setClearColor(this.clear, alpha);
      }
      this.view.copy(this.nextView);
      this.cached = true;
    }
    this.source.visible = false;
    this.mesh.visible = true;
    return true;
  }

  reset() {
    this.target?.dispose();
    this.target = undefined;
    this.samples = undefined;
    this.initialized = false;
    this.cached = false;
    this.mesh.visible = false;
    this.source.visible = true;
    this.mesh.material.uniforms.colorMap!.value = null;
    this.mesh.material.uniforms.depthMap!.value = null;
  }

  /** The scene owns the visible proxy's geometry/material and the original rail mesh. */
  dispose() {
    this.reset();
    this.copy.material.dispose();
  }
}
