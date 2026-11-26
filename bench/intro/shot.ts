// Intro mock (not a product feature): the shot both bench/intro/render.ts and the tuner page
// (bench/intro/tuner.html) play. Exposure and camera keys live in bench/intro/shot.json, which the
// tuner saves; the timing and the frame below are fixed.

export const FPS = 30,
  // 9.5 s of camera move, then a 3.5 s hold: the camera rests on its last key (`view` holds past
  // it) while the traffic, the trains and the climb-out run on.
  DURATION_S = 13;

export type Format = 'landscape' | 'portrait';
export const formats: readonly Format[] = ['landscape', 'portrait'];
/** A video frame: its size, the app canvas it is cut from, the vertical field of view over that
 * canvas, and where the title lockup centres. */
export interface Frame {
  W: number;
  H: number;
  CANVAS_H: number;
  FOV: number;
  titleX: number;
}
export const frames: Record<Format, Frame> = {
  // 16:9. The canvas renders taller than the video and each frame is a 1080-row window of it: a
  // lens shift, since the app holds its pitch at 10 degrees or more. Centred over the trains, the
  // window rises to the canvas top for the horizon shot, leaving the sky room for the climb-out.
  // 36 degrees over the canvas is 24.5 over the video's rows, a longer lens than the app's 45, so
  // the skyline and the climbing aircraft read larger. The title stands right of centre, clear of
  // Canary Wharf and of the climb-out.
  landscape: { W: 1920, H: 1080, CANVAS_H: 1620, FOV: 36, titleX: 1920 / 2 + 390 },
  // 9:16. A shorter lens, about 30 degrees across (landscape spans 42), keeps both sides of the
  // reveal in the narrow frame; at the 10 degree pitch the horizon already stands a third of the
  // way down, so there is no lens shift. The title is centred.
  portrait: { W: 1080, H: 1920, CANVAS_H: 1920, FOV: 51, titleX: 1080 / 2 },
};

/** A camera key: ground target, zoom, pitch and bearing in scene.setView's conventions (bearing 0
 * looks north, 90 looks west), at video time `t`. */
export interface Key {
  t: number;
  x: number;
  y: number;
  zoom: number;
  pitch: number;
  bearing: number;
}
export type Season = 'summer' | 'equinox' | 'winter';
export const seasons: readonly Season[] = ['summer', 'equinox', 'winter'];
export interface Shot {
  format: Format;
  exposure: number;
  /** The clock time the sun stands at (s since midnight), apart from the simulation's 09:03: held
   * at `startS` until video time `changeT`, then easing to `endS` by the end of the cut. */
  sun: { startS: number; changeT: number; endS: number };
  season: Season;
  keys: Key[];
}

export function parseShot(value: unknown): Shot {
  const shot = value as Shot;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  if (!finite(shot?.exposure) || !Array.isArray(shot.keys) || shot.keys.length < 2)
    throw new Error('A shot needs an exposure and at least two keys');
  for (const k of shot.keys)
    if (!(['t', 'x', 'y', 'zoom', 'pitch', 'bearing'] as const).every((f) => finite(k[f])))
      throw new Error(`Bad key ${JSON.stringify(k)}`);
  return {
    format: formats.includes(shot.format) ? shot.format : 'landscape',
    exposure: shot.exposure,
    sun: parseSun(value),
    season: seasons.includes(shot.season) ? shot.season : 'winter',
    keys: [...shot.keys].sort((a, b) => a.t - b.t),
  };
}

function parseSun(value: unknown): Shot['sun'] {
  const { sun, sunS } = value as { sun?: Shot['sun']; sunS?: number };
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (sun && finite(sun.startS) && finite(sun.changeT) && finite(sun.endS)) return { ...sun };
  // Older shot files held one sun time (`sunS`), or none: the shot's own 09:03.
  const held = finite(sunS) ? sunS : 32580;
  return { startS: held, changeT: DURATION_S, endS: held };
}
/** The sun's clock time at video time `t`. */
export const sunAt = (sun: Shot['sun'], t: number) =>
  sun.startS + (sun.endS - sun.startS) * smooth(sun.changeT, DURATION_S, t);

