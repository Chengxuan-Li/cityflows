import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { cumulativeLengths, parallelOffset } from '../geo/polyline';
import type { CompiledCity } from '../network';
import {
  themedSignLabels,
  type SignRule,
  type AccessSign,
  type Curb,
  type placeStreet,
} from '../render/street';
import { lampColors } from '../render/lighting';
import { roadSurfaceAt, type cityHeights } from './heights';

// Bound both final 3D edges against each replacement chord; keep every gap run separate.
function curbStations(a: number[][], b: number[][]) {
  const distanceSq = (p: number[], from: number[], to: number[]) => {
    // 1 cm in plan, 1 mm vertically.
    const dx = (to[0]! - from[0]!) * 100;
    const dy = (to[1]! - from[1]!) * 1000;
    const dz = (to[2]! - from[2]!) * 100;
    const px = (p[0]! - from[0]!) * 100;
    const py = (p[1]! - from[1]!) * 1000;
    const pz = (p[2]! - from[2]!) * 100;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    const t = lengthSq ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / lengthSq)) : 0;
    return (px - t * dx) ** 2 + (py - t * dy) ** 2 + (pz - t * dz) ** 2;
  };
  const kept = new Set([0, a.length - 1]),
    spans = [[0, a.length - 1]];
  while (spans.length) {
    const [from, to] = spans.pop()!;
    let worst = 1,
      at = -1;
    for (let i = from! + 1; i < to!; i++) {
      const error = Math.max(
        distanceSq(a[i]!, a[from!]!, a[to!]!),
        distanceSq(b[i]!, b[from!]!, b[to!]!),
      );
      if (error > worst) {
        worst = error;
        at = i;
      }
    }
    if (at !== -1) {
      kept.add(at);
      spans.push([from!, at], [at, to!]);
    }
  }
  return [...kept].sort((a, b) => a - b);
}

/** A 20cm strip with a 12cm top and vertical faces, sampled along the shared broken edge. */
export function buildCurbs(
  curbs: readonly Curb[],
  city: CompiledCity,
  heights: ReturnType<typeof cityHeights>,
) {
  const positions: number[] = [];
  for (const curb of curbs) {
    const half = curb.halfWidthM ?? 0.1;
    const a = parallelOffset(curb.points, -half),
      b = parallelOffset(curb.points, half);
    if (!a.length || !b.length) continue;
    const road = city.roads[curb.road]!,
      profile = heights.roads[curb.road]!;
    const vertex = (p: { x: number; y: number }, up: number) => [
      p.x,
      roadSurfaceAt(road, profile, p) + up,
      p.y,
    ];
    const quad = (p: number[], q: number[], r: number[], s: number[]) =>
      positions.push(...p, ...q, ...r, ...p, ...r, ...s);
    const left = a.map((p) => vertex(p, 0)),
      right = b.map((p) => vertex(p, 0));
    const top = (p: number[]) => [p[0]!, p[1]! + 0.12, p[2]!];
    // Keep the original strip wherever each left station has a matching right vertex.
    if (left.length <= right.length) {
      const stations = curbStations(left, right);
      for (let i = 1; i < stations.length; i++) {
        const before = stations[i - 1]!,
          after = stations[i]!;
        const p = left[before]!,
          q = left[after]!,
          r = right[after]!,
          s = right[before]!;
        quad(top(p), top(s), top(r), top(q));
        quad(p, top(p), top(q), q);
        quad(r, top(r), top(s), s);
      }
    } else {
      // Pruning can leave the inner side of a tight bend with fewer corners. Triangulate
      // between the sides in distance order while keeping every surviving edge vertex.
      const alongA = cumulativeLengths(a),
        alongB = cumulativeLengths(b);
      const endA = alongA.at(-1)! || 1,
        endB = alongB.at(-1)! || 1;
      let i = 0,
        j = 0;
      while (i + 1 < left.length || j + 1 < right.length) {
        const p = left[i]!,
          s = right[j]!;
        const nextA = (alongA[i + 1] ?? Infinity) / endA;
        const nextB = (alongB[j + 1] ?? Infinity) / endB;
        if (nextA <= nextB) {
          const q = left[++i]!;
          positions.push(...top(p), ...top(s), ...top(q));
          quad(p, top(p), top(q), q);
        } else {
          const r = right[++j]!;
          positions.push(...top(p), ...top(s), ...top(r));
          quad(r, top(r), top(s), s);
        }
      }
    }
    quad(left[0]!, right[0]!, top(right[0]!), top(left[0]!));
    const p = left.at(-1)!,
      q = right[Math.min(left.length, right.length) - 1]!;
    quad(p, top(p), top(q), q);
  }
  const geometry = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  const indexed = mergeVertices(geometry);
  geometry.dispose();
  return indexed;
}

