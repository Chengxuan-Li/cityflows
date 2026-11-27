import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Vector4,
} from 'three';
import type { Vec2 } from '../../src/geo/vec2';
import { airsideAreas } from '../../src/render/airside-geometry';
import type { Airport, Runway } from '../../src/schema/airport';

/** Airfield layer: apron slabs, runway grooves and rubber, shoulders and rough greens, around
 * the project's first runway. */
export const params = {};

type Point = readonly [number, number];
type ShoreEdge = { a: Vec2; b: Vec2 };

export function apronDressing(airport: Airport, runway: Runway, shore: readonly ShoreEdge[]) {
  const end = runway.ends[0],
    c = Math.cos(end.heading),
    s = Math.sin(end.heading);
  const local = (p: Vec2): Point => {
    const x = p.x - end.pos.x,
      y = p.y - end.pos.y;
    return [c * x + s * y, c * y - s * x];
  };
  const bounds = new Vector4(-350, -105, 2025, 350);
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 384;
  const draw = canvas.getContext('2d', { willReadFrequently: true })!;
  function worldScale(ctx: CanvasRenderingContext2D) {
    const x = ctx.canvas.width / bounds.z,
      y = ctx.canvas.height / bounds.w;
    ctx.setTransform(x, 0, 0, y, -bounds.x * x, -bounds.y * y);
  }
  worldScale(draw);
  const path = (ctx: CanvasRenderingContext2D, points: readonly Point[], close: boolean) => {
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
  };
  const fill = (ctx: CanvasRenderingContext2D, rings: readonly (readonly Point[])[]) => {
    ctx.beginPath();
    for (const ring of rings) path(ctx, ring, true);
    ctx.fill('evenodd');
  };
  const stroke = (
    ctx: CanvasRenderingContext2D,
    pts: readonly Point[],
    width: number,
    colour: string,
  ) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    path(ctx, pts, false);
    ctx.stroke();
  };
  const clip = (rings: readonly Point[][]) => {
    if (!rings.length) return;
    draw.globalCompositeOperation = 'destination-in';
    fill(draw, rings);
    draw.globalCompositeOperation = 'source-over';
  };
  const boundary = (airport.boundary ?? []).map((ring) => ring.map(local));
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  const capture = (channel: number) => {
    const image = draw.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) pixels[i + channel] = image[i + 3]!;
    draw.save();
    draw.resetTransform();
    draw.clearRect(0, 0, canvas.width, canvas.height);
    draw.restore();
  };
  // Complete the unmapped east service apron from the parallel taxiway to the
  // airport boundary. Water is cut from the receiving meshes by the intro shore pass.
  fill(draw, [
    [
      [418, 104],
      [468, 94.8],
      [1476, 94.8],
      [1534, 85.5],
      [1534, 206],
      [556, 206],
      [554, 165],
      [452, 165],
    ],
  ]);
  clip(boundary);
  capture(0);

  const waterfront = shore
    .map(({ a, b }) => [local(a), local(b)] as const)
    .filter(
      ([a, b]) =>
        Math.max(a[0], b[0]) > 502 &&
        Math.min(a[0], b[0]) < 1540 &&
        Math.min(a[1], b[1]) >= 70 &&
        Math.max(a[1], b[1]) <= 218,
    );
  draw.lineCap = 'round';
  draw.lineJoin = 'round';
  draw.beginPath();
  for (const points of waterfront) path(draw, points, false);
  draw.lineWidth = 12.4;
  draw.strokeStyle = 'rgba(0,0,0,0.48)';
  draw.stroke();
  draw.lineWidth = 1.54;
  draw.strokeStyle = 'black';
  draw.stroke();
  capture(1);

  for (const { kind, rings } of airsideAreas(airport)) {
    if (kind !== 'taxiway') continue;
    const paths = rings.map((ring) => ring.map(local));
    draw.beginPath();
    for (const ring of paths) path(draw, ring, true);
    draw.save();
    draw.clip('evenodd');
    draw.strokeStyle = 'black';
    draw.lineWidth = 5.4;
    draw.stroke();
    draw.restore();
  }
  capture(2);

  fill(draw, [
    [
      [-100, -71],
      [1555, -71],
      [1614, 0],
      [1526, 93],
      [-100, 93],
    ],
  ]);
  clip(boundary);
  capture(3);

  const coverage = new DataTexture(pixels, canvas.width, canvas.height);
  coverage.generateMipmaps = true;
  coverage.minFilter = LinearMipmapLinearFilter;
  coverage.magFilter = LinearFilter;
  coverage.anisotropy = 8;
  coverage.needsUpdate = true;

  // A separate mipmapped paint pass retains the app's existing guides and runway
  // paint. These short marks occupy the apron only and leave its main areas open.
  const ink = document.createElement('canvas');
  ink.width = 4096;
  ink.height = 768;
  const paint = ink.getContext('2d')!;
  worldScale(paint);
  paint.lineCap = 'butt';
  for (const stand of Object.values(airport.stands)) {
    const [x, y] = local(stand.pos);
    const angle = stand.heading - end.heading,
      dx = Math.cos(angle),
      dy = Math.sin(angle);
    const at = (along: number, across: number): Point => [
      x + dx * along - dy * across,
      y + dy * along + dx * across,
    ];
    for (const side of [-1, 1]) {
      const across = 6.3 * side;
      const q = at(1.6, across);
      paint.fillStyle = 'rgba(89,82,76,0.53)';
      paint.fillRect(q[0] - 0.35, q[1] - 0.35, 0.7, 0.7);
      stroke(
        paint,
        [at(1.6, across - 0.54), at(1.6, across + 0.54)],
        0.17,
        'rgba(240,236,222,0.78)',
      );
    }
    stroke(paint, [at(4.7, -2.55), at(4.7, -0.85)], 0.29, 'rgba(155,58,47,0.75)');
    stroke(paint, [at(4.7, -2.55), at(4.7, -2.02)], 0.3, 'rgba(224,218,202,0.88)');
  }
  for (const [u, v] of [
    [828, 146],
    [925, 168],
    [978, 181],
    [1110, 113],
    [1390, 113],
  ] as const) {
    const edge = 'rgba(190,157,69,0.83)';
    stroke(
      paint,
      [
        [u, v + 2.9],
        [u, v],
        [u + 12.4, v],
        [u + 12.4, v + 2.9],
      ],
      0.31,
      edge,
    );
    for (let j = 0.65; j < 10.2; j += 1.53)
      stroke(
        paint,
        [
          [u + j, v],
          [u + j + 1.9, v + 2.9],
        ],
        0.26,
        edge,
      );
    stroke(
      paint,
      [
        [u - 2.7, v - 0.35],
        [u - 0.8, v - 0.35],
      ],
      0.3,
      'rgba(151,59,46,0.78)',
    );
    stroke(
      paint,
      [
        [u - 2.05, v - 0.35],
        [u - 1.45, v - 0.35],
      ],
      0.31,
      'rgba(236,228,205,0.80)',
    );
  }
  const markings = new CanvasTexture(ink);
  markings.flipY = false;
  markings.colorSpace = SRGBColorSpace;
  markings.anisotropy = 8;
  return {
    bounds,
    coverage,
    markings,
    dispose: () => {
      coverage.dispose();
      markings.dispose();
    },
  };
}

