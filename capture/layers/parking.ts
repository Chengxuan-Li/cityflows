// Capture layer: fuller car parks. About `occupancy` of the spaces taken, the simulation's own
// parked cars kept, every car in a real colour.

export const params = { occupancy: 0.85 };

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface ParkedSnapshot {
  occupied: Uint8Array;
  vclass: Uint8Array;
  id: Uint32Array;
  hues: Uint32Array;
}
interface ParkedCars {
  setSnapshot(snapshot: ParkedSnapshot | null): void;
}
/** Real car colours, mostly white, grey, silver and black. */
export const carColours = [
  0xe8e8e6, 0xe8e8e6, 0xd9dadb, 0xb8bcc0, 0xb8bcc0, 0x8e9397, 0x5d6266, 0x2b2d30, 0x2b2d30,
  0x1f2a44, 0x6b1f24, 0x3c4b5c, 0x8a8f7a,
];
/** About 85 % of the spaces taken, the simulation's own parked cars kept; every car in a real
 * colour. */
export function fillParking(
  parked: ParkedCars | undefined,
  spaces: number,
  current: ParkedSnapshot | null,
  occupancy: number,
) {
  if (!parked || !spaces) return () => {};
  const original = parked.setSnapshot.bind(parked);
  const fill = (snapshot: ParkedSnapshot | null): ParkedSnapshot => {
    const bytes = Math.ceil(spaces / 8);
    const occupied = new Uint8Array(bytes);
    if (snapshot) occupied.set(snapshot.occupied.subarray(0, bytes));
    const hues = new Uint32Array(spaces);
    for (let i = 0; i < spaces; i++) {
      if (hash(i * 0.731 + 5) < occupancy) occupied[i >> 3]! |= 1 << (i & 7);
      hues[i] = carColours[Math.floor(hash(i * 1.913) * carColours.length)]!;
    }
    return {
      occupied,
      vclass: snapshot?.vclass.slice(0, spaces) ?? new Uint8Array(spaces),
      id: snapshot?.id.slice(0, spaces) ?? new Uint32Array(spaces),
      hues,
    };
  };
  parked.setSnapshot = (snapshot) => original(fill(snapshot));
  parked.setSnapshot(current);
  return () => {
    parked.setSnapshot = original;
    original(current);
  };
}
