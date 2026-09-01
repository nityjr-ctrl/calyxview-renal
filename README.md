# CalyxView Renal

A production-style research and education prototype for exploring how a future validated platform could support partial-nephrectomy planning and training.

**Live prototype:** [calyxview-renal.netlify.app](https://calyxview-renal.netlify.app/)

> **RESEARCH & EDUCATION PROTOTYPE — NOT FOR PATIENT CARE**
>
> This demonstration is not clinically validated, FDA cleared or approved, or UKCA/CE marked as a medical device. Do not use it for diagnosis, treatment, patient management, real-world surgical planning, consent or intraoperative guidance.

## What is implemented

- A responsive, image-led editorial overview with four plain-language navigation choices and one clear route into the 3D workspace.
- An on-page five-step operating guide and direct entry points for the synthetic case, local file-flow demonstration and guided lesson.
- An interactive synthetic kidney preview on the overview page, with structure visibility controls and explicit provenance labels.
- Interactive WebGL kidney, renal mass, arterial tree, venous tree and collecting-system anatomy.
- Drag rotation, wheel zoom, anatomical view presets, layer isolation, opacity, clipping and resection-margin exploration.
- Illustrative planning controls for approach, clamp scenario, margin and residual-volume presentation.
- A local-only DICOM intake demonstration with explicit consent, file inventory, staged progress and privacy warnings.
- Five-step guided training mode with reveal-after-answer rationales and session progress.
- Provenance, QA and source-state interfaces that distinguish simulated, derived and future verified data.
- Downloadable snapshot of the synthetic 3D view.
- Persistent research-use boundaries, detailed safety information, responsive design and hardened Netlify headers.
- A typed `SegmentationGateway` seam for a future approved backend in [`lib/prototype-pipeline.ts`](lib/prototype-pipeline.ts).

## How to use the prototype

1. Choose **Explore the 3D demo** to begin with the built-in synthetic kidney; no files are required.
2. Use **Try file flow** only if you want to demonstrate the future intake journey. Select synthetic files or files de-identified under an approved institutional process.
3. Confirm the safety statement. The prototype then counts file handles, extensions and total size locally; it does not read DICOM metadata or pixels.
4. In **Explore 3D**, drag to rotate, scroll or pinch to zoom, switch anatomical views and reveal or hide the kidney, tumour, arteries, veins and collecting system.
5. Open **Guided lesson** to complete five short observation checks with immediate explanations.

The editorial design rationale and original hero-asset provenance are documented in [`docs/design-direction.md`](docs/design-direction.md).

## Safe prototype boundary

Selected files remain on the device. The app does not use `FileReader`, `fetch`, `XMLHttpRequest`, an upload endpoint, browser storage or a database for DICOM data. It counts the selected files, recognised extensions and total byte size, then discards the file input value. No metadata or pixel data is parsed, anonymised, transmitted, stored or segmented.

The progress sequence is deliberately simulated. The displayed kidney is built-in procedural teaching anatomy and never comes from a selected scan.

Removing names from DICOM headers is not enough to establish anonymisation. Private attributes, nested content, UIDs, overlays, embedded documents and burned-in pixel text all require validated handling and risk assessment. See [DICOM PS3.15 Annex E](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html), [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html) and [ICO anonymisation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/about-this-guidance/).

## Architecture

```text
Current browser-only prototype

Local file selection
  → non-identifying numeric inventory
  → simulated privacy / quality / segmentation stages
  → built-in synthetic 3D case

Future validated system

PHI quarantine
  → validated DICOM PS3.15 de-identification + pixel OCR
  → protocol QC + multi-phase registration
  → validated phase-aware segmentation + uncertainty
  → expert correction and approval
  → DICOM SEG / patient-space meshes + provenance
  → verified clinical viewer and audit trail
```

The frontend depends only on the current synthetic adapter. A real service must implement the `SegmentationGateway` contract and accept only a receipt from an approved quarantine/de-identification service—not raw browser-selected DICOM files.

## What remains for true CT-to-segmentation

The current site does **not** implement any of the following:

1. Secure medical-data ingestion, identity/access management, encryption, audit logging, retention or deletion controls.
2. Validated DICOM de-identification, private-tag handling, UID remapping, pixel OCR or human privacy QA.
3. Study/series grouping by DICOM UIDs, protocol suitability checks, HU calibration, patient-space affine handling, artifact detection or multi-phase registration.
4. Kidney, tumour, cyst, renal artery, renal vein or collecting-system inference.
5. Uncertainty maps, out-of-distribution rejection, radiologist/urologist correction or clinical verification.
6. DICOM SEG, DICOM Surface SEG or GLB generation from patient-space masks.
7. Independent multi-centre technical validation, reader/human-factors studies, prospective clinical validation, quality management or regulatory authorisation.

The detailed production work programme is in [`docs/production-segmentation-roadmap.md`](docs/production-segmentation-roadmap.md).

## Development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm run build
```

The production build is written to `netlify-dist/`. Netlify uses the build and security-header configuration in [`netlify.toml`](netlify.toml).

## Clinical and regulatory references

- [DICOM confidentiality profiles](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html)
- [DICOM Segmentation IOD](https://dicom.nema.org/medical/dicom/2026a/output/chtml/part03/sect_A.51.html)
- [FDA Clinical Decision Support Software guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software)
- [MHRA software and AI as a medical device guidance](https://www.gov.uk/government/publications/medical-devices-software-applications-apps)
- [IMDRF SaMD clinical evaluation](https://www.imdrf.org/documents/software-medical-device-samd-clinical-evaluation)
- [KiTS23 kidney tumour segmentation challenge](https://kits-challenge.org/kits23/)
- [nnU-Net](https://www.nature.com/articles/s41592-020-01008-z)

No licence is granted for clinical use, patient data or medical-device claims.