export const airfieldFinish = /* glsl */ `
uniform vec2 runwayOrigin;
uniform vec2 runwayDirection;
uniform vec2 runwayThreshold;
uniform float runwayLength;
uniform vec4 introAirfieldBounds;
uniform sampler2D introAirfieldCoverage;
uniform sampler2D introApronPaint;

vec2 runwayAxes(vec2 world) {
  vec2 p=world-runwayOrigin;
  return vec2(dot(p,runwayDirection),dot(p,vec2(-runwayDirection.y,runwayDirection.x)));
}
vec2 airfieldUV(vec2 p) { return (p-introAirfieldBounds.xy)/introAirfieldBounds.zw; }
vec4 airfieldCoverage(vec2 p) {
  vec2 uv=airfieldUV(p);
  if (runwayLength<1.0 || min(uv.x,uv.y)<0.0 || max(uv.x,uv.y)>1.0) return vec4(0.0);
  return texture2D(introAirfieldCoverage,uv);
}
// The airfield's greens as the cut's rough ground (surfaces.ts disturbedGround on the app's
// land-use tone): pale soil and grit with darker damp patches, grass breaking through in noisy
// patches (surfaces.ts turf on the app's green), mown in faint stripes where it grows.
GroundFinish airfieldGrass(GroundDomain g,vec2 p) {
  GroundFinish soil=disturbedGround(g);
  GroundFinish grass=turf(g);
  soil.colour*=vec3(0.855,0.846,0.815);
  grass.colour*=vec3(0.624,0.799,0.558);
  vec2 rowAxis=vec2(0.09,1.0)/9.6;
  float stripe=dot(p,rowAxis);
  float rowPixel=abs(dot(g.pixel[0],rowAxis))+abs(dot(g.pixel[1],rowAxis));
  grass.colour*=1.0+0.072*cos(stripe*3.14159)*(1.0-smoothstep(0.24,0.57,rowPixel));

  vec3 patches=vec3(0.5,0,0)+0.62*groundGrain(g,0.045,groundTurnA,7.3)
    +0.34*groundGrain(g,0.19,groundTurnB,-2.1)+0.18*groundGrain(g,0.83,groundTurnC,5.6);
  return groundBlend(soil,grass,0.9*groundMask(patches,0.46,0.66,g.pixel));
}
vec3 apronConcrete(vec2 p,float shore) {
  vec2 dim=vec2(6.4,5.6);
  vec2 tile=(p+vec2(0.4,-1.8))/dim, aa=fwidth(tile);
  float resolved=1.0-smoothstep(0.16,0.52,max(aa.x,aa.y));
  vec2 id=floor(tile), within=fract(tile);
  float seed=hashCell(id+45.32);
  float replaced=smoothstep(0.90,0.98,seed)*resolved;
  float joint=max(seam(tile.x,0.072/dim.x,aa.x),seam(tile.y,0.072/dim.y,aa.y));
  float dirt=weathering(p*vec2(0.065,0.111));
  vec2 stainAt=vec2(hashCell(id+27.1),hashCell(id-17.8))*0.69+0.155;
  float leak=(1.0-smoothstep(0.02,0.19+0.12*seed,length((within-stainAt)*vec2(1.0,1.6))))
    *smoothstep(0.70,0.86,hashCell(id+71.6))*resolved;
  float repair=(1.0-smoothstep(0.12,0.21,max(abs(within.x-stainAt.x),abs(within.y-stainAt.y))))
    *smoothstep(0.93,0.98,hashCell(id+14.62))*resolved;
  float drift=0.5*grit(vec2(p.x*0.024,p.y*0.13));
  float l1=abs(abs(p.y-102.7+drift)-1.55);
  float l2=abs(abs(p.y-114.9+drift)-0.93);
  float l3=abs(abs(p.y-144.7+drift)-1.14);
  float tyre=(1.0-smoothstep(0.12,0.73,min(l1,l2)))*smoothstep(474.0,685.0,p.x)
    + (1.0-smoothstep(0.11,0.69,l3))*smoothstep(530.0,660.0,p.x)*(1.0-smoothstep(936.0,992.0,p.x));
  float rubber=tyre*(0.042+0.064*smoothstep(-0.15,0.2,grit(vec2(p.x*0.103,p.y*0.25))));
  vec3 base=vec3(0.637,0.628,0.598)*(1.0+(seed-0.5)*0.10*resolved+0.074*replaced
    -0.42*joint+0.16*dirt-0.19*leak+0.085*repair-rubber+0.12*grit(p*11.0));
  if(shore>0.01) {
    float age=smoothstep(0.015,0.42,shore);
    float rust=smoothstep(0.015,0.34,weathering(p*vec2(0.21,0.39)+28.1));
    vec3 old=mix(vec3(0.427,0.421,0.392),vec3(0.347,0.255,0.186),rust);
    old*=1.0+0.24*dirt-0.36*leak-0.33*joint;
    float coping=smoothstep(0.56,0.93,shore);
    vec3 stone=vec3(0.677,0.655,0.601)*(1.0+0.10*grit(p*2.9)-0.50*seam(p.x/2.9,0.026,fwidth(p.x/2.9)));
    base=mix(base,mix(old,stone,coping),age);
  }
  vec4 paint=texture2D(introApronPaint,airfieldUV(p));
  return mix(base,paint.rgb,paint.a*(0.87+0.17*grit(p*2.9)));
}
vec3 apronLand(vec2 p,vec3 original,inout vec2 slope) {
  mat2 pixel=mat2(dFdx(p),dFdy(p));
  vec4 cover=airfieldCoverage(p);
  if(cover.a>0.007) {
    GroundFinish land=airfieldGrass(groundDomain(p,pixel),p);
    vec2 side=vec2(-runwayDirection.y,runwayDirection.x);
    slope=mix(slope,mat2(runwayDirection,side)*land.relief.yz,cover.a);
    original=mix(original,land.colour,cover.a);
  }
  if(cover.r>0.007) {
    slope*=1.0-cover.r;
    original=mix(original,apronConcrete(p,cover.g),cover.r);
  }
  return original;
}
`;
