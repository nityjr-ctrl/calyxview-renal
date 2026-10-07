# Kidneys A to E in the 3D viewer

The 3D viewer shows 5 kidneys from the public KiTS23 dataset. They
appear under neutral letters because the deploy bundle scan forbids cohort
identifiers in any published path or text file. This file records the mapping
and is never deployed.

Regenerate from the repository root with:

```
node scripts/make-reference-cases.mjs [path-to-calyxview-models-dir]
```

| Shown as | Pipeline table case | Cohort case | Meshes in the file |
| --- | --- | --- | --- |
| Kidney A (reference-a) | 1 | `case_00000` | parenchyma, tumour |
| Kidney B (reference-b) | 2 | `case_00001` | parenchyma, tumour |
| Kidney C (reference-c) | 3 | `case_00002` | parenchyma, tumour, cyst, ribs, psoas, colon, spleen, liver, skin |
| Kidney D (reference-d) | 4 | `case_00003` | parenchyma, tumour |
| Kidney E (reference-e) | 5 | `case_00004` | parenchyma, tumour |

Where each part comes from:

- The meshes are byte-identical copies of the ones my separate CalyxView
  endourology project made (its mesh step, `endo_recon_pipeline.py`) from the
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
  `pipeline/results/summary.public.json`, so the viewer matches the pipeline
  table. The rest comes from each case's `planning.json`.
- No CT was used in these runs, so the hilar suffix and PADUA's
  collecting-system item weren't assessed (`hilarAssessed` and
  `collectingAssessed` are false).

KiTS23 imaging and labels are CC BY-NC-SA 4.0, so these meshes carry the same
non-commercial share-alike terms.

## CT slices

The CT tab in the viewer and the stills on the overview come from
`scripts/make-ct-slices.py`, run on the KiTS23 imaging and labels of the same
five cases (not by the script above):

```
python scripts/make-ct-slices.py --data C:\Users\nityj\CalyxView-data\kits23-renal
```

What's published, in `public/ct/reference-<letter>/`, for each kidney: the
axial slices through a box round the tumour-bearing kidney and its largest
tumour (found as renalplan does), padded by 25 mm. Thin-slice scans are
averaged into slabs of about 3 mm so no slice is skipped; Kidney E's 4 mm
slices are kept as they are. Soft-tissue window (40/400 HU), 8-bit WebP,
about 384 px on the long edge, anterior up and the patient's left on the
right. `slices.json` holds the KiTS kidney, tumour and cyst outlines as
polylines in image pixels, each slab's height in the 3D model's frame, and the
slab through the tumour's centre; `key.webp` is that slab at 640 px with the
outlines drawn on. The full CT volumes and label volumes are not published,
and nothing in the output names a case. The CT slices carry KiTS23's
CC BY-NC-SA 4.0 terms.

Kidney C's crop includes a small KiTS cyst inside that kidney, level with the lower part of the tumour, that the mesh
leaves out (the mesher kept only the largest cyst, which is in the other
kidney), so the CT tab outlines a cyst that the 3D model doesn't show.
