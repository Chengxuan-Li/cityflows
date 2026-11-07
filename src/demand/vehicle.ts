import { createRandom } from '../geo/random';
import {
  DEFAULT_CLASS_SHARES,
  vehicleClasses,
  type DemandConfig,
  type TripRequest,
} from '../schema';
import { weightedChoice } from './selection';

/** Key each assignment independently so class shares never change the existing trip draws. */
export function tripVehicle(
  id: string,
  demand: DemandConfig,
  group: 'local' | 'through',
  mode: TripRequest['mode'] = 'car',
): Pick<TripRequest, 'vehicleClass' | 'purpose'> {
  if (mode !== 'car') return { vehicleClass: 'car', purpose: 'private' };
  const random = createRandom(demand.seed).derive('vehicle').derive(id);
  const shares = (demand.classShares ?? DEFAULT_CLASS_SHARES)[group];
  const vehicleClass = weightedChoice(vehicleClasses, (value) => shares[value], random)!;
  return {
    vehicleClass,
    purpose:
      group === 'through'
        ? 'through'
        : vehicleClass === 'van'
          ? random.next() < 0.5
            ? 'delivery'
            : 'service'
          : 'private',
  };
}
