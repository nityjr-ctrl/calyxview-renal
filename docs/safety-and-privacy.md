# Safety and privacy design

## Current implementation guarantees

- The application is a static browser client with no server functions, database or authentication layer.
- No DICOM upload request exists.
- No `FileReader`, `fetch`, `XMLHttpRequest`, browser storage or service worker is used for selected files.
- Selected file names are not stored in React state or displayed.
- Only file count, `.dcm`/`.dicom` extension count, other-file count and total byte size are retained for the current tab.
- The file input value is cleared immediately after inventory creation.
- The visualised anatomy is authored synthetic geometry and is never derived from selected data.
- Clinical export and sign-off controls are unavailable by design.
- The deployed research result is a small aggregate JSON object only. It contains cohort-level metrics, counts, runtime and frozen revisions/hashes; it contains no study rows, case identifiers, local paths, scan data, masks, model weights, logs or QC images.

## Known limitations

- The site cannot determine whether a DICOM object is de-identified.
- It does not inspect public or private metadata, nested content, overlays, graphics, embedded files or burned-in pixel text.
- File extensions are not proof of DICOM conformance.
- The preflight, quality, segmentation, reconstruction and review stages are simulated.
- Measurements, scores and volume figures are illustrative and may be wrong.
- The separate 20-study offline feasibility benchmark is research evidence, not browser inference or clinical validation. Its aggregate scores must not be applied to an individual patient or institution.

## Benchmark publication boundary

The reproducible benchmark pipeline runs outside the website repository. Source CT NIfTI files, reference masks, generated masks, model checkpoints, case-level timing and quality-control artifacts are retained only in the local research workspace under the applicable data and model terms. The release gate accepts a completed 20-study denominator and emits only [`../research/kits23-feasibility/results/summary.public.json`](../research/kits23-feasibility/results/summary.public.json).

Repository tests reject local filesystem paths, medical-volume filenames, patient/study fields, case rows, partial denominators and invalid metric ranges. The production bundle is inspected separately because source-control exclusions alone are not a privacy control.

## Future service boundary

A future segmentation API must not accept raw browser-selected studies. It should accept only an authorised receipt from an approved quarantine and de-identification service. That receipt should bind the de-identified study UID, object count, de-identification profile, review identity, input hashes and retention policy.

The placeholder `SegmentationGateway` interface encodes this separation in [`../lib/prototype-pipeline.ts`](../lib/prototype-pipeline.ts). It is intentionally set to `null` in the current build.
