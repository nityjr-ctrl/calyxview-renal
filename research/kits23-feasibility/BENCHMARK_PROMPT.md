# Reusable prompt — frozen KiTS23 × Task135_KiTS2021 feasibility benchmark

Copy the text below as one prompt. Do not edit the cohort, revisions, model, metrics, or failure policy after looking at results.

---

You are implementing and running a reproducible, research-only renal CT segmentation feasibility benchmark. Work to evidence-backed completion, preserve an audit trail, and never fabricate a result.

## Safety boundary

Display this warning on every human-readable result:

**RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE. NOT FOR DIAGNOSIS, TREATMENT SELECTION, SURGICAL PLANNING, MARGIN SELECTION, OR PATIENT CARE. MODEL OUTPUTS MAY BE INCOMPLETE OR WRONG.**

This task processes public research NIfTI data only. Do not process clinical/patient DICOM, do not make treatment recommendations, and do not describe the output as validated, diagnostic, planning-grade, or clinically safe. Never upload source CT, reference labels, predictions, model weights, archives, credentials, or caches to GitHub, Netlify, a browser application, or any third party not explicitly required by the official sources below.

## Frozen objective

Run the official pretrained KiTS21 nnU-Net v1 `Task135_KiTS2021` **3d_fullres five-fold ensemble** on exactly these 20 KiTS23 cases:

`case_00400`, `case_00401`, `case_00402`, `case_00403`, `case_00404`, `case_00405`, `case_00406`, `case_00407`, `case_00408`, `case_00409`, `case_00410`, `case_00411`, `case_00412`, `case_00413`, `case_00414`, `case_00415`, `case_00416`, `case_00417`, `case_00418`, `case_00419`.

The cohort and inference settings are frozen before inference. Do not replace cases, sample a more favourable subset, change the model configuration, omit failed cases, enable test-time augmentation, or report a partial cohort as a 20-case run.

## Immutable provenance

- KiTS23 repository: `https://github.com/neheller/kits23`
- KiTS23 commit: `c1088353084c17b8882a11db71429e7c022b7785`
- Official imaging dataset: `https://huggingface.co/datasets/neheller/KiTS-Challenge-Imaging`
- Imaging revision: `65f1f295873a326230153c7e1de0c7dba10f0b29`
- Canonical portable manifest SHA-256: `bc529b7e5edfa9c5ac0979de1d38a027735b741760e3e82c14acc78ec900c561`
- Frozen source totals: `1,030,320,853` image bytes and `3,669,644` label bytes
- Data licence: `CC BY-NC-SA 4.0`
- nnU-Net v1 repository: `https://github.com/MIC-DKFZ/nnUNet`
- nnU-Net commit: `db16c6cef5fdd5a180159184e46b58bcca670446`
- Official model archive: `https://zenodo.org/record/5126443/files/Task135_KiTS2021.zip?download=1`
- Model archive bytes: `3,505,803,654`
- Model archive MD5: `b27ab702742083080b95baac00ba186f`
- Model archive SHA-256: `a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3`
- Installed `plans.pkl`: `143,080` bytes; SHA-256 `d15d46664240f0a9056ef1320e00df46fbd866ea94323a98e47b3e9eff1f4e39`
- Postprocessing contract: `postprocessing.json` absent; no model postprocessing applied
- Model: `Task135_KiTS2021`, configuration `3d_fullres`, folds `0 1 2 3 4`, test-time augmentation disabled, one preprocessing thread, one NIfTI-save thread
- Recorded platform: WSL2 Linux `6.6.87.2-microsoft-standard-WSL2`, Python `3.12.3`, nnU-Net package `1.7.0`
- PyTorch: `2.7.1+cu128`, installed separately from `https://download.pytorch.org/whl/cu128`
- CUDA runtime and GPU: CUDA `12.8`; NVIDIA GeForce RTX 5070 Ti; `17,094,475,776` reported VRAM bytes
- NumPy: `1.26.4`
- NiBabel: `5.4.2`
- SimpleITK: `2.5.6`
- Surface-distance: `0.1`

The model's documented training cohort is KiTS21 `case_00000`–`case_00299`; the frozen cases therefore have no identifier overlap and were published in a later KiTS dataset. Describe the result as a **non-overlapping, within-KiTS feasibility check**. Explicitly state that it is neither an independent external cohort nor multicentre/prospective clinical validation.