export function smooth(a: number, b: number, t: number) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}
/** The top row of the video's window over the canvas at video time `t`. */
export const windowTop = (frame: Frame, t: number) =>
  ((frame.CANVAS_H - frame.H) / 2) * (1 - smooth(0.8, 5.5, t));

// Shot timing, in video seconds, for a cut under ten seconds. The sim runs at 1x while the trains
// pull out, speeds to 6x for the pull-back, and settles at 3x for the climb-out.
const rate = (t: number) => 1 + 5 * smooth(0.8, 2.5, t) - 3 * smooth(5.5, 7, t);
export const simOffset = (t: number) => {
  let s = 0;
  for (let i = 0, n = Math.ceil(t * 200); i < n; i++) s += (rate((i + 0.5) / 200) * t) / n;
  return s;
};
const TRAINS_DEPART_T = 0.6; // video s
const ROTATE_T = 7.5; // video s: the A220 rotates as the camera pulls back from the horizon
// BCS3 #5 on 27 (bench/intro/probe-flights.ts): rolls at 09:02:40, rotates at 09:03:17. The
// winter sun is about 8 degrees up: low, warm dawn light under Clock lighting.
const ROTATION_S = 32597;
export const startS = ROTATION_S - simOffset(ROTATE_T);
export const trainsDepartS = startS + simOffset(TRAINS_DEPART_T);
// The title fades in at 0:09, with the camera at rest and the horizon long in frame.
export const titleAlpha = (t: number) => smooth(9, 10.5, t);

/** The camera at video time `t`: a Hermite spline through the keys (Catmull-Rom tangents, at rest
 * at both ends), so it flows through the middle keys rather than pausing on them. Zoom runs in
 * log space, a steady dolly. */
