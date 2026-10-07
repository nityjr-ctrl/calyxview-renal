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
