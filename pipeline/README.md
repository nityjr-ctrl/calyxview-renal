# renalplan: CT-to-3D reconstruction and planning support for partial nephrectomy

> Research and teaching prototype. Not a medical device. Not for diagnosis,
> treatment selection, surgical planning, margin selection or patient care.

`renalplan` is the Python side of CalyxView Renal. It takes a CT (NIfTI or a
de-identified DICOM export) plus a kidney / tumour / cyst label map, and produces:

- a **3D case bundle**: one GLB with named meshes (tumour-side kidney,
  contralateral kidney, tumour, cyst, approximate renal sinus, resection margin
  envelope, residual parenchyma, hilar vessels and body outline when a CT is
  given), plus a viewer manifest entry;
- **nephrometry** computed from the masks: R.E.N.A.L. and PADUA components with
  every assumption stated;
- **resection geometry**: tumour and kidney volumes, an illustrative uniform
  margin, parenchyma inside the margin, residual volume and preserved fraction,
  contact surface, distances to sinus, vessels and collecting system;
- **evaluation**: Dice, surface Dice, HD95 and volume error against reference
  labels, per case and with bootstrap confidence intervals, using the KiTS23
  hierarchical regions and tolerances;
- **optimisation**: a grid search over explainable post-processing rules for
  model output, and a sweep over mesh smoothing / decimation scored against the
  source mask.

It is deliberately CPU-first so everything can be run and scored on a laptop.
The GPU model backends (TotalSegmentator, nnU-Net) are wrapped as subprocess
calls for the workstation.

## Install

```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e .            # gives you the `renalplan` command
pytest                      # 7 tests on a synthetic phantom with known geometry
```

## Commands

```bash
# one case from a label map (KiTS convention: 1 kidney, 2 tumour, 3 cyst)
renalplan case --labels case_00000/segmentation.nii.gz --out out --case-id case_00000
# with the CT: adds hilar vessels (threshold) and the body outline, and scores against a reference
renalplan case --labels pred.nii.gz --ct imaging.nii.gz --reference segmentation.nii.gz --vessels --out out
# from a de-identified DICOM folder (refuses identified data)
renalplan case --labels pred.nii.gz --dicom /path/to/export --series "NEPHRO" --out out

# every KiTS case under a folder -> out/nephrometry.csv + one bundle per case
renalplan batch --kits ~/CalyxView-data/kits --out out/kits

# score predictions against references (KiTS regions, bootstrap CI, plot)
renalplan evaluate --pred preds/ --ref ~/CalyxView-data/kits --out out/eval
# grid-search post-processing rules for mean Dice, write the best config
renalplan optimise-postprocess --pred preds/ --ref ~/CalyxView-data/kits --out out/pp
renalplan evaluate --pred preds/ --ref ~/CalyxView-data/kits --postprocess out/pp/best_postprocess.json --out out/eval_pp
# sweep Taubin iterations x decimation targets; recommend the cheapest faithful mesh
renalplan optimise-mesh --kits ~/CalyxView-data/kits --limit 4 --out out/mesh

# tooling only: reference labels with SIMULATED errors (never a model prediction)
renalplan perturb --kits ~/CalyxView-data/kits --out sim/ --tumour-erode
# synthetic phantom used by the tests
renalplan phantom --out phantom/
```

Every case bundle contains `planning.json` (machine-readable), `report.md`
(human-readable), `manifest_entry.json` (drop-in for the CalyxView viewer
manifest, with the GLB copied to `web/public/models/`), and `overview.png`
(mask overlay; CT pixels only with `--render-ct`).

## How the numbers are derived

| Quantity | Method | Stated assumption |
| --- | --- | --- |
| R (size) | Longest chord of the tumour's convex hull, mm | none |
| E (exophytic) | Fraction of tumour voxels outside the convex hull of the parenchyma | hull stands in for the renal outline |
| N (nearness) | Distance from tumour surface to the collecting system if an excretory-phase mask is supplied, else to the sinus region | sinus = hull-enclosed space that is not parenchyma or tumour |
| A (anterior/posterior) | Sign of the tumour centroid along the patient anterior axis relative to the kidney centroid, orthogonal to the kidney long axis; within 5 mm is "x" | none |
| L (polar) | Tumour extent along the kidney long axis (PCA) against the polar lines at the sinus extent | polar lines at the 5th/95th percentile of the sinus along the long axis |
| h (hilar) | Tumour within 2 mm of the vessel mask | only when a vessel mask exists |
| PADUA rim | Sign of the tumour centroid along the centroid-to-sinus axis | as above |
| Volumes | Voxel counts times voxel volume; mesh volumes reported separately | tumour overwrites parenchyma where labels overlap |
| Margin | Euclidean distance transform of the tumour, thresholded at the margin | uniform margin, not a surgical plan |
| Contact surface | Voxel faces shared between tumour and parenchyma | none |
| Vessels | HU threshold within 30 mm of the kidney, outside the parenchyma, components >= 0.2 ml | one enhanced phase; artery/vein split needs an arterial phase |

## Segmentation backends

| Backend | Where it runs | What it gives | Status |
| --- | --- | --- | --- |
| Reference labels (KiTS23) | CPU | kidney, tumour, cyst | used for all results here |
| nnU-Net v1 Task135_KiTS2021 | GPU | kidney, tumour, cyst | benchmarked in `research/kits23-feasibility`; wrapper in `segment.nnunet_predict` |
| TotalSegmentator v2 | GPU | kidneys, kidney cysts, aorta, IVC | wrapper in `segment.totalsegmentator`; no tumour class |
| Region-grow from a seed | CPU | kidney (naive yardstick) | `segment.region_grow_kidney` |
| HU threshold near the hilum | CPU | contrast-filled vessels | `segment.extract_vessels` |

## Results on real KiTS23 masks

See `results/README.md` for the tables and plots produced in this repository
(nephrometry on eight real cases, the mesh fidelity sweep and its recommended
settings, and the post-processing sweep on simulated errors). CT volumes,
reference labels and predictions stay outside git; only derived numbers and
mask-only plots are committed.

## What is missing before clinical use

Everything in `docs/production-segmentation-roadmap.md` still applies: validated
de-identification, protocol QC, a trained and independently validated
multi-structure model (arteries, veins, collecting system), expert correction,
human-factors and clinical validation, quality management and regulatory
authorisation. The nephrometry here has not been compared with surgeon-assigned
scores; that comparison is the first study to run once PACS access exists (see
`docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md`).

## Data and licences

KiTS23 (Heller et al.) is used under CC BY-NC-SA 4.0, non-commercial. The
synthetic phantom is generated by `renalplan.phantom` and is never presented as
a patient.
