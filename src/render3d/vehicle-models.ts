import { BufferGeometry, Float32BufferAttribute, MeshLambertMaterial } from 'three';
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
  panes: number;
  sideGlassFrom?: number;
};

type Recipe = {
  vehicleClass: VehicleClass;
  axles: readonly [number, number];
  radius: number;
  belt: number;
  hood: number;
  cabins: readonly Cabin[];
};

// In the same unit envelope as the moving boxes: the front bumper is at x = 0.
export const vehicleModelNames = ['sedan', 'hatchback', 'suv', 'van', 'truck', 'bus'] as const;

const recipes: readonly Recipe[] = [
  {
    vehicleClass: 'car',
    axles: [-0.81, -0.19],
    radius: 0.21,
    belt: 0.58,
    hood: 0.51,
    cabins: [
      {
        roof: [-0.68, -0.37],
        base: [-0.83, -0.25],
        topWidth: 0.34,
        width: 0.45,
        height: 1,
        panes: 2,
      },
    ],
  },
  {
    vehicleClass: 'car',
    axles: [-0.81, -0.18],
    radius: 0.21,
    belt: 0.61,
    hood: 0.5,
    cabins: [
      {
        roof: [-0.85, -0.35],
        base: [-0.96, -0.23],
        topWidth: 0.37,
        width: 0.45,
        height: 1,
        panes: 2,
      },
    ],
  },
  {
    vehicleClass: 'car',
    axles: [-0.8, -0.2],
    radius: 0.24,
    belt: 0.67,
    hood: 0.58,
    cabins: [
      {
        roof: [-0.91, -0.35],
        base: [-0.97, -0.25],
        topWidth: 0.41,
        width: 0.47,
        height: 1,
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
        panes: 1,
        sideGlassFrom: 0.74,
      },
    ],
  },
  {
    vehicleClass: 'truck',
    axles: [-0.79, -0.1],
    radius: 0.16,
    belt: 0.51,
    hood: 0.5,
    cabins: [
      {
        roof: [-0.99, -0.23],
        base: [-0.99, -0.23],
        topWidth: 0.495,
        width: 0.495,
        height: 1,
        panes: 0,
      },
      {
        roof: [-0.21, -0.055],
        base: [-0.21, -0.008],
        topWidth: 0.41,
        width: 0.46,
        height: 0.86,
        panes: 1,
      },
    ],
  },
  {
    vehicleClass: 'bus',
    axles: [-0.82, -0.2],
    radius: 0.16,
    belt: 0.52,
    hood: 0.51,
    cabins: [
      {
        roof: [-0.987, -0.027],
        base: [-0.996, -0.004],
        topWidth: 0.458,
        width: 0.48,
        height: 1,
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

export function buildVehicleModel(index: number) {
  const recipe = recipes[index]!;
  const positions: number[] = [];
  const panels: number[] = [];
  const uv: number[] = [];
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
    panes = 0,
    glassFrom = 0,
    ia = 0,
    ib = 1,
    ic = 2,
  ) => {
    positions.push(...a, ...b, ...c);
    for (const i of [ia, ib, ic]) {
      panels.push(surface, panes, glassFrom);
      uv.push(...textureCorners[i]!);
    }
  };
  const quad = (a: Point, b: Point, c: Point, d: Point, surface = 0, panes = 0, glassFrom = 0) => {
    triangle(a, b, c, surface, panes, glassFrom);
    triangle(a, c, d, surface, panes, glassFrom, 0, 2, 3);
  };

  const { lengthM, heightM } = style.vehicleClasses[recipe.vehicleClass];
  const wheelLength = (recipe.radius * heightM) / lengthM;
  const arch = wheelLength * 1.19;
  // Each axle cuts a shallow arch into the side skirt. The box's front and rear
  // retain a full-width panel for the lamps.
  const stations: [number, number, number, number][] = [
    [-1, 0.45, recipe.belt - 0.03, 0.19],
    ...recipe.axles.flatMap<[number, number, number, number]>((x) => [
      [x - arch, 0.5, recipe.belt, 0.15],
      [x - arch * 0.54, 0.5, recipe.belt, recipe.radius * 2],
      [x + arch * 0.54, 0.5, recipe.belt, recipe.radius * 2],
      [x + arch, 0.5, recipe.belt, 0.15],
    ]),
    [(recipe.axles[1] + arch) * 0.48, 0.48, recipe.hood, 0.15],
    [0, 0.445, recipe.hood - 0.015, 0.19],
  ];
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
      quad(prev[j]!, prev[k]!, next[k]!, next[j]!);
    }
  }
  for (let j = 1; j < 5; j++) {
    const rear = rings[0]!,
      front = rings.at(-1)!;
    triangle(rear[0]!, rear[j + 1]!, rear[j]!, 0);
    triangle(front[0]!, front[j]!, front[j + 1]!, 0);
  }

  for (const cabin of recipe.cabins) {
    const [a, b] = cabin.base,
      [c, d] = cabin.roof;
    // Sink the cabin into the shoulder so its window sill follows the trim line.
    const sill = Math.min(recipe.hood, recipe.belt) - 0.025;
    const { height, panes, topWidth, width } = cabin;
    const l: Point = [a, sill, -width],
      r: Point = [a, sill, width];
    const f: Point = [b, sill, -width],
      g: Point = [b, sill, width];
    const L: Point = [c, height, -topWidth],
      R: Point = [c, height, topWidth];
    const F: Point = [d, height, -topWidth],
      G: Point = [d, height, topWidth];
    quad(f, l, L, F, 0, panes, cabin.sideGlassFrom ? -cabin.sideGlassFrom : 0);
    quad(r, g, G, R, 0, panes, cabin.sideGlassFrom);
    quad(l, r, R, L, 0, Number(panes > 0 && !cabin.sideGlassFrom));
    quad(g, f, F, G, 0, Number(panes > 0));
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
        quad(b, a, point(i, 1, 0.33), point(j, 1, 0.33), 1);
        quad(d, c, a, b, 1);
        triangle([x, recipe.radius, side * 0.5], c, d, 2);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.name = vehicleModelNames[index]!;
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('panel', new Float32BufferAttribute(panels, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function vehicleModelMaterial(lights?: { value: number }) {
  const material = new MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.vehicleLights = lights ?? { value: 0 };
    shader.vertexShader =
      'attribute vec3 panel; varying vec3 vPanel; varying vec2 vSurfaceUv; varying vec3 vBody; varying vec3 vBodyNormal;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvPanel = panel; vSurfaceUv = uv; vBody = position; vBodyNormal = normal;',
      );
    shader.fragmentShader =
      'uniform float vehicleLights; varying vec3 vPanel; varying vec2 vSurfaceUv; varying vec3 vBody; varying vec3 vBodyNormal;\n' +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float along = vPanel.z < 0.0 ? 1.0 - vSurfaceUv.x : vSurfaceUv.x;
          float from = abs(vPanel.z);
          float panes = floor(vPanel.y + 0.5);
          float pane = fract(((along - from) / (1.0 - from)) * panes);
          float glass = step(0.5, panes) * step(from, along) * step(0.05, pane)
            * step(pane, 0.95) * step(0.32, vSurfaceUv.y) * step(vSurfaceUv.y, 0.92);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.026, 0.044, 0.056), glass);
          if (vPanel.x > 0.5) {
            float hub = step(1.5, vPanel.x) * (1.0 - vSurfaceUv.x);
            diffuseColor.rgb = mix(vec3(0.016), vec3(0.23, 0.25, 0.27), step(0.28, hub));
          }
          float across = abs(vBody.z);
          float bumper = step(0.24, vBody.y) * step(vBody.y, 0.41);
          float head = step(-0.005, vBody.x) * step(0.5, vBodyNormal.x)
            * step(0.23, across) * step(across, 0.43) * bumper;
          float tail = step(vBody.x, -0.995) * step(0.5, -vBodyNormal.x)
            * step(0.29, across) * step(across, 0.43) * bumper;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.77, 0.8), head);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.49, 0.027, 0.019), tail);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += vehicleLights
            * (head * vec3(1.6, 1.5, 1.3) + tail * vec3(1.4, 0.06, 0.04));`,
        );
  };
  return material;
}
