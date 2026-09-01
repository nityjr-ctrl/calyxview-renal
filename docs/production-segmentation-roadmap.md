# Production CT-to-segmentation roadmap

This document describes work that is explicitly **outside** the deployed prototype. It is not a claim that the current site processes CT data or is suitable for patient care.

## 1. Intended use and governance

- Define users, patients, jurisdictions, clinical decisions and the exact role of the output.
- Obtain specialist regulatory advice before making patient-specific planning claims.
- Establish quality, risk, software-lifecycle, cybersecurity, privacy and change-control systems.
- Create an expert annotation SOP with multi-reader consensus and adjudication.

Marketing and interface claims form part of intended purpose. “Research only” wording cannot neutralise medical-device functionality or claims. See [FDA CDS guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software) and [MHRA software guidance](https://www.gov.uk/government/publications/medical-devices-software-applications-apps).

## 2. Secure intake and de-identification

- Receive data into an isolated PHI quarantine zone, never directly into the segmentation service.
- Apply a validated DICOM PS3.15 Basic Application Confidentiality Profile with the applicable cleaning options.
- Remove or replace identifying metadata, private attributes, nested sequence content, file meta information, preambles, DICOMDIR content, overlays and embedded objects.
- Remap UIDs consistently while preserving referential integrity.
- Detect burned-in pixel text with validated OCR plus sampled human review.
- Record the de-identification method and `PatientIdentityRemoved=YES` when appropriate.
- Encrypt in transit and at rest; apply least privilege, audit logs, short retention and verified deletion.
- Complete jurisdiction-specific re-identification risk assessment. Pseudonymised data remains personal data when re-linkage is possible.

Primary references: [DICOM PS3.15 Annex E](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html), [HHS guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html), [ICO guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/).

## 3. DICOM inventory and protocol QC

- Group instances by Study, Series, SOP and Frame of Reference UIDs.
- Reject duplicates, missing or inconsistent slices, unsupported transfer syntaxes and invalid geometry.
- Verify CT modality, kidney coverage, contrast phase, reconstruction consistency, slice thickness, physical spacing, position and orientation.
- Apply rescale slope/intercept to recover Hounsfield units while preserving the patient-space affine.
- Detect motion, metal, noise and other out-of-distribution or protocol failures and fail closed.

## 4. Preprocessing and registration

- Crop the renal region and resample to a validated physical spacing.
- Normalise intensities using a pre-specified, versioned pipeline.
- Register arterial/corticomedullary, nephrographic/venous and excretory phases.
- Measure registration error and require overlay-based human QC before inference outputs are combined.

## 5. Segmentation and uncertainty

- Train and validate separate or multi-task models for kidney parenchyma, tumour/cyst, renal arterial branches, veins and collecting system.
- Preserve model version, preprocessing version, input hashes, transforms and inference parameters.
- Produce calibrated uncertainty and explicit rejection states.
- Treat [KiTS23](https://kits-challenge.org/kits23/) and [nnU-Net](https://www.nature.com/articles/s41592-020-01008-z) as research baselines, not ready-made clinical solutions. KiTS23 does not provide renal vasculature or collecting-system classes.

## 6. Expert correction and representation

- Require radiologist/urologist review and correction of every clinically meaningful structure.
- Store masks as [DICOM SEG](https://dicom.nema.org/medical/dicom/2026a/output/chtml/part03/sect_A.51.html) referencing the correct source and Frame of Reference.
- Generate meshes in physical coordinates with topology-aware cleanup.
- Validate smoothing and decimation against dimensional tolerances.
- Export GLB for web visualisation and, when required, DICOM Surface SEG while preserving millimetre units and patient coordinates.
- Display source, derived, human-corrected and verified states plus uncertainty in the viewer.

## 7. Prespecified validation

Evaluation must be independent at patient, site and scanner level and include external multi-centre data across vendors, protocols, slice thicknesses, contrast timing, artifacts, demographics, tumour types and anatomical variants.

At minimum, predefine acceptance criteria for:

- Per-structure Dice, Surface Dice, HD95 and ASSD.
- Lesion sensitivity and false-positive rate.
- Vessel branch/connectivity accuracy and missed-branch severity.
- Registration error.
- Volume and distance bias.
- Mesh dimensional/topological error.
- Uncertainty calibration, rejection rate and catastrophic-failure rate.
- Clinician correction burden and error-detection performance.
- Relevant subgroups and clinically meaningful edge cases.

## 8. Clinical evidence and release controls

- Run formative and summative human-factors studies on the clinician-plus-model workflow.
- Conduct reader studies and prospective validation for the exact intended use.
- Establish release gates, locked test sets, monitoring, drift detection and controlled model updates.
- Demonstrate valid clinical association, analytical validation and clinical validation in line with [IMDRF SaMD guidance](https://www.imdrf.org/documents/software-medical-device-samd-clinical-evaluation).
- Complete the applicable regulatory pathway before patient use.

Until these gates are met, the correct product boundary is the one used by the live site: synthetic 3D anatomy, local-only file-selection demonstration, simulated stages and general training content.
