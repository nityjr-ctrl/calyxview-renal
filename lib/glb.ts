// A small glTF 2.0 binary (GLB) writer for the builder's meshes. Written by
// hand rather than with three's GLTFExporter so the output is predictable and
// the tests can check it in Node.
//
// glTF's convention is metres and y-up, and general viewers expect a model
// near the origin. The builder works in RAS millimetres (+x right, +y
// anterior, +z superior), so each point becomes, about the centre of the
// whole model's bounding box:
//   x_m = x / 1000, y_m = z / 1000, z_m = -y / 1000
// That is a proper rotation (superior is up, anterior faces the viewer), so
// triangle winding and normals stay correct. The STL download keeps RAS mm.

export type GlbMesh = {
  name: string;
  label: string;
  colour: string;
  opacity: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
};

/** The bounding-box centre, in RAS mm, of every vertex of every mesh. */
export function boundsCentreMm(meshes: GlbMesh[]): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let a = 0; a < 3; a += 1) {
        if (p[i + a] < lo[a]) lo[a] = p[i + a];
        if (p[i + a] > hi[a]) hi[a] = p[i + a];
      }
    }
  }
  if (!Number.isFinite(lo[0])) return [0, 0, 0];
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
}

/** RAS mm about a centre to glTF metres, y-up. */
export function toGltfPositions(positions: Float32Array, centre: [number, number, number]): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - centre[0];
    const y = positions[i + 1] - centre[1];
    const z = positions[i + 2] - centre[2];
    out[i] = x / 1000;
    out[i + 1] = z / 1000;
    out[i + 2] = -y / 1000;
  }
  return out;
}

/** The same rotation for normals, renormalised. */
export function toGltfNormals(normals: Float32Array): Float32Array {
  const out = new Float32Array(normals.length);
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 2];
    const z = -normals[i + 1];
    const length = Math.hypot(x, y, z) || 1;
    out[i] = x / length;
    out[i + 1] = y / length;
    out[i + 2] = z / length;
  }
  return out;
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function colourFactor(hex: string, opacity: number): [number, number, number, number] {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? 'cccccc';
  const rgb = [0, 2, 4].map((at) => srgbToLinear(parseInt(value.slice(at, at + 2), 16) / 255));
  return [rgb[0], rgb[1], rgb[2], Math.min(1, Math.max(0, opacity))];
}

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_INT = 5125;

const pad4 = (n: number) => (n + 3) & ~3;

/** Encode the meshes as one GLB: a node, mesh and material per structure. */
export function encodeGlb(meshes: GlbMesh[]): ArrayBuffer {
  const centre = boundsCentreMm(meshes);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const gltfMeshes: Array<Record<string, unknown>> = [];
  const materials: Array<Record<string, unknown>> = [];
  const nodes: Array<Record<string, unknown>> = [];

  const addView = (bytes: Uint8Array, target: number) => {
    const offset = byteLength;
    chunks.push(bytes);
    const padded = pad4(bytes.byteLength);
    if (padded > bytes.byteLength) chunks.push(new Uint8Array(padded - bytes.byteLength));
    byteLength += padded;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    return bufferViews.length - 1;
  };
  const vec3Bounds = (values: Float32Array) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < values.length; i += 3) {
      for (let a = 0; a < 3; a += 1) {
        min[a] = Math.min(min[a], values[i + a]);
        max[a] = Math.max(max[a], values[i + a]);
      }
    }
    return { min, max };
  };

  for (const mesh of meshes) {
    if (mesh.indices.length === 0 || mesh.positions.length === 0) continue;
    const positions = toGltfPositions(mesh.positions, centre);
    const normals = toGltfNormals(mesh.normals);
    const count = positions.length / 3;
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: addView(new Uint8Array(positions.buffer), ARRAY_BUFFER),
      componentType: FLOAT,
      count,
      type: 'VEC3',
      ...vec3Bounds(positions),
    });
    const normalAccessor = accessors.length;
    accessors.push({
      bufferView: addView(new Uint8Array(normals.buffer), ARRAY_BUFFER),
      componentType: FLOAT,
      count,
      type: 'VEC3',
    });
    const indexAccessor = accessors.length;
    const indices = Uint32Array.from(mesh.indices);
    let maxIndex = 0;
    for (const value of indices) if (value > maxIndex) maxIndex = value;
    accessors.push({
      bufferView: addView(new Uint8Array(indices.buffer), ELEMENT_ARRAY_BUFFER),
      componentType: UNSIGNED_INT,
      count: indices.length,
      type: 'SCALAR',
      min: [0],
      max: [maxIndex],
    });
    const material = materials.length;
    materials.push({
      name: mesh.label,
      pbrMetallicRoughness: { baseColorFactor: colourFactor(mesh.colour, mesh.opacity), metallicFactor: 0, roughnessFactor: 0.6 },
      ...(mesh.opacity < 1 ? { alphaMode: 'BLEND' } : {}),
      doubleSided: true,
    });
    gltfMeshes.push({
      name: mesh.name,
      primitives: [{ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor }, indices: indexAccessor, material, mode: 4 }],
    });
    nodes.push({ name: mesh.label, mesh: gltfMeshes.length - 1 });
  }

  const json = {
    asset: { version: '2.0', generator: 'CalyxView Renal browser builder' },
    extras: {
      units: 'metres',
      up: '+y',
      fromRasMm: 'x_m = (x - cx) / 1000, y_m = (z - cz) / 1000, z_m = -(y - cy) / 1000',
      centreRasMm: centre,
    },
    scene: 0,
    scenes: [{ name: 'CalyxView Renal', nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = pad4(jsonBytes.byteLength);
  if (jsonPadded > jsonBytes.byteLength) {
    const spaced = new Uint8Array(jsonPadded).fill(0x20);
    spaced.set(jsonBytes);
    jsonBytes = spaced;
  }
  const total = 12 + 8 + jsonBytes.byteLength + 8 + byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  let at = 20 + jsonBytes.byteLength;
  view.setUint32(at, byteLength, true);
  view.setUint32(at + 4, 0x004e4942, true); // 'BIN\0'
  at += 8;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}
