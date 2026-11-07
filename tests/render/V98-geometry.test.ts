import { expect, test } from 'vitest';
import { auditCities, loadAuditCity } from '../../bench/junction-audit';
import { compile } from '../../src/network';
import { buildGeometry } from '../../src/render3d/geometry';
import { tierCities } from '../tier';

test.each(tierCities(auditCities))(
  'V98 %s has finite 3D surface, slab, marking and place buffers',
  (name) => {
    const city = loadAuditCity(name);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const geometry = buildGeometry(result.compiled, city);
    for (const buffer of [
      geometry.surfaces,
      geometry.slabs,
      geometry.markings,
      geometry.crossings,
      geometry.places,
      geometry.context.buildings,
      geometry.context.ground,
    ]) {
      for (const attribute of Object.values(buffer.attributes))
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      buffer.dispose();
    }
    expect(geometry.surfaces.getAttribute('position').count).toBeGreaterThan(0);
    expect(geometry.markings.getAttribute('position').count).toBeGreaterThan(0);
    expect(geometry.piers.every((pier) => Number.isFinite(pier.height) && pier.height > 0)).toBe(
      true,
    );
    if (name === 'munich' || name === 'sindelfingen') {
      expect(geometry.context.buildingCount).toBeGreaterThan(0);
      expect(geometry.context.groundCount).toBeGreaterThan(0);
    }
  },
);
