import type { SimParams } from '../schema';

export function idmAcceleration(
  params: SimParams['idm'],
  speed: number,
  desiredSpeed: number,
  leaderSpeed: number,
  bumperGap: number,
): number {
  const { aMps2, bMps2, minGapM, headwayS } = params;
  const closing = (speed * (speed - leaderSpeed)) / (2 * Math.sqrt(aMps2 * bMps2));
  const desiredGap = minGapM + Math.max(0, speed * headwayS + closing);
  return aMps2 * (1 - (speed / desiredSpeed) ** 4 - (desiredGap / Math.max(0.01, bumperGap)) ** 2);
}
