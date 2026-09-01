import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const deployRoot = new URL('../netlify-dist/', import.meta.url);
const forbiddenExtensions = [
  '.dcm',
  '.dicom',
  '.nii',
  '.nii.gz',
  '.nrrd',
  '.mha',
  '.mhd',
  '.model',
  '.pkl',
  '.pt',
  '.pth',
  '.ckpt',
  '.onnx',
  '.safetensors',
];
const forbiddenNames = [
  /case-results/i,
  /manifest\.csv/i,
  /output-hashes/i,
  /worst-cases/i,
  /(?:^|[._-])qc(?:[._-]|$)/i,
  /(?:^|[._-])timings?(?:[._-]|$)/i,
  /(?:^|[._-])predictions?(?:[._-]|$)/i,
];
const forbiddenText = [
  /case_00(?:40[0-9]|41[0-9])/i,
  /(?:^|["'\s(])(?:[a-z]:[\\/])|file:\/\/|\/(?:users|home|mnt|tmp)\//i,
  /(?:patientname|patientid|studyinstanceuid|seriesinstanceuid)/i,
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const rootPath = fileURLToPath(deployRoot);
const rootStats = await stat(rootPath);
assert.equal(rootStats.isDirectory(), true, 'netlify-dist must exist before scanning');
const files = await walk(rootPath);
assert.ok(files.length > 0, 'Deployment bundle must not be empty');

for (const path of files) {
  const relativePath = relative(rootPath, path).replaceAll('\\', '/');
  const lower = relativePath.toLowerCase();
  assert.doesNotMatch(
    relativePath,
    /case_00(?:40[0-9]|41[0-9])/i,
    `Cohort identifier in deploy pathname: ${relativePath}`,
  );
  assert.equal(
    forbiddenExtensions.some((suffix) => lower.endsWith(suffix)),
    false,
    `Forbidden medical/model extension in deploy bundle: ${relativePath}`,
  );
  for (const pattern of forbiddenNames) {
    assert.doesNotMatch(relativePath, pattern);
  }

  if (['.html', '.js', '.json', '.css', '.txt', '.xml'].includes(extname(lower))) {
    const contents = await readFile(path, 'utf8');
    for (const pattern of forbiddenText) {
      assert.doesNotMatch(contents, pattern, `Forbidden content in ${relativePath}`);
    }
  }
}

console.log(`Deploy bundle scan passed: ${files.length} files`);
