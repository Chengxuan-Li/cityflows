import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// TASK-166: WCAG AA for the chrome's tokens in both appearances: 4.5:1 for text, 3:1 for the
// graphics that carry state or meaning (focus ring, checked controls, toolbar glyphs, chart marks).
const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => [name!, value!]),
  );
};
const light = block(':root');
const appearances = { light, dark: { ...light, ...block(":root[data-appearance='dark']") } };

type Rgba = [number, number, number, number];
function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value);
  if (!rgb) throw new Error(`not a colour token: ${value}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4]) / 100];
}
/** A token's colour, with translucent overlays composited over `under`. */
function colour(tokens: Record<string, string>, spec: string): Rgba {
  const [top, ...rest] = spec.split(' over ');
  const value = parse(tokens[top!] ?? top!);
  if (!rest.length) return value;
  const base = colour(tokens, rest.join(' over '));
  const a = value[3];
  return [0, 1, 2].map((i) => value[i]! * a + base[i]! * (1 - a)).concat(1) as Rgba;
}
const luminance = ([r, g, b]: Rgba) =>
  [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
const ratio = (a: Rgba, b: Rgba) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const chrome = ['--window', '--toolbar', '--sidebar', '--inspector', '--popover'];
const text: [string, string[]][] = [
  ['--label', [...chrome, '--field', '--control', '--control-pressed', '--segmented-key']],
  ['--label', ['--hover over --sidebar', '--pressed over --toolbar', '--surface']],
  ['--label', ['--signal-green-fill', '--signal-amber-fill', '--signal-red-fill']],
  ['--label-secondary', [...chrome, '--field', '--surface']],
  ['--toolbar-glyph', ['--toolbar']],
  ['--on-accent', ['--accent-fill', '--accent-fill-pressed']],
  ['--accent-text', ['--inspector', '--sidebar', '--pressed over --toolbar']],
  ['--warning-text', ['--warning-fill']],
  ['--danger-text', ['--danger-fill']],
  ['--usage-up', ['--sidebar']],
  ['--usage-down', ['--sidebar']],
];
const graphics: [string, string[]][] = [
  ['--accent', [...chrome, '--field']],
  ['--toolbar-glyph', ['--toolbar', '--pressed over --toolbar']],
  ['--signal-served', ['--surface']],
  ['--signal-conflict', ['--surface']],
  // The walk share fills the foot of a 100% bar whose top (car) and the axis outline it.
  ...['driving', 'queued', 'completed', 'delay', 'car'].map((series): [string, string[]] => [
    `--chart-${series}`,
    ['--sidebar'],
  ]),
  ['--heat', ['--sidebar']],
];

describe.each(Object.entries(appearances))('%s appearance', (_, tokens) => {
  it.each(text)('text %s meets 4.5:1', (fg, backgrounds) => {
    for (const bg of backgrounds)
      expect(ratio(colour(tokens, fg), colour(tokens, bg)), `${fg} on ${bg}`).toBeGreaterThan(4.5);
  });
  it.each(graphics)('graphic %s meets 3:1', (fg, backgrounds) => {
    for (const bg of backgrounds)
      expect(ratio(colour(tokens, fg), colour(tokens, bg)), `${fg} on ${bg}`).toBeGreaterThan(3);
  });
});
