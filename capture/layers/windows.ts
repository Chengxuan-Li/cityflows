import type { Material, Mesh, Scene } from 'three';

// Capture layer: building windows stay drawn while they are a few pixels across (the app fades
// them by distance), and fade to their average below that, without shimmer.

export const params = {};

// Each axis of the window grid fades to its own average only once its cells shrink under about
// two pixels: far towers keep their floor bands after their columns merge, instead of the whole
// grid dimming into the wall as the app's distance fade does.
const rowsPerPixel = 'fwidth(vWindowInfo.y / vWindowInfo.z)',
  columnsPerPixel = 'fwidth(vWindowInfo.x / 2.8)';
function sharpenWindows(material: Material) {
  const original = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        /float band = smoothstep\(0\.28, 0\.33, level\)[^;]*;\s*band \*= smoothstep\(0\.16, 0\.21, along\)[^;]*;\s*band \*= 1\.0 - smoothstep\([^;]*length\(vViewPosition\)\);/,
        `float rows = smoothstep(0.28, 0.33, level) * (1.0 - smoothstep(0.72, 0.77, level));
          float cols = smoothstep(0.16, 0.21, along) * (1.0 - smoothstep(0.74, 0.79, along));
          rows = mix(rows, 0.45, smoothstep(0.32, 0.62, ${rowsPerPixel}));
          cols = mix(cols, 0.58, smoothstep(0.32, 0.62, ${columnsPerPixel}));
          float band = rows * cols;`,
      )
      .replace(
        /float far = smoothstep\([^;]*length\(vViewPosition\)\);/,
        `float far = smoothstep(0.32, 0.62, max(${rowsPerPixel}, ${columnsPerPixel}));`,
      )
      .replace(/band \* 0\.32\)/, 'band * 0.55)');
    if (!shader.fragmentShader.includes('float rows'))
      throw new Error('Intro detail: the window shader no longer matches');
  };
  material.needsUpdate = true;
  return original;
}

/** Sharpens every lit building material in the scene; returns the undo. */
export function detailWindows(scene: Scene) {
  const windows: [Material, Material['onBeforeCompile']][] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    const material = mesh.material as Material | undefined;
    if (!mesh.isMesh || !material || Array.isArray(material) || !material.userData.lights) return;
    if (windows.some(([m]) => m === material)) return;
    windows.push([material, sharpenWindows(material)]);
  });
  return () => {
    for (const [material, original] of windows) {
      material.onBeforeCompile = original;
      material.needsUpdate = true;
    }
  };
}
