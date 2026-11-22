import { describe, expect, it } from 'vitest';
import { aircraftCode, aircraftTypes, codeAdmits, codeForSpan } from '../../src/schema';

describe('aircraft catalogue', () => {
  it('codes follow ICAO wingspan bounds', () => {
    expect(codeForSpan(14.9)).toBe('A');
    expect(codeForSpan(15)).toBe('B');
    expect(codeForSpan(35.8)).toBe('C');
    expect(codeForSpan(64.8)).toBe('E');
    expect(codeForSpan(79.8)).toBe('F');
    expect(() => codeForSpan(80)).toThrow();
  });
  it('every class is present and codes match the batch table', () => {
    const byId = Object.fromEntries(aircraftTypes.map((t) => [t.id, aircraftCode(t)]));
    expect(byId).toMatchObject({
      A388: 'F',
      B748: 'F',
      B77W: 'E',
      A20N: 'C',
      E190: 'C',
      SF34: 'B',
      C25C: 'B',
      EC45: null,
    });
    expect(new Set(aircraftTypes.map((t) => t.class)).size).toBe(7);
  });
  it('a limit admits its own code and smaller', () => {
    expect(codeAdmits('E', 'C')).toBe(true);
    expect(codeAdmits('C', 'D')).toBe(false);
  });
});
