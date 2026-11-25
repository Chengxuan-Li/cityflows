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

/** Maximum demonstrated crosswind by aircraft type, knots: stated approximations of the
 * manufacturers' published figures (TASK-300). */
export const demonstratedCrosswindKt: Readonly<Record<string, number>> = {
  A388: 38,
  B748: 36,
  B77W: 38,
  A359: 40,
  A333: 32,
  B789: 40,
  A20N: 38,
  B738: 33,
  A21N: 35,
  BCS3: 32,
  E190: 30,
  E175: 30,
  CRJ9: 27,
  AT76: 35,
  DH8D: 32,
  SF34: 25,
  C25C: 25,
  PC24: 29,
  GLF6: 32,
};

/** Per-airport configuration tables by ICAO code. An airport without one (London City) uses the
 * derived configurations and switches by wind alone. */
export const airportRunwayConcepts: Readonly<
  Record<string, Pick<RunwayConfigurationInput, 'configurations' | 'concepts'>>
> = {
  // Zurich's operating concepts approximate AIP Switzerland, LSZH AD 2.20. TASK-328 uses
  // north from opening to curfew and keeps east and south as wind alternatives.
  LSZH: {
    configurations: [
      { id: 'north', arrivalEnds: ['14'], departureEnds: ['16', '28'] },
      { id: 'east', arrivalEnds: ['28'], departureEnds: ['32', '34'] },
      { id: 'south', arrivalEnds: ['34'], departureEnds: ['32'] },
    ],
    concepts: [
      { startS: 6 * 3600, endS: 23.5 * 3600, configurationId: 'north' },
      { startS: 23.5 * 3600, endS: 6 * 3600, configurationId: null },
    ],
  },
  // TASK-312: Boston's main flows, stated approximations of Massport's preferential runway use:
  // southwest flow (landings 22L, take-offs 22R) and northeast flow (landings 4R, take-offs 4L),
  // on the parallel pair that does not cross itself; the wind chooses between them.
  KBOS: {
    configurations: [
      { id: 'southwest', arrivalEnds: ['22L'], departureEnds: ['22R'] },
      { id: 'northeast', arrivalEnds: ['4R'], departureEnds: ['4L'] },
    ],
  },
  // Heathrow's segregated mode approximates the published runway alternation (TASK-304/312).
  // TASK-328 keeps one pair of assignments per wind direction for the whole day.
  // The reciprocal role assignments are still available to saved custom concepts.
  EGLL: {
    configurations: [
      { id: '27L arrivals', arrivalEnds: ['27L'], departureEnds: ['27R'] },
      { id: '27R arrivals', arrivalEnds: ['27R'], departureEnds: ['27L'] },
      { id: '09L arrivals', arrivalEnds: ['09L'], departureEnds: ['09R'] },
      { id: '09R arrivals', arrivalEnds: ['09R'], departureEnds: ['09L'] },
    ],
    concepts: [{ startS: 0, endS: dayS, configurationId: '27L arrivals' }],
  },
};

/** The headwind (negative: tailwind) and crosswind on a runway heading, knots. */
export function windComponents(headingRad: number, wind: AirportWind) {
  const angle = (wind.fromDeg - 90) * degToRad - headingRad;
  return {
    headwindKt: wind.speedKt * Math.cos(angle),
    crosswindKt: Math.abs(wind.speedKt * Math.sin(angle)),
  };
}

export function createRunwayChooser(input: RunwayConfigurationInput) {
  const ends = new Map(input.ends.map(({ designator, headingRad }) => [designator, headingRad]));
  const configurations = input.configurations?.length
    ? input.configurations
    : deriveRunwayConfigurations(input.ends);
  const headingsOf = (configuration: RunwayConfiguration) => {
    const used = new Set([...configuration.arrivalEnds, ...configuration.departureEnds]);
    if (!used.size) throw new Error(`Runway configuration ${configuration.id} has no ends`);
    return [...used].map((end) => {
      const heading = ends.get(end);
      if (heading === undefined)
        throw new Error(`Unknown runway end ${end} in ${configuration.id}`);
      return heading;
    });
  };
  const candidates = configurations.map((configuration) => ({
    configuration,
    headings: headingsOf(configuration),
  }));
  const tailwindLimit = input.tailwindLimitKt ?? 5;
  const crosswindLimit = Math.min(...Object.values(input.crosswindLimitsKt ?? {}));
  const safe = (headings: number[], wind: AirportWind) =>
    headings.every((heading) => {
      const { headwindKt, crosswindKt } = windComponents(heading, wind);
      return (
        -headwindKt <= tailwindLimit + windEpsilonKt &&
        crosswindKt <= crosswindLimit + windEpsilonKt
      );
    });
  const conceptAt = (timeS: number) =>
    input.concepts?.find(({ startS, endS }) =>
      startS <= endS ? startS <= timeS && timeS < endS : startS <= timeS || timeS < endS,
    );

  function choose(timeS: number, wind: AirportWind): RunwayConfiguration | null {
    const concept = conceptAt(timeS);
    if (concept?.configurationId === null) return null;
    let best = null;
    for (const { configuration, headings } of candidates) {
      if (!safe(headings, wind)) continue;
      if (configuration.id === concept?.configurationId) return configuration;
      const endCount = headings.length;
      const headwind =
        headings.reduce((sum, heading) => sum + windComponents(heading, wind).headwindKt, 0) /
        endCount;
      if (
        !best ||
        endCount > best.endCount ||
        (endCount === best.endCount && headwind > best.headwind + windEpsilonKt)
      ) {
        best = { configuration, endCount, headwind };
      }
    }
    return best?.configuration ?? null;
  }

  return {
    configurations,
    choose,
    conceptAt,
    /** Whether every end a configuration uses keeps the tailwind and crosswind limits. */
    admits: (configuration: RunwayConfiguration, wind: AirportWind) =>
      safe(headingsOf(configuration), wind),
  };
}

/** Chooses a wind-safe concept, then the safe option with most ends and strongest mean headwind. */
export function chooseRunwayConfiguration(
  input: RunwayConfigurationInput,
  timeS: number,
  wind: AirportWind,
) {
  return createRunwayChooser(input).choose(timeS, wind);
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
  const { choose } = createRunwayChooser(input);
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
