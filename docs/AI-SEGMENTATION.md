# Local AI segmentation workflow

Authorised by Nity on 10 October 2026. Research and teaching only. This work is separate from the published site's existing expert-outline cases.

Acceptance outcomes:

1. A reproducible local CT-to-mask command with recorded model/source revisions and input hashes. Kidney, tumour, renal artery and renal vein remain distinct; absence is reported rather than filled with a surrogate.
2. Optional same-patient phases are aligned explicitly, with alignment review required. Collecting-system extraction is restricted to contrast-supported lumen, with incomplete branches retained and pelvis naming not invented automatically.
3. A local review bundle contains source overlays, individual masks, a model, per-structure provenance and pending-review states. Raw CTs and weights stay outside Git and outside the public website.
4. Meaningful tests cover label mapping, spatial alignment, absent anatomy, phase rejection and output integrity. A real public-data inference and export demonstrate the integrated path where runtime/model availability permits. Unsupported stages remain explicit blockers.
5. Verified source changes are committed and pushed on the isolated feature branch; publication claims describe only measured behaviour.

Work leaves: inspect source/runtime; qualify and pin available weights; implement inference/phase handling; implement review/export; run defect and integration checks; record release provenance. The implementation must not automatically substitute KiTS reference masks for predictions, equate aorta/IVC with renal vessels, connect gaps in the collecting system or claim clinical validation.

## What this version does