The canonical portable manifest hash identifies the frozen cohort/content after excluding machine-specific absolute paths. Use it in reproducibility documentation and public metadata; do not substitute the hash of a workstation-specific CSV serialization.

The model/data/protocol identity is frozen, and key runtime versions are recorded. The complete transitive dependency graph is neither captured nor supplied as a fully hashed lock file, so capture as much additional environment evidence as practical and disclose any unrecorded or changed dependency rather than calling the environment byte-for-byte reproducible.

## Execution-environment qualification

Keep the website repository and all research assets separate. Store source NIfTI, labels, predictions, archives, logs, timings, and reports under an external non-repository `WORK_ROOT`. Use native Linux storage for the exact source/model cache and inference scratch; the recommended rebuildable locations are `/var/tmp/calyxview-renal-runtime-v2` and `/var/tmp/calyxview-renal-kits20`. Do not use `/mnt/c`, OneDrive, Git, or the deployed website for preprocessing or per-case scratch.

The recorded 32 GB Windows workstation initially used a 15 GiB WSL cap and 4 GiB swap. The Linux kernel terminated inference for memory pressure, so those attempts were preserved separately as environment-gate failures rather than counted as model attempts. Before the qualified run, `%UserProfile%\.wslconfig` was temporarily set to:

```ini
[wsl2]
memory=26GB
swap=16GB
```

After `wsl --shutdown`, require `free -h` to show approximately 25 GiB usable memory and 16 GiB swap, and require `nvidia-smi` to show the intended GPU. Do not apply these values to a smaller host without leaving safe capacity for Windows. Preserve any pre-existing `.wslconfig`, do not commit the temporary file, and restore the original settings after all inference and reporting are complete.

Treat the legacy checkpoint as untrusted executable-format content until all provenance gates pass. Verify official URL, archive byte count, MD5, SHA-256, the exact tracked nnU-Net revision, absence of unignored untracked files, a recorded inventory of ignored runtime artefacts, and all five fold files before deserialisation. The inventory is evidence of what was present, not a claim that ignored artefacts are upstream commit content or that the executable source tree is pure. Smoke-load fold 0 in a dedicated least-privilege research environment with no credentials or unrelated secrets. The exact nnU-Net revision uses explicit `weights_only=False`; narrowly allow `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` only inside the checksum-verified inference subprocess. Never use that compatibility path for an unknown, modified, or uploaded checkpoint.

## Required execution gates

1. Confirm the KiTS23 checkout resolves to the exact commit. The GitHub repository provides code, labels, and provenance; the CT volumes themselves come from the separate official Hugging Face imaging store and must not be described as GitHub-hosted data.
2. Acquire only `case_00400`–`case_00419` from the exact imaging revision. Require the canonical portable manifest SHA-256 and source byte totals above.
3. For every case, validate that image and reference are 3D, finite, shape/affine matched, and use only integer labels `0`, `1`, `2`, `3` where `0=background`, `1=kidney`, `2=tumour`, and `3=cyst`.
4. Before inference, write a 20-row local manifest containing case order, source/reference SHA-256, byte counts, paths, shape, spacing, label values, and reference volumes. Separately derive and hash its canonical portable, path-free representation. Write metadata with the frozen revisions, selection rule, licence, and canonical portable manifest SHA-256. Do not continue if the cohort is not exactly 20 cases or the portable hash differs.
5. Download the model to a partial filename, require the exact completed byte count, and verify both frozen hashes before installation. MD5 and SHA-256 establish file identity, not pickle safety. Confirm the installed `3d_fullres` directory has folds 0–4, verify every checkpoint/metadata hash, verify the frozen `plans.pkl`, and require `postprocessing.json` to be absent. Do not use nnU-Net v2; v1 weights are incompatible.
6. Confirm the exact tracked nnU-Net revision, CUDA device, WSL memory/swap qualification, and native `/var/tmp` cache/scratch before checkpoint loading. Record Python, PyTorch, CUDA, GPU, nnU-Net revision, package versions, command line, start/end time, and wall-clock/resource evidence.
   If a checkout or runtime copy is materialised with CRLF line endings, do not describe the whole checkout as clean. Its tracked source may be recorded as commit-equivalent only after proving there are no staged or unignored untracked files and `git diff --ignore-cr-at-eol` is empty; any other tracked change is a hard stop. Separately inventory and hash Git-ignored artefacts, disclose potentially executable ignored files, and do not claim executable-source purity from the tracked-source check. Apply the same scope to the KiTS23 checkout and independently re-hash every active image, label, and nnU-Net input against the frozen manifest.
