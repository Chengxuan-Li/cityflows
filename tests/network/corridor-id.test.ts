import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { compile } from '../../src/network';
import { citySchema } from '../../src/schema/city.schema';

test('corridorId defaults to streetGroupId and survives a schema round trip', () => {
  const city = grid5x5();
  const paired = Object.values(city.roads).find((road) => road.streetGroupId !== null)!;
  const single = Object.values(city.roads).find((road) => road.streetGroupId === null);
  const result = compile(city);
  if (!result.ok) throw new Error('grid');
  const compiled = (id: string) => result.compiled.roads.find((road) => road.id === id)!;
  expect(compiled(paired.id).corridorId).toBe(paired.streetGroupId);
  if (single) expect(compiled(single.id).corridorId).toBeNull();

  paired.corridorId = 'corridor:test';
  const parsed = citySchema.parse(JSON.parse(JSON.stringify(city)));
  expect(parsed.roads[paired.id]!.corridorId).toBe('corridor:test');
  const again = compile(parsed);
  if (!again.ok) throw new Error('grid');
  expect(again.compiled.roads.find((road) => road.id === paired.id)!.corridorId).toBe(
    'corridor:test',
  );
});
