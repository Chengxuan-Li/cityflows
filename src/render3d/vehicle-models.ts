import { BufferGeometry, Float32BufferAttribute, MeshLambertMaterial, Vector3 } from 'three';
import type { VehicleClass } from '../schema/city';
import { style } from '../render/style';

type Point = readonly [number, number, number];
type Cabin = {
  // Rear and front roof edges, followed by the corresponding edges at the beltline.
  roof: readonly [number, number];
  base: readonly [number, number];
  topWidth: number;
  width: number;
  height: number;
  sill: number;
  frontSill?: number;
  panes: number;
  sideGlassFrom?: number;
};

type Recipe = {
  vehicleClass: VehicleClass;
  axles: readonly [number, number];
  radius: number;
  belt: number;
  hood: number;
  skirt?: number;
  boot?: number;
  noseWidth?: number;
  noseHeight?: number;
  head?: readonly [number, number];
  tail?: readonly [number, number];
  cabins: readonly Cabin[];
};

const face = {
  body: 0,
  tire: 1,
  hub: 2,
  sideGlass: 3,
  glass: 4,
  head: 5,
  tail: 6,
  busSide: 7,
  busFront: 8,
} as const;

// In the same unit envelope as the moving boxes: the front bumper is at x = 0.
export const vehicleModelNames = ['sedan', 'hatchback', 'suv', 'van', 'truck', 'bus'] as const;

const recipes: readonly Recipe[] = [
  {
    vehicleClass: 'car',
    axles: [-0.8, -0.19],
    radius: 0.205,
    belt: 0.56,
    hood: 0.49,
    boot: 0.5,
    cabins: [
      {
        roof: [-0.59, -0.38],
        base: [-0.75, -0.24],
        topWidth: 0.32,
        width: 0.435,
        height: 1,
        sill: 0.493,
        panes: 2,
      },
    ],
  },
  {
    vehicleClass: 'car',
    axles: [-0.786, -0.21],
    radius: 0.21,
    belt: 0.565,
    hood: 0.51,
    noseWidth: 0.425,
    cabins: [
      {
        roof: [-0.813, -0.43],
        base: [-0.91, -0.25],
        topWidth: 0.355,
        width: 0.447,
        height: 1,
        sill: 0.5,
        panes: 2,
      },
    ],
  },
  {
    vehicleClass: 'car',
    axles: [-0.78, -0.21],
    radius: 0.245,
    belt: 0.73,
    hood: 0.69,
    skirt: 0.255,
    noseWidth: 0.47,
    head: [0.435, 0.57],
    tail: [0.44, 0.61],
    cabins: [
      {
        roof: [-0.937, -0.303],
        base: [-0.951, -0.246],
        topWidth: 0.44,
        width: 0.457,
        height: 1,
        sill: 0.69,
        panes: 3,
      },
    ],
  },
  {
    vehicleClass: 'van',
    axles: [-0.8, -0.17],
    radius: 0.16,
    belt: 0.57,
    hood: 0.47,
    cabins: [
      {
        roof: [-0.97, -0.22],
        base: [-0.99, -0.11],
        topWidth: 0.44,
        width: 0.47,
        height: 1,
        sill: 0.47,
        panes: 1,
        sideGlassFrom: 0.74,
      },
    ],
  },
  {
    vehicleClass: 'truck',
    axles: [-0.79, -0.1],
    radius: 0.16,
    belt: 0.43,
    hood: 0.44,
    head: [0.235, 0.38],
    tail: [0.22, 0.35],
    cabins: [
      {
        roof: [-0.99, -0.263],
        base: [-0.99, -0.263],
        topWidth: 0.495,
        width: 0.495,
        height: 1,
        sill: 0.415,
        panes: 0,
      },
      {
        roof: [-0.225, -0.042],
        base: [-0.225, -0.013],
        topWidth: 0.418,
        width: 0.458,
        height: 0.88,
        sill: 0.419,
        panes: 1,
      },
    ],
  },
  {
    vehicleClass: 'bus',
    axles: [-0.82, -0.2],
    radius: 0.16,
    belt: 0.52,
    hood: 0.48,
    noseHeight: 0.29,
    noseWidth: 0.46,
    head: [0.19, 0.263],
    cabins: [
      {
        roof: [-0.984, -0.031],
        base: [-0.993, -0.007],
        topWidth: 0.477,
        width: 0.477,
        height: 1,
        sill: 0.47,
        frontSill: 0.281,
        panes: 6,
      },
    ],
  },
];

