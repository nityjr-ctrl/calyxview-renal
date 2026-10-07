# Request: de-identified CT export from PACS for CalyxView (teaching)

**From:** Urology (endourology training)
**To:** Clinical Director (Urology), Training Programme Director, Radiology / PACS team, Information Governance
**Purpose:** build a small teaching library of 3D renal anatomy for endourology trainees, from de-identified scans
**Status of the software:** built and tested on open data and on a synthetic DICOM study (the CalyxView code isn't public yet and can be shared on request)

*This copy sits in the CalyxView Renal repository for reference. Scans from this
export are for the teaching library only. They won't be used for the
partial-nephrectomy study, which needs the pre-operative CTs of its own cohort,
its own research approval and its own export, and keeps its scans until that
study ends. Most patients having a CT urogram or a stone CT won't have a renal
tumour anyway.*

CalyxView is a teaching tool. It is not a medical device and will not be used for
clinical decision-making on any patient. Nothing in this request changes that.

---

## 1. The ask, in one paragraph

We're asking for a one-off, de-identified export of CT studies from PACS, in
DICOM format, so the collecting system (calyces, infundibula, renal pelvis) and
kidney stones can be rebuilt in 3D for teaching. Open datasets have real kidney
parenchyma and tumours but no calyces or stones, because those only show on
certain phases: the excretory phase for the collecting system, and non-contrast
CT for stones. The CalyxView software has been tested end to end on a synthetic
DICOM study. What it needs now is the right scans.

---

## 2. What we are asking for, precisely

### 2.1 Studies

| Item | Request | Why |
| --- | --- | --- |
| Study type A | **CT urogram** (split-bolus or multi-phase), 20 to 30 studies | Excretory phase opacifies the collecting system; this is the only way to reconstruct calyces faithfully |
| Study type B | **Non-contrast CT KUB** (stone protocol), 20 to 30 studies | Stones are bright on non-contrast CT; contrast hides them |
| Selection | Adult patients, range of normal and abnormal collecting-system anatomy (duplex, calyceal diverticulum, staghorn, lower-pole stones, hydronephrosis, post-PCNL) | A range of anatomy teaches more than many similar cases |
| Exclusions | Paediatric studies; anything with a rare condition that could identify the patient; any patient who has opted out of secondary use | Governance |

### 2.2 Series and format (please pass to the PACS team verbatim)

| Setting | Request |
| --- | --- |
| Format | DICOM Part 10 files, one file per slice, standard folder export (not a screen capture, not JPEG, not a PDF) |
| Transfer syntax | **Uncompressed: Explicit VR Little Endian (1.2.840.10008.1.2.1)**. If the archive only holds JPEG-2000 or JPEG-Lossless, please decompress on export |
| Series to include | For CT urograms: the **non-contrast** and the **excretory / delayed** phase axial series. For CT KUB: the non-contrast axial series |
| Reconstruction | **Thin axial slices, 1.0 to 1.5 mm** (2 mm acceptable, 3 mm and above not useful for calyces), **soft-tissue / standard kernel**, full field of view covering both kidneys and the proximal ureters |
| Not needed | Scout / topogram images, coronal or sagittal reformats, MIP or 3D screen captures, dose reports, radiology reports (a one-line note of the indication is helpful but optional) |
| Naming | Keep the original Series Description (for example "EXCRETORY 1.25mm"); the software reads it to tell the phases apart |

### 2.3 Anonymisation (the important part)

| Requirement | Detail |
| --- | --- |
| Route | Through the trust's **approved DICOM anonymisation tool or process** (PACS export anonymiser, CTP, or the radiology research anonymisation pathway), not a manual header edit |
| Profile | DICOM PS3.15 **Basic Application Level Confidentiality Profile**, with "Retain Longitudinal Temporal Information with Modified Dates" or dates removed, and the **Clean Descriptors option**. The Basic Profile on its own removes the Series Description, and the software needs it to tell the phases apart. With Clean Descriptors the anonymiser keeps the description and cleans anything identifying out of it. Please check that the phase names survive |
| Must be removed or replaced | Patient name, hospital number, NHS number, date of birth, address, telephone, accession number, referring / performing clinician, operator, institution name and address, station name, all private (vendor) tags, embedded documents and overlays |
| Must be set | `PatientIdentityRemoved = YES` and `DeidentificationMethod` describing the tool used. CalyxView, and renalplan (the CalyxView Renal pipeline), stop a series if its first file has any of 13 identifying fields filled in and this flag isn't set. That's a tripwire for a folder that skipped the anonymiser. This export sets the flag, so the check won't stop anything in it, and it doesn't look at private tags or burned-in text. The anonymiser is the real safeguard |
| Pseudonym | A study code such as `CV-CTU-001`. The key linking code to patient stays with the radiology / IG team and is never given to the project. Because the trust keeps that key, the export counts as pseudonymised personal data for the trust, and the DPIA should treat it that way |
| Burned-in text | CT axial images normally carry none, but please confirm `BurnedInAnnotation = NO` or run the pixel-text check in the anonymiser |
| UIDs | Replaced consistently within a study so the phases still belong together (standard anonymiser behaviour) |

### 2.4 Handover

| Item | Request |
| --- | --- |
| Medium | Encrypted trust-approved USB drive, or a folder on a trust network share with access restricted to the named project lead |
| Storage in the project | The de-identified DICOM files live only on the trust workstation used for processing, in a folder outside any cloud sync. They are never uploaded, never committed to a code repository, and are deleted once the 3D models are built and checked |
| What leaves the workstation | Only the finished 3D surfaces (small files with no pixel data and no header fields, named by study code) and the teaching viewer. They stay on trust systems for teaching sessions, and won't go on a public website or leave the trust unless IG agrees first |
| Size | About 150 to 250 MB per thin uncompressed series, so roughly 300 to 500 MB per CT urogram (two phases) and 150 to 250 MB per CT KUB. The full request, up to 60 studies, needs up to about 25 GB, so a 32 GB drive is enough |

---

## 3. What we are asking of each person

| Who | Ask | Effort |
| --- | --- | --- |
| **Clinical Director, Urology** | Endorse the teaching purpose, and agree that the library belongs to the department for teaching | One email |
| **Training Programme Director** | Confirm the educational rationale (calyceal anatomy, URS and PCNL access planning are curriculum items); nominate 4 to 6 trainees to trial it | One email, one 45-minute session |
| **Information Governance / Caldicott Guardian** | Advise on the DPIA for this de-identified secondary use for teaching, and confirm it fits the trust's framework | Review of this document |
| **Radiology / PACS lead** | Identify suitable studies and perform the export through the anonymisation route described in 2.2 and 2.3 | Half a day of PACS time in total |
| **Consultant endourologist (clinical champion)** | Look at the first five reconstructed cases and say whether the anatomy is faithful enough to teach from | One hour |
| **Nobody** | Money. The software is written, runs on an existing workstation and in an ordinary web browser, and uses no cloud service and no licence | Nil |

---

## 4. What happens after the export

1. **Intake check.** Each exported folder is opened in the CalyxView DICOM intake page on the workstation. It reads the headers locally, confirms the anonymisation flag, lists the series and phases, and checks slice spacing, coverage and encoding. Anything that fails is sent back, not processed.
2. **Reconstruction.** One command turns a passing study into a 3D case: parenchyma, collecting system (from the excretory phase), stones (from the non-contrast phase) and the body outline. This takes a few minutes per study.
3. **Clinical review.** The champion reviews the first cases side by side with the source images.
4. **Teaching library.** Reviewed cases go into the viewer with the URS and PCNL teaching views. The DICOM source files are then deleted from the workstation.
5. **Feedback.** Trainees use it in a supervised session, and we change whatever they find confusing.

---

## 5. Safeguards, restated

- Teaching use only; not for planning or performing any procedure on a patient.
- De-identified at source by the trust's own process. The key stays with radiology / IG, and the project never holds it.
- No cloud, no upload, no external service, no analytics or tracking in the viewer.
- Source images stay on one trust workstation and are deleted after processing.
- The renal pipeline's intake check is open for inspection in the CalyxView Renal repository (`pipeline/renalplan/io.py`). The CalyxView code isn't public yet and can be shared on request.
- A visible "teaching tool only, not a medical device" notice sits on every page.

---

## 6. Suggested wording for the PACS request form

> Please export the following studies through the anonymisation route as DICOM
> Part 10 files, uncompressed (Explicit VR Little Endian), thin axial soft-tissue
> series only (non-contrast and excretory phases for CT urograms; non-contrast for
> CT KUB), using the Basic Profile with the Clean Descriptors option so the Series
> Description is kept, with PatientIdentityRemoved = YES, DeidentificationMethod
> recorded, all private tags removed and a study pseudonym of the form CV-CTU-nnn /
> CV-KUB-nnn. Scouts, reformats and reports are not required. Deliver on an
> encrypted drive to [project lead], for de-identified teaching use under
> [IG reference].

---

## Appendix: why these phases and not the ones we already have

| Scan | What it shows | What we can build from it |
| --- | --- | --- |
| Open KiTS23 (late-arterial or nephrographic phase, already used) | Kidney, tumour and cyst outlines. No vessel labels, no collecting system | Parenchyma, tumour, cyst. No calyces, no stones |
| Excretory-phase CT urogram | Contrast-filled calyces and pelvis | The collecting system: the anatomy every URS and PCNL decision depends on |
| Non-contrast CT KUB | Dense stones against soft tissue | Stone position, size and pole |
| Any CT (already handled) | Ribs, psoas, liver, spleen, colon, skin | Context for the percutaneous tract |
