// The builder's hardening, from an adversarial test of the builder and viewer
// in October 2026: bad headers, detached and duplicate tumours, outlines cut
// off at the scan edge, plausibility flags, exact Python rounding, superseded
// builds, the GLB's glTF convention and the viewer's addresses.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { WARNING, buildFromLabels, buildFromNifti, buildSample, keptPercent, reportJson, reportMarkdown } from '../lib/builder/build.ts';
import { BROWSER_DIFFERENCES, ESTIMATE_LINE } from '../lib/builder/report.ts';
import { encodeNifti, parseNifti, affineUsable } from '../lib/builder/nifti.ts';
import { pyRound } from '../lib/builder/volume.ts';
import { encodeGlb } from '../lib/glb.ts';
import { canonicalHash, parseWorkspaceHash } from '../lib/workspace-route.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const quiet = () => {};

/** Paint spheres of a label into a grid. Centres and radii in voxels. */
function grid(dims, spheres) {
  const [nx, ny, nz] = dims;
  const labels = new Uint8Array(nx * ny * nz);
  for (const { centre, radius, label, radii } of spheres) {
    const [rx, ry, rz] = radii ?? [radius, radius, radius];
    let index = 0;
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1, index += 1) {
          const d = ((x - centre[0]) / rx) ** 2 + ((y - centre[1]) / ry) ** 2 + ((z - centre[2]) / rz) ** 2;
          if (d <= 1) labels[index] = label;
        }
      }
    }
  }
  return labels;
}

const build = (labels, dims, affine = IDENTITY, source = 'sform') =>
  buildFromLabels(labels, dims, affine, source, 'file', 5, quiet).output.report;

// A kidney-shaped ellipsoid with a C-shaped hilum cut out, so the sinus estimate is sensible.
function kidneyWithHilum(dims, centre, radii) {
  const labels = grid(dims, [{ centre, radii, label: 1 }]);
  const [nx, ny] = dims;
  for (let index = 0; index < labels.length; index += 1) {
    const x = index % nx;
    const y = Math.floor(index / nx) % ny;
    const z = Math.floor(index / (nx * ny));
    const dx = x - (centre[0] + radii[0] * 0.55);
    if (dx > 0 && Math.abs(y - centre[1]) < radii[1] * 0.45 && Math.abs(z - centre[2]) < radii[2] * 0.45) labels[index] = 0;
  }
  return labels;
}

// ---------------------------------------------------------------------------
// 1 and 2: headers that would feed a zero or non-finite size into the build.
// ---------------------------------------------------------------------------

test('1: an orientation matrix with zero spacing or zero determinant is refused plainly', async () => {
  const dims = [8, 8, 8];
  const labels = grid(dims, [{ centre: [4, 4, 4], radius: 2, label: 1 }]);
  const zero = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  await assert.rejects(buildFromNifti(encodeNifti(labels, dims, zero, [1, 1, 1]), 5, quiet), /orientation matrix is invalid \(zero spacing\)/);
  // Non-zero columns, but two of them parallel: determinant 0.
  const flat = [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.equal(affineUsable(flat), false);
  assert.throws(() => parseNifti(encodeNifti(labels, dims, flat, [1, 1, 1])), /orientation matrix is invalid \(zero spacing\)/);
  assert.equal(affineUsable(IDENTITY), true);
  // The library guards the same way when called directly.
  assert.throws(() => buildFromLabels(labels, dims, zero, 'sform', 'file', 5, quiet), /zero spacing/);
});

test('2: a NaN, infinite or negative vox_offset is a damaged header, not an empty image', () => {
  const dims = [8, 8, 8];
  const labels = grid(dims, [{ centre: [4, 4, 4], radius: 2, label: 1 }]);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -400, 1e12]) {
    const raw = encodeNifti(labels, dims, IDENTITY, [1, 1, 1]);
    new DataView(raw).setFloat32(108, bad, true);
    assert.throws(() => parseNifti(raw), /voxel offset is invalid/, String(bad));
  }
});

// ---------------------------------------------------------------------------
// 3: detached tumour and an implausibly small sinus.
// ---------------------------------------------------------------------------

