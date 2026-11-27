import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { pointInPolygon } from '../../../src/geo/polyline';
import type { City } from '../../../src/schema';
import type { SceneInternals, Site } from '../../layers';
import type { PlantingRun } from '../../layers/undergrowth';
import {
  dockDressing,
  inFactoryYard,
  inStaffFrontage,
  outsideStaffBeds,
  onYardPavement,
  longStayLampPools,
  staffFrontagePose,
  staffPlanting,
} from './dockyard';

// Capture location: King George V DLR station and London City Airport. What only this place has:
// the station's canopy and roundels, ExCeL's roof masts, the staff car park's dockyard dressing
// (./dockyard.ts), Hartmann Road's verges, the bend planting where the DLR rises, and the airside
// the plants keep off. The generic layers take the rest from the shot file.

type Vec2 = { x: number; y: number };

/** The staff car park becomes a dock yard when the app's vehicle models are there to fill it. */
const dockyard = ({ city, scene }: Parameters<NonNullable<Site['install']>>[0]) => {
  const staff = city.parking?.['pk:3102']?.shape;
  return staff?.kind === 'polygon' && scene.vehicles?.modelGeometries ? staff.ring : undefined;
};

/** The apron, grass strips and runway on the airside of Hartmann Road, in the runway's frame
 * from its first threshold. The wider airport boundary also encloses the car park and verges. */
function airside(city: City) {
  const threshold = Object.values(city.airport?.runways ?? {})[0]?.ends[0];
  return (p: Vec2) => {
    if (!threshold) return false;
    const dx = p.x - threshold.pos.x,
      dy = p.y - threshold.pos.y;
    const k = Math.cos(threshold.heading),
      s = Math.sin(threshold.heading);
    const u = k * dx + s * dy,
      v = k * dy - s * dx;
    return u > -305 && u < 1645 && v > -84 && v < 209;
  };
}

