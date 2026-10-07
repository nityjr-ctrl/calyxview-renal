import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { buildFromNifti, buildSample, remargin, reportMarkdown, structureVolumeMl } from '../lib/builder/build.ts';
import { isClosed, marchingCubes, maskToSurface, meshVolume, taubinSmooth, TRIANGLE_TABLE } from '../lib/builder/marching-cubes.ts';
import {
  exophyticPoints,
  nearnessPoints,
  paduaComplexity,
  paduaPolar,
  paduaSizePoints,
  polarLines,
  renalComplexity,
  renalLocation,
  renalRPoints,
  sinusEstimateTooLarge,
} from '../lib/builder/nephrometry.ts';
import { encodeNifti, parseNifti, qformAffine, readNifti, toLabelMap } from '../lib/builder/nifti.ts';
import { convexHullMask, countMask, edtSquared, pyRound } from '../lib/builder/volume.ts';

function sphere(n, radius, centre = (n - 1) / 2) {
  const mask = new Uint8Array(n * n * n);
  let index = 0;
  for (let z = 0; z < n; z += 1) {
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1, index += 1) {
        if ((x - centre) ** 2 + (y - centre) ** 2 + (z - centre) ** 2 <= radius * radius) mask[index] = 1;
      }
    }
  }
  return mask;
}

const toArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

test('NIfTI: reads .nii and .nii.gz label maps with their sform', async () => {
  const dims = [6, 5, 4];
  const labels = new Uint8Array(6 * 5 * 4);
  labels[0] = 1;
  labels[7] = 2;
  labels[labels.length - 1] = 3;
  const affine = [-1.5, 0, 0, 10, 0, 1.5, 0, -20, 0, 0, 2.5, 30, 0, 0, 0, 1];
  const raw = encodeNifti(labels, dims, affine, [1.5, 1.5, 2.5]);
  const plain = parseNifti(raw);
  assert.deepEqual(plain.dims, dims);
  assert.equal(plain.affineSource, 'sform');
  assert.deepEqual(plain.affine, affine);
  assert.deepEqual(Array.from(plain.data), Array.from(labels));

  const zipped = await readNifti(toArrayBuffer(gzipSync(Buffer.from(raw))));
  assert.deepEqual(Array.from(zipped.data), Array.from(labels));
  assert.deepEqual(zipped.affine, affine);
});