test('3: a tumour that does not touch the scored kidney is flagged everywhere the scores go', () => {
  const dims = [60, 60, 90];
  const labels = kidneyWithHilum(dims, [30, 30, 45], [16, 14, 30]);
  const tumour = grid(dims, [{ centre: [30, 30, 84], radius: 4, label: 2 }]);
  for (let i = 0; i < labels.length; i += 1) if (tumour[i]) labels[i] = 2;
  const report = build(labels, dims);
  assert.equal(report.scored, true, 'the numbers are still given, as renalplan gives them');
  assert.equal(report.planning.contactSurfaceCm2, 0);
  assert.equal(report.flags.tumourDetached, true);
  assert.ok(report.warnings.includes(WARNING.tumourDetached));
  assert.match(WARNING.tumourDetached, /does not touch the scored kidney, so E, N, the PADUA sinus item and ‘kidney kept’ are not meaningful here/);
  assert.match(reportMarkdown(report), /## Warnings[\s\S]*does not touch the scored kidney/);
  assert.ok(JSON.parse(reportJson(report)).warnings.includes(WARNING.tumourDetached));
});

test('3: a sinus estimate under 1% of the kidney is flagged as unreliable', () => {
  // A solid ellipsoid has no hilum, so almost nothing is left for the sinus.
  const dims = [60, 60, 90];
  const labels = grid(dims, [
    { centre: [30, 30, 45], radii: [18, 16, 36], label: 1 },
    { centre: [46, 30, 45], radius: 4, label: 2 },
  ]);
  const report = build(labels, dims);
  assert.equal(report.flags.sinusEstimateSmall, true);
  assert.ok(report.warnings.includes(WARNING.sinusSmall));
  assert.equal(WARNING.sinusSmall, 'Sinus estimate unreliable; N and the sinus item may be wrong.');
  // The phantom has a proper sinus concavity and isn't flagged.
  const sample = buildSample(5, quiet).output.report;
  assert.equal(sample.flags.sinusEstimateSmall, false);
  assert.equal(sample.flags.tumourDetached, false);
});

// ---------------------------------------------------------------------------
// 4: two tumour pieces of the same size.
// ---------------------------------------------------------------------------

test('4: two tumour pieces of similar size are named as such, never as smaller', () => {
  const dims = [60, 60, 100];
  const labels = kidneyWithHilum(dims, [30, 30, 50], [16, 14, 34]);
  const tumours = grid(dims, [
    { centre: [44, 30, 30], radius: 4, label: 2 },
    { centre: [44, 30, 70], radius: 4, label: 2 },
  ]);
  for (let i = 0; i < labels.length; i += 1) if (tumours[i]) labels[i] = 2;
  const { output } = buildFromLabels(labels, dims, IDENTITY, 'sform', 'file', 5, quiet);
  const { report } = output;
  assert.equal(report.flags.similarTumourPieces, true);
  // Equal pieces: the first in scan order (lower z, so inferior with this affine) is scored.
  assert.ok(report.warnings.includes('Two tumour pieces of similar size; the inferior one was scored.'), report.warnings.join(' | '));
  assert.ok(!report.notes.some((note) => /smaller/i.test(note)), report.notes.join(' | '));
  assert.equal(output.meshes.find((mesh) => mesh.name === 'tumour-other').label, 'Other tumour pieces');

  // Flip the file upside down in RAS: the same voxels are now superior.
  const flipped = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  assert.ok(build(labels, dims, flipped).warnings.includes('Two tumour pieces of similar size; the superior one was scored.'));

  // A clearly smaller second piece keeps the old wording.
  const unequal = kidneyWithHilum(dims, [30, 30, 50], [16, 14, 34]);
  const pieces = grid(dims, [
    { centre: [44, 30, 30], radius: 6, label: 2 },
    { centre: [44, 30, 70], radius: 3, label: 2 },
  ]);
  for (let i = 0; i < unequal.length; i += 1) if (pieces[i]) unequal[i] = 2;
  const other = build(unequal, dims);
  assert.equal(other.flags.similarTumourPieces, false);
  assert.ok(other.notes.some((note) => /One more, smaller piece/.test(note)));
});

// ---------------------------------------------------------------------------
// 5: outlines cut off at the edge of the scan, and the kept fraction.
// ---------------------------------------------------------------------------

test('5: an outline that reaches a face of the scan is flagged', () => {
  const dims = [60, 60, 80];
  const labels = kidneyWithHilum(dims, [30, 30, 40], [16, 14, 30]);
  // A tumour on the lower pole, cut by the bottom slice.
  const tumour = grid(dims, [{ centre: [30, 30, 3], radius: 6, label: 2 }]);
  for (let i = 0; i < labels.length; i += 1) if (tumour[i]) labels[i] = 2;
  const cut = build(labels, dims);
  assert.equal(cut.flags.touchesEdge, true);
  assert.ok(cut.warnings.includes('The outline reaches the edge of the scan, so it may be cut off; sizes and scores may be low.'));

  const clear = kidneyWithHilum(dims, [30, 30, 40], [16, 14, 30]);
  const inside = grid(dims, [{ centre: [44, 30, 40], radius: 5, label: 2 }]);
  for (let i = 0; i < clear.length; i += 1) if (inside[i]) clear[i] = 2;
  assert.equal(build(clear, dims).flags.touchesEdge, false);
});

test('5: the kept fraction has one decimal above 99% and never reads 100% when kidney was removed', () => {
  assert.equal(keptPercent(0.9996, 0.05), '>99.9%');
  assert.equal(keptPercent(0.9954, 0.4), '99.5%');
  assert.equal(keptPercent(1, 0), '100.0%');
  assert.equal(keptPercent(0.9, 2), '90%');
  assert.equal(keptPercent(0.9, 2, 1), '90.0%');
  assert.equal(keptPercent(Number.NaN, 0), 'n/a');
});

// ---------------------------------------------------------------------------
// 6, 7, 10, 12, 15: copy and display rules, checked in the sources.
// ---------------------------------------------------------------------------

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('6 and 12: the builder shows the diameter to two decimals and qualifies the 1 mm grid', async () => {
  const builder = await source('../components/kidney-builder.tsx');
  assert.doesNotMatch(builder, /radiusCm\.toFixed\(1\)/);
  assert.match(builder, /radiusCm\.toFixed\(2\)/);
  for (const path of ['../components/kidney-builder.tsx', '../components/renal-site.tsx']) {
    const text = await source(path);
    for (const match of text.matchAll(/1 mm grid[^.]*/g)) {
      assert.match(match[0], /coarser for very\s+large\s+volumes/, `${path}: ${match[0]}`);
    }
  }
});

test('7: the copy explains the hull difference and claims exact agreement only on the phantom', async () => {
  assert.ok(BROWSER_DIFFERENCES.some((item) => /Delaunay/.test(item) && /20,000/.test(item) && /exact convex hull/.test(item)));
  assert.ok(BROWSER_DIFFERENCES.some((item) => /E and N can differ by a few tenths/.test(item)));
  assert.doesNotMatch(ESTIMATE_LINE, /same rules as renalplan/);
  for (const path of ['../components/kidney-builder.tsx', '../components/renal-site.tsx']) {
    const text = await source(path);
    assert.doesNotMatch(text, /same rules as renalplan|agree on every score/, path);
  }
  assert.match(await source('../components/kidney-builder.tsx'), /raw E and N can differ slightly because the browser’s hull is exact/);
  assert.match(await source('../components/renal-site.tsx'), /raw E and N can differ slightly because the\s+browser&apos;s hull is exact/);
});

test('10 and 15: the viewer hides stale numbers while building and stands its controls down without WebGL', async () => {
  const builder = await source('../components/kidney-builder.tsx');
  assert.match(builder, /const building = builder\.state\.status === 'running'/);
  assert.match(builder, /\{building \? \(\s*<Building \/>/);
  assert.match(builder, /if \(running\) return;/);
  const platform = await source('../components/renal-platform.tsx');
  assert.match(platform, /building=\{rebuilding\}/);
  assert.match(platform, /rebuilding \? 'Building…'/);
  assert.match(platform, /onSnapshot=\{snapshot\}\s*disabled=\{noWebgl\}/);
  assert.match(platform, /id="clip-plane"[\s\S]{0,200}disabled=\{noWebgl\}/);
  for (const path of ['../components/kidney-scene.tsx', '../components/reference-case-scene.tsx']) {
    assert.match(await source(path), /onNoWebglRef\.current\?\.\(\)/, path);
  }
});

// ---------------------------------------------------------------------------
// 8: Python's round, exactly.
// ---------------------------------------------------------------------------

test('8: pyRound matches Python on its awkward cases', () => {
  for (const [value, digits, expected] of [
    [61.45, 1, 61.5],
    [0.0505, 3, 0.051],
    [0.4995, 3, 0.499],
    [2.675, 2, 2.67],
    [0.125, 2, 0.12],
    [0.375, 2, 0.38],
    [0.5, 0, 0],
    [1.5, 0, 2],
    [2.5, 0, 2],
    [-2.5, 0, -2],
    [1e300, 2, 1e300],
  ]) {
    assert.equal(pyRound(value, digits), expected, `round(${value}, ${digits})`);
  }
});

// [value, digits, Python's round(value, digits)], from CPython 3.14 with random.seed(20261008):
// a third uniform doubles, a third near-ties (a short decimal plus 5 in the next place),
// a third short decimals.
const PYTHON_ROUND_CASES = [
  [29.218819771226844,3,29.219],[97.015,2,97.02],[11.367,2,11.37],[78.22724556544163,1,78.2],[12.17735,3,12.177],[0.03641,2,0.04],
  [22.45563584364476,2,22.46],[5.98975,0,6.0],[7.2473,3,7.247],[49.38619096858316,3,49.386],[0.8500000000000001,2,0.85],[0.10218,0,0.0],
  [32.90683090879987,4,32.9068],[31.75,2,31.75],[68.46,0,68.0],[66.50626793416686,2,66.51],[90.145,1,90.1],[1.1098,0,1.0],
  [19.27652416991028,0,19.0],[52.949999999999996,0,53.0],[92.43,3,92.43],[80.90634353392923,0,81.0],[14.18305,1,14.2],[9.1189,3,9.119],
  [66.85434934885346,0,67.0],[29.0825,2,29.08],[1.5172,0,2.0],[24.064910220560044,1,24.1],[29.729950000000002,1,29.7],[2.128,4,2.128],
  [9.950839926379217,0,10.0],[26.246750000000002,4,26.2468],[3.0505,0,3.0],[53.206245070393685,2,53.21],[72.45,0,72.0],[675.82,0,676.0],
  [35.14821760331777,0,35.0],[6.41645,3,6.416],[2.8452,1,2.8],[25.20783095067689,1,25.2],[94.285,3,94.285],[53.821,1,53.8],
  [30.700134994407648,4,30.7001],[89.25,1,89.2],[88.76,1,88.8],[63.831752135343514,2,63.83],[30.345,1,30.3],[0.6068,2,0.61],
  [17.706080567025275,0,18.0],[98.76685,1,98.8],[81.153,2,81.15],[46.574197312420374,0,47.0],[24.544999999999998,1,24.5],[6.067,3,6.067],
  [74.18776547061884,0,74.0],[74.05395,3,74.054],[0.05599,4,0.056],[71.93961417170017,3,71.94],[92.725,3,92.725],[81.937,2,81.94],
  [79.6220654654594,1,79.6],[84.765,1,84.8],[5.2102,2,5.21],[13.616766693276784,0,14.0],[45.7715,0,46.0],[2.8591,1,2.9],
  [55.180217999993374,0,55.0],[67.765,3,67.765],[3.6522,1,3.7],[41.17020754110471,2,41.17],[1.13185,1,1.1],[0.52415,3,0.524],
  [59.329584757431384,3,59.33],[7.5755,2,7.58],[0.38919,2,0.39],[59.977988664395795,4,59.978],[94.1235,4,94.1235],[8.4082,2,8.41],
  [49.98781437509995,4,49.9878],[87.65965,0,88.0],[0.41,3,0.41],[32.158758069748714,4,32.1588],[54.75,0,55.0],[2.7222,2,2.72],
  [30.01690676670328,1,30.0],[19.35,3,19.35],[212.56,3,212.56],[88.73354207790528,1,88.7],[11.395000000000001,4,11.395],[6.062,0,6.0],
  [79.394484344103,0,79.0],[41.405950000000004,0,41.0],[0.88,0,1.0],[17.599730805670877,1,17.6],[25.55,3,25.55],[0.05894,4,0.0589],
  [15.412662222908157,3,15.413],[18.451150000000002,2,18.45],[0.9526,0,1.0],[72.50771560296542,0,73.0],[51.065000000000005,4,51.065],[0.52855,0,1.0],
  [97.19469162588227,4,97.1947],[57.483850000000004,2,57.48],[13.053,3,13.053],[8.95076430206424,0,9.0],[57.807500000000005,1,57.8],[51.56,1,51.6],
  [76.48809725992542,3,76.488],[16.35,2,16.35],[8.5354,4,8.5354],[83.23858518047105,3,83.239],[54.725,0,55.0],[68.531,1,68.5],
  [47.25978884233716,1,47.3],[9.785,2,9.79],[3.5438,0,4.0],[30.712442805803462,4,30.7124],[45.55,3,45.55],[0.15361,0,0.0],
  [12.58728049195973,1,12.6],[47.179500000000004,0,47.0],[131.56,2,131.56],[34.2283094045159,1,34.2],[4.83775,2,4.84],[7.3206,0,7.0],
  [97.65626358468634,0,98.0],[67.295,4,67.295],[0.6977,1,0.7],[68.3463079022886,3,68.346],[0.45,4,0.45],[0.43972,1,0.4],
  [80.86171541401941,4,80.8617],[85.55,2,85.55],[666.55,4,666.55],[91.97683846302603,0,92.0],[47.75,4,47.75],[0.42524,3,0.425],
  [60.901059605338425,2,60.9],[98.1605,0,98.0],[19.02,2,19.02],[12.83367788342914,1,12.8],[51.035000000000004,3,51.035],[19.997,1,20.0],
  [20.571002932261827,3,20.571],[54.949999999999996,1,54.9],[99.455,1,99.5],[47.37009689257351,0,47.0],[56.895,3,56.895],[0.34367,1,0.3],
  [13.73745604299308,3,13.737],[47.255,0,47.0],[4.8679,4,4.8679],[42.54011266928165,2,42.54],[6.92815,1,6.9],[0.72353,4,0.7235],
  [89.2310735372489,2,89.23],[81.26905000000001,1,81.3],[88.685,0,89.0],[79.07675010008451,1,79.1],[21.1055,0,21.0],[44.718,0,45.0],
  [65.1940726852928,1,65.2],[18.0645,0,18.0],[766.9,2,766.9],[82.5040252035047,1,82.5],[73.485,0,73.0],[1.8253,1,1.8],
  [5.060223278307885,2,5.06],[2.3949499999999997,4,2.3949],[0.1001,4,0.1001],[81.28814526136959,0,81.0],[49.615,4,49.615],[345.07,0,345.0],
  [53.80359217954268,4,53.8036],[37.849999999999994,1,37.8],[1.092,3,1.092],[9.432979022835807,3,9.433],[42.349999999999994,4,42.35],[0.43904,4,0.439],
  [31.029964307918966,2,31.03],[78.64999999999999,4,78.65],[0.75048,4,0.7505],[75.22795669441126,2,75.23],[24.05,4,24.05],[897.28,0,897.0],
  [43.7664991304876,0,44.0],[48.032250000000005,3,48.032],[11.732,4,11.732],[49.609820798096514,2,49.61],[99.05499999999999,3,99.055],[6.0292,4,6.0292],
  [7.542019930281285,1,7.5],[98.1455,4,98.1455],[92.963,2,92.96],[50.60270302067378,3,50.603],[4.85155,4,4.8515],[0.07754,4,0.0775],
  [8.917684094551815,2,8.92],[67.57499999999999,0,68.0],[333.92,0,334.0],[57.43198465127152,0,57.0],[70.64115,3,70.641],[0.04964,0,0.0],
  [71.66792851864689,0,72.0],[90.66499999999999,1,90.7],[45.934,2,45.93],[8.825781361928964,3,8.826],[79.185,3,79.185],[1.7068,0,2.0],
  [25.809815359849807,4,25.8098],[55.74205,2,55.74],[96.022,1,96.0],[45.87503846111475,2,45.88],[74.435,2,74.44],[96.95,4,96.95],
  [78.17046219750489,0,78.0],[83.1195,1,83.1],[0.40151,1,0.4],[90.78492612184795,4,90.7849],[39.22545,2,39.23],[76.012,2,76.01],
  [36.715102408362156,2,36.72],[3.985,2,3.98],[84.543,4,84.543],[33.416916479008954,0,33.0],[42.55,0,43.0],[5.515,0,6.0],
  [19.287865169318017,0,19.0],[4.45275,3,4.453],[1.6053,1,1.6],[17.801395156541755,4,17.8014],[43.165,3,43.165],[95.067,1,95.1],
  [6.510939846289943,3,6.511],[44.295,0,44.0],[0.61663,2,0.62],[96.87643256199743,4,96.8764],[69.44365,1,69.4],[53.911,1,53.9],
  [2.3357229885155095,2,2.34],[41.20375,0,41.0],[823.77,0,824.0],[38.05478272144127,3,38.055],[35.349999999999994,2,35.35],[780.58,4,780.58],
  [74.79616673156572,1,74.8],[16.425,4,16.425],[4.7951,2,4.8],[39.15064494497864,4,39.1506],[54.80565,0,55.0],[0.63275,3,0.633],
  [27.438735340618447,3,27.439],[16.794999999999998,1,16.8],[7.1921,0,7.0],[83.25222252980129,3,83.252],[75.64999999999999,3,75.65],[0.68431,3,0.684],
  [81.13574787123319,2,81.14],[6.85215,1,6.9],[6.2489,0,6.0],[0.4844129801279129,1,0.5],[94.31745000000001,4,94.3175],[71.424,3,71.424],
  [95.8456303029618,3,95.846],[99.35205,0,99.0],[2.675,1,2.7],[56.65451173749329,1,56.7],[37.31375,4,37.3137],[4.7249,1,4.7],
  [15.624293393296163,1,15.6],[73.91225,1,73.9],[6.1455,3,6.146],[48.08857448851752,0,48.0],[74.5545,4,74.5545],[63.37,3,63.37],
  [2.1021711699524936,3,2.102],[37.864450000000005,1,37.9],[857.73,1,857.7],[18.492225521833184,3,18.492],[84.63655,2,84.64],[1.8448,4,1.8448],
  [76.31781795654824,3,76.318],[15.5385,3,15.539],[5.3654,4,5.3654],[1.9551080160561063,3,1.955],[42.15,2,42.15],[0.5431,0,1.0],
  [74.93536701781173,3,74.935],[48.15535,3,48.155],[79.219,1,79.2],[62.07148462730518,2,62.07],[90.05,1,90.0],[61.65,4,61.65],
  [89.98584273901609,2,89.99],[47.465,1,47.5],[34.927,0,35.0],[32.38837815598383,4,32.3884],[21.1485,3,21.148],[15.52,1,15.5],
];

test('8: pyRound matches 300 values rounded by Python', () => {
  assert.equal(PYTHON_ROUND_CASES.length, 300);
  for (const [value, digits, expected] of PYTHON_ROUND_CASES) {
    assert.equal(pyRound(value, digits), expected, `round(${value}, ${digits})`);
  }
});

// ---------------------------------------------------------------------------
// 9 and 13: plausibility and orientation flags. Flags only; nothing refused.
// ---------------------------------------------------------------------------

test('9: plausibility flags for kidney volume, tumour size, fragments and voxel spacing', () => {
  // A kidney a few ml in size, with three more loose pieces of about 1.4 ml.
  const dims = [60, 60, 60];
  const labels = grid(dims, [
    { centre: [20, 30, 30], radius: 9, label: 1 },
    { centre: [45, 10, 10], radius: 7, label: 1 },
    { centre: [45, 50, 10], radius: 7, label: 1 },
    { centre: [45, 50, 50], radius: 7, label: 1 },
    { centre: [28, 30, 30], radius: 4, label: 2 },
  ]);
  const report = build(labels, dims);
  assert.equal(report.scored, true);
  assert.equal(report.flags.kidneyFragmented, true);
  assert.ok(report.warnings.includes('The kidney label is in 4 pieces over 1 ml; the outline looks fragmented.'));
  assert.equal(report.flags.kidneyVolumeUnusual, true);
  assert.ok(report.warnings.some((w) => /outside the usual 60 to 600 ml/.test(w)));
  assert.equal(report.flags.spacingUnusual, false);

  // 8 mm voxels: a 20-voxel tumour is 16 cm across, and the spacing is unusual too.
  const coarse = [8, 0, 0, 0, 0, 8, 0, 0, 0, 0, 8, 0, 0, 0, 0, 1];
  const big = grid([60, 60, 60], [
    { centre: [24, 30, 30], radii: [14, 12, 24], label: 1 },
    { centre: [40, 30, 30], radius: 10, label: 2 },
  ]);
  const large = build(big, [60, 60, 60], coarse);
  assert.equal(large.flags.tumourOver15Cm, true);
  assert.ok(large.warnings.some((w) => /over 15 cm/.test(w)));
  assert.equal(large.flags.spacingUnusual, true);
  assert.ok(large.warnings.includes('Voxel spacing 8.00 x 8.00 x 8.00 mm is outside 0.3 to 6 mm. Check the header.'));
});

test('13: no sform or qform is flagged as assumed orientation', async () => {
  const dims = [50, 50, 80];
  const labels = kidneyWithHilum(dims, [25, 25, 40], [14, 12, 28]);
  const raw = encodeNifti(labels, dims, IDENTITY, [1, 1, 1]);
  const view = new DataView(raw);
  view.setInt16(252, 0, true);
  view.setInt16(254, 0, true);
  const { output } = await buildFromNifti(raw, 5, quiet);
  assert.equal(output.report.grid.affineSource, 'pixdim');
  assert.equal(output.report.flags.orientationAssumed, true);
  assert.ok(
    output.report.warnings.includes(
      'No orientation in the file; axes assumed from the pixdim. Left/right and anterior/posterior may be wrong.',
    ),
  );
});

// ---------------------------------------------------------------------------
// 11: a superseded build posts nothing, and the shown time is the new build's.
// ---------------------------------------------------------------------------

test('11: the worker drops a build that a newer file supersedes', async () => {
  const posted = [];
  globalThis.postMessage = (message) => posted.push(message);
  await import('../lib/build-worker.ts');
  const send = (data) => globalThis.onmessage({ data });

  // Zipped, so the first build waits on the browser's unzip, as a real one does.
  const big = [90, 90, 130];
  const firstRaw = encodeNifti(kidneyWithHilum(big, [45, 45, 65], [30, 26, 58]), big, IDENTITY, [1, 1, 1]);
  const zipped = gzipSync(Buffer.from(firstRaw));
  const first = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
  const small = [40, 40, 60];
  const secondLabels = kidneyWithHilum(small, [20, 20, 30], [12, 10, 22]);
  const tumour = grid(small, [{ centre: [31, 20, 30], radius: 4, label: 2 }]);
  for (let i = 0; i < secondLabels.length; i += 1) if (tumour[i]) secondLabels[i] = 2;
  const second = encodeNifti(secondLabels, small, IDENTITY, [1, 1, 1]);

  // The first build starts, then the second file arrives while it is unzipping.
  send({ type: 'file', id: 1, buffer: first, marginMm: 5 });
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  assert.ok(posted.some((m) => m.id === 1 && m.type === 'progress'), 'the first build had started');
  const sentSecond = performance.now();
  send({ type: 'file', id: 2, buffer: second, marginMm: 5 });
  while (!posted.some((m) => m.id === 2 && (m.type === 'result' || m.type === 'error'))) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const elapsed = performance.now() - sentSecond;
  assert.ok(!posted.some((m) => m.id === 1 && (m.type === 'result' || m.type === 'error')), 'nothing from the superseded build');
  const result = posted.find((m) => m.id === 2 && m.type === 'result');
  assert.ok(result, 'the newer build finished');
  assert.deepEqual(result.output.report.grid.fileDims, small);
  assert.ok(result.output.report.totalMs <= elapsed + 1, 'the time shown is the newer build’s own');
});

// ---------------------------------------------------------------------------
// 16: the GLB is glTF-convention: metres, y-up, centred, named.
// ---------------------------------------------------------------------------

test('16: the GLB is metres, y-up and centred, with names, and its chunks add up', () => {
  const { output } = buildSample(5, quiet);
  const meshes = output.meshes.filter((mesh) => mesh.visible);
  const glb = encodeGlb(meshes);
  const view = new DataView(glb);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'magic glTF');
  assert.equal(view.getUint32(4, true), 2, 'version 2');
  assert.equal(view.getUint32(8, true), glb.byteLength, 'total length');
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, 'JSON chunk');
  assert.equal(jsonLength % 4, 0);
  const binAt = 20 + jsonLength;
  const binLength = view.getUint32(binAt, true);
  assert.equal(view.getUint32(binAt + 4, true), 0x004e4942, 'BIN chunk');
  assert.equal(binAt + 8 + binLength, glb.byteLength, 'chunks fill the file');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)));
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.buffers[0].byteLength, binLength);
  for (const viewInfo of json.bufferViews) assert.ok(viewInfo.byteOffset + viewInfo.byteLength <= binLength);

  assert.deepEqual(json.meshes.map((mesh) => mesh.name), meshes.map((mesh) => mesh.name));
  assert.deepEqual(json.materials.map((material) => material.name), meshes.map((mesh) => mesh.label));
  assert.ok(json.nodes.every((node) => typeof node.name === 'string' && node.name.length > 0));

  // Centred on the whole model, in metres: a kidney-sized model fits in +-0.3 m.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes) {
    const accessor = json.accessors[mesh.primitives[0].attributes.POSITION];
    assert.equal(accessor.type, 'VEC3');
    for (let a = 0; a < 3; a += 1) {
      assert.ok(Math.abs(accessor.min[a]) <= 0.3 && Math.abs(accessor.max[a]) <= 0.3, `${mesh.name} within 0.3 m`);
      lo[a] = Math.min(lo[a], accessor.min[a]);
      hi[a] = Math.max(hi[a], accessor.max[a]);
    }
  }
  for (let a = 0; a < 3; a += 1) assert.ok(Math.abs(lo[a] + hi[a]) < 1e-4, 'centred on the bounding box');

  // y-up: glTF y is RAS z (superior), glTF z is minus RAS y (posterior towards +z).
  const kidney = meshes.find((mesh) => mesh.name === 'parenchyma');
  const ras = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let a = 0; a < 3; a += 1) {
        ras.lo[a] = Math.min(ras.lo[a], mesh.positions[i + a]);
        ras.hi[a] = Math.max(ras.hi[a], mesh.positions[i + a]);
      }
    }
  }
  const index = json.meshes.findIndex((mesh) => mesh.name === kidney.name);
  const accessor = json.accessors[json.meshes[index].primitives[0].attributes.POSITION];
  let kLo = [Infinity, Infinity, Infinity];
  let kHi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < kidney.positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      kLo[a] = Math.min(kLo[a], kidney.positions[i + a]);
      kHi[a] = Math.max(kHi[a], kidney.positions[i + a]);
    }
  }
  const centre = ras.lo.map((value, a) => (value + ras.hi[a]) / 2);
  const close = (x, y) => Math.abs(x - y) < 1e-5;
  assert.ok(close(accessor.max[1], (kHi[2] - centre[2]) / 1000), 'glTF y is superior');
  assert.ok(close(accessor.max[2], -(kLo[1] - centre[1]) / 1000), 'glTF z is minus anterior');
  assert.ok(close(accessor.max[0], (kHi[0] - centre[0]) / 1000), 'glTF x is RAS x');
});

