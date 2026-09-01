# Attribution and research-use notice

## Required public notice

> **RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE.** This benchmark and the CalyxView Renal prototype are not for diagnosis, treatment selection, surgical planning, margin selection, or patient care. Model outputs may be incomplete or wrong.

The published result is a **non-overlapping, within-KiTS feasibility check** on 20 public research NIfTI cases. It is not an independent external, prospective, multicentre, or clinical validation study. It does not establish safety, efficacy, generalisability, or fitness for partial-nephrectomy planning.

## Sources and frozen identities

This work uses the following research sources:

- **KiTS23 code, labels, and cohort provenance:** [`neheller/kits23`](https://github.com/neheller/kits23), commit `c1088353084c17b8882a11db71429e7c022b7785`.
- **KiTS CT image volumes:** [`neheller/KiTS-Challenge-Imaging`](https://huggingface.co/datasets/neheller/KiTS-Challenge-Imaging), revision `65f1f295873a326230153c7e1de0c7dba10f0b29`.
- **Frozen cohort:** `case_00400`–`case_00419`, fixed before inference. The canonical portable, path-free manifest SHA-256 is `bc529b7e5edfa9c5ac0979de1d38a027735b741760e3e82c14acc78ec900c561`.
- **Official pretrained model:** `Task135_KiTS2021` from [Zenodo record 5126443](https://zenodo.org/records/5126443), DOI `10.5281/zenodo.5126443`. Archive MD5 `b27ab702742083080b95baac00ba186f`; SHA-256 `a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3`.
- **Inference framework:** [`MIC-DKFZ/nnUNet`](https://github.com/MIC-DKFZ/nnUNet/tree/db16c6cef5fdd5a180159184e46b58bcca670446) v1 commit `db16c6cef5fdd5a180159184e46b58bcca670446`.

The GitHub repository does **not** host the 20 CT volumes. The images are fetched from the KiTS project's separate official Hugging Face store. They are NIfTI research volumes, not clinical DICOM uploads.

## Licence boundaries

- KiTS data are made available under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Reuse must include attribution, remain non-commercial, and comply with share-alike requirements for adapted material.
- Commercial or legally ambiguous reuse requires permission from the relevant rights holder. This repository does not grant additional rights to KiTS images, labels, derived study assets, or model weights.
- The pretrained weights were trained on KiTS data. Treat them as non-commercial research assets unless the relevant rights holder expressly confirms broader use.
- nnU-Net software is distributed under its own Apache-2.0 software licence. That code licence does not override dataset, checkpoint, privacy, clinical, or regulatory restrictions.
- References to KiTS, nnU-Net, Zenodo, Hugging Face, or their contributors do not imply endorsement of CalyxView Renal or its results.

When publishing research based on these sources, follow the current citation instructions supplied by the official KiTS, imaging-dataset, model-record, and nnU-Net pages in addition to retaining the source links and frozen identifiers above.

## What stays local

The following are local research evidence and must not be committed to GitHub, copied into a Netlify build, placed in browser storage, sent to analytics, or otherwise published through this project:

- source CT NIfTI, reference labels, nnU-Net inputs, predictions, DICOM, or DICOM metadata;
- model archives, checkpoints, pickle metadata, virtual environments, caches, or native WSL scratch;
- the detailed manifest, case-result CSV, case-linked metrics/statuses/failure reasons, per-case timings/logs, local paths, or failure traces;
- detailed report HTML, worst-case galleries, screenshots, or segmentation-mask/QC images;
- credentials, tokens, patient information, or clinical uploads of any kind.

The frozen public KiTS identifiers `case_00400`–`case_00419` are permitted as protocol/method metadata. They must never be joined publicly to an individual metric, prediction status, failure reason, timing, log, path, mask/QC image, or other case-level artefact. Mask-only images omit CT pixels but remain derived study-level research assets and are kept local.

## What may be published

Only a reviewed aggregate publication package may be copied to the public repository or site. Generate the candidate `summary.public.json` outside the repository with `make_public_summary.py`, then review it before copying. The JSON is limited to:

- the fixed cohort size and total success/failure counts;
- per-region aggregate Dice, Surface Dice, HD95, and volume-error statistics with confidence intervals;
- aggregate runtime statistics;
- frozen dataset, framework, and model identifiers/hashes;
- frozen method/configuration identifiers and the full-denominator failure counts.

It may include the fixed cohort range or the 20 public KiTS IDs only as protocol/method metadata. It must contain no mapping from an ID to a metric, status, failure reason, runtime, log, path, filename, downloadable model/data artefact, image, medical-volume reference, or hidden source payload. The surrounding public page must visibly provide the method, failure-accounting rule, limitations, licence notice, and research disclaimer. The repository's publication test and the final built deploy directory must both be checked before release.

## Interpretation boundary

The identifier non-overlap makes the experiment more informative than scoring the model on its documented training identifiers. It does not make the cohort independent: training and evaluation data remain within the KiTS programme and may share institutions, scanners, acquisition practice, or population characteristics.

Do not use aggregate results to make claims about an individual scan. Do not call the result validated, diagnostic, planning-grade, clinically safe, or suitable for real partial nephrectomy. True deployment still requires secure DICOM ingestion/de-identification, a production GPU service, clinically appropriate anatomy and uncertainty controls, clinician correction, interoperable planning-grade outputs, independent prospective validation, human-factors work, privacy/security controls, quality management, and applicable regulatory review.