export function view(keys: readonly Key[], t: number) {
  const after = keys.findIndex((k) => k.t > t);
  // Past the last key the camera holds on it.
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

/** The title's baseline in video rows: the lockup stands on the horizon, `pitch` degrees above
 * the canvas centre (the subtitle just above it), a little higher while it fades in. */
export function titleBaseline(frame: Frame, t: number, pitch: number) {
  const { CANVAS_H, FOV } = frame;
  const horizon =
    CANVAS_H / 2 -
    ((CANVAS_H / 2) * Math.tan((pitch * Math.PI) / 180)) / Math.tan((FOV * Math.PI) / 360) -
    Math.round(windowTop(frame, t));
  return horizon - 74 + 12 * (1 - titleAlpha(t));
}
export interface TitleStyle {
  title: string;
  subtitle: string;
  version: string;
  colour: string;
  /** The lockup's centre, in video columns. */
  x: number;
}
export const title: TitleStyle = {
  title: 'CityFlows',
  subtitle: 'An open testbed for the city in motion',
  version: 'v0.1.0',
  colour: '#fff6ea',
  x: frames.landscape.titleX,
};
/** The subtitle, set once as an image (`renderSubtitle`): where it sits around the lockup's
 * centre and the subtitle's baseline. */
export interface SubtitleImage {
  image: CanvasImageSource;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Lays `text` out centred on `centre` with its character spacing scaled: the gaps between
 * letters' ink grow or shrink by `spacing`, with kerning kept, and the letter groups in `joined`
 * (ligatures) stay whole. Self-contained, so the render script can run its source in the page. */
export function layoutSpaced(
  g: CanvasRenderingContext2D,
  text: string,
  font: string,
  spacing: number,
  joined: readonly string[],
  centre: number,
) {
  g.font = font;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fontKerning = 'normal';
  const units: string[] = [];
  for (let i = 0; i < text.length;) {
    const unit = joined.find((l) => text.startsWith(l, i)) ?? text[i]!;
    units.push(unit);
    i += unit.length;
  }
  // Each unit's natural start and ink edges, in the run as set (kerning kept).
  const natural = units.map((c, i) => {
    const x = g.measureText(units.slice(0, i).join('')).width;
    const m = g.measureText(c);
    return { x, left: x - m.actualBoundingBoxLeft, right: x + m.actualBoundingBoxRight };
  });
  const at: number[] = [],
    left: number[] = [],
    right: number[] = [];
  let shift = 0;
  natural.forEach((n, i) => {
    if (i > 0) shift += (1 - spacing) * (n.left - natural[i - 1]!.right);
    at.push(n.x - shift);
    left.push(n.left - shift);
    right.push(n.right - shift);
  });
  const x0 = Math.min(...left),
    x1 = Math.max(...right);
  const start = centre - (x0 + x1) / 2;
  return {
    units,
    at: at.map((x) => start + x),
    left: start + x0,
    right: start + x1,
  };
}

/** Sets the subtitle, Cormorant Garamond italic at 40 px and 0.9x spacing, as an image: canvas
 * text cannot turn on OpenType features, so it is drawn as SVG text with the font (`font`, the
 * full TTF in base64) embedded and kerning, standard, contextual and discretionary ligatures on
 * (the st of "testbed"). The ligatures' letters stay together when spacing. Needs the same font
 * loaded in the document as "Cormorant Garamond" italic, for measuring. Self-contained. */
export async function renderSubtitle(style: TitleStyle, font: string): Promise<SubtitleImage> {
  const size = 40,
    scale = 2,
    pad = 32;
  const g = document.createElement('canvas').getContext('2d')!;
  const set = layoutSpaced(
    g,
    style.subtitle,
    `italic 500 ${size}px "Cormorant Garamond"`,
    0.9,
    ['ffi', 'ffl', 'ff', 'fi', 'fl', 'ft', 'Th', 'st', 'ct', 'sp'],
    0,
  );
  const m = g.measureText(style.subtitle);
  const ascent = Math.ceil(m.actualBoundingBoxAscent),
    descent = Math.ceil(m.actualBoundingBoxDescent);
  const left = Math.floor(set.left) - pad,
    top = -ascent - pad;
  const width = Math.ceil(set.right) + pad - left,
    height = ascent + descent + 2 * pad;
  const escape = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const spans = set.units
    .map((u, i) =>
      u.trim()
        ? `<tspan x="${(set.at[i]! - left).toFixed(2)}" y="${-top}">${escape(u)}</tspan>`
        : '',
    )
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" ` +
    `viewBox="0 0 ${width} ${height}"><style>` +
    `@font-face{font-family:"Subtitle";src:url(data:font/ttf;base64,${font}) format("truetype");` +
    `font-style:italic;font-weight:300 700}` +
    `text{font-family:"Subtitle";font-style:italic;font-weight:500;font-size:${size}px;` +
    `font-kerning:normal;font-feature-settings:"kern" 1,"liga" 1,"clig" 1,"calt" 1,"dlig" 1;` +
    `fill:${style.colour}}</style><text>${spans}</text></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const raster = document.createElement('canvas');
    raster.width = width * scale;
    raster.height = height * scale;
    raster.getContext('2d')!.drawImage(image, 0, 0, raster.width, raster.height);
    return { image: raster, left, top, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws the lockup: the title in bold Arimo at 0.8x its character spacing, the subtitle beneath
 * (`renderSubtitle`'s image; without one, plain canvas text), and the version at the title's top
 * right. Self-contained but for `layoutSpaced`, which the render script loads beside it. */
export function drawTitle(
  g: CanvasRenderingContext2D,
  style: TitleStyle,
  baseline: number,
  alpha: number,
  subtitle?: SubtitleImage,
) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = style.colour;
  g.shadowColor = 'rgba(10, 14, 30, 0.35)';
  g.shadowBlur = 18;
  const head = layoutSpaced(g, style.title, '700 110px Arimo', 0.8, [], style.x);
  head.units.forEach((c, i) => g.fillText(c, head.at[i]!, baseline));
  if (subtitle)
    g.drawImage(
      subtitle.image,
      style.x + subtitle.left,
      baseline + 52 + subtitle.top,
      subtitle.width,
      subtitle.height,
    );
  else {
    const sub = layoutSpaced(
      g,
      style.subtitle,
      'italic 500 40px "Cormorant Garamond"',
      0.9,
      ['st', 'ct', 'sp'],
      style.x,
    );
    sub.units.forEach((c, i) => g.fillText(c, sub.at[i]!, baseline + 52));
  }
  g.globalAlpha = alpha * 0.8;
  g.font = '400 19px Arimo';
  g.textAlign = 'left';
  g.fillText(style.version, head.right + 10, baseline - 64);
  g.restore();
}
