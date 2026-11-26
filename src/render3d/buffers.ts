import { BufferAttribute, BufferGeometry } from 'three';

// TASK-357: three's `mergeVertices` (BufferGeometryUtils) without its string keys, which were
// about a tenth of Heathrow's 3D build, and `computeVertexNormals` on the arrays directly. Vertices merge exactly as there: each attribute
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

/** `geometry.computeVertexNormals()` as three computes it (the same arithmetic, read and written
 * through float32 arrays in the same order), on the arrays rather than through Vector3. */
export function computeVertexNormals(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position');
  if (!(position instanceof BufferAttribute) || position.normalized || position.itemSize !== 3)
    throw new Error('computeVertexNormals: plain float positions only');
  let normal = geometry.getAttribute('normal');
  if (normal === undefined || normal.count !== position.count) {
    normal = new BufferAttribute(new Float32Array(position.count * 3), 3);
    geometry.setAttribute('normal', normal);
  } else if (!(normal instanceof BufferAttribute) || normal.normalized || normal.itemSize !== 3)
    throw new Error('computeVertexNormals: plain float normals only');
  else normal.array.fill(0);
  const p = position.array,
    n = normal.array;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  for (let i = 0; i < count; i += 3) {
    const a = (index ? index.getX(i) : i) * 3,
      b = (index ? index.getX(i + 1) : i + 1) * 3,
      c = (index ? index.getX(i + 2) : i + 2) * 3;
    const bx = p[b]!,
      by = p[b + 1]!,
      bz = p[b + 2]!;
    // cb × ab, as Vector3.cross.
    const cbx = p[c]! - bx,
      cby = p[c + 1]! - by,
      cbz = p[c + 2]! - bz;
    const abx = p[a]! - bx,
      aby = p[a + 1]! - by,
      abz = p[a + 2]! - bz;
    const x = cby * abz - cbz * aby,
      y = cbz * abx - cbx * abz,
      z = cbx * aby - cby * abx;
    if (index) {
      // All three read before any is written, as three does (a repeated corner adds once).
      const ax = n[a]! + x,
        ay = n[a + 1]! + y,
        az = n[a + 2]! + z;
      const bnx = n[b]! + x,
        bny = n[b + 1]! + y,
        bnz = n[b + 2]! + z;
      const cx = n[c]! + x,
        cy = n[c + 1]! + y,
        cz = n[c + 2]! + z;
      n[a] = ax;
      n[a + 1] = ay;
      n[a + 2] = az;
      n[b] = bnx;
      n[b + 1] = bny;
      n[b + 2] = bnz;
      n[c] = cx;
      n[c + 1] = cy;
      n[c + 2] = cz;
    } else
      for (const v of [a, b, c]) {
        n[v] = x;
        n[v + 1] = y;
        n[v + 2] = z;
      }
  }
  // normalizeNormals: Vector3.normalize divides by the length (or 1) as a multiply by 1 / length.
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i]!,
      y = n[i + 1]!,
      z = n[i + 2]!;
    const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    n[i] = x * scale;
    n[i + 1] = y * scale;
    n[i + 2] = z * scale;
  }
  normal.needsUpdate = true;
}
