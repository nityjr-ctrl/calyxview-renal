# CalyxView Renal — script-blinded KiTS23 evaluation protocol

Status: **draft pending independent Claude Fable review; do not create the cohort lock until that review is incorporated.**

This protocol answers a simple question: can the frozen model segment a new set of CT images when it receives the CT alone, before the KiTS answer masks are opened?

It does **not** establish clinical accuracy, patient safety, hospital-to-hospital generalisation, or suitability for partial-nephrectomy decisions.

## The plain-language sequence

1. Freeze the model and the exact ten-program evaluation pipeline by hash.
2. Randomly choose 20 previously unexamined KiTS23 studies without opening their masks.
3. Put only those CT images in the inference workspace.
4. Run the frozen model. A study may be attempted at most twice.
5. Verify each successful output against its CT geometry only.
6. Lock every prediction, failure, timing record, log, input, model and code hash.
7. Publish the prediction-lock digest to GitHub.
8. Only then release the KiTS masks into a separate scoring workspace.
9. Compare the locked predictions with KiTS and keep failures in all denominators.
10. Publish aggregate results only.

The model never receives a KiTS mask as an input. A Dice score becomes meaningful only after a prediction is compared with the corresponding expert reference mask.

## Honest blinding description

The achievable local run is **script/inference-blinded, not independently operator-blinded**. The inference scripts cannot read references before locking, but the same human account ultimately has access to the KiTS repository.

A future operator-blinded run requires a separate custodian or host that alone can read the references. That custodian should verify the GitHub prediction-lock digest, release only the fixed masks, and sign the reference-release record after the public lock exists.

## Frozen cohort proposal

- Protocol namespace: `calyxview-renal-kits23-blinded-v1`
- Eligible public IDs: `case_00420` through `case_00588`
- Excluded documented model-training IDs: `case_00000` through `case_00299`
- Excluded previously evaluated IDs: `case_00400` through `case_00419`
- Candidate seed: `20260901`
- Selection: sort eligible IDs by SHA-256 of `calyxview-renal-kits23-blinded-v1|seed=20260901|case_XXXXX`; take the first 20
- Eligible-list SHA-256: `201fe1201cb06b666b1a497ddb0fd44edfe07fd8d9ed078d3db2bd82657acdea`

This selection becomes immutable only after the Fable review is resolved and `cohort-lock.public.json` is created. If the review changes the sampling method, that change must happen before locking. Changes after locking require protocol v2.

## Frozen model

- Published nnU-Net v1 `Task135_KiTS2021`
- Configuration: `3d_fullres`
- Folds: `0, 1, 2, 3, 4`
- Test-time augmentation: disabled
- At most one identical retry after a failed attempt
- Output gate: 3D, finite, CT geometry-matched, integer labels in `0..3`

`create_model_lock.py` verifies the archive, nnU-Net source revision, plans and all five installed checkpoints before inference.
It also freezes the exact hashes of the cohort preparer, model locker, inference runner, prediction validator, scratch manager, provenance recorder, prediction locker, reference releaser, evaluator and aggregate-publication builder. The runner refuses to begin if any one of those programs differs from the pre-inference lock.

## Phase gates

### Gate 0 — review before selection lock

- Claude Fable receives only the public site, public repository and aggregate protocol facts.
- No scans, masks, patient information, private paths or case-linked results are sent.
- Every P0 scientific correction is resolved before cohort creation.
- After those corrections are incorporated, create the model lock once; it must bind the final ten-program pipeline as well as the model files.

### Gate 1 — image-only cohort

Run `prepare_blinded_cohort.py` with the new run root. It accepts only an optional image-cache path—never a label or reference path.

Required outcome:

- exactly 20 CT inputs;
- exact five-column manifest: `case_id,selection_order,selection_hash,image_sha256,image_bytes`;
- immutable `cohort-lock.public.json`;
- zero label/reference/segmentation material below the inference root.

### Gate 2 — CT-only inference

Run `run_nnunet_wsl.ps1` with folds `0–4` and `-DisableTTA`.

Required outcome:

- every selected case ends as a geometry-validated success or an exhausted two-attempt failure;
- every timing record is bound to the exact case, input, selection, command, model lock and source hashes;
- the live ten-program source set still matches the pre-inference model lock before WSL or model code starts;
- no case substitution, silent omission, extra output or post-lock overwrite is accepted.

### Gate 3 — reference-free provenance and prediction lock

Run `capture_blinded_provenance.py`, then `lock_predictions.py`.

Required outcome:

- provenance independently verifies the model, code, CTs, logs, timings and outputs;
- `prediction-lock.json` contains the private case-linked evidence;
- `prediction-lock.sha256` contains only the private lock digest;
- neither file may be replaced;
- references remain absent and unopened.

### Gate 4 — public timestamp before reference release

Commit and push only `prediction-lock.sha256` to the public repository. Use its commit-pinned `raw.githubusercontent.com` URL with `release_references.py`.

Required outcome:

- the public digest exactly matches the private lock;
- the URL is pinned to a 40-character Git commit;
- a separate evaluation root receives the 20 KiTS masks and `reference-release.json`;
- custody is labelled `same_operator_script_blinded` unless a genuinely separate custodian performed the release.

### Gate 5 — scoring

Run the blinded form of `evaluate_and_report.py` with the inference root, prediction lock and separate reference-release root.

Before the first reference NIfTI is loaded, the evaluator must verify:

- prediction-lock and public-digest identity;
- unchanged CT, prediction, timing and log hashes;
- unchanged cohort/model/provenance locks;
- unchanged evaluator, reference-releaser and public-summary-builder hashes from the pre-inference source lock;
- reference-release binding and reference hashes;
- exact 20-case identity and order;
- absence of references under the inference root.

## Metrics and fixed failure rules

For kidney plus mass, mass (tumour plus cyst), and tumour:

- Dice;
- physical-millimetre Surface Dice with KiTS23 tolerances;
- HD95 in millimetres;
- absolute volume error in millilitres.

Reports use case-level non-parametric bootstrap 95% confidence intervals. Missing or invalid predictions remain in the 20-case denominator. They receive Dice 0 and Surface Dice 0. HD95 receives the reference physical diagonal when available, otherwise the predeclared 1000 mm penalty. Missing predictions are treated as empty for volume error.

## Publication boundary

Public:

- protocol, source revisions and code;
- cohort-selection method and lock;
- prediction-lock digest;
- aggregate completion, runtime, metrics and confidence intervals;
- custody limitation and research-only warning.

Private/local only:

- CT and reference volumes;
- predictions;
- case-linked timings, failures, metrics and quality-control images;
- private prediction lock and reference-release inventory;
- local paths and environment details that could identify a workstation.

## What is still required for clinical claims

- genuinely independent reference custody;
- external multicentre data outside the KiTS ecosystem;
- site, scanner, protocol and population subgroup analysis;
- renal-vessel and collecting-system reference evaluation;
- expert correction and uncertainty workflow testing;
- prospective human-factors and clinical-performance studies;
- security, quality-management and applicable regulatory work.
