import type { City, Command } from '../../schema';
import { batch } from './batch';
import { editNode } from './node';
import { editPlace } from './place';
import { editParking, editRoadParking } from './parking';
import { editRoad } from './road';
import { editRamp } from './ramp';
import { editRoundabout } from './roundabout';
import { editTopology } from './topology';
import type { CommandPatch } from './types';
import { diffCity } from '../patch';
import { dissolveTouched, joinJunctions, leaveJunctionGroup } from './groups';

export function dispatch(city: City, command: Command): CommandPatch {
  switch (command.kind) {
    case 'setRoadParking':
      return editRoadParking(city, command);
    case 'setParkingAttributes':
      return editParking(city, command);
    case 'setMarkingTheme':
      return { set: {}, remove: {}, markingTheme: command.theme };
    case 'restoreCity':
      return diffCity(city, command.city);
    case 'addRoundabout':
    case 'removeRoundabout':
      return dissolveTouched(city, editRoundabout(city, command));
    case 'addRamp':
    case 'removeRamp':
      return dissolveTouched(city, editRamp(city, command));
    case 'reverseRoad':
    case 'setStreetDirection':
      return dissolveTouched(city, editRoad(city, command));
    case 'setRoadLanes':
    case 'setRoadAttributes':
    case 'setRoadAccess':
    case 'setCrossing':
      return editRoad(city, command);
    case 'setTurnRule':
    case 'clearTurnRule':
    case 'setControl':
    case 'setSignal':
      return editNode(city, command);
    case 'joinJunctions':
      return joinJunctions(city, command.nodeIds);
    case 'leaveJunctionGroup':
      return leaveJunctionGroup(city, command.nodeId);
    case 'addPlace':
    case 'updatePlace':
    case 'setConnectors':
    case 'deletePlace':
      return editPlace(city, command);
    case 'batch':
      return batch(city, command.commands, dispatch);
    case 'moveNode':
      return editTopology(city, command);
    case 'addRoad':
    case 'deleteRoad':
    case 'splitRoad':
    case 'mergeRoads':
      return dissolveTouched(city, editTopology(city, command));
  }
}
