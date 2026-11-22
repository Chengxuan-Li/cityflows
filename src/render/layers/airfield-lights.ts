import { Container, Particle, ParticleContainer, type Texture } from 'pixi.js';
import type { Box } from '../../geo/polyline';
import type { AirsideGraph } from '../../network/airside';
import { aircraftTypes } from '../../schema/aircraft';
import type { Airport } from '../../schema/airport';
import {
  aircraftLights,
  airfieldColors,
  airfieldLightColors,
  papiAngles,
  placeAirfieldLights,
  type AirfieldLight,
  type AirfieldLightKind,
} from '../airfield-lights';
import type { AircraftPose, AirfieldState } from '../types';

// TASK-301: the airfield's lights and the aircraft's lights in the 2D evening, as additive glows
// over the map (the same rules and states as in 3D; in 2D the beacon and strobes show steadily).

const radiusM: Record<AirfieldLightKind, number> = {
  'runway-edge': 2.6,
  'runway-centreline': 2,
  threshold: 2.6,
  'runway-end': 2.6,
  approach: 2.8,
  papi: 4,
  'taxiway-centreline': 1.6,
  'taxiway-edge': 1.6,
  'stop-bar': 2,
  'intermediate-hold': 1.8,
  'apron-flood': 30,
};

export class AirfieldLights2D {
  readonly container = new Container();
  private readonly points: ParticleContainer;
  private readonly craft: ParticleContainer;
  private graph: AirsideGraph | undefined;
  private lights: AirfieldLight[] = [];
  private colors: number[] = [];
  private particles: Particle[] = [];

  constructor(private readonly glow: Texture) {
    this.points = new ParticleContainer({ texture: glow, dynamicProperties: { color: true } });
    this.craft = new ParticleContainer({ texture: glow });
    for (const c of [this.points, this.craft]) c.blendMode = 'add';
    this.container.addChild(this.points, this.craft);
  }

  setCity(graph: AirsideGraph | undefined, approachAids?: Airport['approachAids']) {
    this.graph = graph;
    this.lights = graph ? placeAirfieldLights(graph, approachAids) : [];
    this.colors = [];
    this.particles = this.lights.map((l) => this.particle(l.x, l.y, radiusM[l.kind], 0));
    this.points.particleChildren = this.particles;
    this.points.update();
    this.craft.particleChildren = [];
    this.craft.update();
  }

  private particle(x: number, y: number, radius: number, tint: number) {
    return new Particle({
      texture: this.glow,
      x,
      y,
      anchorX: 0.5,
      anchorY: 0.5,
      scaleX: (2 * radius) / 64,
      scaleY: (2 * radius) / 64,
      tint,
      alpha: tint ? (radius > 10 ? 0.35 : 1) : 0,
    });
  }

  update(state: AirfieldState | undefined, poses: readonly AircraftPose[], bounds: Box | null) {
    if (!this.graph) return;
    const colors = airfieldLightColors(
      this.graph,
      this.lights,
      state,
      papiAngles(this.graph, this.lights, poses),
    );
    const particles = this.particles;
    let changed = false;
    colors.forEach((c, i) => {
      if (this.colors[i] === c) return;
      particles[i]!.tint = c;
      particles[i]!.alpha = c ? (this.lights[i]!.kind === 'apron-flood' ? 0.35 : 1) : 0;
      changed = true;
    });
    this.colors = colors;
    if (changed) this.points.update();
    const craft: Particle[] = [];
    for (const pose of poses) {
      if (
        bounds &&
        (pose.x < bounds.minX ||
          pose.x > bounds.maxX ||
          pose.y < bounds.minY ||
          pose.y > bounds.maxY)
      )
        continue;
      const type = aircraftTypes.find((t) => t.id === pose.typeId)!;
      const on = aircraftLights(pose);
      const c = Math.cos(pose.heading),
        s = Math.sin(pose.heading);
      // Local metres (+x forward, +y starboard) to the map.
      const at = (x: number, y: number, radius: number, tint: number) =>
        craft.push(this.particle(pose.x + x * c - y * s, pose.y + x * s + y * c, radius, tint));
      const half = type.spanM / 2,
        nose = type.lengthM / 2;
      at(0, -half, 2.5, airfieldColors.red);
      at(0, half, 2.5, airfieldColors.green);
      at(-nose, 0, 2, 0xffffff);
      if (on.beacon) at(0, 0, 3.5, airfieldColors.red);
      if (on.strobes) for (const y of [-half, half]) at(-1, y, 3, 0xffffff);
      if (on.landing || on.taxi) at(nose + 6, 0, on.landing ? 9 : 6, airfieldColors.flood);
    }
    this.craft.particleChildren = craft;
    this.craft.update();
  }
}
