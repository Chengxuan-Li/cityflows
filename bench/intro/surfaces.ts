import {
  CanvasTexture,
  Float32BufferAttribute,
  Vector2,
  Vector3,
  Vector4,
  Matrix4,
  type InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  type BufferGeometry,
  type Group,
  type Mesh,
  MeshLambertMaterial,
} from 'three';
import { hexToLinear, type SceneLight } from '../../src/render/lighting';
import type { Runway } from '../../src/schema/airport';
import type { railElevation } from '../../src/render3d/rail';

import { airfieldFinish, type apronDressing } from './airfield';
import { grain, patchMaterial } from './weathering';
import { groundDetail } from './ground-detail';

export const towerHeightM = 38;

export interface IntroSurfaces {
  content: Group;
  vegetation?: { natural: Group; street: Group };
  light: SceneLight;
  geometry?: {
    surfaces: BufferGeometry;
    airside?: BufferGeometry;
    heights: Parameters<typeof railElevation>[0];
    context: { buildings: BufferGeometry; detailedBuildings: BufferGeometry };
  };
  buildings?: Mesh;
  surroundings?: Mesh;
  ground?: Mesh;
  lotSurface?: Mesh;
  walk?: { footways: Mesh; sidewalks: Mesh };
}

// Sky occlusion close to a trunk is too broad for the screen-space contact pass. Stamp it
// once using the actual crown radii. The GPU samples this metre-per-texel map only on land.
function canopyShade(vegetation: IntroSurfaces['vegetation']) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 1024, 1024);
  const stamp = document.createElement('canvas');
  stamp.width = stamp.height = 64;
  const brush = stamp.getContext('2d')!;
  const shadow = brush.createRadialGradient(32, 32, 0, 32, 32, 32);
  shadow.addColorStop(0, 'rgba(0,0,0,0.43)');
  shadow.addColorStop(0.44, 'rgba(0,0,0,0.22)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  brush.fillStyle = shadow;
  brush.fillRect(0, 0, 64, 64);
  const matrix = new Matrix4();
  for (const group of vegetation ? [vegetation.natural, vegetation.street] : []) {
    for (const tree of group.children[0]!.children as InstancedMesh[]) {
      for (let i = 0; i < tree.count; i++) {
        tree.getMatrixAt(i, matrix);
        const m = matrix.elements;
        const x = m[12] - 539 + 512,
          y = 512 - (m[14] - 247);
        const radius = Math.max(1.5, 1.3 * Math.hypot(m[0], m[2]));
        if (Math.min(x, y, 1024 - x, 1024 - y) < radius) continue;
        ctx.drawImage(stamp, x - radius, y - radius, 2 * radius, 2 * radius);
      }
    }
  }
  return new CanvasTexture(canvas);
}

const common =
  grain +
  /* glsl */ `
varying vec3 vIntroPos;
vec3 slabs(vec2 metres, vec2 dims, float stagger) {
  vec2 q = metres/dims;
  vec2 aa = fwidth(q);
  float course = floor(q.y);
  q.x += stagger*mod(course,2.0)+0.025*hashCell(vec2(course,17.0));
  float resolved = 1.0-smoothstep(0.13,0.48,max(aa.x,aa.y));
  vec2 cell = floor(q);
  float seed = hashCell(cell+19.3);
  float butt = seam(q.x,0.012/dims.x,aa.x)*mix(0.48,1.15,seed)*resolved;
  float gap = max(butt,seam(q.y,0.012/dims.y,aa.y));
  float replacement = smoothstep(0.944,0.991,seed)*resolved;
  float damp = smoothstep(0.05,0.45,weathering(metres*0.29));
  float tone = (seed-0.5)*resolved*(0.085+0.20*damp);
  return mix(vec3(0.99,1.0,1.02),vec3(1.1,1.06,0.98),replacement)
    *(0.99 + tone - 0.40*gap - 0.24*damp + 0.12*grit(metres*11.0));
}
`;

