import { z } from 'zod';
import { layerNames, type LayerName, type LayerParams } from '../layers/registry';

// Capture (cinematic-captures branch only): the shot file. A shot is a short video rendered from
// the real app: which project and location, the frame per format, the camera keys, the sim's
// start and rate, the light, the title, and the scene layers with their parameters. The render
// CLI (capture/core/render.ts) and the in-app Capture panel (capture/panel) read and write it.
// Everything here is plain arithmetic, shared by Node and the page.

/** A clock time: seconds since midnight, or "HH:MM" / "HH:MM:SS(.s)". */
const clock = z.union([
  z.number().min(0).max(172800),
  z
    .string()
    .regex(/^\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/)
    .transform((text) => {
      const [h, m, s] = text.split(':').map(Number) as [number, number, number?];
      return h * 3600 + m * 60 + (s ?? 0);
    }),
]);
const finite = z.number().refine(Number.isFinite);
const key = z.object({
  t: finite.min(0),
  x: finite,
  y: finite,
  zoom: finite.positive(),
  pitch: finite,
  bearing: finite,
});
const formatNames = ['landscape', 'portrait'] as const;
export type FormatName = (typeof formatNames)[number];
const format = z.object({
  width: z.int().positive(),
  height: z.int().positive(),
  /** The app canvas the frame is cut from, at least `height` rows: a lens shift. */
  canvasHeight: z.int().positive(),
  /** Vertical field of view over the canvas, degrees. */
  fov: finite.min(5).max(120),
  /** Where the title lockup centres, in video columns. */
  titleX: finite,
  /** The frame's window over the canvas, 0 at the top and 1 at the bottom, easing from `from` to
   * `to` between video times `start` and `end`. */
  window: z
    .object({ from: finite.min(0).max(1), to: finite.min(0).max(1), start: finite, end: finite })
    .optional(),
  /** This format's own camera keys; without them it plays the shot's. */
  keys: z.array(key).min(2).optional(),
});
const sun = z.union([
  /** Follows the simulated clock. */
  z.literal('sim'),
  /** Held at `from`, or easing from `from` to `to` between video times `start` and `end`. */
  z.object({ from: clock, to: clock.optional(), start: finite.optional(), end: finite.optional() }),
]);
const shotSchema = z.object({
  /** The folder under capture/locations whose site.ts dresses the scene (optional). */
  location: z.string().regex(/^[a-z0-9-]+$/),
  /** A project file (relative to the repository or absolute), or `bundled:<city id>`. */
  project: z.string().min(1),
  fps: z.int().min(1).max(120).default(30),
  duration: finite.positive().max(600),
  /** The near field's centre, where layers that dress a bounded area centre by default. */
  focus: z.object({ x: finite, y: finite }).optional(),
  sim: z.object({
    /** The sim clock at the first frame, or a cue: the clock reached at video time `t`. */
    start: clock.optional(),
    cue: z.object({ t: finite.min(0), clock }).optional(),
    /** Sim seconds per video second; smoothstep between keys, held past the ends. */
    rate: z.array(z.object({ t: finite.min(0), rate: finite.min(0) })).default([]),
  }),
  light: z.object({
    exposure: finite.min(0.1).max(8).default(1),
    /** The day Clock light follows (`YYYY-MM-DD`); the app takes the place from the project. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    sun: sun.default('sim'),
    /** Any of the app's visual settings (`cityflows.visual`), applied as they are. */
    visual: z.record(z.string(), z.unknown()).default({}),
  }),
  /** The app's map layers (`LayerVisibility`) to set; the rest stay as they are. */
  map: z.record(z.string(), z.boolean()).default({}),
  title: z
    .object({
      text: z.string(),
      subtitle: z.string().default(''),
      /** Text at the title's top right; "auto" is the app's version. */
      version: z.string().default('auto'),
      colour: z.string().default('#fff6ea'),
      /** Fade-in, video seconds. */
      fade: z.tuple([finite, finite]),
      /** The baseline: on the horizon, or a video row. */
      y: z.union([z.literal('horizon'), finite]).default('horizon'),
      /** A full TTF for the subtitle (italic), so its discretionary ligatures work. */
      subtitleFont: z.string().optional(),
    })
    .nullable()
    .default(null),
  formats: z
    .object({ landscape: format.optional(), portrait: format.optional() })
    .refine((f) => f.landscape || f.portrait, 'A shot needs at least one format'),
  keys: z.array(key).min(2),
  /** Scene layers that are on, each with its parameters (defaults fill the rest). */
  layers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
type ShotInput = z.input<typeof shotSchema>;
type Parsed = z.output<typeof shotSchema>;
export type Key = z.output<typeof key>;
export type Format = z.output<typeof format>;
export type Sun = z.output<typeof sun>;
export type Title = NonNullable<Parsed['title']>;
export interface Shot extends Omit<Parsed, 'layers'> {
  layers: Partial<{ [L in LayerName]: Partial<LayerParams<L>> }>;
}

/** A shot file's contents, validated; keys sorted by time. */
export function parseShot(value: unknown): Shot {
  const result = shotSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      `Bad shot file: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  const shot = result.data;
  const unknown = Object.keys(shot.layers).filter(
    (n) => !(layerNames as readonly string[]).includes(n),
  );
  if (unknown.length) throw new Error(`Unknown layers: ${unknown.join(', ')}`);
  if (shot.sim.start === undefined && !shot.sim.cue)
    throw new Error('The shot needs sim.start or sim.cue');
  const sort = (keys: Key[]) => [...keys].sort((a, b) => a.t - b.t);
  return {
    ...shot,
    keys: sort(shot.keys),
    formats: Object.fromEntries(
      Object.entries(shot.formats).map(([n, f]) => [
        n,
        f && { ...f, keys: f.keys && sort(f.keys) },
      ]),
    ),
    layers: shot.layers as Shot['layers'],
  };
}

/** The shot as written to its file: clocks as text, defaults left in. */
export function serializeShot(shot: Shot) {
  const sun = shot.light.sun;
  return `${JSON.stringify(
    {
      ...shot,
      sim: {
        ...(shot.sim.start !== undefined ? { start: clockText(shot.sim.start, true) } : {}),
        ...(shot.sim.cue
          ? { cue: { t: shot.sim.cue.t, clock: clockText(shot.sim.cue.clock, true) } }
          : {}),
        rate: shot.sim.rate,
      },
      light: {
        ...shot.light,
        sun:
          sun === 'sim'
            ? sun
            : {
                ...sun,
                from: clockText(sun.from, true),
                ...(sun.to !== undefined ? { to: clockText(sun.to, true) } : {}),
              },
      },
    } satisfies ShotInput,
    null,
    2,
  )}\n`;
}

export const formatList = formatNames;
export const formatsOf = (shot: Shot) => formatNames.filter((n) => shot.formats[n]);
/** A format's frame and the keys it plays. */
export function frameOf(shot: Shot, name: FormatName) {
  const frame = shot.formats[name];
  if (!frame) throw new Error(`The shot has no ${name} format`);
  return { ...frame, keys: frame.keys ?? shot.keys };
}
export type Frame = ReturnType<typeof frameOf>;

export const focusOf = (shot: Shot) => shot.focus ?? { x: shot.keys[0]!.x, y: shot.keys[0]!.y };

export function clockText(s: number, precise = false) {
  const whole = Math.floor(s);
  const text = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  const fraction = Math.round((s - whole) * 1000) / 1000;
  return precise && fraction > 0 ? `${text}${String(fraction).slice(1)}` : text;
}

export function smooth(a: number, b: number, t: number) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** Sim seconds per video second at video time `t`. */
export function rateAt(shot: Shot, t: number) {
  const keys = shot.sim.rate;
  if (!keys.length) return 1;
  let rate = keys[0]!.rate;
  for (let i = 1; i < keys.length; i++)
    rate += (keys[i]!.rate - keys[i - 1]!.rate) * smooth(keys[i - 1]!.t, keys[i]!.t, t);
  return rate;
}
/** Sim seconds elapsed by video time `t`. The sum samples the rate at 200 Hz as the first
 * capture's timing did, so its cues land on the same sim seconds. */
export function simOffset(shot: Shot, t: number) {
  let s = 0;
  for (let i = 0, n = Math.ceil(t * 200); i < n; i++) s += (rateAt(shot, (i + 0.5) / 200) * t) / n;
  return s;
}
/** The sim clock at the first frame. */
export const simStart = (shot: Shot) =>
  shot.sim.cue ? shot.sim.cue.clock - simOffset(shot, shot.sim.cue.t) : shot.sim.start!;
export const simAt = (shot: Shot, t: number) => simStart(shot) + simOffset(shot, t);

/** The sun's clock time at video time `t`, or null to follow the sim. */
export function sunAt(shot: Shot, t: number) {
  const sun = shot.light.sun;
  if (sun === 'sim') return null;
  if (sun.to === undefined) return sun.from;
  return sun.from + (sun.to - sun.from) * smooth(sun.start ?? 0, sun.end ?? shot.duration, t);
}

/** The top row of the frame's window over the canvas at video time `t`. */
export function windowTop(frame: Frame, t: number) {
  const w = frame.window ?? { from: 0.5, to: 0.5, start: 0, end: 1 };
  const at = w.from + (w.to - w.from) * smooth(w.start, w.end, t);
  return (frame.canvasHeight - frame.height) * at;
}

export const titleAlpha = (title: Title, t: number) => smooth(title.fade[0], title.fade[1], t);
/** The title's baseline in video rows. On the horizon: the lockup stands `pitch` degrees above
 * the canvas centre (the subtitle just above the horizon), a little higher while it fades in. */
export function titleBaseline(title: Title, frame: Frame, t: number, pitch: number) {
  const rise = 12 * (1 - titleAlpha(title, t));
  if (title.y !== 'horizon') return title.y + rise;
  const { canvasHeight, fov } = frame;
  const horizon =
    canvasHeight / 2 -
    ((canvasHeight / 2) * Math.tan((pitch * Math.PI) / 180)) / Math.tan((fov * Math.PI) / 360) -
    Math.round(windowTop(frame, t));
  return horizon - 74 + rise;
}

/** The camera at video time `t`: a Hermite spline through the keys (Catmull-Rom tangents, at rest
 * at both ends), so it flows through the middle keys rather than pausing on them, holding on the
 * last key. Zoom runs in log space, a steady dolly. Keys use scene.setView's conventions: bearing
 * 0 looks north, 90 looks west. */
export function view(keys: readonly Key[], t: number) {
  const after = keys.findIndex((k) => k.t > t);
  const i = after < 0 ? keys.length - 2 : Math.max(0, after - 1);
  const a = keys[i]!,
    b = keys[i + 1]!;
  const h = b.t - a.t,
    s = Math.min(1, Math.max(0, (t - a.t) / h));
  const tangent = (k: number, f: (key: Key) => number) =>
    k === 0 || k === keys.length - 1
      ? 0
      : (f(keys[k + 1]!) - f(keys[k - 1]!)) / (keys[k + 1]!.t - keys[k - 1]!.t);
  const hermite = (f: (key: Key) => number) =>
    (2 * s ** 3 - 3 * s ** 2 + 1) * f(a) +
    (s ** 3 - 2 * s ** 2 + s) * h * tangent(i, f) +
    (-2 * s ** 3 + 3 * s ** 2) * f(b) +
    (s ** 3 - s ** 2) * h * tangent(i + 1, f);
  return {
    centre: { x: hermite((k) => k.x), y: hermite((k) => k.y) },
    zoom: Math.exp(hermite((k) => Math.log(k.zoom))),
    pitch: Math.min(
      85,
      Math.max(
        10,
        hermite((k) => k.pitch),
      ),
    ),
    bearing: hermite((k) => k.bearing),
  };
}
