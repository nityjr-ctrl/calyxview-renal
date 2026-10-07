// Publishes the five KiTS23 kidneys shown in the 3D viewer, with the
// nephrometry renalplan computed for them.
//
// Where things come from:
//   * The meshes are copied byte for byte from my separate CalyxView
//     endourology project (its mesh step, endo_recon_pipeline.py). That step
//     built them from the same KiTS23 expert outlines renalplan used. They are
//     not renalplan's own meshes.
//   * Kidney C's file also carries ribs, psoas, colon, spleen, liver and a body
//     outline. Those are TotalSegmentator (AI) outlines of the KiTS23 CT, not
//     KiTS labels, and nobody has checked them. They are labelled as such and
//     hidden by default.
//   * The nephrometry was computed by renalplan from the KiTS23 label maps
//     (voxels), not from these meshes. Display values (diameter, exophytic
//     fraction, distance to the sinus, kept fraction) are read from the same
//     rows as the pipeline table on the site (pipeline/results/summary.public.json),
//     so the viewer and the table always show the same numbers. Categorical
//     fields and the notes come from each case's planning.json.
//
// The deploy bundle scan forbids KiTS cohort identifiers in any published path
// or text file, so every case is republished under a neutral letter. The
// mapping back to the cohort is recorded in docs/REFERENCE-CASES.md, which is
// never deployed.
//
//   node scripts/make-reference-cases.mjs [path-to-calyxview-models-dir]
//
// Run it from the repository root. It only reads the source folder.

import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_MESHES = process.argv[2] ?? join('..', '..', 'CalyxView', 'repo', 'web', 'public', 'models');

// Kidneys A to E are cases 1 to 5 in the pipeline table (case = cohortIndex + 1).
const CASES = [
  { letter: 'a', cohortIndex: 0 },
  { letter: 'b', cohortIndex: 1 },
  { letter: 'c', cohortIndex: 2 },
  { letter: 'd', cohortIndex: 3 },
  { letter: 'e', cohortIndex: 4 },
];

const KITS = 'KiTS expert outline';
const AI = 'TotalSegmentator (AI), unchecked';

// framing: whether the camera frames on this structure.
const STRUCTURES = {
  parenchyma: { label: 'Kidney', provenance: KITS, colour: '#c9b79b', opacity: 0.34, visible: true, framing: true },
  tumour: { label: 'Tumour', provenance: KITS, colour: '#d85c60', opacity: 1, visible: true, framing: true },
  cyst: { label: 'Cyst', provenance: KITS, colour: '#8fb8d8', opacity: 0.7, visible: true, framing: true },
  ribs: { label: 'Ribs (AI outline)', provenance: AI, colour: '#d8d2c4', opacity: 0.5, visible: false, framing: false },
  psoas: { label: 'Psoas (AI outline)', provenance: AI, colour: '#b98b7a', opacity: 0.45, visible: false, framing: false },
  colon: { label: 'Colon (AI outline)', provenance: AI, colour: '#c8a06a', opacity: 0.45, visible: false, framing: false },
  spleen: { label: 'Spleen (AI outline)', provenance: AI, colour: '#a8737d', opacity: 0.45, visible: false, framing: false },
  liver: { label: 'Liver (AI outline)', provenance: AI, colour: '#9d7a6b', opacity: 0.4, visible: false, framing: false },
  skin: { label: 'Body outline (AI)', provenance: AI, colour: '#8fa0ad', opacity: 0.09, visible: false, framing: false },
};

const UNKNOWN = { provenance: 'Unknown source', colour: '#9aa7b2', opacity: 0.5, visible: false, framing: false };

function glbJson(buffer) {
  // The JSON chunk of a GLB container holds the node names and accessor bounds.
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const chunkLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(buffer.subarray(20, 20 + chunkLength)));
}

function meshBounds(json) {
  // Axis-aligned bounds of each named mesh, from its POSITION accessor.
  const bounds = new Map();
  for (const mesh of json.meshes ?? []) {
    if (!mesh.name) continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const primitive of mesh.primitives ?? []) {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], accessor.min[axis]);
        max[axis] = Math.max(max[axis], accessor.max[axis]);
      }
    }
    bounds.set(mesh.name, { min, max });
  }
  return bounds;
}

