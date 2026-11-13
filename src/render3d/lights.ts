import {
  AdditiveBlending,
  Color,
  DataTexture,
  InstancedMesh,
  LinearFilter,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
} from 'three';

/** TASK-163: artificial light as cheap additive decals and sprites, never real lights. */
export interface LightPoint {
  x: number;
  /** Height of the lit surface (pools) or of the lamp (halos), metres up. */
  z: number;
  y: number;
  radiusM: number;
  color: number;
}

/** A soft radial falloff in the alpha channel: 1 at the centre, 0 at the rim. */
function radialTexture(size = 64) {
  const pixels = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const d = Math.hypot((i + 0.5) / size - 0.5, (j + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, 1 - d) ** 2 * (3 - 2 * Math.max(0, 1 - d));
      pixels.set([255, 255, 255, Math.round(255 * a)], (j * size + i) * 4);
    }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Warm pools on the ground under street lamps and along platforms: one instanced, additive
 * quad each. The material colour scales them all with the scene's artificial light. */
export function buildPools(points: readonly LightPoint[]) {
  const material = new MeshBasicMaterial({
    map: radialTexture(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  material.userData.lit = true;
  const mesh = new InstancedMesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    material,
    Math.max(1, points.length),
  );
  const transform = new Object3D(),
    color = new Color();
  points.forEach((p, i) => {
    transform.position.set(p.x, p.z, p.y);
    transform.scale.set(2 * p.radiusM, 1, 2 * p.radiusM);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, color.setHex(p.color));
  });
  mesh.count = points.length;
  mesh.renderOrder = 5;
  mesh.visible = false;
  mesh.computeBoundingSphere();
  mesh.name = 'light-pools';
  return mesh;
}

/** Camera-facing glows at lamp heads and signal lights, sized in metres. */
export function buildHalos(points: readonly LightPoint[]) {
  const material = new ShaderMaterial({
    uniforms: { intensity: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        vUv = uv;
        vTint = instanceColor;
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        centre.xy += position.xy * length(instanceMatrix[0].xyz);
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: `
      uniform float intensity;
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float glow = pow(max(0.0, 1.0 - d), 2.5) + 0.6 * pow(max(0.0, 1.0 - d * 2.5), 2.0);
        gl_FragColor = vec4(vTint * glow * intensity, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  material.userData.lit = true;
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, Math.max(1, points.length));
  const transform = new Object3D(),
    color = new Color();
  points.forEach((p, i) => {
    transform.position.set(p.x, p.z, p.y);
    transform.scale.setScalar(2 * p.radiusM);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, color.setHex(p.color));
  });
  mesh.count = points.length;
  mesh.renderOrder = 6;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.name = 'light-halos';
  return mesh;
}

/** The headlight beam: a soft cone on the road ahead, bright at the bumper and fading out. */
export function beamTexture(width = 64, height = 32) {
  const pixels = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const u = (i + 0.5) / width,
        v = ((j + 0.5) / height - 0.5) * 2;
      // The cone widens ahead: half width 0.45 at the bumper, 1 at the far end.
      const spread = Math.abs(v) / (0.45 + 0.55 * u);
      const across = Math.max(0, 1 - spread * spread);
      const along = Math.min(1, u * 12) * (1 - u) ** 1.6;
      pixels.set([255, 255, 255, Math.round(255 * across * along)], (j * width + i) * 4);
    }
  const texture = new DataTexture(pixels, width, height, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
