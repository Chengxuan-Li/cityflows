import { expect, it } from 'vitest';
import { heightAt } from './heights';

it('joins node heights with smoothstep ramps over at most 60 metres', () => {
  const road = { lengthM: 240, deckM: 5, fromM: 0, toM: 0 };
  expect(heightAt(road, 0)).toBe(0);
  expect(heightAt(road, 30)).toBe(2.5);
  expect(heightAt(road, 60)).toBe(5);
  expect(heightAt(road, 120)).toBe(5);
  expect(heightAt(road, 240)).toBe(0);
  for (const end of [0, road.lengthM]) {
    expect(Math.abs(heightAt(road, end + 1e-4) - heightAt(road, end))).toBeLessThan(1e-6);
    expect(Math.abs(heightAt(road, end - 1e-4) - heightAt(road, end))).toBeLessThan(1e-6);
  }
});

it('keeps flat grades exact and ramps short decks from either end', () => {
  for (const deckM of [-5, 0, 5, 10]) {
    const flat = { lengthM: 50, deckM, fromM: deckM, toM: deckM };
    expect(heightAt(flat, 0)).toBe(deckM);
    expect(heightAt(flat, 25)).toBe(deckM);
    expect(heightAt(flat, 50)).toBe(deckM);
  }
  const short = { lengthM: 40, deckM: 5, fromM: 0, toM: 10 };
  expect(heightAt(short, 0)).toBe(0);
  expect(heightAt(short, 20)).toBe(5);
  expect(heightAt(short, 40)).toBe(10);
});
