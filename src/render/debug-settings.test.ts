import { describe, expect, it } from 'vitest';
import { defaultDebug, debugIn2D, parseDebug } from './debug-settings';
import { parseVisual } from './lighting';

describe('viewer debug preferences', () => {
  it('keeps existing viewers on the normal rendering and validates each stored field', () => {
    expect(parseVisual({ mode: 'night' })).toMatchObject({
      developerTools: false,
      debug: defaultDebug,
    });
    const { debug, developerTools } = parseVisual({
      developerTools: 'yes',
      debug: {
        rendered: false,
        shading: 'constructor',
        overlays: { lanes: true, aircraft: 'true', unknown: true },
      },
    });
    expect(developerTools).toBe(false);
    expect(debug).toEqual({
      ...defaultDebug,
      rendered: false,
      overlays: { ...defaultDebug.overlays, lanes: true },
    });
  });
  it('retains 3D options across a visit to 2D', () => {
    const saved = parseDebug({
      shading: 'normals',
      overlays: { wireframe: true, detailRanges: true, railGraph: true },
    });
    expect(debugIn2D(saved)).toEqual({
      ...defaultDebug,
      overlays: { ...defaultDebug.overlays, railGraph: true },
    });
    expect(saved.shading).toBe('normals');
    expect(debugIn2D({ ...saved, shading: 'heights' }).shading).toBe('heights');
  });
});
