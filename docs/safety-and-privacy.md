# Safety and privacy design

## Current implementation guarantees

- The application is a static browser client with no server functions, database or authentication layer.
- No upload request exists, for DICOM or anything else. There is no server to receive a file.
- The builder ("Make a 3D kidney") reads one file the visitor chooses: a NIfTI label map (.nii or .nii.gz). The whole file is read into the tab's memory with `File.arrayBuffer()` and transferred to a Web Worker in the same tab (`lib/build-worker.ts`). No `fetch`, `XMLHttpRequest`, `sendBeacon`, WebSocket, browser storage or service worker touches it; `test/build-kidney.test.mjs` fails if any of those appear in the builder's code.
- The file name is checked once for its extension and is not stored or displayed. The file input is cleared as soon as the file is taken. Downloads are always named `calyxview-renal-*`.
- The case is held in memory for the open tab only: in the viewer's state and in the worker, so the margin can be changed. Loading another file, pressing Clear or closing the tab discards it.
- The builder does not read DICOM and does not read CT. A volume with negative values, fractional values or more than 20 distinct values is refused as a likely CT. It does not read the NIfTI header's free-text description field and never copies it into the GLB, STL, JSON or Markdown it produces.
- The built-in sample is generated in the browser from renalplan's synthetic phantom; no `.nii` file ships with the site.
- The teaching kidney is hand-made synthetic geometry with no patient data in it. KiTS23 kidneys A to E are pre-built meshes from de-identified public data (the KiTS23 dataset), published under neutral letters so their KiTS case numbers don't ship with the site.
- Clinical export and sign-off controls are unavailable by design.
- The site ships two small result files and five meshes. The benchmark file (`research/kits23-feasibility/results/summary.public.json`) is aggregate only: cohort-level metrics, counts, runtime and frozen revisions and hashes, with no per-scan rows. The pipeline file (`pipeline/results/summary.public.json`) also has one row per KiTS23 case, numbered 1 to 8 with no KiTS case numbers, giving the computed scores, measurements and runtime, plus aggregate clean-up and mesh results. The five KiTS23 meshes in `public/models/` are deployed too. Nothing deployed contains scan data, label volumes, local paths, model weights, logs or QC images, and all of it comes from public KiTS23 data.

## Known limitations

- The site cannot tell whether a label map came from a de-identified scan, and it cannot stop a visitor loading an outline they aren't allowed to use. The builder's panel says to use public, synthetic or properly de-identified outlines; local rules on patient data still apply on the visitor's own computer.
- The CT check is a heuristic. It stops an obvious CT volume, not every non-label file.
- The builder's scores are estimates: the sinus is estimated from the outline, the polar lines are planes across the kidney's long axis, and there are no vessels or collecting system. They follow renalplan 0.2.0's rules and match it on the synthetic phantom, but they are not validated.
- Measurements on the teaching kidney are illustrative. The scores for kidneys A to E were computed by renalplan from the KiTS outlines, without the CT, and haven't been compared with clinicians' scores. Any of them may be wrong.
- The separate 20-scan offline feasibility benchmark is research evidence, not browser inference or clinical validation. Its aggregate scores must not be applied to an individual patient or institution.

## Benchmark publication boundary

The reproducible benchmark pipeline runs outside the website repository. Source CT NIfTI files, reference masks, generated masks, model checkpoints, case-level timing and quality-control artefacts are retained only in the local research workspace under the applicable data and model terms. The release gate accepts a completed 20-study denominator and emits only [`../research/kits23-feasibility/results/summary.public.json`](../research/kits23-feasibility/results/summary.public.json).

Repository tests reject local filesystem paths, medical-volume filenames, patient/study fields, case rows in the benchmark file, partial denominators and invalid metric ranges. The production bundle is inspected separately because source-control exclusions alone are not a privacy control.

## Future service boundary

A future segmentation API must not accept raw browser-selected studies. It should accept only an authorised receipt from an approved quarantine and de-identification service. That receipt should bind the de-identified study UID, object count, de-identification profile, review identity, input hashes and retention policy.

The placeholder `SegmentationGateway` interface encodes this separation in [`../lib/prototype-pipeline.ts`](../lib/prototype-pipeline.ts). It is intentionally set to `null` in the current build.