function boxesOverlap(a, b, slackMm = 5) {
  if (!a || !b) return false;
  for (let axis = 0; axis < 3; axis += 1) {
    if (a.max[axis] + slackMm < b.min[axis] || b.max[axis] + slackMm < a.min[axis]) return false;
  }
  return true;
}

async function readJsonWithRetry(path, attempts = 5) {
  // Another process may be rewriting the summary; retry briefly on a bad parse.
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError;
}

function plainNotes(renalNotes) {
  // Only notes that aren't already shown elsewhere in the viewer. The sinus
  // estimate and the missing vessel outline have their own labels.
  // renalplan counts tumour pieces across the whole label map, so an extra
  // piece may not be in this kidney. The CalyxView mesher keeps only the
  // largest piece of each label, so the 3D model never shows it.
  const notes = [];
  for (const note of renalNotes ?? []) {
    const match = /^(\d+) additional tumour component/i.exec(note);
    if (match) {
      const extra = Number(match[1]);
      notes.push(
        extra === 1
          ? "The KiTS outline has a second, smaller piece labelled tumour, which may not be in this kidney and which this 3D model leaves out. The scores are for the larger one."
          : `The KiTS outline has ${extra} more, smaller pieces labelled tumour, which may not be in this kidney and which this 3D model leaves out. The scores are for the largest one.`,
      );
    }
    // The sinus estimate came out too small or off to one side, so renalplan
    // put the polar lines where 30% of the kidney's volume lies beyond each
    // (its 30th and 70th percentiles along the long axis).
    if (/sinus estimate too short or off-centre/i.test(note)) {
      notes.push(
        "The estimated sinus came out too small, or off to one side of the kidney's middle, to set the polar lines. So the pipeline put them where 30% of the kidney's volume lies beyond each, roughly a third and two thirds of the way along. That makes L and the PADUA pole rougher than usual. N and PADUA's rim and sinus items still use the small estimate, so they're approximate too, and N may read long.",
      );
    }
    // The sinus estimate was far too big for a renal sinus: the kidney isn't
    // the usual shape (a horseshoe kidney does this).
    if (/sinus estimate implausibly large/i.test(note)) {
      notes.push(
        "The estimated sinus came out far too big for a renal sinus, which means this kidney isn't the usual shape. A horseshoe kidney does this. L, N and PADUA's pole, rim and sinus items don't mean much here.",
      );
    }
  }
  return notes;
}

if (!existsSync(SOURCE_MESHES)) {
  console.error(`No mesh folder at ${SOURCE_MESHES}. Pass the CalyxView models folder as the first argument.`);
  process.exit(1);
}

const summary = await readJsonWithRetry('pipeline/results/summary.public.json');
const summaryRows = new Map((summary.nephrometry?.cases ?? []).map((row) => [row.case, row]));

