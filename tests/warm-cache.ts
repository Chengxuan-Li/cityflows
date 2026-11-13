import type { TestProject } from 'vitest/node';
import { loadAuditCity } from '../bench/junction-audit';

// TASK-171: fills the real-city import cache (bench/city-cache.ts) once, in the main process,
// before any worker starts. Cold, about 50 test files import the same city at once and each
// takes several times its idle time, which timed out loaded runs. Warm, this reads the cache.
export default function warmCityCache(project: TestProject) {
  loadAuditCity(project.name === 'unit' ? 'sindelfingen' : 'munich');
}