7. In the dedicated least-privilege environment, smoke-load fold 0 from the checksum-verified legacy checkpoint. Then run one smoke case (`case_00400`) with the exact five-fold `3d_fullres` protocol, disabled test-time augmentation, and single preprocessing/save threads. Continue to all 20 only if the prediction exists and passes NIfTI shape, affine, spacing, finiteness, integer-label, and label-range validation. Do not use the stronger `3d_cascade_fullres` configuration for this frozen hardware-bounded run.
8. Run all 20 with the exact equivalent of:

   `nnUNet_predict -i <nnunet_input> -o <predictions> -t Task135_KiTS2021 -m 3d_fullres -f 0 1 2 3 4 --num_threads_preprocessing 1 --num_threads_nifti_save 1 --disable_tta`

9. Execute one case per process in manifest order. Record per-case start/end time, command configuration, attempt runtime, stdout/stderr paths, and final status. Permit at most one byte-for-byte identical retry; do not change settings on retry.
10. Preserve one output NIfTI per manifest case locally, but never commit or publish it.
11. Evaluate every manifest row, including failures, and generate the required artefacts below.

Use strict validated resume after the smoke case and after safe interruptions. An existing result may be skipped only when its timing record says succeeded, its exact recorded command/configuration matches, and a fresh validation confirms geometry and allowed labels. A missing record, changed configuration, or invalid output is a hard stop. Never combine resume and overwrite modes. Do not relaunch a completed model failure to obtain extra attempts; resume may rerun only a separately documented environment-gate failure that occurred before a qualified model attempt. If a full run is interrupted after a case has already exhausted its two allowed attempts, use `-SkipRecordedFailures` only together with strict resume. It must require the exact case/order/configuration, attempts numbered 1 and 2, reconciled finite runtimes, exact case-bound logs, explicit absence of a final prediction, and no canonical prediction file. Preserve that failure in the denominator and expect the resumed runner to exit `1` after processing the remaining cases. Do not retry it; use the 20-record complete-provenance gate and failure-accounted evaluation as the release decision.

## Exact evaluation contract

Use these KiTS23 hierarchical regions and physical Surface Dice tolerances:

- Kidney + mass: labels `(1,2,3)`, tolerance `1.0330772532390826 mm`
- Mass (tumour + cyst): labels `(2,3)`, tolerance `1.1328796488598762 mm`
- Tumour: label `(2)`, tolerance `1.1498198361434828 mm`

For each case and region compute:

- Dice: `2|A∩B|/(|A|+|B|)`, with both empty = 1 and one empty = 0.
- Symmetric Surface Dice in physical millimetres using `surface-distance==0.1` and the exact tolerance above.
- Symmetric robust 95th-percentile Hausdorff distance (HD95) in physical millimetres from the same surface distances.
- Reference volume, predicted volume, signed error, absolute error, and relative error in mL using `abs(det(affine[:3,:3]))/1000` as voxel volume.

Report arithmetic case means for each region and for the three-region per-case average. Add non-parametric case-bootstrap percentile 95% confidence intervals using exactly 10,000 resamples and seed `20260901`. Do not use voxel-pooled confidence intervals.

## Failure policy

Hard-stop before inference if a repository revision, tracked-source identity or unignored-change gate, imaging revision, cohort, manifest checksum/byte total, source geometry, label contract, model byte count/hash, five-fold installation, legacy-checkpoint smoke, CUDA, WSL memory/swap, or native-scratch preflight check fails. Preserve the evidence and report the run as blocked. Never substitute another asset to force completion.

When process/kernel evidence proves that inference was killed before a qualified attempt because the WSL resource gate was inadequate, quarantine those logs and timings as environment-qualification evidence. Correct only the execution capacity, keep the frozen model/data/command unchanged, and state why the attempt is not counted as model performance. Do not use this exception for an unexplained model error.

Once the frozen run begins, continue safely across independent cases when possible and retain every failed case in the result table and aggregate denominator. For a missing or invalid prediction, including unreadable data, non-integer/out-of-range labels, shape mismatch, affine mismatch, or spacing mismatch:

- set Dice to `0` for all three regions;
- set Surface Dice to `0` for all three regions;
- treat prediction volume as `0 mL` when reference geometry is valid;
- set HD95 to the reference image's physical diagonal, or `1000 mm` if reference geometry cannot be validated;
- record the exact failure reason and never drop or replace the case.

