import { BufferAttribute, BufferGeometry } from 'three';

// TASK-357: three's `mergeVertices` (BufferGeometryUtils) without its string keys, which were
// about a tenth of Heathrow's 3D build. Vertices merge exactly as there: each attribute
// component truncated to the tolerance's decimal places, the first vertex of a key kept, the
// same index order. For the plain (not interleaved, no morph) geometries the 3D build makes.

const same = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));

export function mergeVertices(geometry: BufferGeometry, tolerance = 1e-4) {
  if (Object.keys(geometry.morphAttributes).length)
    throw new Error('mergeVertices: morph attributes are not supported');
  tolerance = Math.max(tolerance, Number.EPSILON);
  const halfTolerance = tolerance * 0.5;
  const exponent = Math.log10(1 / tolerance);
  const hashMultiplier = Math.pow(10, exponent);
  const hashAdditive = halfTolerance * hashMultiplier;
  const indices = geometry.getIndex();
  const vertexCount = indices ? indices.count : geometry.getAttribute('position').count;
  const attributes = Object.keys(geometry.attributes).map((name) => {
    const attribute = geometry.getAttribute(name);
    if (!(attribute instanceof BufferAttribute))
      throw new Error('mergeVertices: interleaved attributes are not supported');
    return attribute;
  });
  const width = attributes.reduce((sum, a) => sum + a.itemSize, 0);
  const key = new Float64Array(width);
  // Open addressing on the truncated components; a slot holds a kept vertex's number + 1.
  let capacity = 1 << Math.max(4, Math.ceil(Math.log2(vertexCount * 2 + 1)));
  let slots = new Int32Array(capacity);
  const keys = new Float64Array(Math.max(1, vertexCount) * width);
  const sourceIndices: number[] = [];
  const newIndices: number[] = [];
  const hashOf = (k: Float64Array, offset: number) => {
    let h = 0x811c9dc5;
    for (let j = 0; j < width; j++) {
      const v = k[offset + j]!;
      h = Math.imul(h ^ (v | 0), 0x01000193);
      h = Math.imul(h ^ ((v / 4294967296) | 0), 0x01000193);
    }
    return h >>> 0;
  };
  for (let i = 0; i < vertexCount; i++) {
    const index = indices ? indices.getX(i) : i;
    let c = 0;
    for (const attribute of attributes) {
      const { array, itemSize, normalized } = attribute;
      for (let k = 0; k < itemSize; k++)
        key[c++] = Math.trunc(
          (normalized ? attribute.getComponent(index, k) : array[index * itemSize + k]!) *
            hashMultiplier +
            hashAdditive,
        );
    }
    const mask = capacity - 1;
    let slot = hashOf(key, 0) & mask;
    let found = -1;
    for (; slots[slot]; slot = (slot + 1) & mask) {
      const kept = slots[slot]! - 1;
      let j = 0;
      while (j < width && same(keys[kept * width + j]!, key[j]!)) j++;
      if (j === width) {
        found = kept;
        break;
      }
    }
    if (found >= 0) {
      newIndices.push(found);
      continue;
    }
    const next = sourceIndices.length;
    keys.set(key, next * width);
    slots[slot] = next + 1;
    sourceIndices.push(index);
    newIndices.push(next);
    if ((next + 1) * 2 > capacity) {
      // Grow and rehash the kept vertices.
      capacity *= 2;
      slots = new Int32Array(capacity);
      for (let v = 0; v <= next; v++) {
        let s = hashOf(keys, v * width) & (capacity - 1);
        while (slots[s]) s = (s + 1) & (capacity - 1);
        slots[s] = v + 1;
      }
    }
  }
  const result = new BufferGeometry();
  result.name = geometry.name;
  result.userData = { ...geometry.userData };
  for (const group of geometry.groups)
    result.addGroup(group.start, group.count, group.materialIndex);
  result.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
  for (const [name, attribute] of Object.entries(geometry.attributes) as [
    string,
    BufferAttribute,
  ][]) {
    const { array, itemSize } = attribute;
    const remapped = new (array.constructor as new (length: number) => typeof array)(
      sourceIndices.length * itemSize,
    );
    for (let i = 0; i < sourceIndices.length; i++)
      for (let j = 0; j < itemSize; j++)
        remapped[i * itemSize + j] = array[sourceIndices[i]! * itemSize + j]!;
    const copy = new BufferAttribute(remapped, itemSize, attribute.normalized);
    copy.setUsage(attribute.usage);
    copy.name = attribute.name;
    copy.gpuType = attribute.gpuType;
    result.setAttribute(name, copy);
  }
  result.setIndex(newIndices);
  return result;
}
