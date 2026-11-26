import type { WebGLRenderer } from 'pixi.js';

/** Count the actual submissions (including Pixi's batch and instanced paths) for one displayed frame. */
export function samplePixiFrame(renderer: WebGLRenderer, render: () => void, frameMs: number) {
  const gl = renderer.gl;
  let calls = 0,
    triangles = 0;
  const count = (mode: number, vertices: number, instances = 1) => {
    calls++;
    const perInstance =
      mode === gl.TRIANGLES
        ? Math.floor(vertices / 3)
        : mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN
          ? Math.max(0, vertices - 2)
          : 0;
    triangles += instances * perInstance;
  };
  const { drawArrays, drawElements, drawArraysInstanced, drawElementsInstanced } = gl;
  gl.drawArrays = (mode, first, n) => {
    count(mode, n);
    drawArrays.call(gl, mode, first, n);
  };
  gl.drawElements = (mode, n, type, offset) => {
    count(mode, n);
    drawElements.call(gl, mode, n, type, offset);
  };
  gl.drawArraysInstanced = (mode, first, n, i) => {
    count(mode, n, i);
    drawArraysInstanced.call(gl, mode, first, n, i);
  };
  gl.drawElementsInstanced = (mode, n, type, offset, i) => {
    count(mode, n, i);
    drawElementsInstanced.call(gl, mode, n, type, offset, i);
  };
  try {
    render();
  } finally {
    Object.assign(gl, { drawArrays, drawElements, drawArraysInstanced, drawElementsInstanced });
  }
  return {
    frameMs,
    fps: 1000 / frameMs,
    calls,
    triangles,
    geometries: Object.keys(renderer.geometry._managedGeometries.items).length,
    textures: renderer.texture.managedTextures.length,
  };
}