This is a local workstation tool, not a CT-upload service on calyxview.com.
`renalplan ai` first uses the installed
[TotalSegmentator](https://github.com/wasserth/TotalSegmentator) 6 mm model to
locate kidneys. It crops the CT to their combined extent plus a 40 mm margin,
then runs two separate models. The published nnU-Net v1 Task135_KiTS2021
supplies kidney and tumour drafts on original HU. The
[KiPA22 BA-Net model](https://github.com/ShishuaiHu/BA-Net/tree/kipa22) supplies
unqualified renal artery and vein candidates on an explicitly adapted input
copy. The command discards BA-Net's kidney and tumour labels: those failed
the public-data compatibility checks in both tested intensity encodings.
KiPA labels are 1 vein, 2 kidney, 3 artery, 4 tumour; Task135 labels are
1 kidney, 2 tumour, 3 cyst. This version does not export a cyst mask.
The command checks crop geometry and restores predictions to the original CT grid.
`assessed-region.nii.gz` records the model's coverage. Zero outside that region
means unassessed, not absent anatomy. A coarse miss can exclude a kidney,
exophytic tumour or vessel branch; inspect the full CT and crop boundaries.
The command preserves disconnected
pieces and exports meshes without closing gaps, smoothing or removing small
components. A missing structure remains missing.

KiPA22 uses renal CTA data. Different phases, acquisition protocols and
paediatric anatomy need separate qualification. Neither of the adult public
engineering runs establishes clinical accuracy. TotalSegmentator provides
localisation only; its outlines never become final masks. Its aorta and IVC
labels cannot stand in for renal artery and vein branches.

For a declared excretory phase, a separate rule extracts bright, connected
lumen seeded within 3 mm of the kidney mask, in a search region extending
12 mm from that mask. These margins define a search, not a reconstructed lumen.
Multi-Otsu thresholding is inspired by
[ASSIST-U](https://pmc.ncbi.nlm.nih.gov/articles/PMC11022208/); this implementation
is not the authors' complete pipeline or a validated collecting-system model.
It excludes predicted tumour and vessels, uses a conservative 350 HU floor,
and requires a dense contrast seed. Bright stones, unlabelled vessels and
other structures can still contaminate the candidate. Incomplete opacification
leaves incomplete calyces. The renal pelvis has no separate automatic label.
An expert can correct the collecting-system mask against the CT in Slicer.
The final public urogram run did not provide an adequate dense seed and
therefore exported an empty, explicitly unassessed collecting mask. This
release does not claim that it can automatically reconstruct that study.

An optional same-patient excretory image is aligned to the reference using
[SimpleITK rigid mutual-information registration](https://simpleitk.readthedocs.io/en/master/registrationOverview.html).
The transform and resampled CT are saved. Numerical convergence does not prove
alignment, especially with breathing, deformation or different scan coverage.
The collecting candidate is extracted after resampling. Registration remains
pending review; images from different patients must never be combined.

## Set up a local runtime

Use a separate Python 3.12 environment on a CUDA workstation. Keep models,
raw images and generated bundles outside any Git repository and public web
directory. The first workstation environment used an RTX 5070 Ti with 16 GB
VRAM, PyTorch 2.11.0+cu128, NumPy 2.4.6, SciPy 1.17.1, SimpleITK 2.5.5,
nibabel 5.4.2, scikit-image 0.26.0, batchgenerators 0.25.3, MedPy 0.5.2,
hiddenlayer 0.3 and IPython 9.6.0. These are qualification records, not a
claim that every other environment is supported.

Install this package's `ai` extra in your environment, including
TotalSegmentator 2.14.0. Preinstall its openly available Dataset298 6 mm weights
from the official tool. Supply the `nnunet/results` folder as
`--coarse-model-root`. This workflow requires that checkpoint to be present,
records all model-file hashes, and disables telemetry in a new per-run config.
It leaves the user's existing TotalSegmentator configuration untouched.
The upstream BA-Net
source also imports batchgenerators, MedPy, pandas, scikit-learn, graphviz,
hiddenlayer, IPython and dicom2nifti. Install those in the isolated environment;
do not replace an existing clinical/research environment's dependencies.

Download the source archive for revision
`14a336e20101e474204efc308106bae503431dcb` from the
[GitHub archive endpoint](https://api.github.com/repos/ShishuaiHu/BA-Net/tarball/14a336e20101e474204efc308106bae503431dcb).
Extract it outside Git and identify the `nnUNet` folder inside. Download
[`kipa22.zip` from Zenodo record 7030423](https://zenodo.org/records/7030423).
The archive is 3,708,026,487 bytes; its published MD5 is
`fb22a9730070fdf45ed3923b1d82b4d2`. It contains BA-Net and ResUNet checkpoints;
the lock command extracts only BA-Net into the expected nnU-Net layout.

From the `pipeline` folder, with paths adapted to your machine:

```bash
python -m pip install -e '.[ai]'
python scripts/lock_kipa.py \
  --archive /data/models/kipa22.zip \
  --source-archive /data/models/ba-net.tar.gz \
  --source /data/models/source/BA-Net/nnUNet \
  --results /data/models/kipa-results \
  --out /data/models/kipa-lock.json
```

The command verifies the published model checksum and checks every Python
source file against the downloaded source archive. The qualified source archive
SHA-256 is `4249bbd5b1febe28b9db2cb106a9a94a1a63dd6abb4ab01022a1b522acb270fd`;
a different archive must be requalified explicitly. It records SHA-256 hashes
of the source archive, source files and extracted checkpoints. Inference
rechecks the locked files. The verified legacy PyTorch checkpoints require
pickle loading, which is enabled only in the model subprocess. Do not use
arbitrary checkpoints or untrusted replacement locks.

Task135 uses a separate, clean copy of official nnU-Net v1 source at
`db16c6cef5fdd5a180159184e46b58bcca670446`. Download its
[pinned source archive](https://api.github.com/repos/MIC-DKFZ/nnUNet/tarball/db16c6cef5fdd5a180159184e46b58bcca670446)
and extract it outside Git. Its qualified archive SHA-256 is
`797535faf36163ffbd24f9ae26587719b98b5eae9624b0533acc80364b2e5892`.
Preinstall the published Task135 model from
[nnU-Net's Zenodo model record](https://zenodo.org/records/5126443).
Point `--tissue-model-root` to the parent of
`nnUNet/3d_fullres/Task135_KiTS2021/nnUNetTrainerV2__nnUNetPlansv2.1`.
The package freezes the plans and all five fold checkpoint identities in
`renalplan/model_specs/task135.json`. Inference verifies them before and after
prediction and verifies every Python source file against the pinned archive.
It rejects an additional postprocessing file. Keep nnU-Net's Apache 2.0 licence
and the model record's licence/attribution with your downloaded files.

BA-Net source is Apache 2.0; the Zenodo model record specifies CC BY 4.0.
Retain the authors' licences and attribution. The
[KiTS23 public data](https://github.com/neheller/kits23) is CC BY-NC-SA;
respect its noncommercial/share-alike conditions. Source code publication
does not publish the raw scans or weights.

## Generate a draft

Inputs must be 3D NIfTI CTs with explicit millimetre spatial units, original
Hounsfield units and finite geometry. This command does not accept DICOM or
de-identify a scan. Use an approved de-identified export and conversion first;
the project's older DICOM tripwire is not a de-identification audit. Do not
guess missing units for a clinical scan.

```bash
python -m renalplan.cli ai \
  --ct /data/deidentified/reference.nii.gz --phase arterial \
  --excretory /data/deidentified/excretory.nii.gz --same-study \
  --model-source /data/models/source/BA-Net/nnUNet \
  --model-root /data/models/kipa-results \
  --model-archive /data/models/kipa22.zip \
  --model-lock /data/models/kipa-lock.json \
  --model-hu-offset 1024 \
  --tissue-model-source /data/models/source/nnUNet-v1 \
  --tissue-source-archive /data/models/nnunet-task135.tar.gz \
  --tissue-model-root /data/models/kits-results \
  --coarse-model-root /data/total-models/nnunet/results \
  --three-dir /path/to/calyxview-renal/node_modules/three \
  --case-id research-pilot --out /data/local-review
```

Declare the actual reference phase; the command cannot classify it. Omit
`--excretory` and `--same-study` when you have only one image. If that image
is already an excretory CT, use `--phase excretory`. Otherwise the collecting
system is not assessed. `--same-study` is a human declaration, not an automated
identity check. BA-Net defaults to folds 0, 1, 2 and 3 with test-time mirroring;
Task135 defaults to folds 0 to 4 without test-time mirroring. The two pilot
studies used `--folds 0 --tissue-folds 0`, a single-fold engineering check,
not the default full ensembles. This release has not measured the full
ensembles on these studies.
`--model-hu-offset` is an explicit experimental adaptation of the model's
input copy. The released BA-Net plans record foreground mean 1141.0159,
standard deviation 87.33068 and clipping limits 918 to 1396. Those statistics
are inconsistent with ordinary renal soft-tissue HU. The +1024 offset is
inferred from those statistics and conventional stored CT encoding; the
authors' exact input encoding has not been independently confirmed. It needs
external qualification. The original CT, TotalSegmentator input, collecting
extraction and CT overlays stay in HU. `0` permits a documented unadapted
experiment; its masks must not be presented as qualified anatomy. The first
unadapted KiTS pilot produced gross false tumour labels, which prompted this
check. Neither the adapter nor the first public-data comparison establishes
clinical accuracy.
`--vessel-bundle` can reuse a completed, hash-verified BA-Net bundle from the
exact same reference CT, avoiding a repeat vessel run. The command verifies
the reference CT hash and links the parent provenance. It still reruns Task135
and collecting extraction. It never loads expert outlines as predictions.
Instead of automatic localisation, `--renal-crop` declares that the input is
already a reviewed renal CT crop. The crop is limited to an estimated
100 million voxels at BA-Net's trained spacing to fit the qualified runtime.
An oversized or undetected ROI fails explicitly; the pipeline does not guess
a crop or silently substitute a coarse mask. The 40 mm margin and crop budget
are engineering choices, not validated surgical limits.

Every case code must start with `research-` and contain no patient identifiers.
Existing output directories are preserved. A caught failure has `failed.json`;
a kernel kill or interrupted process can leave an incomplete folder without
that marker. Neither is a complete bundle. Inspect the local logs to diagnose it.
For a completed bundle, `complete.json` binds the provenance record; individual
artifact hashes detect accidental changes, not malicious tampering by someone
who can rewrite the bundle and all its hashes.

## Review and correct

Serve a completed bundle over localhost only:

```bash
python -m http.server 5232 --bind 127.0.0.1 \
  --directory /data/local-review/research-pilot
```

Open `http://127.0.0.1:5232/`. View the model layers, then inspect the source
CT boundaries in all three planes. These are canonical voxel planes; oblique
inputs retain their geometry rather than becoming a diagnostic MPR viewer.
PNG overlays use fixed windows and cover the combined mask extent plus eight
voxels. Inspect the full source NIfTI in Slicer for anatomy outside that crop,
different windows, detailed vessels and any uncertain boundaries.

The bundle includes five binary masks, including explicit empty masks, the
source CT, optional aligned phase/transform, GLB and per-structure provenance.
The local viewer copies Three.js assets from `--three-dir` and has no CDN
fallback. The existing site's `npm ci` installation supplies `node_modules/three`;
the pilot used Three.js 0.185.1. Without those assets the CT review still works and the GLB can be
downloaded. The viewer makes no external requests or uploads.

Correct an individual binary mask on the exported source CT grid in Slicer.
Record the decision in a fresh bundle:

```bash
python -m renalplan.cli ai-review \
  --bundle /data/local-review/research-pilot \
  --structure collecting_system --decision needs-correction \
  --reviewer-code reviewer-local \
  --corrected /data/corrections/collecting_system.nii.gz \
  --three-dir /path/to/calyxview-renal/node_modules/three \
  --case-id research-pilot-review1 --out /data/local-review
```

Use `accepted` only after source review; an empty mask cannot be accepted as
a reconstructed structure. Use `not-assessable` with an empty corrected mask
when the anatomy cannot be reconstructed. To accept a collecting mask after
inter-phase registration, inspect alignment and include `--alignment-checked`.
Decisions are reviewer-declared, not authenticated clinical sign-off. The
original bundle is preserved; the new record links the parent and any corrected
mask hash. Scores and planning measurements remain withheld even after a
recorded review. This release does not implement a clinical readiness gate,
surgical clearance or automated margin selection.