test('NIfTI: falls back to the qform, then pixdim, and reads int16 big-endian data', () => {
  const dims = [2, 2, 2];
  const raw = new Uint8Array(encodeNifti(new Uint8Array(8), dims, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], [2, 3, 4]));
  const view = new DataView(raw.buffer);
  view.setInt16(254, 0, true); // no sform
  view.setInt16(252, 1, true); // qform: 180 degrees about z, so x and y flip
  view.setFloat32(256, 0, true);
  view.setFloat32(260, 0, true);
  view.setFloat32(264, 1, true);
  view.setFloat32(268, 5, true);
  const viaQform = parseNifti(raw.buffer);
  assert.equal(viaQform.affineSource, 'qform');
  assert.deepEqual(
    viaQform.affine.map((value) => Math.round(value * 1000) / 1000 + 0),
    [-2, 0, 0, 5, 0, -3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1],
  );
  assert.deepEqual(qformAffine([0, 0, 0], [0, 0, 0], [-1, 1, 1, 1]).slice(0, 11).map((value) => value + 0), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1]);

  view.setInt16(252, 0, true);
  assert.equal(parseNifti(raw.buffer).affineSource, 'pixdim');
  assert.deepEqual(parseNifti(raw.buffer).affine, [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);

  // Big-endian int16 with values 0..7.
  const big = new Uint8Array(352 + 16);
  big.set(raw.subarray(0, 352));
  const header = new DataView(big.buffer);
  const swap16 = (offset) => header.setInt16(offset, new DataView(raw.buffer).getInt16(offset, true), false);
  const swap32 = (offset) => header.setInt32(offset, new DataView(raw.buffer).getInt32(offset, true), false);
  const swapF = (offset) => header.setFloat32(offset, new DataView(raw.buffer).getFloat32(offset, true), false);
  swap32(0);
  for (let d = 0; d <= 7; d += 1) swap16(40 + 2 * d);
  header.setInt16(70, 4, false);
  header.setInt16(72, 16, false);
  for (let p = 0; p < 8; p += 1) swapF(76 + 4 * p);
  swapF(108);
  swapF(112);
  swapF(116);
  header.setInt16(252, 0, false);
  header.setInt16(254, 0, false);
  for (let v = 0; v < 8; v += 1) header.setInt16(352 + 2 * v, v, false);
  const parsed = parseNifti(big.buffer);
  assert.deepEqual(Array.from(parsed.data), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('NIfTI: a CT is refused politely, a label map is accepted', () => {
  const ct = new Int16Array([-1000, -90, 40, 160, 0, 0, 0, 0]);
  const refused = toLabelMap(ct);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /looks like a CT, not an outline/);
  assert.match(refused.message, /3D Slicer or TotalSegmentator/);
  const many = new Uint16Array(64).map((_, i) => i);
  assert.equal(toLabelMap(many).ok, false);
  const fractional = new Float32Array([0, 1, 1.5, 2]);
  assert.equal(toLabelMap(fractional).ok, false);
  const fine = toLabelMap(new Float32Array([0, 1, 2, 3, 7, 0]));
  assert.equal(fine.ok, true);
  assert.deepEqual(fine.values, [1, 2, 3, 7]);
});

test('marching cubes: the table is complete and a sphere comes out closed, at the right volume', () => {
  assert.equal(TRIANGLE_TABLE.length, 256);
  assert.equal(TRIANGLE_TABLE[0].length, 0);
  assert.equal(TRIANGLE_TABLE[255].length, 0);
  for (let cube = 1; cube < 255; cube += 1) assert.ok(TRIANGLE_TABLE[cube].length >= 3, `case ${cube}`);

  const radius = 10;
  const n = 24;
  const mask = sphere(n, radius);
  const truth = (4 / 3) * Math.PI * radius ** 3;
  const mesh = marchingCubes(mask, [n, n, n]);
  assert.ok(isClosed(mesh), 'the raw surface is closed');
  const raw = meshVolume(mesh);
  assert.ok(Math.abs(raw - truth) / truth < 0.05, `raw volume ${raw.toFixed(0)} vs ${truth.toFixed(0)}`);
  const smooth = taubinSmooth(mesh, 15);
  assert.ok(isClosed(smooth));
  const smoothed = meshVolume(smooth);
  assert.ok(Math.abs(smoothed - truth) / truth < 0.05, `smoothed volume ${smoothed.toFixed(0)} vs ${truth.toFixed(0)}`);

  // Every one of the 256 cases closes when it's the only cube in the grid.
  for (let cube = 1; cube < 255; cube += 1) {
    const grid = new Uint8Array(8);
    const corners = [0, 1, 3, 2, 4, 5, 7, 6]; // corner number to x + 2y + 4z
    for (let c = 0; c < 8; c += 1) if ((cube >> c) & 1) grid[corners[c]] = 1;
    assert.ok(isClosed(marchingCubes(grid, [2, 2, 2])), `case ${cube} closes`);
  }
});

test('thick slices: a 20 mm sphere at 1 x 1 x 4 mm meshes smooth, closed and at the right volume', () => {
  const spacing = [1, 1, 4];
  const dims = [56, 56, 16];
  const centre = [27.5, 27.5, 7.5];
  const radius = 20;
  const mask = new Uint8Array(dims[0] * dims[1] * dims[2]);
  let index = 0;
  for (let z = 0; z < dims[2]; z += 1) {
    for (let y = 0; y < dims[1]; y += 1) {
      for (let x = 0; x < dims[0]; x += 1, index += 1) {
        const d2 = ((x - centre[0]) * spacing[0]) ** 2 + ((y - centre[1]) * spacing[1]) ** 2 + ((z - centre[2]) * spacing[2]) ** 2;
        if (d2 <= radius * radius) mask[index] = 1;
      }
    }
  }
  const affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1];
  const surface = maskToSurface(mask, dims, affine, { keepLargest: true });
  assert.ok(surface && isClosed(surface), 'closed');
  const truth = (4 / 3) * Math.PI * radius ** 3;
  const volume = meshVolume(surface);
  assert.ok(Math.abs(volume - truth) / truth < 0.05, `volume ${volume.toFixed(0)} vs ${truth.toFixed(0)}`);
  // No slabs: every vertex sits close to the same distance from the centre.
  const c = [centre[0], centre[1], centre[2] * 4];
  const distances = [];
  for (let v = 0; v < surface.positions.length; v += 3) {
    distances.push(Math.hypot(surface.positions[v] - c[0], surface.positions[v + 1] - c[1], surface.positions[v + 2] - c[2]));
  }
  const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
  const sd = Math.sqrt(distances.reduce((a, b) => a + (b - mean) ** 2, 0) / distances.length);
  assert.ok(sd < 1, `radial spread ${sd.toFixed(2)} mm`);
  assert.equal(surface.gridMm, 1);

  // The binary surface on the same mask is what showed the terraces.
  const binary = marchingCubes(mask, dims);
  const scaled = binary.positions.map((value, i) => value * spacing[i % 3]);
  const binaryDistances = [];
  for (let v = 0; v < scaled.length; v += 3) binaryDistances.push(Math.hypot(scaled[v] - c[0], scaled[v + 1] - c[1], scaled[v + 2] - c[2]));
  const bMean = binaryDistances.reduce((a, b) => a + b, 0) / binaryDistances.length;
  const bSd = Math.sqrt(binaryDistances.reduce((a, b) => a + (b - bMean) ** 2, 0) / binaryDistances.length);
  assert.ok(bSd > sd, `binary ${bSd.toFixed(2)} mm should be rougher than ${sd.toFixed(2)} mm`);
});

