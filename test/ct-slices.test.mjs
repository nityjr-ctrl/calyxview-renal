// Checks the published CT slices for Kidneys A to E (public/ct/, made by
// scripts/make-ct-slices.py): the schema of each slices.json, one WebP per
// slice, slabs in order, outlines inside the image, nothing that names a case
// or a path, and each kidney small enough to load quickly.

import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ctRoot = fileURLToPath(new URL('../public/ct/', import.meta.url));
const MAX_BYTES_PER_KIDNEY = 1.5 * 1024 * 1024;
const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const OUTLINES = ['kidney', 'tumour', 'cyst'];
const TOP_LEVEL_KEYS = [
  'cropOriginMm',
  'frame',
  'height',
  'licence',
  'orientation',
  'pixelMm',
  'sliceMm',
  'slices',
  'tumourSlice',
  'version',
  'width',
  'window',
  'xLeftMm',
  'yTopMm',
];
// Same patterns as test/deploy-bundle-scan.mjs, plus dates and file names.
const FORBIDDEN_TEXT = [
  /case_\d{5}/i,
  /(?:^|["'\s(])(?:[a-z]:[\\/])|file:\/\/|\/(?:users|home|mnt|tmp|root|var|opt|srv)\//i,
  /patientname|patientid|studyinstanceuid|seriesinstanceuid|patient_?id|birth/i,
  /\.nii|\.dcm|imaging|segmentation/i,
  /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/,
];

const folders = (await readdir(ctRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test('there is one CT folder per kidney, A to E', () => {
  assert.deepEqual(
    folders,
    LETTERS.map((letter) => `reference-${letter}`),
  );
});

for (const folder of folders) {
  const dir = join(ctRoot, folder);

  test(`${folder}: slices.json is valid and matches its images`, async () => {
    const text = await readFile(join(dir, 'slices.json'), 'utf8');
    for (const pattern of FORBIDDEN_TEXT) assert.doesNotMatch(text, pattern, `${folder}/slices.json`);
    assert.ok(text.length < 120_000, `${folder}/slices.json is unexpectedly large (${text.length} bytes)`);

    const data = JSON.parse(text);
    assert.deepEqual(Object.keys(data).sort(), TOP_LEVEL_KEYS);
    assert.equal(data.version, 1);
    assert.ok(Number.isInteger(data.width) && data.width > 100 && data.width <= 512);
    assert.ok(Number.isInteger(data.height) && data.height > 100 && data.height <= 512);
    assert.ok(Math.max(data.width, data.height) <= 400, 'long edge about 384 px');
    assert.ok(data.pixelMm > 0.1 && data.pixelMm < 1.5);
    assert.ok(data.sliceMm >= 0.5 && data.sliceMm <= 6);
    assert.deepEqual(data.window, { level: 40, width: 400 });
    assert.equal(data.licence, 'KiTS23, CC BY-NC-SA 4.0');
    for (const value of [data.xLeftMm, data.yTopMm, ...data.cropOriginMm]) assert.ok(Number.isFinite(value));

    const { slices } = data;
    assert.ok(Array.isArray(slices) && slices.length >= 20 && slices.length <= 80, `${slices.length} slices`);
    assert.ok(Number.isInteger(data.tumourSlice) && data.tumourSlice >= 0 && data.tumourSlice < slices.length);
    assert.ok(slices[data.tumourSlice].tumour?.length, 'the tumour slice has a tumour outline');

    const webps = (await readdir(dir)).filter((name) => /^\d{3}\.webp$/.test(name)).sort();
    assert.equal(webps.length, slices.length, 'one image per slice');
    webps.forEach((name, index) => assert.equal(name, `${String(index).padStart(3, '0')}.webp`));

    for (let index = 0; index < slices.length; index += 1) {
      const slice = slices[index];
      for (const key of Object.keys(slice)) assert.ok(['z', ...OUTLINES].includes(key), `unexpected key ${key}`);
      assert.ok(Number.isFinite(slice.z));
      if (index > 0) assert.ok(slice.z > slices[index - 1].z, `z rises from slice ${index - 1} to ${index}`);
      for (const name of OUTLINES) {
        for (const line of slice[name] ?? []) {
          assert.ok(Array.isArray(line) && line.length >= 6 && line.length % 2 === 0, `${name} polyline shape`);
          for (let i = 0; i < line.length; i += 2) {
            const [x, y] = [line[i], line[i + 1]];
            assert.ok(x >= 0 && x <= data.width && y >= 0 && y <= data.height, `${name} point ${x},${y} inside the image`);
          }
        }
      }
    }
    // The tumour sits inside the crop, so it shouldn't be on the first or last slab.
    assert.ok(!slices[0].tumour && !slices.at(-1).tumour, 'the crop is padded above and below the tumour');
  });

  test(`${folder}: key.webp exists and the kidney is under 1.5 MB`, async () => {
    const files = await readdir(dir);
    assert.ok(files.includes('key.webp'), 'key.webp');
    for (const name of files) assert.match(name, /^(?:\d{3}\.webp|key\.webp|slices\.json)$/, `unexpected file ${name}`);
    let total = 0;
    for (const name of files) {
      const path = join(dir, name);
      const info = await stat(path);
      total += info.size;
      if (name.endsWith('.webp')) {
        const head = (await readFile(path)).subarray(0, 12);
        assert.equal(head.subarray(0, 4).toString('latin1'), 'RIFF', `${name} is a RIFF file`);
        assert.equal(head.subarray(8, 12).toString('latin1'), 'WEBP', `${name} is a WebP`);
      }
    }
    assert.ok(total < MAX_BYTES_PER_KIDNEY, `${folder} is ${total} bytes`);
  });
}
