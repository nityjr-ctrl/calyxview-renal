# CalyxView Renal

A production-style research and education prototype for exploring how a future validated platform could support partial-nephrectomy planning and training.

**Live prototype:** [calyxview-renal.netlify.app](https://calyxview-renal.netlify.app/)

> **RESEARCH & EDUCATION PROTOTYPE — NOT FOR PATIENT CARE**
>
> This demonstration is not clinically validated, FDA cleared or approved, or UKCA/CE marked as a medical device. Do not use it for diagnosis, treatment, patient management, real-world surgical planning, consent or intraoperative guidance.

## What is implemented

- A responsive, image-led editorial overview with five plain-language navigation choices and one clear route into the 3D workspace.
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
- An aggregate-only research section for a frozen 20-study KiTS23 feasibility benchmark, with Dice, Surface Dice, HD95, volume error, runtime and reproducibility evidence.
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

## Measured research feasibility benchmark

The **Research** section reports a frozen, non-overlapping, within-KiTS feasibility run on 20 public KiTS23 CT studies (`case_00400`–`case_00419`). It uses the published nnU-Net v1 `Task135_KiTS2021` five-fold `3d_fullres` ensemble with test-time augmentation disabled. This is not an independent external dataset or clinical validation.

Only the aggregate public payload in [`research/kits23-feasibility/results/summary.public.json`](research/kits23-feasibility/results/summary.public.json) is bundled into the site. CT volumes, reference labels, predictions, model weights, case-level rows, timing records, logs and mask QC remain outside Git and Netlify. The fixed prompt, scripts, checksums, failure policy and step-by-step reproduction guide are in [`research/kits23-feasibility/README.md`](research/kits23-feasibility/README.md).

The benchmark tests an offline research model against KiTS23 training reference segmentations for kidney plus mass, tumour plus cyst, and tumour. It does not make the browser demo a CT-analysis system, and it does not establish clinical safety, benefit, cross-hospital generalisation or fitness for partial-nephrectomy decisions.

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

## Companion project and the PACS request

The endourology sibling, **CalyxView** ([github.com/nityjr-ctrl/CalyxView](https://github.com/nityjr-ctrl/CalyxView)),
reconstructs kidney parenchyma, collecting system and stones from CT for URS and
PCNL teaching, and carries a local-only DICOM intake check plus a tested
DICOM-to-3D pipeline. Both projects need the same thing next: an anonymised DICOM
export of CT urograms and stone CTs from PACS. The request, with the exact series,
format, anonymisation and handover specification, is in
[`docs/PACS-DICOM-EXPORT-REQUEST.md`](docs/PACS-DICOM-EXPORT-REQUEST.md).

## CT-to-3D planning pipeline (`pipeline/`)

The Python side of the project. `renalplan` takes a CT (NIfTI or a de-identified
DICOM export) plus a kidney / tumour / cyst label map and produces a 3D case
bundle (named meshes, viewer manifest entry), computed R.E.N.A.L. and PADUA
components with every assumption stated, resection geometry (margin envelope,
residual parenchyma, contact surface, distances to sinus, vessels and collecting
system), and per-case reports. It also carries the evaluation tools (Dice,
surface Dice, HD95, volume error, bootstrap CIs, KiTS23 regions), a grid search
over explainable post-processing rules for model output, and a mesh fidelity
sweep. Results on eight real KiTS23 cases are in [`pipeline/results/`](pipeline/results/).

```bash
cd pipeline && pip install -r requirements.txt && pip install -e . && pytest
renalplan batch --kits ~/CalyxView-data/kits --out out/kits
```

See [`pipeline/README.md`](pipeline/README.md), the proposal in
[`docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md`](docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md)
and the PACS request in [`docs/PACS-DICOM-EXPORT-REQUEST.md`](docs/PACS-DICOM-EXPORT-REQUEST.md).
The pipeline is research and teaching software: not a medical device, not for
patient care.

## Development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm test
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

## Project licensing

This repository does not currently grant a licence to reuse the CalyxView Renal
application code, design or original content; those materials are all rights
reserved unless the owner adds an explicit project licence. Repository
visibility is not permission to reuse it. KiTS data, nnU-Net software and other
third-party materials remain governed by their own licences and rights holders.
No licence is granted for clinical use, patient data or medical-device claims.
