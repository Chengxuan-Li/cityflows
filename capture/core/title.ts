import type { Title } from './shot';

// Capture: the title lockup, drawn on the frame (not in the scene): the title in bold Arimo, the
// subtitle in an italic face beneath it, the version at the title's top right.

/** A subtitle set once as an image (`renderSubtitle`): where it sits around the lockup's centre
 * and the subtitle's baseline. */
export interface SubtitleImage {
  image: CanvasImageSource;
  left: number;
  top: number;
  width: number;
  height: number;
}
const subtitleFace = 'Capture Subtitle';
const subtitleFont = (size: number) => `italic 500 ${size}px "${subtitleFace}", Georgia, serif`;
const ligatures = ['ffi', 'ffl', 'ff', 'fi', 'fl', 'ft', 'Th', 'st', 'ct', 'sp'];

/** Lays `text` out centred on `centre` with its character spacing scaled: the gaps between
 * letters' ink grow or shrink by `spacing`, with kerning kept, and the letter groups in `joined`
 * (ligatures) stay whole. */
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
  return { units, at: at.map((x) => start + x), left: start + x0, right: start + x1 };
}

/** Loads the title's faces: Arimo (bundled with the app) and, when given, the subtitle's full
 * TTF. Returns the subtitle image, or undefined to set it as plain canvas text. */
export async function prepareTitle(title: Title, font: ArrayBuffer | undefined) {
  await document.fonts.load('700 110px Arimo');
  await document.fonts.load('400 19px Arimo');
  if (!font || !title.subtitle) return undefined;
  const face = new FontFace(subtitleFace, font, { weight: '300 700', style: 'italic' });
  document.fonts.add(await face.load());
  return renderSubtitle(title, font);
}

/** Sets the subtitle at 40 px and 0.9x spacing as an image: canvas text cannot turn on OpenType
 * features, so it is drawn as SVG text with the font embedded and kerning, standard, contextual
 * and discretionary ligatures on (the st of "testbed"). The ligatures' letters stay together
 * when spacing. Needs the same font loaded in the document, for measuring. */
async function renderSubtitle(title: Title, font: ArrayBuffer): Promise<SubtitleImage> {
  const size = 40,
    scale = 2,
    pad = 32;
  const g = document.createElement('canvas').getContext('2d')!;
  const set = layoutSpaced(g, title.subtitle, subtitleFont(size), 0.9, ligatures, 0);
  const m = g.measureText(title.subtitle);
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
  let binary = '';
  const bytes = new Uint8Array(font);
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" ` +
    `viewBox="0 0 ${width} ${height}"><style>` +
    `@font-face{font-family:"Subtitle";src:url(data:font/ttf;base64,${btoa(binary)}) format("truetype");` +
    `font-style:italic;font-weight:300 700}` +
    `text{font-family:"Subtitle";font-style:italic;font-weight:500;font-size:${size}px;` +
    `font-kerning:normal;font-feature-settings:"kern" 1,"liga" 1,"clig" 1,"calt" 1,"dlig" 1;` +
    `fill:${title.colour}}</style><text>${spans}</text></svg>`;
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

/** Draws the lockup centred on column `x`: the title at 0.8x its character spacing, the subtitle
 * beneath (its image, or plain canvas text), and the version at the title's top right. */
export function drawTitle(
  g: CanvasRenderingContext2D,
  title: Title & { version: string },
  x: number,
  baseline: number,
  alpha: number,
  subtitle: SubtitleImage | undefined,
) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = title.colour;
  g.shadowColor = 'rgba(10, 14, 30, 0.35)';
  g.shadowBlur = 18;
  const head = layoutSpaced(g, title.text, '700 110px Arimo', 0.8, [], x);
  head.units.forEach((c, i) => g.fillText(c, head.at[i]!, baseline));
  if (subtitle)
    g.drawImage(
      subtitle.image,
      x + subtitle.left,
      baseline + 52 + subtitle.top,
      subtitle.width,
      subtitle.height,
    );
  else if (title.subtitle) {
    const sub = layoutSpaced(g, title.subtitle, subtitleFont(40), 0.9, ['st', 'ct', 'sp'], x);
    sub.units.forEach((c, i) => g.fillText(c, sub.at[i]!, baseline + 52));
  }
  if (title.version) {
    g.globalAlpha = alpha * 0.8;
    g.font = '400 19px Arimo';
    g.textAlign = 'left';
    g.fillText(title.version, head.right + 10, baseline - 64);
  }
  g.restore();
}