// The site says "five real kidneys" and "A to E" in plain text, so a partial
// set must not be published. Check every case before writing anything.
const missing = [];
for (const { letter, cohortIndex } of CASES) {
  const cohortId = `case_${String(cohortIndex).padStart(5, '0')}`;
  if (!existsSync(join(SOURCE_MESHES, `${cohortId}.glb`))) missing.push(`${letter}: no mesh for ${cohortId}`);
  if (!summaryRows.has(cohortIndex + 1)) missing.push(`${letter}: no row ${cohortIndex + 1} in summary.public.json`);
  if (!existsSync(join('pipeline/results/cases', cohortId, 'planning.json'))) {
    missing.push(`${letter}: no planning.json for ${cohortId}`);
  }
}
if (missing.length > 0) {
  console.error(`Nothing was written. Missing:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

await mkdir('public/models', { recursive: true });

const published = [];
const provenance = [];

for (const { letter, cohortIndex } of CASES) {
  const cohortId = `case_${String(cohortIndex).padStart(5, '0')}`;
  const sourceGlb = join(SOURCE_MESHES, `${cohortId}.glb`);
  // Checked above, so these are present.
  const row = summaryRows.get(cohortIndex + 1);

  const target = join('public/models', `reference-${letter}.glb`);
  await copyFile(sourceGlb, target);
  const sourceBytes = await readFile(sourceGlb);
  const copiedBytes = await readFile(target);
  if (!sourceBytes.equals(copiedBytes)) throw new Error(`copy of ${letter} differs from its source`);

  const json = glbJson(sourceBytes);
  const names = (json.meshes ?? []).map((mesh) => mesh.name).filter(Boolean);
  const bounds = meshBounds(json);
  const planning = JSON.parse(
    await readFile(join('pipeline/results/cases', cohortId, 'planning.json'), 'utf8'),
  );
  const renal = planning.nephrometry.renal;
  const padua = planning.nephrometry.padua;

  const structures = names.map((name) => {
    const base = STRUCTURES[name] ?? { label: name, ...UNKNOWN };
    // A cyst that doesn't touch the tumour-side kidney belongs to the other
    // kidney, which isn't in the file. Label it, hide it, and don't let it
    // pull the camera away from the kidney.
    if (name === 'cyst' && !boxesOverlap(bounds.get('cyst'), bounds.get('parenchyma'))) {
      return { name, ...base, label: 'Cyst (other kidney)', visible: false, framing: false };
    }
    return { name, ...base };
  });

  published.push({
    id: `reference-${letter}`,
    label: `Kidney ${letter.toUpperCase()}`,
    mesh: `/models/reference-${letter}.glb`,
    structures,
    nephrometry: {
      renalLabel: planning.nephrometry.renalLabel,
      renalTotal: renal.total,
      renalComplexity: renal.complexity,
      renalPoints: { r: renal.radius_pts, e: renal.exophytic_pts, n: renal.nearness_pts, l: renal.location_pts },
      paduaTotal: padua.total,
      paduaComplexity: padua.complexity,
      paduaSinusInvolved: padua.sinus_involved,
      diameterCm: row.diameterCm,
      tumourMl: row.tumourMl,
      exophyticFraction: row.exophyticFraction,
      nearnessMm: row.tumourToSinusMm,
      preservedFraction: row.preservedFraction,
      face: renal.ap,
      polarLocation: padua.polar_location,
      rim: padua.rim,
      locationDetail: renal.location_detail,
      hilar: renal.hilar,
      // Same flags as the pipeline table, so the cards, viewer and table agree.
      polarLinesAssumed: Boolean(row.polarLinesAssumed),
      sinusEstimateTooLarge: Boolean(row.sinusEstimateTooLarge),
      hilarAssessed: !(renal.notes ?? []).some((note) => /hilar suffix not assessed/i.test(note)),
      collectingAssessed: padua.collecting_involved !== null && padua.collecting_involved !== undefined,
    },
    caseNotes: plainNotes(renal.notes),
    runtimeSeconds: row.runtimeSeconds ?? planning.provenance.runtimeSeconds,
  });

  provenance.push(
    `| Kidney ${letter.toUpperCase()} (reference-${letter}) | ${cohortIndex + 1} | \`${cohortId}\` | ${names.join(', ')} |`,
  );
}

const banner = `// GENERATED by scripts/make-reference-cases.mjs. Do not edit by hand.
//
// Five KiTS23 kidneys, republished under neutral letters. The meshes were
// copied from my separate CalyxView endourology project, which built them from
// the same KiTS23 expert outlines. Kidney C's surrounding organs are
// TotalSegmentator (AI) outlines of the CT and haven't been checked. The
// nephrometry was computed by renalplan from the KiTS23 label maps, not from
// these meshes, and the display values match the pipeline table on the site.
// KiTS23 imaging and labels are CC BY-NC-SA 4.0.
`;

await writeFile(
  'lib/reference-cases.ts',
  `${banner}
export type ReferenceStructure = {
  name: string;
  label: string;
  /** Where the outline came from, shown under the layer name. */
  provenance: string;
  colour: string;
  opacity: number;
  visible: boolean;
  /** Whether the camera frames on this structure. */
  framing: boolean;
};

export type ReferenceCase = {
  id: string;
  label: string;
  mesh: string;
  structures: ReferenceStructure[];
  nephrometry: {
    renalLabel: string;
    renalTotal: number;
    renalComplexity: string;
    /** The R.E.N.A.L. points that make up renalTotal. */
    renalPoints: { r: number; e: number; n: number; l: number };
    paduaTotal: number;
    paduaComplexity: string;
    /** PADUA's renal-sinus item, against the estimated sinus. */
    paduaSinusInvolved: boolean;
    /** Largest tumour diameter, 1 dp, as in the pipeline table. */
    diameterCm: number;
    tumourMl: number;
    exophyticFraction: number;
    /** Tumour to the estimated renal sinus, which sets N. */
    nearnessMm: number;
    /** Share of the tumour-side kidney outside a uniform 5 mm band round the tumour. */
    preservedFraction: number;
    face: string;
    polarLocation: string;
    rim: string;
    locationDetail: string;
    /** Only meaningful when hilarAssessed is true. */
    hilar: boolean;
    /** The sinus estimate was too small or off-centre, so the polar lines were put where 30% of the kidney's volume lies beyond each. */
    polarLinesAssumed: boolean;
    /** The sinus estimate was far too big for a renal sinus, so the kidney isn't the usual shape. */
    sinusEstimateTooLarge: boolean;
    hilarAssessed: boolean;
    collectingAssessed: boolean;
  };
  caseNotes: string[];
  runtimeSeconds: number;
};

export const referenceCases: ReferenceCase[] = ${JSON.stringify(published, null, 2)};

export const referenceCaseCount = ${published.length};
`,
  'utf8',
);