test('distance transform matches brute force, with uneven spacing', () => {
  const dims = [9, 7, 5];
  const spacing = [0.8, 1.1, 2.5];
  const feature = new Uint8Array(9 * 7 * 5);
  let seed = 7;
  for (let i = 0; i < feature.length; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    if (seed % 23 === 0) feature[i] = 1;
  }
  feature[100] = 1;
  const d2 = edtSquared(feature, dims, spacing);
  const at = (i) => [i % 9, Math.floor(i / 9) % 7, Math.floor(i / 63)];
  for (let i = 0; i < feature.length; i += 1) {
    const [x, y, z] = at(i);
    let best = Infinity;
    for (let j = 0; j < feature.length; j += 1) {
      if (!feature[j]) continue;
      const [u, v, w] = at(j);
      best = Math.min(best, ((x - u) * spacing[0]) ** 2 + ((y - v) * spacing[1]) ** 2 + ((z - w) * spacing[2]) ** 2);
    }
    assert.ok(Math.abs(d2[i] - best) < 1e-9, `voxel ${i}: ${d2[i]} vs ${best}`);
  }
  // A gap of exactly 4 mm reads 4 mm, not a hair over.
  const line = new Uint8Array(6);
  line[0] = 1;
  assert.equal(Math.sqrt(edtSquared(line, [6, 1, 1], [0.8, 1, 1])[5]), 4);
});

test('convex hull fills the hull of the voxel centres, boundary included', () => {
  const n = 8;
  const corners = new Uint8Array(n * n * n);
  for (const x of [1, 6]) for (const y of [1, 6]) for (const z of [2, 5]) corners[x + n * (y + n * z)] = 1;
  const box = convexHullMask(corners, [n, n, n]);
  assert.equal(countMask(box), 6 * 6 * 4);
  // An L in one slab: the hull adds the triangle across the inside corner.
  const l = new Uint8Array(n * n * 2);
  for (let z = 0; z < 2; z += 1) {
    for (let i = 0; i < 6; i += 1) {
      l[i + n * (0 + n * z)] = 1;
      l[0 + n * (i + n * z)] = 1;
    }
  }
  const hull = convexHullMask(l, [n, n, 2]);
  // Points with x + y <= 5 in each slab: 21 per slab.
  assert.equal(countMask(hull), 42);
});

test('scoring cut-offs follow renalplan', () => {
  assert.deepEqual([4, 4.01, 6.99, 7].map(renalRPoints), [1, 2, 2, 3]);
  assert.deepEqual([4, 4.01, 7, 7.01].map(paduaSizePoints), [1, 2, 2, 3]);
  assert.deepEqual([0.5, 0.49, 0.051, 0.05, 0].map(exophyticPoints), [1, 2, 2, 3, 3]);
  assert.deepEqual([7, 6.9, 4.1, 4, 1].map(nearnessPoints), [1, 2, 2, 3, 3]);
  assert.deepEqual([4, 6, 7, 9, 10].map(renalComplexity), ['low', 'low', 'moderate', 'moderate', 'high']);
  assert.deepEqual([6, 7, 8, 9, 10].map(paduaComplexity), ['low', 'low', 'intermediate', 'intermediate', 'high']);

  const span = (from, to, count = 101) => Float64Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
  assert.deepEqual(renalLocation(span(-10, 10), -20, 20), { points: 3, detail: 'entirely between the polar lines' });
  assert.deepEqual(renalLocation(span(-10, 30), 0, 40).points, 3);
  assert.deepEqual(renalLocation(span(25, 45), -20, 20), { points: 1, detail: 'entirely above or below the polar lines' });
  assert.deepEqual(renalLocation(span(15, 35), -20, 20), { points: 2, detail: 'crosses a polar line' });
  assert.deepEqual(paduaPolar(span(-10, 10), -20, 20), { location: 'middle', points: 2 });
  assert.deepEqual(paduaPolar(span(15, 35), -20, 20), { location: 'superior', points: 1 });
  assert.deepEqual(paduaPolar(span(-35, -15), -20, 20), { location: 'inferior', points: 1 });

  const kidney = span(-60, 60, 1201);
  const usable = polarLines(span(-15, 15), kidney);
  assert.equal(usable.fromSinus, true);
  assert.ok(Math.abs(usable.lo + 13.5) < 1e-9 && Math.abs(usable.hi - 13.5) < 1e-9);
  const short = polarLines(span(-5, 5), kidney);
  assert.equal(short.fromSinus, false);
  assert.ok(Math.abs(short.lo + 24) < 1e-9 && Math.abs(short.hi - 24) < 1e-9);
  assert.equal(polarLines(span(5, 40), kidney).fromSinus, false, 'must straddle the centroid');
  assert.equal(sinusEstimateTooLarge(26, 100, 10, 100), true);
  assert.equal(sinusEstimateTooLarge(10, 100, 51, 100), true);
  assert.equal(sinusEstimateTooLarge(10, 100, 50, 100), false);
  assert.deepEqual([2.25, 2.35, 18.309833].map((v) => pyRound(v, 1)), [2.2, 2.4, 18.3]);
});

