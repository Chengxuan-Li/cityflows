import { describe, expect, it } from 'vitest';
import {
  chooseRunwayConfiguration,
  deriveRunwayConfigurations,
  runwayConfigurationChanges,
  type RunwayConfigurationInput,
} from '../../src/sim/runway-configuration';

const hourS = 3600;
const east = { fromDeg: 90, speedKt: 10 };
const west = { fromDeg: 270, speedKt: 10 };
const calm = { fromDeg: 0, speedKt: 0 };
const london: RunwayConfigurationInput = {
  ends: [
    { designator: '09', headingRad: 0 },
    { designator: '27', headingRad: Math.PI },
  ],
};

describe('runway configurations', () => {
  it('switches on wind reversal and ignores repeated samples with the same configuration', () => {
    expect(
      runwayConfigurationChanges(london, [
        { timeS: 0, wind: east },
        { timeS: 6 * hourS, wind: east },
        { timeS: 9 * hourS, wind: west },
      ]).map(({ timeS, configuration }) => [timeS, configuration?.id]),
    ).toEqual([
      [0, '09'],
      [9 * hourS, '27'],
    ]);
  });

  it('groups parallel ends and leaves crossing runway pairs to explicit configurations', () => {
    const ends = [
      { designator: '09L', headingRad: -0.01 },
      { designator: '09R', headingRad: 0.01 },
      { designator: '18', headingRad: Math.PI / 2 },
    ];
    expect(deriveRunwayConfigurations(ends).map(({ id }) => id)).toEqual([
      '09L',
      '09R',
      '18',
      '09L+09R',
    ]);
    expect(chooseRunwayConfiguration({ ends }, 0, east)).toMatchObject({
      arrivalEnds: ['09L', '09R'],
      departureEnds: ['09L', '09R'],
    });
    expect(chooseRunwayConfiguration({ ends, configurations: [] }, 0, east)?.id).toBe('09L+09R');
    const crossing = { id: 'crossing', arrivalEnds: ['09L'], departureEnds: ['18'] };
    expect(chooseRunwayConfiguration({ ends, configurations: [crossing] }, 0, east)).toEqual(
      crossing,
    );
  });

  it('uses the concept when permitted, falls back in wind, and honors a closure across midnight', () => {
    const input: RunwayConfigurationInput = {
      ...london,
      concepts: [
        { startS: 22 * hourS, endS: 6 * hourS, configurationId: null },
        { startS: 6 * hourS, endS: 16 * hourS, configurationId: '09' },
        { startS: 16 * hourS, endS: 22 * hourS, configurationId: '27' },
      ],
    };
    expect(
      runwayConfigurationChanges(input, [{ timeS: 0, wind: calm }]).map(
        ({ timeS, configuration }) => [timeS / hourS, configuration?.id ?? null],
      ),
    ).toEqual([
      [0, null],
      [6, '09'],
      [16, '27'],
      [22, null],
    ]);
    expect(chooseRunwayConfiguration(input, 16 * hourS, east)?.id).toBe('09');
    expect(chooseRunwayConfiguration(input, 16 * hourS, { ...east, speedKt: 5 })?.id).toBe('27');
    expect(
      chooseRunwayConfiguration({ ...input, tailwindLimitKt: 4 }, 16 * hourS, {
        ...east,
        speedKt: 5,
      })?.id,
    ).toBe('09');
  });

  it('checks tailwind and the strictest supplied crosswind limit on departure ends too', () => {
    const input: RunwayConfigurationInput = {
      ...london,
      ends: [...london.ends, { designator: '18', headingRad: Math.PI / 2 }],
      configurations: [{ id: 'crossing', arrivalEnds: ['09'], departureEnds: ['18'] }],
    };
    expect(
      chooseRunwayConfiguration({ ...input, crosswindLimitsKt: { E190: 11 } }, 0, east)?.id,
    ).toBe('crossing');
    expect(
      chooseRunwayConfiguration({ ...input, crosswindLimitsKt: { E190: 11, C25C: 8 } }, 0, east),
    ).toBeNull();
    expect(chooseRunwayConfiguration(input, 0, { fromDeg: 0, speedKt: 8 })).toBeNull();
  });
});
