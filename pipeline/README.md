# renalplan: 3D models and computed nephrometry from kidney and tumour outlines

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
- **optimisation**: a grid search over simple post-processing rules for
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
pytest                      # 35 tests: a synthetic phantom with known geometry, the score cut-offs and rules, the DICOM tripwire
```

`pip install -e .` points the `renalplan` command at this folder. If an older
copy was installed from somewhere else, the command runs that copy instead.
Check with `python -c "import renalplan; print(renalplan.__file__, renalplan.__version__)"`.
The tests always import the copy next to them (`pythonpath` in `pyproject.toml`),
and `python -m renalplan.cli ...` run from this folder does too.

## Commands

```bash
# one case from a label map (KiTS convention: 1 kidney, 2 tumour, 3 cyst)
renalplan case --labels case_00000/segmentation.nii.gz --out out --case-id case_00000
# with the CT: adds hilar vessels (threshold) and the body outline, and scores against a reference
renalplan case --labels pred.nii.gz --ct imaging.nii.gz --reference segmentation.nii.gz --vessels --out out
# from a de-identified DICOM folder. --case-id is required here: use the study code, not a folder name.
# The loader stops on some identifying header fields (a tripwire, not a de-identification check).
renalplan case --labels pred.nii.gz --dicom /path/to/export --series "NEPHRO" --case-id STUDY-001 --out out

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

Without `--case-id`, `case` names the case after the label file's folder (the
KiTS layout, `case_00000/segmentation.nii.gz`) or, for a bare file such as
`pred.nii.gz`, after the file. A folder name can carry a hospital or patient
name, so pass `--case-id` for anything outside KiTS.

Every case bundle contains `planning.json` (machine-readable), `report.md`
(human-readable), `manifest_entry.json` (drop-in for the CalyxView viewer
manifest, with the GLB copied to `web/public/models/`), and `overview.png`
(mask overlay; CT pixels only with `--render-ct`).

## How the numbers are derived

| Quantity | Method | Stated assumption |
| --- | --- | --- |
| R (size) | Largest distance between tumour surface-voxel centres, mm | measured centre to centre, so it can read up to about one voxel short |
| E (exophytic) | Fraction of tumour voxels outside the convex hull of the parenchyma | hull stands in for the renal outline; 5% or less outside is scored as entirely endophytic (E 3) |
| N (nearness) | Distance from tumour surface to the collecting system if an excretory-phase mask is supplied, else to the sinus region | sinus = hull-enclosed space that is not parenchyma or tumour |
| A (anterior/posterior) | Sign of the tumour centroid along the patient anterior axis relative to the kidney centroid, orthogonal to the kidney long axis; within 5 mm is "x" | none |
| L (polar) | Tumour extent (2nd to 98th percentile of its voxels) along the kidney long axis (PCA) against two polar lines. 3 if it lies entirely between them, crosses the axial midline (half-way between them) or has more than half its voxels between them; 1 if it lies entirely above or below them; 2 otherwise | lines at the 5th/95th percentiles of the sinus estimate along the long axis. An estimate that spans less than 20 mm or doesn't straddle the kidney's centroid isn't used: the lines then go where 30% of the kidney's volume lies beyond each (the 30th/70th percentiles of kidney voxels along the axis, roughly a third and two thirds of the way along, not 30% and 70% of the length), and the notes say so. Both scores set their lines on axial CT slices and define them differently; here one pair of planes across the kidney's own long axis serves both, so L is approximate for every case |
| h (hilar) | Tumour within 2 mm of the vessel mask | only when a vessel mask exists. R.E.N.A.L. gives h only when the tumour touches the main renal artery or vein. The vessel mask (below) takes in branches and anything else that bright near the kidney, so this can call h too often |
| PADUA polar location | Share of tumour voxels between the same two lines: more than half is middle (2); half or less is superior or inferior (1), after the end holding more of the tumour | the more-than-half rule is the one Wood et al. used to automate PADUA (BJU Int 2024), with lines at the axial extent of sinus fat on CT. Ficarra et al.'s own wording for a tumour that crosses a line (Eur Urol 2009) wasn't checked. Approximate for the same reasons as L |
| PADUA rim | Sign of the tumour centroid along the centroid-to-sinus axis | uses the sinus estimate, even when it was too small to set the polar lines |
| Sinus check | Sinus estimate more than 25% of the kidney's volume, or spanning more than half its length | no renal sinus is that big, so the kidney isn't the usual shape (a horseshoe kidney does this). The notes flag L, N and PADUA's polar, rim and sinus items as unreliable. Scores aren't changed |
| Volumes | Voxel counts times voxel volume; mesh volumes reported separately | tumour overwrites parenchyma where labels overlap |
| Margin | Euclidean distance transform of the tumour, thresholded at the margin | uniform margin, not a surgical plan |
| Contact surface | Voxel faces shared between tumour and parenchyma | none |
| Vessels | HU threshold within 30 mm of the kidney, outside the parenchyma, components >= 0.2 ml | one enhanced phase; artery/vein split needs an arterial phase |

R, E and N are rounded to the precision they're stored at (0.01 cm, 0.001 and
0.1 mm) before they're scored, so R.E.N.A.L., PADUA and the report agree at
every cut-off. Every `planning.json` and `report.md` lists the assumptions
behind its case.

Version 0.2.0 (29 September 2026) changed the location rules: the polar-line
fallback for a small or off-centre sinus estimate, the more-than-half rule for
the PADUA pole, the axial midline half-way between the lines, the sinus check,
R 3 at exactly 7.0 cm, and scoring from the rounded values. `results/README.md`
lists what that did to each case.

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
authorisation. The nephrometry here hasn't been compared with clinicians' scores.
That comparison is the first study to run once the trust has agreed an export
(see `docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md`).

## Data and licences

KiTS23 (Heller et al.) is used under CC BY-NC-SA 4.0, non-commercial. The
synthetic phantom is generated by `renalplan.phantom` and is never presented as
a patient.
