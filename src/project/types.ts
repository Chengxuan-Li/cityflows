import { z } from 'zod';
import { historyFileSchema, personSchema, scenarioSchema } from '../schema';
import type { City, HistoryEntry, Person, Scenario } from '../schema';
import type { Baseline } from './scenarios';

export const projectKeys = [
  'city',
  'population',
  'scenarios',
  'history',
  'view',
  'baseline',
] as const;
export type ProjectKey = (typeof projectKeys)[number];

export interface Project {
  baseline?: Baseline;
  city: City;
  population?: Person[];
  scenarios: Scenario[];
  history?: readonly HistoryEntry[];
  view?: ProjectView;
}

export type OpenResult =
  { ok: true; project: Project } | { ok: false; file: string; error: string };

export const viewSchema = z.object({
  camera: z.json(),
  layers: z.json(),
  selection: z.json(),
});

export type ProjectView = z.infer<typeof viewSchema>;

export const populationSchema = z.array(personSchema);
export const scenariosSchema = z.array(scenarioSchema).min(1);
export const historySchema = historyFileSchema;