Use `complete_with_failures` only to mean the 20-row, failure-accounted report completed. Claim successful inference only if all 20 predictions validate.

## Required outputs

Produce locally:

1. `manifests/manifest.csv` with exactly 20 ordered rows.
2. `manifests/manifest.metadata.json` with provenance, selection rule, licence, hashes, and research disclaimer.
3. `predictions/case_XXXXX.nii.gz` for each successful case; local only, never published.
4. `report/case-results.csv` with status/failure reason, runtime when available, three-region Dice/Surface Dice/HD95, and volume errors for every case.
5. `report/summary.json` with completion counts, failure-accounting rule, per-region and overall means/95% CIs, runtime evidence, software/hardware provenance, metric definitions, and privacy assertions.
6. `report/report.html` with a prominent research-only warning, aggregate cards, all 20 case rows, and method/limitation text.
7. `report/qc/case_XXXXX.png` using **derived segmentation masks only**—reference, prediction, and disagreement; no CT pixels.
8. `report/worst-cases.html` and `report/worst-cases.png`, ranked by failures first, then lowest mean Surface Dice and Dice.
9. A machine-readable list of output SHA-256 hashes.

Before presenting the result, scan the report directory and fail if it contains `.nii`, `.nii.gz`, `.dcm`, or `.dicom` files. Inspect the worst-case gallery. Recount manifest rows, predictions, successful evaluations, and failures from disk; do not rely on memory.

## Aggregate-only publication contract

All required outputs above are **local audit evidence**, not website assets. Do not publish the manifest, case-result rows, case-linked metrics/statuses/failure reasons, timing/log records, absolute paths, NIfTI references, mask/QC images, worst-case gallery, detailed report HTML, weights, or output-hash list. The frozen public cohort IDs `case_00400`–`case_00419` may appear only as protocol/method metadata, without any per-case result attached. Do not copy local `summary.json` verbatim without review.

Generate a candidate with the repository's `make_public_summary.py` release gate, outside the repository, from the completed local `report/summary.json`. The public repository/site may receive only the reviewed `summary.public.json` containing cohort size, success/failure counts, aggregate per-region metrics and confidence intervals, aggregate runtime, and frozen revisions/hashes. A protocol field may name the fixed cohort range or list its 20 public KiTS IDs, but it must not map an ID to a metric, status, failure reason, runtime, log, path, image, or other artefact. The surrounding public page must visibly display the method, limitations, licence notice, and research disclaimer. Run the repository's aggregate-publication test and inspect the built deploy directory for forbidden medical/model files before publishing.

Public wording must say **non-overlapping, within-KiTS feasibility**. It must never say or imply “external validation”. Attribute KiTS23 and the official imaging store, disclose CC BY-NC-SA 4.0 non-commercial/share-alike restrictions, identify the Zenodo model archive and nnU-Net source, and state that no endorsement is implied.

## Final response contract

This is the private/local operator handoff, not a website publication payload. Lead with the measured outcome, then report:

- exact cohort/model/framework revisions, canonical portable manifest SHA-256, model byte count, MD5, and SHA-256;
- `successful/20` and failed case identifiers/reasons;
- per-region Dice, Surface Dice, HD95, and volume MAE with 95% confidence intervals;
- wall-clock/runtime, WSL memory/swap qualification, and GPU evidence, distinguishing measured values from unavailable values;
- paths to the local report, summary, case CSV, worst-case gallery, manifest, and reusable scripts;
- confirmation that no source CT, labels, predictions, case-level outputs, mask/QC images, weights, DICOM metadata, or patient identifiers were pushed to GitHub/Netlify;
- the contents and validation result of the aggregate-only public summary, if one was published;
- confirmation that the temporary `.wslconfig` was restored after the completed run;
- the CC BY-NC-SA 4.0 non-commercial/share-alike boundary;
- why this is a useful non-overlap feasibility result but not clinical validation;
- what remains for real DICOM ingestion/de-identification, production inference, vascular/collecting-system anatomy, clinician correction, uncertainty/out-of-distribution controls, planning-grade exports, independent prospective validation, security/privacy, quality management, and regulatory review.

Do not round away failures, omit negative findings, compare against unverified claims, or imply that a strong average makes an individual case safe. If any part of this handoff is later copied to the public site, remove case-linked failure identifiers/reasons and retain only aggregate counts plus permitted cohort protocol metadata.

---