function roundelTexture(text: string) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 768 });
  const g = canvas.getContext('2d')!;
  const cx = 512,
    cy = 384;
  g.lineWidth = 110;
  g.strokeStyle = '#00a4a7';
  g.beginPath();
  g.arc(cx, cy, 255, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#10069f';
  const barH = 150,
    barW = 900;
  g.fillRect(cx - barW / 2, cy - barH / 2, barW, barH);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 104;
  do g.font = `600 ${size--}px Arimo, Arial, sans-serif`;
  while (g.measureText(text).width > barW - 70);
  g.fillText(text, cx, cy + 6);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
function surfaceY(internals: SceneInternals, p: Vec2, below: number) {
  const ray = new Raycaster(new Vector3(p.x, 60, p.y), new Vector3(0, -1, 0));
  const hits = ray
    .intersectObject(internals.content, true)
    .filter((h) => h.point.y < below && (h.object as Mesh).isMesh);
  return hits[0]?.point.y ?? 0;
}
function detailStation(internals: SceneInternals, city: City) {
  const group = new Group();
  group.name = 'capture-station';
  const points = Object.values(city.rail?.platforms ?? {}).flatMap((p) =>
    p.station === 'p:2670' && p.shape.kind === 'polygon' ? p.shape.ring : [],
  );
  if (points.length < 4) return { group, dispose: () => {} };
  // The island platform's centre line, from its west end to its east end.
  const west = points.filter((p) => p.x < 560),
    east = points.filter((p) => p.x > 600);
  const mean = (ps: Vec2[]) => ({
    x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
    y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
  });
  const a = mean(west),
    b = mean(east);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
    n = { x: -d.y, y: d.x };
  const width = Math.min(
    ...[west, east].map((ps) => {
      const across = ps.map((p) => (p.x - a.x) * n.x + (p.y - a.y) * n.y);
      return Math.max(...across) - Math.min(...across);
    }),
  );
  const at = (s: number, across = 0) => ({
    x: a.x + d.x * s + n.x * across,
    y: a.y + d.y * s + n.y * across,
  });
  const heading = Math.atan2(-d.y, d.x);
  const deck = surfaceY(internals, at(length * 0.5, 0), 2.2);
  // Canopy: a shallow gabled roof over the middle of the platform on one row of columns.
  const s0 = 9,
    s1 = length - 14,
    roofY = deck + 3.7,
    roofW = width - 0.6;
  const metal = new MeshLambertMaterial({ color: 0xe1e5e7 });
  const steel = new MeshLambertMaterial({ color: 0x8e979c });
  const roofLength = s1 - s0;
  const mid = at((s0 + s1) / 2);
  for (const side of [-1, 1]) {
    const slab = new Mesh(new BoxGeometry(roofLength, 0.16, roofW / 2 + 0.05), metal);
    slab.position.set(
      mid.x + n.x * side * roofW * 0.25,
      roofY + 0.12,
      mid.y + n.y * side * roofW * 0.25,
    );
    slab.rotation.order = 'YXZ';
    slab.rotation.y = heading;
    slab.rotation.x = side * 0.07;
    group.add(slab);
    const fascia = new Mesh(new BoxGeometry(roofLength, 0.32, 0.08), steel);
    const edge = at((s0 + s1) / 2, side * (roofW / 2 + 0.02));
    fascia.position.set(edge.x, roofY - 0.02, edge.y);
    fascia.rotation.y = heading;
    group.add(fascia);
  }
  const spine = new Mesh(new BoxGeometry(roofLength, 0.4, 0.3), steel);
  spine.position.set(mid.x, roofY - 0.1, mid.y);
  spine.rotation.y = heading;
  group.add(spine);
  for (let s = s0 + 2; s <= s1 - 2; s += 7.5) {
    const p = at(s);
    const column = new Mesh(new CylinderGeometry(0.12, 0.14, roofY - deck, 10), steel);
    column.position.set(p.x, (roofY + deck) / 2, p.y);
    group.add(column);
    for (const side of [-1, 1]) {
      const arm = new Mesh(new BoxGeometry(0.1, 0.12, roofW / 2), steel);
      const q = at(s, (side * roofW) / 4);
      arm.position.set(q.x, roofY - 0.18, q.y);
      arm.rotation.y = heading;
      group.add(arm);
    }
  }
  // Roundels: on posts along both platform edges, facing the trains, and on the canopy's ends.
  const named = roundelTexture('King George V'),
    plain = roundelTexture('DLR');
  const sign = (texture: CanvasTexture, wide: number) => {
    const face = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.4,
      side: DoubleSide,
    });
    face.userData.lit = false;
    const board = new Mesh(new PlaneGeometry(wide, wide * 0.75), face);
    return board;
  };
  for (const s of [14, 34, 54, 74]) {
    if (s > length - 4) continue;
    for (const side of [-1, 1]) {
      const p = at(s, side * (width / 2 - 0.9));
      const board = sign(named, 1.5);
      board.position.set(p.x, deck + 2.35, p.y);
      // Face across the track; the double-sided face reads backwards from behind, so a second
      // board faces the other way.
      board.rotation.y = heading + (side > 0 ? 0 : Math.PI);
      group.add(board);
      const back = board.clone();
      back.rotation.y += Math.PI;
      back.position.add(new Vector3(-n.x * side * 0.02, 0, -n.y * side * 0.02));
      group.add(back);
      for (const off of [-0.45, 0.45]) {
        const q = at(s + off, side * (width / 2 - 0.9));
        const post = new Mesh(new CylinderGeometry(0.04, 0.04, 1.85, 6), steel);
        post.position.set(q.x, deck + 0.925, q.y);
        group.add(post);
      }
    }
  }
  for (const [s, turn] of [
    [s0 - 0.06, -Math.PI / 2],
    [s1 + 0.06, Math.PI / 2],
  ] as const) {
    const p = at(s);
    const board = sign(plain, 2.2);
    board.position.set(p.x, roofY - 0.9, p.y);
    board.rotation.y = heading + turn;
    group.add(board);
  }
  internals.content.add(group);
  return {
    group,
    dispose: () => {
      group.removeFromParent();
      group.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      named.dispose();
      plain.dispose();
    },
  };
}
/** ExCeL's halls (`conference_centre`, from ./dress.ts): along both long sides of each
 * roof, white masts every 36 m rising 22 m above it, each stayed by cables to the roof. */
