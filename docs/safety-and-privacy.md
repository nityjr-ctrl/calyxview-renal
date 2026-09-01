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

## Known limitations

- The site cannot determine whether a DICOM object is de-identified.
- It does not inspect public or private metadata, nested content, overlays, graphics, embedded files or burned-in pixel text.
- File extensions are not proof of DICOM conformance.
- The preflight, quality, segmentation, reconstruction and review stages are simulated.
- Measurements, scores and volume figures are illustrative and may be wrong.

## Future service boundary

A future segmentation API must not accept raw browser-selected studies. It should accept only an authorised receipt from an approved quarantine and de-identification service. That receipt should bind the de-identified study UID, object count, de-identification profile, review identity, input hashes and retention policy.

The placeholder `SegmentationGateway` interface encodes this separation in [`../lib/prototype-pipeline.ts`](../lib/prototype-pipeline.ts). It is intentionally set to `null` in the current build.
