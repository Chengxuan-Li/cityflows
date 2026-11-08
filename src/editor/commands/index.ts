import type { City, Command } from '../../schema';
import { batch } from './batch';
import { editNode } from './node';
import { editPlace } from './place';
import { editRoad } from './road';
import { editRamp } from './ramp';
import { editRoundabout } from './roundabout';
import { editTopology } from './topology';
import type { CommandPatch } from './types';
import { diffCity } from '../patch';

export function dispatch(city: City, command: Command): CommandPatch {
  switch (command.kind) {
    case 'setMarkingTheme':
      return { set: {}, remove: {}, markingTheme: command.theme };
    case 'restoreCity':
      return diffCity(city, command.city);
    case 'addRoundabout':
    case 'removeRoundabout':
      return editRoundabout(city, command);
    case 'addRamp':
    case 'removeRamp':
      return editRamp(city, command);
    case 'setRoadLanes':
    case 'setRoadAttributes':
    case 'setRoadAccess':
    case 'reverseRoad':
    case 'setStreetDirection':
    case 'setCrossing':
      return editRoad(city, command);
    case 'setTurnRule':
    case 'clearTurnRule':
    case 'setControl':
    case 'setSignal':
      return editNode(city, command);
    case 'addPlace':
    case 'updatePlace':
    case 'setConnectors':
    case 'deletePlace':
      return editPlace(city, command);
    case 'batch':
      return batch(city, command.commands, dispatch);
    case 'addRoad':
    case 'deleteRoad':
    case 'splitRoad':
    case 'mergeRoads':
    case 'moveNode':
      return editTopology(city, command);
  }
}