// ---------------------------------------------------------------------------
// 14: addresses.
// ---------------------------------------------------------------------------

test('14: viewer addresses fall back sensibly and are rewritten to their plain form', () => {
  const known = new Set(['synthetic', 'reference-a', 'reference-c']);
  const junk = parseWorkspaceHash('#workspace/reference-c?ct=junk', known);
  assert.deepEqual(junk, { view: 'workspace', caseId: 'reference-c', build: false, ct: true, notFound: false });
  assert.equal(canonicalHash(junk.caseId, junk.build, junk.ct), '#workspace/reference-c?ct');
  assert.equal(parseWorkspaceHash('#workspace/Reference-C?foo=1', known).caseId, 'reference-c');
  assert.equal(parseWorkspaceHash('#workspace/reference-c?foo=1', known).ct, false);

  const unknown = parseWorkspaceHash('#workspace/reference-z', known);
  assert.equal(unknown.caseId, 'synthetic');
  assert.equal(unknown.notFound, true);
  assert.equal(canonicalHash(unknown.caseId), '#workspace');

  const lesson = parseWorkspaceHash('#workspace?learn', known);
  assert.equal(lesson.view, 'workspace');
  assert.equal(lesson.notFound, false);
  assert.equal(parseWorkspaceHash('#workspace/build', known).build, true);
  assert.equal(parseWorkspaceHash('#planning', known).view, 'overview');
});