export function vehicleModelIndex(vclass: number, id: number) {
  if (vclass !== 0) return vclass + 2;
  const mixed = Math.imul(id ^ (id >>> 16), 0x45d9f3b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) % 3;
}

/** Map a trapezoidal window as one quadrilateral, across both mesh triangles. */
function windowWeights(a: Point, b: Point, c: Point, d: Point) {
  const origin = new Vector3(...a);
  const ac = new Vector3(...c).sub(origin);
  const ab = new Vector3(...b).sub(origin);
  const bd = new Vector3(...d).sub(new Vector3(...b));
  const normal = new Vector3().crossVectors(ac, bd);
  const squared = normal.lengthSq();
  const t = new Vector3().crossVectors(ab, bd).dot(normal) / squared;
  const s = ab.cross(ac).dot(normal) / squared;
  return [1 / (1 - t), 1 / (1 - s), 1 / t, 1 / s];
}

export function buildVehicleModel(index: number) {
  const recipe = recipes[index]!;
  const bus = recipe.vehicleClass === 'bus';
  const positions: number[] = [];
  const panels: number[] = [];
  const panelUv: number[] = [];
  const unitWeights = [1, 1, 1, 1];
  const textureCorners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const;
  const triangle = (
    a: Point,
    b: Point,
    c: Point,
    surface: number,
    aMask = 0,
    bMask = 0,
    ia = 0,
    ib = 1,
    ic = 2,
    weights = unitWeights,
  ) => {
    positions.push(...a, ...b, ...c);
    for (const i of [ia, ib, ic]) {
      panels.push(surface, aMask, bMask);
      const [u, v] = textureCorners[i]!;
      const w = weights[i]!;
      panelUv.push(u * w, v * w, w);
    }
  };
  const quad = (
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    surface: number = face.body,
    aMask = 0,
    bMask = 0,
  ) => {
    const glazed =
      surface === face.glass ||
      surface === face.sideGlass ||
      surface === face.busFront ||
      (surface === face.busSide && aMask > 0);
    const weights = glazed ? windowWeights(a, b, c, d) : unitWeights;
    triangle(a, b, c, surface, aMask, bMask, 0, 1, 2, weights);
    triangle(a, c, d, surface, aMask, bMask, 0, 2, 3, weights);
  };

  const { lengthM, heightM } = style.vehicleClasses[recipe.vehicleClass];
  const wheelLength = (recipe.radius * heightM) / lengthM;
  const arch = wheelLength * 1.19;
  const skirt = recipe.skirt ?? 0.15;
  const deck = recipe.boot ?? recipe.belt - 0.03;
  const noseWidth = recipe.noseWidth ?? 0.445;
  const noseHeight = recipe.noseHeight ?? recipe.hood - 0.015;
  // Each axle cuts a shallow arch into the side skirt. The box's front and rear
  // retain a full-width panel for the lamps.
  const stations: [number, number, number, number][] = [
    [-1, 0.45, deck, skirt + 0.04],
    ...recipe.axles.flatMap<[number, number, number, number]>((x) => [
      [x - arch, 0.5, recipe.belt, skirt],
      [x - arch * 0.54, 0.5, recipe.belt, recipe.radius * 2],
      [x + arch * 0.54, 0.5, recipe.belt, recipe.radius * 2],
      [x + arch, 0.5, recipe.belt, skirt],
    ]),
    [(recipe.axles[1] + arch) * 0.48, 0.48, recipe.hood, skirt],
    [0, noseWidth, noseHeight, skirt + 0.035],
  ];
  if (recipe.vehicleClass === 'car') {
    stations.push([-0.965, 0.483, deck + 0.01, skirt + 0.014]);
    stations.push([-0.023, 0.483, recipe.hood, skirt + 0.012]);
  }
  if (recipe.boot !== undefined)
    for (const station of stations) if (station[0] < recipe.cabins[0]!.base[0]) station[2] = deck;
  stations.sort((a, b) => a[0] - b[0]);
  const rings = stations.map(
    ([x, w, y, y0]) =>
      [
        [x, y0, -w * 0.9],
        [x, y - 0.075, -w],
        [x, y, -w * 0.96],
        [x, y, w * 0.96],
        [x, y - 0.075, w],
        [x, y0, w * 0.9],
      ] as Point[],
  );
  for (let i = 1; i < rings.length; i++) {
    const prev = rings[i - 1]!,
      next = rings[i]!;
    for (let j = 0; j < prev.length; j++) {
      const k = (j + 1) % prev.length;
      const flank = j < 2 ? -1 : j === 3 || j === 4 ? 1 : 0;
      quad(
        prev[j]!,
        prev[k]!,
        next[k]!,
        next[j]!,
        bus && flank ? face.busSide : face.body,
        0,
        flank,
      );
    }
  }
  for (let j = 1; j < 5; j++) {
    const rear = rings[0]!,
      front = rings.at(-1)!;
    const [tailLow, tailHigh] = recipe.tail ?? [0.235, 0.385];
    const [headLow, headHigh] = recipe.head ?? [0.23, 0.39];
    triangle(rear[0]!, rear[j + 1]!, rear[j]!, face.tail, tailLow, tailHigh);
    triangle(front[0]!, front[j]!, front[j + 1]!, face.head, headLow, headHigh);
  }

  for (const cabin of recipe.cabins) {
    const [a, b] = cabin.base,
      [c, d] = cabin.roof;
    const { height, panes, topWidth, width, sill, frontSill = sill } = cabin;
    const l: Point = [a, sill, -width],
      r: Point = [a, sill, width];
    const f: Point = [b, frontSill, -width],
      g: Point = [b, frontSill, width];
    const L: Point = [c, height, -topWidth],
      R: Point = [c, height, topWidth];
    const F: Point = [d, height, -topWidth],
      G: Point = [d, height, topWidth];
    const side = bus ? face.busSide : panes ? face.sideGlass : face.body;
    quad(f, l, L, F, side, panes, bus ? -1 : -(cabin.sideGlassFrom ?? 0));
    quad(r, g, G, R, side, panes, bus ? 1 : (cabin.sideGlassFrom ?? 0));
    quad(l, r, R, L, panes && !cabin.sideGlassFrom ? face.glass : face.body);
    quad(g, f, F, G, bus ? face.busFront : panes ? face.glass : face.body);
    quad(R, G, F, L);
  }

  const sides = 10;
  for (const x of recipe.axles) {
    for (const side of [-1, 1]) {
      const point = (i: number, scale: number, z: number): Point => {
        const angle = (2 * Math.PI * i * side) / sides;
        return [
          x + wheelLength * scale * Math.sin(angle),
          recipe.radius - recipe.radius * scale * Math.cos(angle),
          z * side,
        ];
      };
      for (let i = 0; i < sides; i++) {
        const j = i + 1;
        const a = point(i, 1, 0.475),
          b = point(j, 1, 0.475);
        const c = point(i, 0.84, 0.5),
          d = point(j, 0.84, 0.5);
        quad(b, a, point(i, 1, 0.33), point(j, 1, 0.33), face.tire);
        quad(d, c, a, b, face.tire);
        triangle([x, recipe.radius, side * 0.5], c, d, face.hub);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.name = vehicleModelNames[index]!;
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('panelUv', new Float32BufferAttribute(panelUv, 3));
  geometry.setAttribute('panel', new Float32BufferAttribute(panels, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function vehicleModelMaterial(kerbSide: { value: number }, lights?: { value: number }) {
  const material = new MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.vehicleLights = lights ?? { value: 0 };
    shader.uniforms.kerbSide = kerbSide;
    // Each triangle belongs to one surface. Interpolate only its coordinates,
    // so pane counts and face selection cannot drift across their thresholds.
    const varyings = 'flat varying vec3 vPanel; varying vec3 vSurfaceUv; varying vec3 vBody;\n';
    shader.vertexShader =
      'attribute vec3 panel, panelUv;\n' +
      varyings +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvPanel = panel; vSurfaceUv = panelUv; vBody = position;',
      );
    shader.fragmentShader =
      varyings +
      `uniform float vehicleLights, kerbSide;
      float band(float x, float lo, float hi, float px) {
        return smoothstep(lo - px, lo + px, x) * (1.0 - smoothstep(hi - px, hi + px, x));
      }
      vec3 busDoor(vec2 p, vec2 px, float lo, float hi) {
        float x = band(p.x, lo, hi, px.x);
        float y = band(p.y, 0.205, 0.92, px.y);
        float inset = band(p.x, lo + 0.004, hi - 0.004, px.x);
        float middle = 0.5 * (lo + hi);
        float seam = band(p.x, middle - 0.002, middle + 0.002, px.x);
        float inside = inset * (1.0 - seam);
        float edge = x * y - inside * band(p.y, 0.225, 0.905, px.y);
        return vec3(x * y, edge, inside * band(p.y, 0.53, 0.885, px.y));
      }
      // CITY in a 3 × 5 dot matrix. Each integer stores one glyph, top-left first.
      float busDestination(vec2 uv, vec2 px) {
        vec2 p = (uv - vec2(0.355, 0.781)) * vec2(50.0, 40.0);
        vec2 cell = floor(p);
        float glyph = floor(cell.x / 4.0);
        int bits = glyph == 0.0 ? 31015 : glyph == 1.0 ? 29847 : glyph == 2.0 ? 29842 : 23186;
        int bit = int(clamp(cell.y * 3.0 + 2.0 - mod(cell.x, 4.0), 0.0, 14.0));
        vec2 subcell = fract(p), cellPx = min(px * vec2(50.0, 40.0), vec2(0.49));
        return float((bits >> bit) & 1) * step(0.0, cell.x) * step(cell.x, 14.0)
          * step(0.0, cell.y) * step(cell.y, 4.0) * step(mod(cell.x, 4.0), 2.0)
          * band(subcell.x, 0.09, 0.91, cellPx.x) * band(subcell.y, 0.09, 0.91, cellPx.y);
      }
      ` +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 uv = vSurfaceUv.xy / vSurfaceUv.z;
          vec2 uvPx = max(0.5 * fwidth(uv), vec2(0.00001));
          vec3 bodyPx = max(0.5 * fwidth(vBody), vec3(0.00001));
          vec3 windowInk = vec3(0.022, 0.039, 0.051);
          float head = 0.0, tail = 0.0, destination = 0.0, glass = 0.0;
          float panel = vPanel.x;
          if (panel == ${face.tire}.0 || panel == ${face.hub}.0) {
            float hub = panel == ${face.hub}.0 ? 1.0 - smoothstep(0.68 - uvPx.x, 0.68 + uvPx.x, uv.x) : 0.0;
            diffuseColor.rgb = mix(vec3(0.016), vec3(0.23, 0.25, 0.27), hub);
          } else if (panel == ${face.sideGlass}.0 || panel == ${face.busSide}.0) {
            if (vPanel.y > 0.0) {
              float mirror = panel == ${face.sideGlass}.0 && vPanel.z < 0.0 ? 1.0 : 0.0;
              float along = mix(uv.x, 1.0 - uv.x, mirror);
              float from = panel == ${face.sideGlass}.0 ? abs(vPanel.z) : 0.0;
              float scale = vPanel.y / (1.0 - from);
              float panePx = min(uvPx.x * scale, 0.49);
              glass = band(along, from, 1.0, uvPx.x)
                * band(fract((along - from) * scale), 0.05, 0.95, panePx)
                * band(uv.y, 0.22, 0.92, uvPx.y);
            }
            if (panel == ${face.busSide}.0 && vPanel.z == kerbSide) {
              vec3 door = max(busDoor(vBody.xy, bodyPx.xy, -0.152, -0.032),
                busDoor(vBody.xy, bodyPx.xy, -0.608, -0.468));
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, door.x);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.028, 0.04, 0.047), door.y);
              glass = max(glass * (1.0 - door.x), door.z);
            }
          } else if (panel == ${face.glass}.0) {
            glass = band(uv.x, 0.055, 0.945, uvPx.x) * band(uv.y, 0.14, 0.91, uvPx.y);
          } else if (panel == ${face.busFront}.0) {
            float across = band(uv.x, 0.047, 0.953, uvPx.x);
            glass = across * band(uv.y, 0.042, 0.728, uvPx.y);
            float sign = across * band(uv.y, 0.751, 0.934, uvPx.y);
            destination = sign * busDestination(uv, uvPx);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), sign);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.36, 0.043), destination);
          } else if (panel == ${face.head}.0 || panel == ${face.tail}.0) {
            float bumper = band(vBody.y, vPanel.y, vPanel.z, bodyPx.y);
            float across = abs(vBody.z);
            head = panel == ${face.head}.0 ? bumper * band(across, 0.24, 0.41, bodyPx.z) : 0.0;
            tail = panel == ${face.tail}.0 ? bumper * band(across, 0.29, 0.424, bodyPx.z) : 0.0;
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, windowInk, glass);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.77, 0.8), head);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.49, 0.027, 0.019), tail);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += vehicleLights
            * (head * vec3(1.6, 1.5, 1.3) + tail * vec3(1.4, 0.06, 0.04)
              + destination * vec3(0.55, 0.24, 0.028));`,
        );
  };
  return material;
}
