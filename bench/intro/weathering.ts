import type { Material, WebGLProgramParametersWithUniforms } from 'three';

/** Preserve both the shader and its original cache key, including the facade's day/night defines. */
export function patchMaterial(
  material: Material,
  name: string,
  apply: (shader: WebGLProgramParametersWithUniforms) => void,
) {
  const original = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const keyed = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey');
  const ownKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer);
    apply(shader);
  };
  material.customProgramCacheKey = () => `${key}|intro-${name}`;
  material.needsUpdate = true;
  return () => {
    material.onBeforeCompile = original;
    if (keyed) material.customProgramCacheKey = ownKey;
    else delete (material as { customProgramCacheKey?: unknown }).customProgramCacheKey;
    material.needsUpdate = true;
  };
}

// World- or chain-space noise. Fade each octave according to its own footprint; small
// aggregate and weathering converge separately as the camera pulls away.
export const grain = /* glsl */ `
float hashCell(vec2 p) {
  vec3 h = fract(p.xyx * vec3(0.1031, 0.11369, 0.13787));
  h += dot(h, h.yzx + 19.19);
  return fract((h.x + h.y)*h.z);
}
float field(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f *= f*(3.0-2.0*f);
  return mix(mix(hashCell(cell),hashCell(cell+vec2(1,0)),f.x),mix(hashCell(cell+vec2(0,1)),hashCell(cell+1.0),f.x),f.y);
}
float filterNoise(vec2 p,float footprint) {
  if (footprint >= 0.53) return 0.0;
  return (field(p)-0.5)*(1.0-smoothstep(0.18,0.53,footprint));
}
float grit(vec2 p) {
  return filterNoise(p,max(fwidth(p.x),fwidth(p.y)));
}
// Filter in final-frame pixels (two internal samples per dimension).
float seam(float p,float width,float footprint) {
  float d = abs(fract(p+0.5)-0.5);
  float aa = max(0.002,footprint);
  return (1.0-smoothstep(max(0.0,width-aa),width+aa,d))*min(1.0,width/aa)*(1.0-smoothstep(0.18,0.48,aa));
}

float weathering(vec2 p) {
  float px=max(fwidth(p.x),fwidth(p.y));
  if (px >= 0.53) return 0.0;
  vec2 warped=p+vec2(filterNoise(p*0.61+8.14,px*0.61),filterNoise(p*0.73-6.83,px*0.73))*1.75;
  return 0.78*filterNoise(warped,px)+0.36*filterNoise(warped*2.27+11.4,px*2.27)
    +0.17*filterNoise(warped*4.91-4.2,px*4.91);
}
`;