test('the sample reproduces renalplan 0.2.0 on its own phantom', () => {
  const { output, state } = buildSample(5, () => {});
  const { renal, padua, planning, flags } = output.report;
  // renalplan case --labels phantom/segmentation.nii.gz gives these.
  assert.equal(renal.label, '4x');
  assert.equal(renal.radiusCm, 3);
  assert.equal(renal.exophyticFraction, 0.614);
  assert.equal(renal.nearnessMm, 18.3);
  assert.equal(renal.locationPoints, 1);
  assert.equal(padua.total, 6);
  assert.equal(padua.polarLocation, 'inferior');
  assert.equal(padua.rim, 'lateral');
  assert.ok(Math.abs(planning.preservedFraction - 0.9320947478452951) < 1e-12);
  assert.ok(Math.abs(planning.tumourMl - 11.9745) < 1e-9);
  assert.ok(Math.abs(planning.ipsilateralKidneyMl - 76.0545) < 1e-9);
  assert.ok(Math.abs(planning.contralateralKidneyMl - 68.319) < 1e-9);
  assert.ok(Math.abs(planning.contactSurfaceCm2 - 13.28) < 1e-9);
  assert.equal(flags.polarLinesAssumed, false);
  assert.equal(flags.contralateralKidneyPresent, true);

  const names = output.meshes.map((mesh) => mesh.name);
  for (const name of ['parenchyma', 'tumour', 'contralateral', 'cyst', 'sinus', 'margin']) assert.ok(names.includes(name), name);
  for (const name of ['parenchyma', 'tumour', 'contralateral', 'margin']) {
    const mesh = output.meshes.find((item) => item.name === name);
    assert.ok(isClosed(mesh), `${name} closed`);
    assert.ok(Math.abs(structureVolumeMl(mesh) - mesh.volumeMl) / mesh.volumeMl < 0.05, `${name} mesh within 5% of voxels`);
  }
  assert.equal(output.report.meshVolumes.length, output.meshes.length);

  const wider = remargin(state, 10);
  assert.ok(wider.planning.preservedFraction < planning.preservedFraction);
  assert.match(reportMarkdown(output.report), /same rules as renalplan but approximate; not validated/);
});

test('a NIfTI file builds end to end, and a kidney without a tumour is meshed but not scored', async () => {
  const n = 40;
  const labels = sphere(n, 14);
  const dims = [n, n, n];
  const affine = [1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1];
  const file = toArrayBuffer(gzipSync(Buffer.from(encodeNifti(labels, dims, affine, [1.5, 1.5, 1.5]))));
  const { output } = await buildFromNifti(file, 5, () => {});
  assert.equal(output.report.scored, false);
  assert.match(output.report.notScoredReason, /no tumour label/);
  assert.equal(output.meshes[0].name, 'parenchyma');

  const ct = new Int16Array(n * n * n).fill(-1000);
  const ctHeader = new Uint8Array(encodeNifti(new Uint8Array(0), dims, affine, [1.5, 1.5, 1.5]).slice(0, 352));
  const view = new DataView(ctHeader.buffer);
  view.setInt16(70, 4, true);
  view.setInt16(72, 16, true);
  const ctFile = new Uint8Array(352 + ct.byteLength);
  ctFile.set(ctHeader);
  ctFile.set(new Uint8Array(ct.buffer), 352);
  await assert.rejects(buildFromNifti(ctFile.buffer, 5, () => {}), /looks like a CT/);
});

test('the builder and its worker never touch the network or storage', async () => {
  const sources = ['../lib/build-worker.ts', '../lib/export-model.ts', '../components/kidney-builder.tsx'];
  for (const name of await readdir(new URL('../lib/builder/', import.meta.url))) sources.push(`../lib/builder/${name}`);
  for (const path of sources) {
    const text = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB/, path);
    assert.doesNotMatch(text, /[–—]/, `${path} uses an en or em dash`);
  }
});