export function yardPaving(
  finish: 'asphalt' | 'concrete' | 'planting',
  paint: CanvasTexture,
  bounds: readonly [number, number, number, number],
) {
  const material = new MeshLambertMaterial({
    color: { asphalt: 0x858589, concrete: 0xbcb8ac, planting: 0xb3bb86 }[finish],
  });
  const [u, v, w, h] = bounds;
  const fragments = {
    asphalt: `
      vec2 cell = p / vec2(6.4,4.8);
      vec2 footprint=fwidth(cell);
      cell += 0.38*vec2(grit(p*0.105),grit(p*0.127+8.1));
      vec2 q = fract(cell)-0.5;
      float repairCell = hashCell(floor(cell));
      q += vec2(0.38*(repairCell-0.5), 0.33*(hashCell(floor(cell)+13.0)-0.5));
      float repair = (1.0-smoothstep(0.18,0.23,abs(q.x)))
        *(1.0-smoothstep(0.13,0.19,abs(q.y)))
        *smoothstep(0.74,0.83,repairCell)*(1.0-smoothstep(0.18,0.48,max(footprint.x,footprint.y)));
      float traffic=grit(vec2(p.x*0.084,p.y*0.29))*0.12;
      float oil=smoothstep(0.06,0.45,weathering(p*vec2(0.21,0.39)));
      diffuseColor.rgb *= (0.91+traffic-0.18*repair-0.17*oil+0.16*grit(p*11.0));
    `,
    concrete: `
      float damp=smoothstep(0.13,0.44,grit(p*vec2(0.51,0.19))+0.28*grit(p*1.44));
      diffuseColor.rgb *= slabs(p,vec2(4.8,3.75),0.0)*(1.0-0.31*damp+0.18*grit(p*8.0));
    `,
    planting: `
      GroundDomain terrain=groundDomain(p,mat2(dFdx(p),dFdy(p)));
      diffuseColor.rgb *= wildVerge(terrain,disturbedGround(terrain)).colour*0.83;
    `,
  };
  patchMaterial(material, `dock-${finish}`, (shader) => {
    shader.uniforms.dockPaint = { value: paint };
    shader.uniforms.dockOrigin = { value: new Vector2(u, v) };
    shader.uniforms.dockSize = { value: new Vector2(w, h) };
    shader.vertexShader =
      'varying vec2 vDock;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDock=uv;');
    shader.fragmentShader =
      common +
      (finish === 'planting' ? groundDetail : '') +
      'varying vec2 vDock; uniform sampler2D dockPaint; uniform vec2 dockOrigin,dockSize;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 p=vDock;
        ${fragments[finish]}
        vec4 markings=texture2D(dockPaint,(p-dockOrigin)/dockSize);
        diffuseColor.rgb=mix(diffuseColor.rgb,markings.rgb,markings.a*(0.87+0.15*grit(p*3.8)));
      `,
      );
  });
  return material;
}

const towers = /* glsl */ `
float towerGlass;
float daylightPane;
const float towerHeightM = ${towerHeightM}.0;
// Filter each axis separately. A thin distant tower can keep its floor bands after its
// columns have merged. Near the horizon each band converges on its area average.
float cellBand(float x,float lo,float hi,float px) {
  float w = max(px,0.001);
  return mix(smoothstep(lo-w,lo+w,x)*(1.0-smoothstep(hi-w,hi+w,x)), hi-lo, smoothstep(0.17,0.51,px));
}
`;

// The glass reflects a broad roof-and-tree horizon and the sky above it. The rough
// transition and the per-pane variation both filter out as the shot pulls back.
const houseGlass = /* glsl */ `
  if (introWindowDay>0.0 && vWindowInfo.z>0.0 && vIntroHeight<towerHeightM) {
    vec3 eye = normalize(cameraPosition-vIntroPos);
    vec3 normal = normalize(vIntroNormal);
    if (dot(normal,eye)<0.0) normal = -normal;
    vec3 ray = reflect(-eye,normal);
    float facing = clamp(dot(normal,eye),0.0,1.0);
    float fresnel = 0.055+0.945*pow(1.0-facing,5.0);
    float roofline = 0.04+0.085*grit(ray.xz*3.5+vec2(vIntroPos.x*0.012,vIntroPos.z*0.012));
    float openSky = smoothstep(roofline-0.11,roofline+0.12,ray.y);
    vec3 surround = mix(vec3(0.12,0.14,0.14),vec3(0.23,0.26,0.23),smoothstep(-0.8,0.0,ray.y));
    vec3 sky = mix(vec3(0.80,0.91,1.02),vec3(0.38,0.57,0.88),smoothstep(0.0,0.8,ray.y));
    vec2 cell = vec2(vWindowInfo.x/2.8,vWindowInfo.y/vWindowInfo.z);
    vec2 footprint = fwidth(cell), pane = fract(cell);
    float px = max(footprint.x,footprint.y);
    float resolved = 1.0-smoothstep(0.09,0.30,px);
    float room = hashCell(floor(cell)+vec2(vIntroFinish*117.0))-0.5;
    float inner = cellBand(pane.x,0.207,0.696,footprint.x)*cellBand(pane.y,0.322,0.739,footprint.y);
    // A slim head/sill and an inset reveal, visible on the houses closest to the camera.
    float glassMask = mix(daylightPane,min(daylightPane,inner),resolved);
    float reveal = max(0.0,daylightPane-glassMask);
    float upper = mix(0.54,smoothstep(0.33,0.72,pane.y),resolved);
    vec3 reflection = introSky*mix(surround,sky,openSky);
    // Reflections replace the lit wall beneath the pane. Interior emission stays additive
    // throughout twilight, including while this daylight treatment is still fading.
    vec3 wallLight = outgoingLight-totalEmissiveRadiance;
    vec3 glass = wallLight*(0.20+0.18*room*resolved)*vec3(0.78,0.89,1.0)
      + reflection*(0.19+0.59*fresnel)*(0.77+0.43*upper);
    vec3 trim = wallLight*vec3(0.62,0.65,0.68)+introSky*(0.016+0.039*(1.0-upper));
    outgoingLight += introWindowDay*(glassMask*(glass-wallLight) + reveal*(trim-wallLight));
  }
`;

const masonry = /* glsl */ `
vec3 courses(vec2 p, vec2 dims, float seed, int finish) {
  vec2 q=p/dims;
  vec2 aa=fwidth(q);
  float resolved=1.0-smoothstep(0.12,0.55,max(aa.x,aa.y));
  float row=floor(q.y);
  q.x += 0.5*mod(row,2.0)+0.10*(hashCell(vec2(row,seed))-0.5);
  float tone=hashCell(floor(q)+vec2(seed,seed*0.39));
  float repair=smoothstep(0.94,0.991,tone)*resolved;
  vec2 local=fract(q);
  float edge=seam(q.x,0.038,aa.x)*resolved;
  float course=seam(q.y,0.075,aa.y);
  float rounded=cos((local.x-0.18)*6.283)*resolved;
  float lip=seam(q.y-0.12,0.033,aa.y);
  float mottling=weathering(p*0.79);
  float dust=grit(p*2.14+7.2);
  float coarse=grit(p*14.0);
  float base=0.96+(tone-0.5)*resolved*(0.19+0.23*abs(mottling))+0.38*mottling+0.07*dust+0.11*coarse;
  if(finish==2) return vec3(base+0.115*max(edge,course))*mix(vec3(1.0),vec3(1.14,1.06,0.98),repair);
  if(finish==0) return vec3(1.04,0.94,0.88)*(base+0.135*rounded-0.32*course+0.12*lip)
    *mix(vec3(1.0),vec3(1.13,0.95,0.88),repair);
  return vec3(0.96,0.99,1.035)*(base-0.19*edge-0.33*course+0.12*lip)
    *mix(vec3(1.0),vec3(0.95,1.03,1.15),repair);
}
`;

const building = /* glsl */ `
  towerGlass = 0.0;
  daylightPane = 0.0;
  if (vIntroHeight >= towerHeightM && vWindowInfo.z>0.0) {
    float seed = vIntroFinish;
    float storey = vWindowInfo.y / vWindowInfo.z;
    float bay = vWindowInfo.x / mix(1.9,3.2,seed);
    float floors = fwidth(storey), bays = fwidth(bay);
    float glassBand = cellBand(fract(storey),0.19,0.86,floors);
    float mullion = seam(bay,0.063,bays);
    float pier = seam(bay*0.25,0.027,bays*0.25)*smoothstep(0.36,0.68,seed);
    float crown = smoothstep(vIntroHeight-7.0,vIntroHeight-1.5,vWindowInfo.y);
    float transom = seam(storey+0.12,0.025,floors);
    float floorTint = 0.90+0.13*grit(vec2(seed*17.0,storey*0.30));
    vec3 spandrel = mix(vec3(0.43,0.50,0.52), vec3(0.60,0.56,0.50), seed);
    spandrel *= (0.93+0.48*transom+0.22*crown)*floorTint;
    vec3 glazing = mix(vec3(0.36,0.50,0.59),vec3(0.55,0.63,0.61),seed);
    glazing *= (0.87+0.23*grit(vec2(bay*0.35,storey*0.36)));
    towerGlass = glassBand*(1.0-0.86*max(mullion,pier))*(1.0-0.45*crown);
    diffuseColor.rgb *= mix(spandrel,glazing,towerGlass)*(1.0-0.29*max(mullion,pier));
  } else
  if (abs(vIntroNormal.y)<0.18) {
    vec2 wall = vWindowInfo.z > 0.0 ? vWindowInfo.xy : vIntroUV;
    vec3 brick = courses(wall,vec2(0.225,0.076),vIntroFinish*825.0,2);
    float weather = weathering(vec2(wall.x*0.23,wall.y*0.12));
    float runoff = max(0.0,weathering(vec2(wall.x*0.86,wall.y*0.13)+14.6));
    // The facade patch lays the windows and their illumination over this masonry.
    float soot = (0.84+0.16*smoothstep(0.0,2.6,wall.y))*(0.97+0.14*weather-0.20*runoff);
    if (vColor.b > vColor.r + 0.015 || vWindowInfo.z<0.0) {
      diffuseColor.rgb *= 0.98+0.13*weather-0.14*runoff;
    } else if (vColor.r-vColor.b>0.16 || vIntroFinish<0.58) {
      diffuseColor.rgb *= mix(vec3(1.03,0.90,0.80),vec3(1.02,0.99,0.93),vIntroFinish) * brick*soot;
    } else {
      diffuseColor.rgb *= (0.98+0.13*grit(wall*0.5)-0.12*runoff)*soot;
    }
  } else if (abs(vIntroNormal.y)<0.999) {
    bool clay = vColor.r>vColor.b;
    diffuseColor.rgb *= courses(vIntroUV,clay ? vec2(0.33,0.36) : vec2(0.28,0.26),
      vIntroFinish*825.0,clay ? 0 : 1);
  } else {
    // The 67 x 32 m shed opposite the island platform: sheet metal and translucent
    // rooflight panels between the ribs. Other flat decks have wider lapped felt rolls.
    vec2 p = stationAxes-vec2(10.3,-41.1);
    if(abs(p.x)<33.8 && abs(p.y)<16.3) {
      float rib = seam(p.x/0.68,0.051,fwidth(p.x/0.68));
      float lip = seam((p.x+0.065)/0.68,0.052,fwidth(p.x/0.68));
      float ridge = seam(p.y/34.0,0.004,fwidth(p.y/34.0));
      float across = abs(mod(p.x+3.4,9.52)-4.76);
      float light = (1.0-smoothstep(0.64,0.74,across))*(1.0-smoothstep(2.9,3.02,abs(abs(p.y)-7.8)));
      float sheet=p.x/0.68;
      float gauge=1.0-smoothstep(0.18,0.58,fwidth(sheet));
      float panel=hashCell(vec2(floor(sheet),floor((p.y+34.0)/8.5)));
      float oxide=weathering(vec2(p.x*0.48,p.y*0.14));
      vec3 zinc = vec3(1.04,1.05,1.015)*(0.98-0.33*rib+0.21*lip+0.15*oxide+(panel-0.5)*0.15*gauge);
      diffuseColor.rgb *= mix(zinc,vec3(0.79,0.90,0.94)*(0.98+0.11*lip-0.12*seam(p.y/1.5,0.018,fwidth(p.y/1.5))),light) + 0.12*ridge;
    } else {
      float laps = seam(p.y/1.08,0.022,fwidth(p.y/1.08));
      float strip=floor(p.y/1.08);
      float lengthM=mix(6.2,11.4,hashCell(vec2(strip,vIntroFinish*31.0)));
      float along=p.x/lengthM+hashCell(vec2(strip,22.4));
      float px=fwidth(p.x)/lengthM;
      float joints=seam(along,0.004,px)*(1.0-smoothstep(0.12,0.45,fwidth(p.y/1.08)));
      float felt=hashCell(vec2(floor(along),strip));
      diffuseColor.rgb *= 0.96+0.19*weathering(vec2(p.x*0.11,p.y*0.34)) -0.22*laps-0.14*joints
        +(felt-0.5)*0.13*(1.0-smoothstep(0.13,0.48,max(px,fwidth(p.y/1.08))));
    }
  }
`;

// The reference's station-side yard is missing from the map's land-use polygons. Dress the
// exposed base there with a tree-lined verge, compacted gravel and a pair of worn wheel tracks.
const greenGround = /* glsl */ `
uniform sampler2D introCover;
uniform vec4 introCoverBounds;
vec3 coverMap(vec2 p) {
  vec2 q = (p-introCoverBounds.xy)/introCoverBounds.zw-0.5;
  float edge = 1.0-smoothstep(0.446,0.493,max(abs(q.x),abs(q.y)));
  return texture2D(introCover,q+0.5).rgb*edge;
}
`;

const yard = /* glsl */ `
  vec2 yard = stationAxes - vec2(-2.0,40.0);
  mat2 yardPixel=mat2(dFdx(yard),dFdy(yard));
  if(abs(yard.x+7.0)<64.0 && abs(yard.y-0.6)<29.0) {
    GroundDomain yardTerrain=groundDomain(yard,yardPixel);
    vec3 rough=groundGrain(yardTerrain,0.68,groundTurnA,8.6);
    vec3 drift=groundGrain(yardTerrain,0.11,groundTurnC,25.3);
    float edge=min(62.0-abs(yard.x+7.0),27.3-abs(yard.y-0.6));
    float plot=smoothstep(-0.45,0.25,edge+rough.x);
    float sides=min(20.8-yard.y,yard.y+15.0+0.065*yard.x);
    float head=min(yard.x+52.0,47.0-yard.x);
    float entrance=1.0-smoothstep(3.0,5.2,abs(yard.x+23.0+0.15*yard.y));
    vec3 worn=vec3(min(head,sides+10.0*entrance),0,0)+5.0*drift+1.25*rough;
    vec3 hardstand=groundMask(worn,-0.85,0.9,yardTerrain.pixel);
    vec3 stone=0.23*groundGrain(yardTerrain,6.8,groundTurnC,45.2)
      +0.11*groundGrain(yardTerrain,15.0,groundTurnB,-6.2);
    vec3 gritBed=groundGrain(yardTerrain,1.7,groundTurnB,7.9);
    float rut=abs(abs(yard.y-(6.2+0.0024*yard.x*yard.x))-0.94);
    float track=(1.0-smoothstep(0.15,0.55,rut))*smoothstep(-42.0,-17.0,yard.x);
    vec3 damp=groundMask(groundGrain(yardTerrain,0.21,groundTurnB,13.7)
      +0.5*groundGrain(yardTerrain,0.48,groundTurnA,-27.6),0.08,0.36,yardTerrain.pixel);
    GroundFinish gravel=GroundFinish(
      vec3(1.0,0.87,0.70)*(0.97+stone.x+0.16*drift.x+0.05*rough.x-0.16*track-0.19*damp.x),
      0.045*stone+0.070*gritBed-0.075*damp+0.042*drift
    );
    GroundFinish soil=disturbedGround(yardTerrain);
    GroundFinish verge=wildVerge(yardTerrain,soil);
    verge.colour*=0.91;
    vec3 bare=groundMask(drift+0.34*rough+0.19*groundGrain(yardTerrain,3.6,groundTurnC,6.4),
      -0.40,0.46,yardTerrain.pixel);
    GroundFinish finish=groundBlend(groundBlend(verge,soil,0.33*bare),gravel,hardstand);
    diffuseColor.rgb*=mix(vec3(1.0),finish.colour,plot);
    introGroundSlope=transpose(stationTurn)*finish.relief.yz*plot;
  }
`;

const pavement = /* glsl */ `
  vec2 p = runwayAxes(vIntroPos.xz);
  vec4 airCover = airfieldCoverage(p);
  if (vColor.r < 0.31) {
    // The two touchdown areas follow the displaced thresholds. The wheel bands spread where
    // aircraft land, then taper into the much fainter marks along the runway centre.
    float fromThreshold = min(p.x-runwayThreshold.x,runwayThreshold.y-p.x);
    float touchdown = smoothstep(12.0,75.0,fromThreshold)*(1.0-smoothstep(190.0,410.0,fromThreshold));
    float shoulders = 1.0-smoothstep(3.8,10.4,abs(p.y));
    float wheels = 1.0-smoothstep(0.65,2.68,abs(abs(p.y)-2.77));
    float scuff = 0.67+0.58*grit(vec2(p.x*0.09,p.y*1.7));
    float rubber = (0.105*shoulders+touchdown*(0.16*shoulders+0.34*wheels))*scuff;
    float grooves = seam(p.x/0.36,0.065,fwidth(p.x/0.36))*(1.0-smoothstep(12.0,14.5,abs(p.y)));
    float aggregate = 0.13*grit(p*15.0)+0.078*grit(p*2.1);
    diffuseColor.rgb = vec3(0.329,0.337,0.346)*(1.0-0.79*rubber-0.17*grooves+aggregate);
  } else if (vColor.r < 0.50) {
    float repair = weathering(p*vec2(0.085,0.14));
    float joints = seam(p.x/10.5,0.006,fwidth(p.x/10.5));
    vec3 lane = mix(vec3(0.352,0.358,0.362),vec3(0.238,0.251,0.260),airCover.b);
    diffuseColor.rgb = lane*(0.98+0.19*repair-0.13*joints+0.15*grit(p*9.0));
  } else {
    diffuseColor.rgb = apronConcrete(p,airCover.g);
  }
`;

export function surfaceTexture(
  stage: IntroSurfaces,
  runway: Runway | undefined,
  cover: { map: CanvasTexture; bounds: Vector4 },
  apron?: ReturnType<typeof apronDressing>,
  frontage?: { x: number; y: number; bearing: number },
) {
  const canopy = canopyShade(stage.vegetation);
  const plainFrontage =
    frontage &&
    new Vector4(frontage.x, frontage.y, Math.cos(frontage.bearing), Math.sin(frontage.bearing));
  const undo: (() => void)[] = [];
  const sky = { value: new Vector3() };
  const windowDay = { value: 1 };
  const ends = runway?.ends;
  const origin = new Vector2(ends?.[0].pos.x ?? 0, ends?.[0].pos.y ?? 0);
  const direction = new Vector2(Math.cos(ends?.[0].heading ?? 0), Math.sin(ends?.[0].heading ?? 0));
  const length = runway?.lengthM ?? 0;
  const runwayUniforms = {
    runwayOrigin: { value: origin },
    runwayDirection: { value: direction },
    runwayThreshold: {
      value: new Vector2(ends?.[0].displacedM ?? 0, length - (ends?.[1].displacedM ?? 0)),
    },
    runwayLength: { value: length },
    introAirfieldBounds: { value: apron?.bounds },
    introAirfieldCoverage: { value: apron?.coverage },
    introApronPaint: { value: apron?.markings },
  };
  // Both building batches can be selected after installation (including by the render script).
  // Every facade triangle has an eaves vertex. The app stores metres above its wall base.
  if (stage.geometry) {
    for (const geometry of [
      stage.geometry.context.buildings,
      stage.geometry.context.detailedBuildings,
    ]) {
      const windows = geometry.getAttribute('windowInfo');
      const height = new Float32Array(windows.count);
      for (let i = 0; i < windows.count; i += 3) {
        const eaves = Math.max(windows.getY(i), windows.getY(i + 1), windows.getY(i + 2));
        height.fill(eaves, i, i + 3);
      }
      geometry.setAttribute('introHeight', new Float32BufferAttribute(height, 1));
      undo.push(() => geometry.deleteAttribute('introHeight'));
    }
  }
  if (stage.buildings) {
    const mesh = stage.buildings,
      original = mesh.onBeforeRender;
    mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      original.call(this, renderer, scene, camera, geometry, material, group);
      sky.value.fromArray(hexToLinear(stage.light.background));
      const twilight = Math.max(0, Math.min(1, (stage.light.artificial - 0.2) / 0.66));
      windowDay.value = 1 - twilight * twilight * (3 - 2 * twilight);
    };
    undo.push(() => {
      mesh.onBeforeRender = original;
    });
  }
  const road =
    'diffuseColor.rgb *= 0.965 + 0.12*grit(vIntroPos.xz*15.0) + 0.095*weathering(vIntroPos.xz*0.21);';
  const paving = 'diffuseColor.rgb *= slabs(stationAxes,vec2(0.90,0.61),0.5);';
  function apply(mesh: Mesh | undefined, name: string, fragment: string) {
    if (!mesh) return;
    const material = mesh.material as MeshLambertMaterial;
    // The app's road grain and context atlas normally use nearest-neighbour sampling.
    const map = material.map;
    if (map) {
      const filtered = map.clone();
      filtered.generateMipmaps = true;
      filtered.minFilter = LinearMipmapLinearFilter;
      filtered.magFilter = LinearFilter;
      filtered.needsUpdate = true;
      material.map = filtered;
      undo.push(() => {
        material.map = map;
        filtered.dispose();
      });
    }
    const facade = name === 'buildings';
    const onLand = name === 'station-yard' || name === 'land-use';
    const paveFrontage = onLand && plainFrontage;
    const finish = name + (apron ? '-apron' : '') + (paveFrontage ? '-frontage' : '');
    const vertexHeader = facade
      ? `
      varying vec3 vIntroNormal; varying vec2 vIntroUV; varying float vIntroFinish; varying float vIntroHeight;
      attribute float introHeight;
      #ifndef LIT_WINDOWS
        attribute float windowSeed;
      #endif
    `
      : '';
    const vertexUv = facade
      ? `
      vIntroNormal=normal;
      vIntroHeight=introHeight;
      vec2 down=normal.xz/max(length(normal.xz),0.00001);
      float along=dot(position.xz,vec2(-down.y,down.x));
      vIntroUV=vec2(along,abs(normal.y)<0.18 ? position.y : dot(position.xz,down)/max(abs(normal.y),0.18));
      vIntroFinish=fract(windowSeed*0.0137);
    `
      : '';
    undo.push(
      patchMaterial(material, finish, (shader) => {
        shader.vertexShader =
          'varying vec3 vIntroPos;\n' +
          vertexHeader +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\nvIntroPos=(modelMatrix*vec4(transformed,1.0)).xyz;\n${vertexUv}`,
          );
        const header = facade
          ? 'uniform vec3 introSky; uniform float introWindowDay; varying vec3 vIntroNormal; varying vec2 vIntroUV; varying float vIntroFinish; varying float vIntroHeight;'
          : 'uniform sampler2D introShade;';
        const isAirfield =
          !!apron && (name === 'airfield' || name === 'land-use' || name === 'station-yard');
        if (facade) {
          shader.uniforms.introSky = sky;
          shader.uniforms.introWindowDay = windowDay;
          // Existing window emission still uses the app's deterministic lighting. The
          // daylight inset grid is only for the lower buildings.
          shader.fragmentShader = shader.fragmentShader
            .replace(
              'if (vWindowInfo.z > 0.0) {\n          float level',
              'if (vWindowInfo.z > 0.0 && vIntroHeight < towerHeightM) {\n          float level',
            )
            // Keep the app's night tint and its separately computed window emission.
            .replace(
              'diffuseColor.rgb = mix(diffuseColor.rgb, windowColour, band * 0.55);',
              `daylightPane = band;
          diffuseColor.rgb = mix(diffuseColor.rgb, windowColour, band * 0.55 * (1.0-introWindowDay));`,
            )
            .replace(
              'float litAlong = fract(vWindowInfo.x / 2.8);',
              'float litAlong = fract(vWindowInfo.x / (vIntroHeight >= towerHeightM ? mix(1.9,3.2,vIntroFinish) : 2.8));',
            )
            .replace(
              'uint cell = cfWindowHash(',
              'if (vIntroHeight >= towerHeightM) pane = towerGlass;\n          uint cell = cfWindowHash(',
            )
            .replace(
              'uint(floor(vWindowInfo.x / 2.8)))',
              'uint(floor(vWindowInfo.x / (vIntroHeight >= towerHeightM ? mix(1.9,3.2,vIntroFinish) : 2.8))))',
            )
            .replace(
              '#include <opaque_fragment>',
              `${houseGlass}
            if (towerGlass>0.0) {
              vec3 eye = normalize(cameraPosition-vIntroPos);
              vec3 normal = normalize(vIntroNormal);
              if (dot(normal,eye)<0.0) normal = -normal;
              vec3 r = reflect(-eye,normal);
              float grazing = pow(1.0-clamp(dot(normal,eye),0.0,1.0),3.0);
              float skyBand = smoothstep(-0.22,0.12,r.y + 0.05*(vIntroFinish-0.5));
              float silhouette = 0.85+0.15*grit(vec2(r.x*22.0,r.z*22.0));
              vec3 reflection = introSky*mix(vec3(0.16,0.24,0.29),vec3(0.46,0.64,0.81),skyBand);
              outgoingLight += towerGlass*silhouette*(0.58+0.41*grazing)*reflection;
            }
            #include <opaque_fragment>`,
            );
        }
        if (isAirfield) Object.assign(shader.uniforms, runwayUniforms);
        if (onLand) {
          shader.uniforms.introCover = { value: cover.map };
          shader.uniforms.introCoverBounds = { value: cover.bounds };
        }
        if (paveFrontage) shader.uniforms.introFrontage = { value: plainFrontage };
        if (!facade) shader.uniforms.introShade = { value: canopy };
        if (onLand) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
            vec3 groundGradient=mat3(viewMatrix)*vec3(introGroundSlope.x,0.0,introGroundSlope.y);
            normal=normalize(normal-(groundGradient-normal*dot(groundGradient,normal)));`,
          );
        }
        shader.fragmentShader =
          common +
          (onLand || isAirfield ? groundDetail : '') +
          (facade ? towers + masonry : '') +
          (isAirfield ? airfieldFinish : '') +
          (onLand ? greenGround : '') +
          header +
          (paveFrontage ? '\nuniform vec4 introFrontage;' : '') +
          '\n' +
          shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
      const mat2 stationTurn = mat2(0.995,-0.1,0.1,0.995);
      vec2 stationAxes = stationTurn*(vIntroPos.xz-vec2(539.0,247.0));
      ${onLand ? 'vec2 introGroundSlope = vec2(0.0);' : ''}
      ${fragment}
      ${
        paveFrontage
          ? `
      vec2 rel=vIntroPos.xz-introFrontage.xy;
      vec2 q=mat2(introFrontage.z,introFrontage.w,introFrontage.w,-introFrontage.z)*rel;
      float edge=min(min(q.x,94.0-q.x),min(q.y,mix(14.5,7.2,clamp(q.x/94.0,0.0,1.0))-q.y));
      if(edge>0.0) diffuseColor.rgb*=mix(vec3(1.0),slabs(q,vec2(0.90,0.61),0.5),0.28*smoothstep(0.0,0.55,edge));`
          : ''
      }
      ${facade ? '' : `if(vIntroPos.y < 0.5 ${name === 'land-use' ? '&& vSurfaceIndex<4.5' : ''}) diffuseColor.rgb *= texture2D(introShade,(vIntroPos.xz-vec2(539.0,247.0))/1024.0+0.5).r;`} `,
          );
      }),
    );
  }
  apply(
    stage.ground,
    'station-yard',
    yard +
      `
    vec2 p = vIntroPos.xz;
    vec3 cover = coverMap(p);
    mat2 landPixel=mat2(dFdx(p),dFdy(p));
    if (cover.r+cover.g>0.006) {
      GroundDomain terrain=groundDomain(p,landPixel);
      GroundFinish soil=disturbedGround(terrain);
      GroundFinish finish=groundBlend(soil,wildVerge(terrain,soil),vec3(smoothstep(0.07,0.61,cover.g),0,0));
      float extent=clamp(cover.r+cover.g,0.0,0.92);
      diffuseColor.rgb*=mix(vec3(1.0),finish.colour,extent);
      introGroundSlope=mix(introGroundSlope,finish.relief.yz,extent);
    }
    diffuseColor.rgb *= 1.0-0.54*cover.b;
    ` +
      (apron
        ? 'diffuseColor.rgb = apronLand(runwayAxes(p),diffuseColor.rgb,introGroundSlope);'
        : ''),
  );
  apply(stage.buildings, 'buildings', building);
  apply(stage.walk?.sidewalks, 'sidewalks', paving);
  apply(stage.walk?.footways, 'footways', paving);
  apply(stage.lotSurface, 'parking', road);
  apply(
    stage.surroundings,
    'land-use',
    `vec2 world = vIntroPos.xz;
    vec3 cover = coverMap(world);
    mat2 landPixel=mat2(dFdx(world),dFdy(world));
    if(vSurfaceIndex>0.5 && vSurfaceIndex<3.5) {
      GroundDomain terrain=groundDomain(world,landPixel);
      vec2 mowDirection=vec2(0.35,0.936)/2.9;
      float mowAxis=dot(world,mowDirection);
      float px=abs(dot(landPixel[0],mowDirection))+abs(dot(landPixel[1],mowDirection));
      float stripe=cos(mowAxis*3.14159)*(1.0-smoothstep(0.19,0.50,px));
      float grow=groundGrain(terrain,0.04,groundTurnB,19.4).x;
      float mown=(1.0-smoothstep(1.1,1.45,vSurfaceIndex))*smoothstep(0.44,0.69,0.5+grow);
      GroundFinish grass=turf(terrain);
      grass.colour*=1.0+0.072*stripe*mown;
      if(cover.g>0.006)
        grass=groundBlend(grass,wildVerge(terrain,disturbedGround(terrain)),vec3(cover.g*0.64,0,0));
      diffuseColor.rgb*=grass.colour*(1.0-0.59*cover.b);
      introGroundSlope=grass.relief.yz;
    } else if (vSurfaceIndex<0.5 && cover.r+cover.g+cover.b>0.006) {
      GroundDomain terrain=groundDomain(world,landPixel);
      GroundFinish soil=disturbedGround(terrain);
      if(cover.g>0.006)
        soil=groundBlend(soil,wildVerge(terrain,soil),vec3(smoothstep(0.07,0.6,cover.g),0,0));
      float extent=clamp(cover.r+cover.g,0.0,0.93);
      diffuseColor.rgb*=mix(vec3(1.0),soil.colour,extent)*(1.0-0.57*cover.b);
      introGroundSlope=soil.relief.yz*extent;
    }
    else if(vSurfaceIndex>3.5 && vSurfaceIndex<4.5) diffuseColor.rgb *= slabs(stationAxes,vec2(3.0),0.0);` +
      (apron
        ? 'diffuseColor.rgb = apronLand(runwayAxes(world),diffuseColor.rgb,introGroundSlope);'
        : ''),
  );
  for (const child of stage.content.children) {
    const mesh = child as Mesh;
    if (!mesh.isMesh) continue;
    if (mesh.geometry === stage.geometry?.surfaces) apply(mesh, 'asphalt', road);
    if (apron && mesh.geometry === stage.geometry?.airside) apply(mesh, 'airfield', pavement);
  }
  return () => {
    undo.reverse().forEach((f) => f());
    canopy.dispose();
  };
}
