# Request: anonymised CT export from PACS for CalyxView (teaching)

**From:** Urology (endourology training)
**To:** Clinical Director (Urology), Training Programme Director, Radiology / PACS team, Information Governance
**Purpose:** build a small, anonymised teaching library of 3D renal anatomy for endourology trainees
**Status of the software:** built and tested on open data and on a synthetic DICOM study (see `HOW-WE-BUILT-THIS.md` in the CalyxView endourology repository)

*This copy sits in the CalyxView Renal repository for reference. The same export
also serves the partial-nephrectomy prototype, which additionally benefits from
arterial (CTA) and nephrographic phases where the study includes them; see
section 2.2.*

CalyxView is a teaching tool. It is not a medical device and will not be used for
clinical decision-making on any patient. Nothing in this request changes that.

---

## 1. The ask, in one paragraph

We are asking for a one-off, anonymised export of CT studies from PACS, in DICOM
format, so that the collecting system (calyces, infundibula, renal pelvis) and
kidney stones can be reconstructed in 3D for teaching. Open datasets give us real
kidney parenchyma and tumours but contain neither calyces nor stones, because those
only show on specific scan phases (excretory phase for the collecting system,
non-contrast for stones). The processing pipeline already exists and has been
verified end to end on a synthetic DICOM study. The only missing ingredient is the
right scans.

---

## 2. What we are asking for, precisely

### 2.1 Studies

| Item | Request | Why |
| --- | --- | --- |
| Study type A | **CT urogram** (split-bolus or multi-phase), 20 to 30 studies | Excretory phase opacifies the collecting system; this is the only way to reconstruct calyces faithfully |
| Study type B | **Non-contrast CT KUB** (stone protocol), 20 to 30 studies | Stones are bright on non-contrast CT; contrast hides them |
| Selection | Adult patients, range of normal and abnormal collecting-system anatomy (duplex, calyceal diverticulum, staghorn, lower-pole stones, hydronephrosis, post-PCNL) | Teaching value comes from variety, not volume |
| Exclusions | Paediatric studies; anything with a rare condition that could identify the patient; any patient who has opted out of secondary use | Governance |

### 2.2 Series and format (please pass to the PACS team verbatim)

| Setting | Request |
| --- | --- |
| Format | DICOM Part 10 files, one file per slice, standard folder export (not a screen capture, not JPEG, not a PDF) |
| Transfer syntax | **Uncompressed: Explicit VR Little Endian (1.2.840.10008.1.2.1)**. If the archive only holds JPEG-2000 or JPEG-Lossless, please decompress on export |
| Series to include | For CT urograms: the **non-contrast** and the **excretory / delayed** phase axial series, plus the **arterial and nephrographic** phases where acquired (these feed the renal-mass planning prototype). For CT KUB: the non-contrast axial series |
| Reconstruction | **Thin axial slices, 1.0 to 1.5 mm** (2 mm acceptable, 3 mm and above not useful for calyces), **soft-tissue / standard kernel**, full field of view covering both kidneys and the proximal ureters |
| Not needed | Scout / topogram images, coronal or sagittal reformats, MIP or 3D screen captures, dose reports, radiology reports (a one-line note of the indication is helpful but optional) |
| Naming | Keep the original Series Description (for example "EXCRETORY 1.25mm"); the software reads it to tell the phases apart |

### 2.3 Anonymisation (the important part)

| Requirement | Detail |
| --- | --- |
| Route | Through the trust's **approved DICOM anonymisation tool or process** (PACS export anonymiser, CTP, or the radiology research anonymisation pathway), not a manual header edit |
| Profile | DICOM PS3.15 **Basic Application Level Confidentiality Profile**, with "Retain Longitudinal Temporal Information with Modified Dates" or dates removed, and "Clean Descriptors" not applied to the Series Description (we need the phase name) |
| Must be removed or replaced | Patient name, hospital number, NHS number, date of birth, address, telephone, accession number, referring / performing clinician, operator, institution name and address, station name, all private (vendor) tags, embedded documents and overlays |
| Must be set | `PatientIdentityRemoved = YES` and `DeidentificationMethod` describing the tool used. The pipeline **refuses** any file without this flag if identifier fields are populated |
| Pseudonym | A study code such as `CV-CTU-001`; the key linking code to patient stays with the radiology / IG team and is never given to the project |
| Burned-in text | CT axial images normally carry none, but please confirm `BurnedInAnnotation = NO` or run the pixel-text check in the anonymiser |
| UIDs | Replaced consistently within a study so the phases still belong together (standard anonymiser behaviour) |