await writeFile(
  'docs/REFERENCE-CASES.md',
  `# Kidneys A to E in the 3D viewer

The 3D viewer shows ${published.length} kidneys from the public KiTS23 dataset. They
appear under neutral letters because the deploy bundle scan forbids cohort
identifiers in any published path or text file. This file records the mapping
and is never deployed.

Regenerate from the repository root with:

\`\`\`
node scripts/make-reference-cases.mjs [path-to-calyxview-models-dir]
\`\`\`

| Shown as | Pipeline table case | Cohort case | Meshes in the file |
| --- | --- | --- | --- |
${provenance.join('\n')}

Where each part comes from:

- The meshes are byte-identical copies of the ones my separate CalyxView
  endourology project made (its mesh step, \`endo_recon_pipeline.py\`) from the
  same KiTS23 expert outlines. They are not renalplan's own meshes.
- Kidney, tumour and cyst are the KiTS23 expert outlines. Kidney C's ribs,
  psoas, colon, spleen, liver and body outline are TotalSegmentator (AI)
  outlines of the KiTS23 CT. Nobody has checked them, and they're hidden by
  default. Kidney C's cyst belongs to the other kidney, which isn't in the
  file, so it's labelled "Cyst (other kidney)", hidden by default and left out
  of the camera framing.
- The nephrometry was computed by renalplan from the KiTS23 label maps, not
  from the meshes. Diameter, tumour volume, exophytic fraction, distance to
  the sinus and the kept fraction are read from
  \`pipeline/results/summary.public.json\`, so the viewer matches the pipeline
  table. The rest comes from each case's \`planning.json\`.
- No CT was used in these runs, so the hilar suffix and PADUA's
  collecting-system item weren't assessed (\`hilarAssessed\` and
  \`collectingAssessed\` are false).

KiTS23 imaging and labels are CC BY-NC-SA 4.0, so these meshes carry the same
non-commercial share-alike terms.

## CT slices

The CT tab in the viewer and the stills on the overview come from
\`scripts/make-ct-slices.py\`, run on the KiTS23 imaging and labels of the same
five cases (not by the script above):

\`\`\`
python scripts/make-ct-slices.py --data C:\\Users\\nityj\\CalyxView-data\\kits23-renal
\`\`\`

What's published, in \`public/ct/reference-<letter>/\`, for each kidney: the
axial slices through a box round the tumour-bearing kidney and its largest
tumour (found as renalplan does), padded by 25 mm. Thin-slice scans are
averaged into slabs of about 3 mm so no slice is skipped; Kidney E's 4 mm
slices are kept as they are. Soft-tissue window (40/400 HU), 8-bit WebP,
about 384 px on the long edge, anterior up and the patient's left on the
right. \`slices.json\` holds the KiTS kidney, tumour and cyst outlines as
polylines in image pixels, each slab's height in the 3D model's frame, and the
slab through the tumour's centre; \`key.webp\` is that slab at 640 px with the
outlines drawn on. The full CT volumes and label volumes are not published,
and nothing in the output names a case. The CT slices carry KiTS23's
CC BY-NC-SA 4.0 terms.

Kidney C's crop includes a small KiTS cyst inside that kidney, level with the lower part of the tumour, that the mesh
leaves out (the mesher kept only the largest cyst, which is in the other
kidney), so the CT tab outlines a cyst that the 3D model doesn't show.
`,
  'utf8',
);

console.log(`published ${published.length} kidneys`);
