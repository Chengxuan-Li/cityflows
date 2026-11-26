import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { Box } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { AirsideGraph } from '../../network/airside';
import { aircraftTypes, type AircraftType } from '../../schema/aircraft';
import { fixedWingGearStations } from '../../sim/aircraft-motion';
import { buildAircraftOutline, type AircraftOutlinePart } from '../aircraft-outline';
import { pushbackDrawbarM } from '../aircraft-pose';
import {
  bridgeSize,
  cabBack,
  type BridgePose,
  type JetBridge,
  type JetBridgeStates,
} from '../apron';
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

/** TASK-315: one jet bridge from above in pose: rotunda, any fixed link, the tunnels and the
 * cab. */
function drawJetBridge(g: Graphics, bridge: JetBridge, pose: BridgePose) {
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
  if (bridge.link)
    for (let j = 1; j < bridge.link.length; j++) bar(bridge.link[j - 1]!, bridge.link[j]!, 3);
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

/** Graphics kept in a container and reused in order: `next` hands out the next one. */
export class GraphicsPool {
  readonly container = new Container();
  private used = 0;
  next() {
    let g = this.container.children[this.used] as Graphics | undefined;
    if (!g) this.container.addChild((g = new Graphics()));
    g.visible = true;
    this.used++;
    return g;
  }
  /** Hides the ones not handed out since the last `finish`. */
  finish() {
    const children = this.container.children;
    for (let i = this.used; i < children.length; i++) children[i]!.visible = false;
    this.used = 0;
  }
}

/** Places a pooled graphic on a shared context at `x`, `y`, turned by `heading`. */
export function placeShared(
  g: Graphics,
  context: GraphicsContext,
  x: number,
  y: number,
  heading: number,
) {
  g.context = context;
  g.position.set(x, y);
  g.rotation = heading;
}

/** TASK-357: aircraft drawn retained. Each type's outline (and shadow) is one shared context in
 * local metres, placed by its graphic's transform, so moving aircraft are not triangulated again
 * every frame; a jet bridge is drawn again only when its pose changes. The paint order is the one
 * immediate drawing had: bridges, shadows, the selected route, then each aircraft's tug, body and
 * selection ring. */
export class Aircraft2D {
  readonly container = new Container();
  private readonly bridges = new Container();
  private readonly shadows = new GraphicsPool();
  private readonly route = new Graphics();
  private readonly bodies = new Container();
  private readonly contexts = new Map<string, GraphicsContext>();
  private bridgeStates: JetBridgeStates | null = null;
  private drawnBridges: (BridgePose | null)[] = [];
  private drawnRoute: readonly number[] | null = null;

  constructor() {
    this.container.addChild(this.bridges, this.shadows.container, this.route, this.bodies);
  }

  private context(key: string, draw: (g: GraphicsContext) => void) {
    let context = this.contexts.get(key);
    if (!context) {
      this.contexts.set(key, (context = new GraphicsContext()));
      draw(context);
    }
    return context;
  }

  private shadowContext(typeId: string) {
    return this.context(`shadow:${typeId}`, (g) => {
      for (const part of outline(typeId))
        if ('points' in part) g.poly(part.points).fill({ color: style.shadow, alpha: 0.18 });
    });
  }

  private bodyContext(typeId: string, enginesRunning: boolean) {
    return this.context(`${typeId}:${enginesRunning}`, (g) => {
      const colors = style.aircraft;
      for (const part of outline(typeId)) {
        if ('points' in part)
          g.poly(part.points).fill(colors[part.kind]).stroke({ width: 0.25, color: colors.edge });
        else if (enginesRunning)
          g.circle(part.center.x, part.center.y, part.radiusM).fill({
            color: colors.disc,
            alpha: 0.25,
          });
      }
    });
  }

  private drawBridges(states: JetBridgeStates | null, timeS: number) {
    if (states !== this.bridgeStates) {
      this.bridgeStates = states;
      for (const child of this.bridges.removeChildren()) child.destroy();
      this.drawnBridges = (states?.bridges ?? []).map(() => {
        this.bridges.addChild(new Graphics());
        return null;
      });
    }
    if (!states) return;
    for (const [i, bridge] of states.bridges.entries()) {
      const pose = states.poseAt(i, timeS),
        drawn = this.drawnBridges[i];
      if (
        drawn &&
        drawn.cab.x === pose.cab.x &&
        drawn.cab.y === pose.cab.y &&
        drawn.facing === pose.facing
      )
        continue;
      this.drawnBridges[i] = pose;
      const g = this.bridges.children[i] as Graphics;
      g.clear();
      drawJetBridge(g, bridge, pose);
    }
  }

  draw(
    aircraft: readonly AircraftPose[],
    bounds: Box | null,
    selected: number | null,
    graph: AirsideGraph | undefined,
    bridges?: { states: JetBridgeStates; timeS: number },
  ) {
    this.drawBridges(bridges?.states ?? null, bridges?.timeS ?? 0);
    const shown = aircraft.filter((p) => inside(bounds, p));
    for (const pose of shown) {
      if (pose.heightM < 0.5) continue;
      // A sun from the south-west: shadows fall to the north-east, a fifth of the height away.
      placeShared(
        this.shadows.next(),
        this.shadowContext(pose.typeId),
        pose.x + 0.15 * pose.heightM,
        pose.y - 0.12 * pose.heightM,
        pose.heading,
      );
    }
    this.shadows.finish();
    const selectedPose = shown.find((p) => p.id === selected);
    const route = selectedPose && graph ? selectedPose.route : null;
    if (route !== this.drawnRoute) {
      this.drawnRoute = route;
      this.route.clear();
      for (const e of route ?? [])
        this.route
          .poly(graph!.edges[e]!.line, false)
          .stroke({ width: 3, color: style.route, alpha: 0.7 });
    }
    const slots = this.bodies.children as Container[];
    for (const [i, pose] of shown.entries()) {
      let slot = slots[i];
      if (!slot) {
        slot = new Container();
        slot.addChild(new Graphics(), new Graphics(), new Graphics());
        this.bodies.addChild(slot);
      }
      slot.visible = true;
      const [tug, body, ring] = slot.children as Graphics[];
      const colors = style.aircraft;
      const type = typeOf(pose.typeId);
      const pushing = pose.state === 'pushback' || pose.state === 'ready-for-pushback';
      tug!.visible = pushing;
      if (pushing) {
        const at = place(pose);
        const { noseX } = fixedWingGearStations(type.lengthM);
        const nose = at({ x: noseX, y: 0 });
        const tugAt = place({
          ...pose,
          ...nose,
          heading: pose.heading + (pose.visual?.steering ?? 0),
        });
        const drawbar = pushbackDrawbarM(type.lengthM);
        tug!.clear();
        tug!.poly([nose, tugAt({ x: drawbar, y: 0 })], false).stroke({
          width: 0.22,
          color: colors.edge,
        });
        tug!
          .poly([
            tugAt({ x: drawbar, y: -1.1 }),
            tugAt({ x: drawbar + 3.2, y: -1.1 }),
            tugAt({ x: drawbar + 3.2, y: 1.1 }),
            tugAt({ x: drawbar, y: 1.1 }),
          ])
          .fill(colors.fuselage)
          .stroke({ width: 0.25, color: colors.edge });
      }
      placeShared(
        body!,
        this.bodyContext(pose.typeId, pose.enginesRunning),
        pose.x,
        pose.y,
        pose.heading,
      );
      ring!.visible = pose.id === selected;
      if (ring!.visible) {
        const { lengthM, spanM } = type;
        ring!.clear();
        ring!.circle(pose.x, pose.y, Math.max(lengthM, spanM) / 2 + 3).stroke({
          width: 1.5,
          color: style.selection,
        });
      }
    }
    for (let i = shown.length; i < slots.length; i++) slots[i]!.visible = false;
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