### 2.4 Handover

| Item | Request |
| --- | --- |
| Medium | Encrypted trust-approved USB drive, or a folder on a trust network share with access restricted to the named project lead |
| Storage in the project | The anonymised DICOM files live only on the trust workstation used for processing, in a folder outside any cloud sync. They are never uploaded, never committed to a code repository, and are deleted once the 3D models are built and checked |
| What leaves the workstation | Only the finished 3D surfaces (small files with no pixel data, no header fields, no identifiers) and the teaching viewer |
| Size | Roughly 200 to 400 MB per CT urogram and 100 to 200 MB per CT KUB uncompressed; 50 studies fit comfortably on a 32 GB drive |

---

## 3. What we are asking of each person

| Who | Ask | Effort |
| --- | --- | --- |
| **Clinical Director, Urology** | Endorse the teaching purpose; agree that the library is a departmental teaching asset | One email |
| **Training Programme Director** | Confirm the educational rationale (calyceal anatomy, URS and PCNL access planning are curriculum items); nominate 4 to 6 trainees to trial it | One email, one 45-minute session |
| **Information Governance / Caldicott Guardian** | Confirm that anonymised secondary use for teaching is within the existing framework, or advise on the DPIA route if not | Review of this document |
| **Radiology / PACS lead** | Identify suitable studies and perform the export through the anonymisation route described in 2.2 and 2.3 | Half a day of PACS time in total |
| **Consultant endourologist (clinical champion)** | Look at the first five reconstructed cases and say whether the anatomy is faithful enough to teach from | One hour |
| **Nobody** | Money. The software is written, runs on an existing workstation and in an ordinary web browser, and uses no cloud service and no licence | Nil |

---

## 4. What happens after the export

1. **Intake check.** Each exported folder is opened in the CalyxView DICOM intake page on the workstation. It reads the headers locally, confirms the anonymisation flag, lists the series and phases, and checks slice spacing, coverage and encoding. Anything that fails is sent back, not processed.
2. **Reconstruction.** One command turns a passing study into a 3D case: parenchyma, collecting system (from the excretory phase), stones (from the non-contrast phase) and the body outline. This takes a few minutes per study.
3. **Clinical review.** The champion reviews the first cases side by side with the source images.
4. **Teaching library.** Reviewed cases go into the viewer with the URS and PCNL planning modules. The DICOM source files are then deleted from the workstation.
5. **Feedback loop.** Trainees use it in a supervised session; we iterate on what they find confusing.

---

## 5. Safeguards, restated

- Teaching use only; not for planning or performing any procedure on a patient.
- Anonymised at source by the trust's own process; the project never holds a re-identification key.
- No cloud, no upload, no external service, no analytics or tracking in the viewer.
- Source images stay on one trust workstation and are deleted after processing.
- The code, the intake checks and the refusal rule for identified data are open for inspection in the repository.
- A visible "teaching tool only, not a medical device" notice sits on every page.

---

## 6. Suggested wording for the PACS request form

> Please export the following studies through the anonymisation route as DICOM
> Part 10 files, uncompressed (Explicit VR Little Endian), thin axial soft-tissue
> series only (non-contrast and excretory phases for CT urograms; non-contrast for
> CT KUB), with PatientIdentityRemoved = YES, DeidentificationMethod recorded, all
> private tags removed and a study pseudonym of the form CV-CTU-nnn / CV-KUB-nnn.
> Scouts, reformats and reports are not required. Deliver on an encrypted drive to
> [project lead], for anonymised teaching use under [IG reference].

---

## Appendix: why these phases and not the ones we already have

| Scan | What it shows | What we can build from it |
| --- | --- | --- |
| Open KiTS23 (nephrographic phase, already used) | Kidney outline, tumour, cyst | Parenchyma, tumour, cyst. No calyces, no stones |
| Excretory-phase CT urogram | Contrast-filled calyces and pelvis | The collecting system: the anatomy every URS and PCNL decision depends on |
| Non-contrast CT KUB | Dense stones against soft tissue | Stone position, size and pole |
| Any CT (already handled) | Ribs, psoas, liver, spleen, colon, skin | Context for the percutaneous tract |