export function excelMasts(
  features: { kind: string; class?: string; sub?: string; rings?: Vec2[][]; heightM?: number }[],
) {
  const group = new Group();
  const white = new MeshLambertMaterial({ color: 0xf1f1ee });
  const lines: number[] = [];
  for (const f of features) {
    if (f.kind !== 'area' || f.class !== 'building' || f.sub !== 'conference_centre') continue;
    const ring = f.rings![0]!;
    // The footprint's long axis from its smallest box.
    let best = { area: Infinity, u: { x: 1, y: 0 }, u0: 0, u1: 0, v0: 0, v1: 0 };
    for (let i = 1; i < ring.length; i++) {
      const dx = ring[i]!.x - ring[i - 1]!.x,
        dy = ring[i]!.y - ring[i - 1]!.y;
      const l = Math.hypot(dx, dy);
      if (l < 1) continue;
      const u = { x: dx / l, y: dy / l };
      let u0 = Infinity,
        u1 = -Infinity,
        v0 = Infinity,
        v1 = -Infinity;
      for (const p of ring) {
        const a = p.x * u.x + p.y * u.y,
          b = -p.x * u.y + p.y * u.x;
        u0 = Math.min(u0, a);
        u1 = Math.max(u1, a);
        v0 = Math.min(v0, b);
        v1 = Math.max(v1, b);
      }
      const area = (u1 - u0) * (v1 - v0);
      if (area < best.area) best = { area, u, u0, u1, v0, v1 };
    }
    let { u, u0, u1, v0, v1 } = best;
    if (v1 - v0 > u1 - u0) {
      u = { x: -u.y, y: u.x };
      [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
    }
    const at = (a: number, b: number) => ({ x: u.x * a - u.y * b, y: u.y * a + u.x * b });
    const roof = (f.heightM ?? 24) + 2;
    const width = v1 - v0;
    for (let a = u0 + 20; a <= u1 - 20; a += 36)
      for (const b of [v0 + width * 0.22, v1 - width * 0.22]) {
        const p = at(a, b);
        if (!pointInPolygon(p, ring)) continue;
        const mast = new Mesh(new CylinderGeometry(0.35, 0.6, 22, 8), white);
        mast.position.set(p.x, roof + 11, p.y);
        mast.castShadow = true;
        group.add(mast);
        const top = [p.x, roof + 22, p.y];
        for (const [da, db] of [
          [-14, 0],
          [14, 0],
          [0, -width * 0.18],
          [0, width * 0.18],
        ] as const) {
          const q = at(a + da, b + db);
          lines.push(...top, q.x, roof - 1, q.y);
        }
      }
  }
  const cables = new LineSegments(
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(lines, 3)),
    new LineBasicMaterial({ color: 0xd8dad8 }),
  );
  cables.material.userData.lit = false;
  group.add(cables);
  return group;
}

// ---- glazed towers
/** The airport terminal's curtain wall (`terminalGlazing` in src/render3d/apron.ts: its glass
 * colour, panes a storey high between floor slabs, mullions about every 2.2 m with the wall
 * showing between, a warm glow after dark) as a mipmapped texture, so towers kilometres off
 * filter to their mix of glass and frame instead of aliasing pane by pane. 16 x 16 panes a tile;
 * after dark about half of them are lit, office by office. */