export function signHeight(
  sign: AccessSign,
  city: CompiledCity,
  heights: ReturnType<typeof cityHeights>,
) {
  return roadSurfaceAt(city.roads[sign.road]!, heights.roads[sign.road]!, sign.pos);
}

function signTexture(rules: readonly SignRule[], theme: ReturnType<typeof placeStreet>['theme']) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext('2d')!;
  const no = rules.includes('no');
  const plateOnly = theme === 'us' && !no;
  if (theme === 'us' && no) {
    ctx.fillStyle = '#fffcf3';
    ctx.fillRect(30, 5, 196, 196);
  }
  ctx.fillStyle = '#c64e45';
  if (!plateOnly) {
    ctx.beginPath();
    ctx.arc(128, 103, 98, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fffcf3';
  if (no) ctx.fillRect(60, 84, 136, 38);
  else if (!plateOnly) {
    ctx.beginPath();
    ctx.arc(128, 103, 75, 0, Math.PI * 2);
    ctx.fill();
  }
  if (theme === 'us' && no) {
    ctx.font = 'bold 30px Arimo, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('DO NOT', 128, 66);
    ctx.fillText('ENTER', 128, 154);
  }
  if (theme === 'uk' && !no) {
    ctx.fillStyle = '#344843';
    ctx.strokeStyle = '#344843';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(91, 88, 12, 0, Math.PI * 2);
    ctx.arc(163, 88, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(91, 88);
    ctx.lineTo(121, 60);
    ctx.lineTo(163, 88);
    ctx.moveTo(115, 60);
    ctx.lineTo(140, 60);
    ctx.stroke();
    ctx.fillRect(86, 121, 84, 29);
    ctx.fillRect(101, 105, 54, 21);
  }
  const labels = rules.filter((r) => r !== 'no').map((r) => themedSignLabels[theme][r]);
  if (labels.length) {
    ctx.fillStyle = '#fffcf3';
    ctx.fillRect(3, 220, 250, 154);
    ctx.strokeStyle = '#64726d';
    ctx.lineWidth = 3;
    ctx.strokeRect(5, 222, 246, 150);
    ctx.fillStyle = '#283b35';

    ctx.textAlign = 'center';
    const words = labels.flatMap((label) =>
      label === 'Lieferverkehr frei' ? ['Lieferverkehr', 'frei'] : [label],
    );
    const size = Math.min(40, 120 / words.length),
      line = size * 1.15;
    ctx.font = `bold ${size}px Arimo, Arial`;
    const first = 297 - ((words.length - 1) * line) / 2 + size * 0.35;
    words.forEach((label, i) => ctx.fillText(label, 128, first + i * line, 235));
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function buildStreet(
  street: ReturnType<typeof placeStreet>,
  city: CompiledCity,
  heights: ReturnType<typeof cityHeights>,
) {
  const group = new Group(),
    lamps = new Group(),
    signs = new Group();
  const transform = new Object3D();
  const material = new MeshLambertMaterial({ color: 0x64726d });
  const poles = new InstancedMesh(new BoxGeometry(0.13, 1, 0.13), material, street.lamps.length);
  // TASK-163: the head's emissive intensity is the scene's artificial light (0 by day).
  const heads = new InstancedMesh(
    new BoxGeometry(0.85, 0.16, 0.32).translate(0.35, 0, 0),
    new MeshLambertMaterial({ color: 0xe7dcc0, emissive: lampColors.street, emissiveIntensity: 0 }),
    street.lamps.length,
  );
  const light: { base: number }[] = [];
  street.lamps.forEach((lamp, i) => {
    const base =
      lamp.road === undefined
        ? heights.terrain.surfaceAt(lamp.pos.x, lamp.pos.y)
        : roadSurfaceAt(city.roads[lamp.road]!, heights.roads[lamp.road]!, lamp.pos);
    transform.position.set(lamp.pos.x, base + lamp.heightM / 2, lamp.pos.y);
    transform.rotation.set(0, -lamp.heading, 0);
    transform.scale.set(1, lamp.heightM, 1);
    transform.updateMatrix();
    poles.setMatrixAt(i, transform.matrix);
    transform.position.y = base + lamp.heightM;
    transform.scale.setScalar(1);
    transform.updateMatrix();
    heads.setMatrixAt(i, transform.matrix);
    light.push({ base });
  });
  lamps.add(poles, heads);
  /** Where each lamp's light falls: a pool on the road beside it and a halo at its head. */
  const lampLights = street.lamps.map((lamp, i) => {
    // Generated heads reach over the road; mapped lamps carry no heading, so their pool centres
    // on the post.
    const reach = lamp.source === 'generated' ? 1 : 0;
    const c = Math.cos(lamp.heading) * reach,
      s = Math.sin(lamp.heading) * reach;
    return {
      pool: {
        x: lamp.pos.x + 2.5 * c,
        y: lamp.pos.y + 2.5 * s,
        z: light[i]!.base + 0.05,
        radiusM: Math.max(7, lamp.heightM * 1.3),
        color: lampColors.street,
      },
      halo: {
        x: lamp.pos.x + 0.6 * c,
        y: lamp.pos.y + 0.6 * s,
        z: light[i]!.base + lamp.heightM - 0.15,
        radiusM: 1.3,
        color: lampColors.street,
      },
    };
  });
  const posts = new InstancedMesh(
    new BoxGeometry(0.07, 2.8, 0.07),
    material.clone(),
    street.signs.length,
  );
  const faces = new Map<string, typeof street.signs>();
  street.signs.forEach((sign, i) => {
    const base = signHeight(sign, city, heights);
    transform.position.set(sign.pos.x, base + 1.4, sign.pos.y);
    transform.rotation.set(0, 0, 0);
    transform.updateMatrix();
    posts.setMatrixAt(i, transform.matrix);
    const key = sign.rules.join('|');
    if (!faces.has(key)) faces.set(key, []);
    faces.get(key)!.push(sign);
  });
  signs.add(posts);
  for (const entries of faces.values()) {
    const faces = new InstancedMesh(
      new PlaneGeometry(1.25, 1.875).translate(0, 0, 0.06),
      new MeshBasicMaterial({
        map: signTexture(entries[0]!.rules, street.theme),
        transparent: true,
        alphaTest: 0.1,
        side: DoubleSide,
      }),
      entries.length,
    );
    entries.forEach((sign, i) => {
      const base = signHeight(sign, city, heights);
      transform.position.set(sign.pos.x, base + 2.5, sign.pos.y);
      transform.rotation.set(0, -sign.heading - Math.PI / 2, 0);
      transform.updateMatrix();
      faces.setMatrixAt(i, transform.matrix);
    });
    signs.add(faces);
  }
  const curbs = new Mesh(
    buildCurbs(street.curbs, city, heights),
    new MeshLambertMaterial({ color: 0xc9c9bb }),
  );
  group.add(lamps, signs, curbs);
  return { group, lamps, heads, signs, curbs, lampLights };
}
