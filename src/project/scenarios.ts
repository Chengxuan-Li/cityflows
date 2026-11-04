import { z } from 'zod';
import type { Editor } from '../editor';
import { generatePopulation, scheduleTrips } from '../demand';
import {
  citySchema,
  scenarioSchema,
  personSchema,
  type City,
  type Scenario,
  type Person,
} from '../schema';

import { legacyCitySchema } from '../schema/city.schema';

export const baselineSchema = z.object({
  city: z.union([citySchema, legacyCitySchema]),
  scenario: scenarioSchema,
  population: z.array(personSchema).optional(),
});

export type Baseline = z.infer<typeof baselineSchema>;
export interface Variant {
  cityVersion: number;
  scenario: Scenario;
}

export function saveBaseline(city: City, scenario: Scenario, population?: Person[]): Baseline {
  return structuredClone({ city, scenario, ...(population ? { population } : {}) });
}

export function restoreBaseline(editor: Editor, baseline: Baseline) {
  return editor.apply({ kind: 'restoreCity', city: structuredClone(baseline.city) });
}

/** Generate once from the saved baseline so both runs receive identical demand. */
export function comparisonTrips(baseline: Baseline) {
  const population = structuredClone(
    baseline.population ?? generatePopulation(baseline.city, baseline.scenario.demand),
  );
  return scheduleTrips(baseline.city, population, baseline.scenario);
}
