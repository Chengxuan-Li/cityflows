import { Graphics } from 'pixi.js';
import type { Box } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { AirsideGraph } from '../../network/airside';
import { aircraftTypes, type AircraftType } from '../../schema/aircraft';
import { fixedWingGearStations } from '../../sim/aircraft-motion';
import { buildAircraftOutline, type AircraftOutlinePart } from '../aircraft-outline';
import { pushbackDrawbarM } from '../aircraft-pose';
import { bridgeSize, cabBack, type JetBridgeStates } from '../apron';
import { style } from '../style';
import type { AircraftPose, Pick } from '../types';

// TASK-298: aircraft from above with TASK-307's outlines, over the map. In 2D they are drawn up
// to the map's edge (approaches and climbs continue beyond it in 3D); one off the ground casts
// a shadow displaced by its height, so a climb or a descent reads in plan.

const outlines = new Map<string, AircraftOutlinePart[]>();
const typeOf = (id: string): AircraftType => aircraftTypes.find((t) => t.id === id)!;
function outline(typeId: string) {
  let parts = outlines.get(typeId);
  if (!parts) outlines.set(typeId, (parts = buildAircraftOutline(typeOf(typeId))));
  return parts;
}

/** Local metres (+x forward, +y starboard) to the map frame (x east, y south). */
function place(pose: AircraftPose, offset: Vec2 = { x: 0, y: 0 }) {
  const c = Math.cos(pose.heading),
    s = Math.sin(pose.heading);
  return (p: Vec2) => ({
    x: pose.x + offset.x + p.x * c - p.y * s,
    y: pose.y + offset.y + p.x * s + p.y * c,
  });
}

const inside = (bounds: Box | null, p: AircraftPose) =>
  !bounds || (p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY);

/** TASK-315: jet bridges from above at `timeS`: rotunda, any fixed link, the tunnels and the
 * cab, under the aircraft. */
function drawJetBridges(g: Graphics, states: JetBridgeStates, timeS: number) {
  const { bridge: fill, edge } = style.apron;
  const bar = (from: Vec2, to: Vec2, width: number) => {
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * (width / 2),
      ny = (dx / length) * (width / 2);
    g.poly([
      { x: from.x + nx, y: from.y + ny },
      { x: to.x + nx, y: to.y + ny },
      { x: to.x - nx, y: to.y - ny },
      { x: from.x - nx, y: from.y - ny },
    ])
      .fill(fill)
      .stroke({ width: 0.25, color: edge });
  };
  for (const [i, bridge] of states.bridges.entries()) {
    const pose = states.poseAt(i, timeS);
    if (bridge.link) bar(bridge.link, bridge.rotunda, 3);
    bar(bridge.rotunda, cabBack(pose), 3);
    const c = Math.cos(pose.facing),
      s = Math.sin(pose.facing);
    const half = bridgeSize.cabDepthM / 2;
    bar(
      { x: pose.cab.x - c * half, y: pose.cab.y - s * half },
      { x: pose.cab.x + c * half, y: pose.cab.y + s * half },
      bridgeSize.cabWidthM,
    );
    g.circle(bridge.rotunda.x, bridge.rotunda.y, bridgeSize.rotundaRadiusM)
      .fill(fill)
      .stroke({ width: 0.25, color: edge });
  }
}

export function drawAircraft(
  g: Graphics,
  aircraft: readonly AircraftPose[],
  bounds: Box | null,
  selected: number | null,
  graph: AirsideGraph | undefined,
  bridges?: { states: JetBridgeStates; timeS: number },
) {
  g.clear();
  if (bridges) drawJetBridges(g, bridges.states, bridges.timeS);
  const shown = aircraft.filter((p) => inside(bounds, p));
  for (const pose of shown) {
    if (pose.heightM < 0.5) continue;
    // A sun from the south-west: shadows fall to the north-east, a fifth of the height away.
    const at = place(pose, { x: 0.15 * pose.heightM, y: -0.12 * pose.heightM });
    for (const part of outline(pose.typeId))
      if ('points' in part) g.poly(part.points.map(at)).fill({ color: style.shadow, alpha: 0.18 });
  }
  const selectedPose = shown.find((p) => p.id === selected);
  if (selectedPose && graph)
    for (const e of selectedPose.route)
      g.poly(graph.edges[e]!.line, false).stroke({ width: 3, color: style.route, alpha: 0.7 });
  for (const pose of shown) {
    const at = place(pose);
    const colors = style.aircraft;
    const type = typeOf(pose.typeId);
    if (pose.state === 'pushback') {
      const { noseX } = fixedWingGearStations(type.lengthM);
      const nose = at({ x: noseX, y: 0 });
      const tugAt = place({
        ...pose,
        ...nose,
        heading: pose.heading + (pose.visual?.steering ?? 0),
      });
      const drawbar = pushbackDrawbarM(type.lengthM);
      g.poly([nose, tugAt({ x: drawbar, y: 0 })], false).stroke({
        width: 0.22,
        color: colors.edge,
      });
      g.poly([
        tugAt({ x: drawbar, y: -1.1 }),
        tugAt({ x: drawbar + 3.2, y: -1.1 }),
        tugAt({ x: drawbar + 3.2, y: 1.1 }),
        tugAt({ x: drawbar, y: 1.1 }),
      ])
        .fill(colors.fuselage)
        .stroke({ width: 0.25, color: colors.edge });
    }
    for (const part of outline(pose.typeId)) {
      if ('points' in part) {
        g.poly(part.points.map(at))
          .fill(colors[part.kind])
          .stroke({ width: 0.25, color: colors.edge });
      } else if (pose.enginesRunning) {
        g.circle(at(part.center).x, at(part.center).y, part.radiusM).fill({
          color: colors.disc,
          alpha: 0.25,
        });
      }
    }
    if (pose.id === selected) {
      const { lengthM, spanM } = type;
      g.circle(pose.x, pose.y, Math.max(lengthM, spanM) / 2 + 3).stroke({
        width: 1.5,
        color: style.selection,
      });
    }
  }
}

/** The aircraft whose plan rectangle (length by span, within the map) holds the point. */
export function pickAircraft(
  aircraft: readonly AircraftPose[],
  point: Vec2,
  bounds: Box | null,
): Pick | null {
  for (const pose of aircraft) {
    if (!inside(bounds, pose)) continue;
    const { lengthM, spanM } = typeOf(pose.typeId);
    const dx = point.x - pose.x,
      dy = point.y - pose.y;
    const c = Math.cos(pose.heading),
      s = Math.sin(pose.heading);
    const along = dx * c + dy * s,
      across = -dx * s + dy * c;
    const nearBody =
      Math.abs(along) < lengthM / 2 && Math.abs(across) < Math.max(3, lengthM * 0.06);
    const nearWing = Math.abs(along) < lengthM * 0.12 && Math.abs(across) < spanM / 2;
    if (nearBody || nearWing) return { kind: 'aircraft', id: pose.id };
  }
  return null;
}
