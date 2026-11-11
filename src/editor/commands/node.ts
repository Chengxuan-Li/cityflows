import type { City, Command, Patch, TurnRule } from '../../schema';
import { editGroupControl, groupOf } from './groups';
import { requireEntity } from './types';

type NodeCommand = Extract<
  Command,
  { kind: 'setTurnRule' | 'clearTurnRule' | 'setControl' | 'setSignal' }
>;
type TurnKey = Omit<TurnRule, 'allowed' | 'provenance'>;

function sameKey(a: TurnKey, b: TurnKey): boolean {
  return a.from === b.from && a.to === b.to && a.fromLane === b.fromLane && a.toLane === b.toLane;
}

export function editNode(city: City, command: NodeCommand): Patch {
  const node = requireEntity(city.nodes, command.nodeId);
  const group = groupOf(city, node.id);
  if (group && (command.kind === 'setControl' || command.kind === 'setSignal'))
    return editGroupControl(city, group, command);
  let next = { ...node };
  switch (command.kind) {
    case 'setTurnRule': {
      const rules = [...node.turnRules];
      // The compiler uses the last matching rule when specificity ties.
      const index = rules.findLastIndex((rule) => sameKey(rule, command.rule));
      if (index === -1) rules.push(command.rule);
      else rules[index] = command.rule;
      next.turnRules = rules;
      break;
    }
    case 'clearTurnRule':
      next.turnRules = node.turnRules.filter((rule) => !sameKey(rule, command.rule));
      break;
    case 'setControl':
      next = {
        ...node,
        control: command.control,
        signal: command.control === 'signal' ? (command.signal ?? node.signal) : null,
        minorRoads:
          command.control === 'yield' || command.control === 'stop'
            ? (command.minorRoads ?? node.minorRoads)
            : [],
      };
      break;
    case 'setSignal':
      next.control = 'signal';
      next.signal = command.signal;
      next.minorRoads = [];
      break;
  }
  return { set: { nodes: { [node.id]: next } }, remove: {} };
}