/** Hartmann Road's near verges and the long-stay car park's frontage planting. */
export function dockVergeRuns(
  streets: readonly { name?: string | null; centerline: Vec2[] }[],
  longStay: Vec2[] | undefined,
): PlantingRun[] {
  const runs: PlantingRun[] = [];
  for (const { name, centerline: line } of streets) {
    if (name !== 'Hartmann Road' || line[0]!.x >= line.at(-1)!.x) continue;
    // The two near verges run beyond the fence. The western section skirts the
    // forecourt beyond the main car park; the eastern one ends at the staff beds.
    for (const [lo, hi, offset, width] of [
      [-273, -61, 5.2, 2.7],
      [304, 391, 5.5, 2.85],
    ] as const) {
      const local: Vec2[] = [];
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1]!,
          b = line[i]!;
        if (b.x <= lo || a.x >= hi || b.x - a.x < 0.001) continue;
        const from = Math.max(a.x, lo),
          to = Math.min(b.x, hi);
        const at = (x: number) => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
        if (!local.length) local.push(at(from));
        local.push(at(to));
      }
      if (local.length > 1) runs.push({ line: local, side: -1, offset, width, height: 1.89 });
    }
  }

  if (longStay?.length) {
    const signed = longStay.reduce((sum, a, i) => {
      const b = longStay[(i + 1) % longStay.length]!;
      return sum + a.x * b.y - a.y * b.x;
    }, 0);
    const side = signed > 0 ? -1 : 1;
    for (let i = 0; i < longStay.length; i++) {
      const a = longStay[i]!,
        b = longStay[(i + 1) % longStay.length]!;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        span = Math.hypot(dx, dy);
      // The long Hartmann Road frontage and the short station-facing end.
      const frontage = (a.y + b.y) * 0.5 > 170 && (dx * side) / span > 0.69;
      const stationEnd = a.x > 246 && b.x > 246 && (-dy * side) / span > 0.54;
      const farEnd = a.x < -38 && b.x < -38 && (-dy * side) / span < -0.65;
      if (span < 6 || !(frontage || stationEnd || farEnd)) continue;
      runs.push({
        line: [a, b],
        side,
        offset: farEnd ? 1.45 : 1.67,
        width: farEnd ? 1.78 : 2.6,
        height: farEnd ? 1.66 : 2.22,
      });
    }
  }
  return runs;
}

export const site: Site = {
  paved: (ctx) => (dockyard(ctx) ? onYardPavement : undefined),
  frontage: (ctx) => (dockyard(ctx) ? staffFrontagePose : undefined),
  plants: (ctx) => {
    const { city, scene } = ctx;
    const dock = !!dockyard(ctx);
    const longStay = city.parking?.['pk:3224']?.shape;
    // The DLR's bridge tracks where it rises west of the station, planted both sides.
    const bends = (scene.city?.rail?.tracks ?? []).filter(
      (t) =>
        t.name === 'Docklands Light Railway' &&
        scene.rail?.heights.grades[t.idx] === 'bridge' &&
        t.line.some((p) => p.x > -314 && p.x < -197 && p.y > 131 && p.y < 205),
    );
    const outside = airside(city);
    return {
      runs: [
        ...dockVergeRuns(
          Object.values(city.roads),
          longStay?.kind === 'polygon' ? longStay.ring : undefined,
        ),
        ...(dock ? staffPlanting : []),
        ...bends.flatMap(({ line }) =>
          [-1, 1].map((side) => ({ line, side, offset: 5.1, width: 2.2, height: 1.75 })),
        ),
      ],
      lamps: dock ? longStayLampPools : [],
      blocked: (p) => outside(p) || (dock && (inFactoryYard(p) || outsideStaffBeds(p))),
      hidden: dock ? inStaffFrontage : undefined,
    };
  },
  install: (ctx) => {
    const { scene, city } = ctx;
    const undo: (() => void)[] = [detailStation(scene, city).dispose];
    const staff = dockyard(ctx);
    if (staff) {
      const dock = dockDressing(
        staff,
        scene.buildings,
        scene.vehicles!.modelGeometries!,
        scene.city?.parkingSpaces ?? [],
        () => scene.light.artificial,
      );
      scene.content.add(dock.group);
      undo.push(dock.dispose);
    }
    const masts = excelMasts(city.context?.features ?? []);
    scene.content.add(masts);
    undo.push(() => masts.removeFromParent());
    return () => undo.reverse().forEach((u) => u());
  },
};
