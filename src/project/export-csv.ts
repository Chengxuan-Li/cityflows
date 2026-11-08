import type { VehicleClass, VehiclePurpose } from '../schema';

export interface ExportProvenance {
  seed: number;
  engineVersion: string;
  schemaVersion: number;
  dtS: number;
}

export interface TripRecord {
  id: string;
  person: string | null;
  origin: string;
  destination: string;
  vehicleClass: VehicleClass;
  purpose: VehiclePurpose;
  departure: number | null;
  arrival: number | null;
  travelTime: number | null;
  delay: number | null;
  failReason: string | null;
  respawns: number;
  parkingFacility: string | null;
  walkingDistanceM: number;
  parkingSearchTimeS: number;
}

export interface RoadStats {
  id: string;
  meanSpeedRatio: number;
  vehiclesPassed: number;
  maxQueue: number;
}

export interface RoadMetricRecord extends RoadStats {
  name: string | null;
  roadClass: string;
  length: number;
}

export interface TrajectoryRecord {
  vehicleId: number;
  time: number;
  x: number;
  y: number;
  /** Canonical lane ID, or movement ID while crossing a junction. */
  lane: string;
  speed: number;
}

function cell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  // Imported names are untrusted spreadsheet input, including formula prefixes.
  const text = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(
  provenance: ExportProvenance,
  header: string[],
  rows: (string | number | null)[][],
): string {
  const { seed, engineVersion, schemaVersion, dtS } = provenance;
  const comment = `# synthetic traffic, not observed traffic; seed=${seed}; engine version=${engineVersion}; schema version=${schemaVersion}; time step=${dtS}s`;
  return (
    [comment, header.join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n') + '\r\n'
  );
}

export function exportTripsCsv(records: readonly TripRecord[], provenance: ExportProvenance) {
  return csv(
    provenance,
    [
      'id',
      'person',
      'origin',
      'destination',
      'class',
      'purpose',
      'departure',
      'arrival',
      'travel time',
      'delay',
      'fail reason',
      'respawns',
      'parking facility',
      'walking distance',
      'parking search time',
    ],
    records.map((r) => [
      r.id,
      r.person,
      r.origin,
      r.destination,
      r.vehicleClass,
      r.purpose,
      r.departure,
      r.arrival,
      r.travelTime,
      r.delay,
      r.failReason,
      r.respawns,
      r.parkingFacility,
      r.walkingDistanceM,
      r.parkingSearchTimeS,
    ]),
  );
}

export function exportRoadMetricsCsv(
  records: readonly RoadMetricRecord[],
  provenance: ExportProvenance,
) {
  return csv(
    provenance,
    ['id', 'name', 'class', 'length', 'mean speed ratio', 'vehicles passed', 'max queue'],
    records.map((r) => [
      r.id,
      r.name,
      r.roadClass,
      r.length,
      r.meanSpeedRatio,
      r.vehiclesPassed,
      r.maxQueue,
    ]),
  );
}

export function exportTrajectoriesCsv(
  records: readonly TrajectoryRecord[],
  provenance: ExportProvenance,
) {
  return csv(
    provenance,
    ['vehicle id', 'time', 'x', 'y', 'lane', 'speed'],
    records.map((r) => [r.vehicleId, r.time, r.x, r.y, r.lane, r.speed]),
  );
}
