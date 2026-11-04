import { expect, it } from 'vitest';
import { signalApproach } from '../../fixtures/signal-approach';
import { compile } from '../../network';
import { approachMarkings } from './roads';

it('derives signal, priority and turn markings only from usable compiled movements', () => {
  const source = signalApproach();
  const result = compile(source);
  if (!result.ok) throw new Error('Fixture must compile');
  const city = result.compiled;
  const node = city.nodes.find((node) => node.signal)!;
  const lane = city.lanes[city.movements[node.movements[0]!]!.fromLane]!;
  expect(approachMarkings(city, lane)).toMatchObject({
    stop: true,
    yield: false,
    crossingEnd: true,
  });
  for (const turn of approachMarkings(city, lane).turns) {
    expect(lane.out.some((index) => city.movements[index]!.turn === turn)).toBe(true);
  }
  node.signal = null;
  node.control = 'yield';
  for (const index of lane.out) city.movements[index]!.priority = 2;
  expect(approachMarkings(city, lane)).toMatchObject({
    stop: false,
    yield: true,
    crossingEnd: false,
  });
  node.control = 'stop';
  expect(approachMarkings(city, lane).stop).toBe(true);
  for (const index of lane.out) city.movements[index]!.priority = 32;
  expect(approachMarkings(city, lane).stop).toBe(false);
  node.control = 'signal';
  for (const index of lane.out) city.movements[index]!.neverGreen = true;
  expect(approachMarkings(city, lane)).toMatchObject({
    stop: false,
    yield: false,
    crossingEnd: false,
    turns: [],
  });
});
