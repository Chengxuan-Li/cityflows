import { createContext, useContext } from 'react';
import type { AircraftState } from '../sim/types';
import type { FlightBoard } from '../sim/flight-operations';

export const flightBoardContext = createContext<FlightBoard | null>(null);
export const useFlightBoard = () => useContext(flightBoardContext);

export const aircraftStateLabels: Record<AircraftState, string> = {
  approach: 'On approach',
  flare: 'Landing',
  'landing-roll': 'Landing roll',
  'go-around': 'Going around',
  taxi: 'Taxiing',
  holding: 'Holding',
  'line-up': 'Lining up',
  'takeoff-roll': 'Take-off roll',
  rotation: 'Rotating',
  climb: 'Climbing out',
  parked: 'Parked',
  pushback: 'Pushback',
  tow: 'Under tow',
  'hover-taxi': 'Hover-taxiing',
  'vertical-climb': 'Lifting off',
  'helicopter-climb': 'Climbing out',
  'helicopter-approach': 'On approach',
  'vertical-descent': 'Landing',
};
