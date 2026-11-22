const dayS = 24 * 3600;
const degToRad = Math.PI / 180;
const parallelToleranceRad = 3 * degToRad;
const windEpsilonKt = 1e-9;

export interface RunwayEnd {
  designator: string;
  /** CityFlows heading in radians, clockwise from east. */
  headingRad: number;
}

export interface RunwayConfiguration {
  id: string;
  arrivalEnds: readonly string[];
  departureEnds: readonly string[];
}

export interface RunwayConcept {
  startS: number;
  endS: number;
  /** Preferred configuration, or null for a closure. The interval can wrap midnight. */
  configurationId: string | null;
}

export interface AirportWind {
  /** Direction the wind comes from, clockwise from north. */
  fromDeg: number;
  speedKt: number;
}

export interface RunwayConfigurationInput {
  ends: readonly RunwayEnd[];
  configurations?: readonly RunwayConfiguration[];
  concepts?: readonly RunwayConcept[];
  tailwindLimitKt?: number;
  /** One limit per requested aircraft type. Every active end must admit those types. */
  crosswindLimitsKt?: Readonly<Record<string, number>>;
}

export interface AirportWindSample {
  timeS: number;
  wind: AirportWind;
}

export interface RunwayConfigurationChange {
  timeS: number;
  configuration: RunwayConfiguration | null;
}

/** Every end alone, plus pairs pointing within three degrees of each other. */
export function deriveRunwayConfigurations(ends: readonly RunwayEnd[]): RunwayConfiguration[] {
  const ordered = ends.toSorted((a, b) =>
    a.designator < b.designator ? -1 : Number(a.designator > b.designator),
  );
  const mixed = (ends: string[]): RunwayConfiguration => ({
    id: ends.join('+'),
    arrivalEnds: ends,
    departureEnds: ends,
  });
  const configurations = ordered.map(({ designator }) => mixed([designator]));
  for (const [index, a] of ordered.entries()) {
    for (const b of ordered.slice(index + 1)) {
      if (Math.cos(a.headingRad - b.headingRad) >= Math.cos(parallelToleranceRad)) {
        configurations.push(mixed([a.designator, b.designator]));
      }
    }
  }
  return configurations;
}

function prepareChooser(input: RunwayConfigurationInput) {
  const ends = new Map(input.ends.map(({ designator, headingRad }) => [designator, headingRad]));
  const configurations = input.configurations?.length
    ? input.configurations
    : deriveRunwayConfigurations(input.ends);
  const candidates = configurations.map((configuration) => {
    const used = new Set([...configuration.arrivalEnds, ...configuration.departureEnds]);
    if (!used.size) throw new Error(`Runway configuration ${configuration.id} has no ends`);
    const headings = [...used].map((end) => {
      const heading = ends.get(end);
      if (heading === undefined)
        throw new Error(`Unknown runway end ${end} in ${configuration.id}`);
      return heading;
    });
    return { configuration, headings };
  });
  const tailwindLimit = input.tailwindLimitKt ?? 5;
  const crosswindLimit = Math.min(...Object.values(input.crosswindLimitsKt ?? {}));

  return (timeS: number, wind: AirportWind): RunwayConfiguration | null => {
    const concept = input.concepts?.find(({ startS, endS }) =>
      startS <= endS ? startS <= timeS && timeS < endS : startS <= timeS || timeS < endS,
    );
    if (concept?.configurationId === null) return null;
    const windHeading = (wind.fromDeg - 90) * degToRad;
    let best = null;
    for (const { configuration, headings } of candidates) {
      const components = headings.map((heading) => {
        const angle = windHeading - heading;
        return {
          headwind: wind.speedKt * Math.cos(angle),
          crosswind: Math.abs(wind.speedKt * Math.sin(angle)),
        };
      });
      if (
        components.some(
          ({ headwind, crosswind }) =>
            -headwind > tailwindLimit + windEpsilonKt || crosswind > crosswindLimit + windEpsilonKt,
        )
      )
        continue;
      if (configuration.id === concept?.configurationId) return configuration;
      const endCount = headings.length;
      const headwind =
        components.reduce((sum, component) => sum + component.headwind, 0) / endCount;
      if (
        !best ||
        endCount > best.endCount ||
        (endCount === best.endCount && headwind > best.headwind + windEpsilonKt)
      ) {
        best = { configuration, endCount, headwind };
      }
    }
    return best?.configuration ?? null;
  };
}

/** Chooses a wind-safe concept, then the safe option with most ends and strongest mean headwind. */
export function chooseRunwayConfiguration(
  input: RunwayConfigurationInput,
  timeS: number,
  wind: AirportWind,
) {
  return prepareChooser(input)(timeS, wind);
}

/** Lists the initial state at midnight and changes at wind samples or concept boundaries. */
export function runwayConfigurationChanges(
  input: RunwayConfigurationInput,
  samples: readonly AirportWindSample[],
): RunwayConfigurationChange[] {
  const winds = new Map(samples.map(({ timeS, wind }) => [timeS, wind]));
  let wind = winds.get(0);
  if (!wind) throw new Error('Runway configuration timeline needs a wind sample at midnight');
  const times = new Set(winds.keys());
  for (const { startS, endS } of input.concepts ?? []) {
    times.add(startS);
    times.add(endS);
  }
  const choose = prepareChooser(input);
  const changes: RunwayConfigurationChange[] = [];
  for (const timeS of [...times].sort((a, b) => a - b)) {
    if (timeS < 0 || timeS >= dayS) continue;
    wind = winds.get(timeS) ?? wind;
    const configuration = choose(timeS, wind);
    const previous = changes.at(-1);
    if (!previous || previous.configuration?.id !== configuration?.id) {
      changes.push({ timeS, configuration });
    }
  }
  return changes;
}
