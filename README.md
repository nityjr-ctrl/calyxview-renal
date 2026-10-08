# CalyxView Renal

CalyxView Renal is my research and teaching prototype for partial nephrectomy planning. Load a kidney and tumour outline and the browser builds a 3D kidney and scores R.E.N.A.L. and PADUA, with nothing uploaded. Behind it is renalplan, a Python pipeline I wrote that does the same from the command line, and the site also has five real KiTS23 kidneys and a hand-made kidney with vessels and a collecting system.

**Live site:** [calyxview-renal.netlify.app](https://calyxview-renal.netlify.app/)

**Author:** Nity G, [nity@uroref.com](mailto:nity@uroref.com). Python library and coding by Nity G. Content organisation and presentation done with help of AI.

> Research and teaching only. It isn't validated and it isn't a medical device. It isn't UKCA or CE marked, and it isn't FDA cleared. Not for diagnosis, treatment, surgical planning, consent or intra-operative guidance.

## What's on the site

- **Make a 3D kidney (the builder).** Load a label map (.nii or .nii.gz; 1 kidney, 2 tumour, 3 cyst) and the browser meshes it and scores R.E.N.A.L. and PADUA with renalplan 0.2.0's rules, each point shown with its rule, plus the kidney kept outside a margin you choose. Download the model as GLB (metres, y-up, centred, for general viewers) or STL (RAS millimetres) and a report as JSON or Markdown. "Try the sample" builds renalplan's own synthetic phantom with no file; on it the browser and the pipeline agree on every score and volume. On real outlines raw E and N can differ slightly because the browser's convex hull is exact, where renalplan samples up to 20,000 surface points. Outlining the CT is still done outside the browser (3D Slicer, TotalSegmentator). See "The builder" below.
- **The hand-made kidney.** A right kidney with an interpolar tumour, made in code. The arteries, veins and collecting system are drawn by hand, so there's no patient data in it. It's the only model here with vessels. A small version sits on the overview page.
- **KiTS23 kidneys A to E.** Five real kidneys from the public KiTS23 dataset. They're de-identified CTs of real patients, outlined by the KiTS team, and shared under CC BY-NC-SA 4.0. The 3D meshes were made by my separate CalyxView endourology project from the KiTS expert outlines. The R.E.N.A.L. and PADUA scores beside them were worked out by renalplan from the same outlines, not from the meshes, and nothing was typed in. Each kidney also has a CT tab: cropped, soft-tissue-windowed axial slices round the tumour-bearing kidney, with the KiTS kidney, tumour and cyst outlines drawn over them and a plane in the 3D view that follows the slice.
- **Kidney C** also carries ribs, psoas, colon, spleen, liver and a body outline. Those came from an AI model (TotalSegmentator) run on its CT. They aren't KiTS outlines and nobody has checked them. The cyst in Kidney C's file belongs to the other kidney, which isn't in the file.
- **The 3D viewer.** Standard views, per-structure show, hide and fade, a cutaway and an image export. For Kidneys A to E, the CT tab scrolls through the slices (slider, arrow keys, Page Up and Page Down, or the mouse wheel over the image). `#workspace/reference-c?ct` opens Kidney C on its CT.
- **The pipeline section.** What renalplan does and what it has been run on, with links to the full results.
- **The benchmark.** Aggregate results from running a published segmentation model on 20 KiTS23 scans.
- **The next step.** What I'd like to do with hospital scans, and what I'm asking for.

## How to use it

1. Open the 3D viewer. It starts on the hand-made kidney.
2. Pick one of Kidneys A to E, from the overview or inside the viewer. Its scores sit beside it.
3. To make your own, open "Make a 3D kidney" and press "Try the sample", or load a label map. Use public, synthetic or properly de-identified outlines.

## The builder

What it reads: the whole label-map file you choose, into this tab's memory, and nothing else. The page hands the bytes to a Web Worker in the same tab (`lib/build-worker.ts`), which unzips a .nii.gz with the browser's `DecompressionStream`, reads the NIfTI-1 header and voxels (8, 16 or 32-bit integers, float32 or float64; orientation from the sform, else the qform, else pixdim, so everything is in RAS millimetres), meshes each structure and scores the tumour-bearing kidney. The file name is looked at once for its extension and isn't kept. Downloads are always named `calyxview-renal-*`.

What it never does: upload anything (no `fetch`, `XMLHttpRequest` or other request carries the file, and there's no server to send it to), store anything (no browser storage; close the tab or load another file and the case is gone), read DICOM, or read CT. A file that looks like a CT (negative values, fractions or more than 20 distinct values) is refused with a pointer to 3D Slicer or TotalSegmentator. It doesn't read the NIfTI header's free-text description or copy it into anything it saves.

How it works (`lib/builder/`): the outlined region is cropped with 12 mm to spare. Above 512 voxels a side or 20 million voxels it's sampled every nth voxel, and the report says so. Each structure is drawn from a signed distance field (distance outside minus distance inside, in mm at the file's own spacing), trilinearly resampled to an isotropic grid (the finest spacing or 1 mm, whichever is larger, coarsened if the grid would pass 8 million points, and the report says so), given a Gaussian of one grid voxel, then meshed by marching cubes at zero (a 256-case table built so the surface is always closed), cut to its largest piece and given 5 Taubin passes (lambda 0.5, mu 0.53). This avoids the terracing a binary mask gives on thick slices. The report lists each surface's volume next to the voxel volume; kidney and tumour agree within 3% on the sample and on a thick-slice KiTS23 outline. The surfaces are only for display. With two kidneys, the one nearest the largest tumour is scored and the other is shown faintly. The scores port renalplan 0.2.0's `nephrometry.py` and `planning.py` with an exact 3D convex hull and an exact distance transform. Differences from renalplan: every voxel is used where renalplan samples 60,000 (and 8,000 for the diameter), and the surfaces come from the distance field above rather than from the binary mask (renalplan uses 15 Taubin passes and decimates). On renalplan's phantom and on a 96 x 96 x 64 test outline the browser matches renalplan exactly; a KiTS-sized 512 x 512 x 100 label map builds in about a second on a laptop CPU in Node.

What it can't do: outline the CT (step 1), see vessels or the collecting system (so no hilar suffix, PADUA's collecting-system item is scored 1, and N is measured to an estimated sinus), or tell you anything validated. It isn't a medical device.

Taking names out of DICOM headers isn't enough to anonymise a scan. Private tags, nested content, UIDs, overlays, embedded documents and text burned into the pixels all need a validated process. See [DICOM PS3.15 Annex E](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html), the [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html) and the [ICO anonymisation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/about-this-guidance/).

## The pipeline (`pipeline/`)

renalplan is the Python side. You give it a kidney, tumour and cyst label map (KiTS convention), and optionally the CT as NIfTI or a de-identified DICOM export. It builds a 3D case bundle (named meshes plus a viewer manifest entry), works out the R.E.N.A.L. and PADUA components, measures volumes, a uniform margin band, the kidney that would be left and the preserved fraction, and writes a short report per case with the rules it used. It also has the evaluation tools (Dice, surface Dice, HD95, volume error, bootstrap confidence intervals, KiTS23 regions), a grid search over simple clean-up rules for model output, and a mesh fidelity sweep.

What it has actually been run on:

- **Eight KiTS23 cases, outlines only.** No CT was used. So the tumour-to-vessel and tumour-to-collecting-system distances are blank, and the hilar "h" suffix wasn't assessed. PADUA's collecting-system item wasn't assessed either and defaults to 1 point, so a PADUA total can be one point low. N is the distance to the renal sinus, approximated from the kidney outline. A tumour with 5% or less outside the kidney outline is scored as entirely endophytic (E 3). L and the PADUA pole are approximate for every case, because the polar lines come from that estimated sinus and sit across the kidney's own long axis rather than on axial slices. For the PADUA pole, a tumour counts as between the poles only if more than half of it lies between the lines (the rule Wood et al. used to automate PADUA, BJU Int 2024). In two cases (Kidneys A and D) the sinus estimate was too small to set the lines, so they were assumed and those scores are rougher still. One case looks like a horseshoe kidney, and the pipeline flags its location scores as unreliable. Each case took 2 to 18 s on a CPU, median about 8 s. Kidneys A to E on the site are the first five of these eight cases. The rerun on 29 September 2026 changed the scores for six of the eight cases, and `pipeline/results/README.md` says which and why.
- **Vessels, the body outline and distances to vessels.** renalplan has only run these on its synthetic test phantom. The phantom's only vessel is an aorta, so the vessel step hasn't met a renal artery or vein yet. The vessel step is a contrast threshold on the CT and doesn't separate arteries from veins.
- **The collecting system.** renalplan doesn't find it itself, so it has to be supplied as an outline. No collecting-system outline, synthetic or real, has been through the pipeline yet, so those steps haven't run at all.
- **Clean-up rules.** Tested on the KiTS outlines with two errors I added on purpose: the tumour eroded by one voxel, and three speckled blobs placed far from the kidney (about 70% labelled kidney, 30% tumour). Every configuration keeps the two largest kidney pieces, and that rule alone lifts kidney + mass Dice from 0.988 to 0.992. Keeping tumour or cyst only within 5 mm of the kidney removes the tumour-labelled blobs, and the best kidney + mass Dice was 0.994. The evaluation crops to the reference box plus 40 mm, so blobs beyond that aren't counted. This shows the code works on errors I put there on purpose. It doesn't show it helps real model output.
- **Mesh fidelity.** Averaged over three cases, every smoothing and simplification setting I tried kept Dice at 0.980 or better against the source outline, with mean volume error of 2.33% or less. Single cases went down to Dice 0.970 and up to 3.7% volume error. The recommended setting is 4,000 faces (Dice 0.981, HD95 1.6 mm). renalplan's own 3D models still use 15 smoothing passes, which wasn't one of the settings tried. The meshes on the site came from the CalyxView project, not from this sweep.

The DICOM loader is a tripwire, not a de-identification check. It looks at the first file of each series for 13 identifying header fields, and stops if any of them is filled in, unless the file says the patient's identity has been removed. It doesn't look at private tags or burned-in text, and it doesn't check NIfTI input.

```bash
cd pipeline && pip install -r requirements.txt && pip install -e . && pytest
renalplan batch --kits ~/CalyxView-data/kits --out out/kits
```

The full results are in [`pipeline/results/`](pipeline/results/), and the commands and scoring rules are in [`pipeline/README.md`](pipeline/README.md).

## The benchmark (`research/kits23-feasibility/`)

The benchmark section of the site reports one offline run of a published nnU-Net v1 model (`Task135_KiTS2021`, five-fold `3d_fullres` ensemble, no test-time augmentation). It was trained for KiTS21 on cases 0 to 299. I ran it unchanged on 20 KiTS23 cases (400 to 419) that weren't in its training data. They come from the same source, so this is a check within KiTS, not external validation. The predictions weren't locked before the expert outlines were available, so it wasn't blinded either.

19 of the 20 scans produced a valid output. The failed one stays in every average: Dice 0, surface Dice 0, HD95 set to the scan's physical diagonal (1,000 mm if that's unknown) and volume error set to the whole reference volume. Mean kidney + mass Dice is 0.924 over all 20, or about 0.97 over the 19 that ran. For the tumour alone it's 0.70, or about 0.73 over the 19. Surface Dice uses the official KiTS23 tolerances (about 1.0 to 1.15 mm). HD95 here is the larger of the two directed 95th-percentile surface distances. The mean HD95 (86 to 158 mm across the three regions) is high because of the failed scan and stray false positives far from the kidney. Case-level data isn't public, so the site can't show medians. The median runtime was 6.8 minutes per scan on a 16 GB GPU.

What's published from KiTS23: the five meshes, renalplan's numbers, and cropped, windowed axial CT slices round each of Kidneys A to E with their outlines (`public/ct/`, made by [`scripts/make-ct-slices.py`](scripts/make-ct-slices.py), about 0.5 to 0.7 MB a kidney). The full CT volumes, label volumes and model output are not published.

Only the aggregate file [`research/kits23-feasibility/results/summary.public.json`](research/kits23-feasibility/results/summary.public.json) goes into the site. The CT volumes, reference labels, predictions, model weights, case-level rows, timings, logs and mask checks stay out of Git and Netlify. The protocol, scripts, checksums, failure rule and how to reproduce the run are in [`research/kits23-feasibility/README.md`](research/kits23-feasibility/README.md). The model weights are on Zenodo under CC BY 4.0.

## How the browser side fits together

```text
The builder today (browser only)

Outline the CT elsewhere (3D Slicer, TotalSegmentator) and save a label map
  → choose it in the builder; it's read into this tab's memory
  → a Web Worker in the same tab meshes and scores it
  → 3D view, scores with their rules, GLB/STL/JSON/Markdown downloads
  → nothing uploaded or stored; gone when the tab closes

What a real system would need

Identified data held in quarantine
  → validated DICOM PS3.15 de-identification, plus a check for burned-in text
  → protocol checks and registration of the contrast phases
  → validated segmentation with uncertainty
  → expert correction and sign-off
  → DICOM SEG and patient-space meshes with provenance
  → a verified clinical viewer with an audit trail
```

The builder never takes a scan in; it works on an outline the visitor already has. A real service that took scans would implement the `SegmentationGateway` contract in [`lib/prototype-pipeline.ts`](lib/prototype-pipeline.ts) and accept only a receipt from an approved de-identification service, never raw files picked in a browser.

## What's missing before this could touch real hospital CT

None of these exist yet, in the site or the pipeline:

1. Secure data intake, access control, encryption, audit logging, retention and deletion.
2. Validated DICOM de-identification, including private tags, UID remapping, burned-in text and a human privacy check.
3. Protocol suitability checks, artefact detection and registration of the contrast phases.
4. Validated kidney, tumour, cyst, artery, vein or collecting-system segmentation on hospital scans.
5. Uncertainty maps, rejection of scans the model shouldn't handle, and clinician correction and sign-off.
6. DICOM SEG or Surface SEG output.
7. Independent multi-centre validation, reader and human-factors studies, prospective clinical validation, a quality management system and regulatory approval.

More detail is in [`docs/production-segmentation-roadmap.md`](docs/production-segmentation-roadmap.md).

## CalyxView, the endourology project

CalyxView is my separate endourology teaching project for URS and PCNL. It isn't public yet. Its mesh step made the five KiTS23 meshes on the site, and renalplan's case bundles open in its viewer. Both projects need hospital scans next, but different ones. CalyxView needs CT urograms and stone CTs for the collecting system and stones. This project needs the pre-operative CTs of patients who had a partial nephrectomy. The CalyxView export request, with the series, format, anonymisation and handover, is in [`docs/PACS-DICOM-EXPORT-REQUEST.md`](docs/PACS-DICOM-EXPORT-REQUEST.md).

## Next step

I'd like to test the pipeline on hospital scans. The proposal asks for research access through the trust's R&D office, a coded export of the study scans and a first retrospective study comparing the computed scores with clinicians' scores. It's in [`docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md`](docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md).

## Development

Requirements: Node.js 22.13 or newer (Netlify builds with Node 24).

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
npm run scan:bundle
```

`npm run build:netlify` runs all five in that order, and it's what Netlify runs. The production build is written to `netlify-dist/`, and the bundle scan checks it for things that mustn't ship, such as scan files, cohort ids, local paths and patient fields. Netlify's build and security-header settings are in [`netlify.toml`](netlify.toml).

The pipeline has its own tests: `cd pipeline && pytest` (synthetic phantom with known geometry).

## References

- [DICOM confidentiality profiles](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html)
- [DICOM Segmentation IOD](https://dicom.nema.org/medical/dicom/2026a/output/chtml/part03/sect_A.51.html)
- [MHRA software and AI as a medical device guidance](https://www.gov.uk/government/publications/medical-devices-software-applications-apps)
- [FDA Clinical Decision Support Software guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software)
- [IMDRF SaMD clinical evaluation](https://www.imdrf.org/documents/software-medical-device-samd-clinical-evaluation)
- [KiTS23 kidney tumour segmentation challenge](https://kits-challenge.org/kits23/)
- [nnU-Net](https://www.nature.com/articles/s41592-020-01008-z)
- R.E.N.A.L.: Kutikov A, Uzzo RG. J Urol 2009;182:844-53.
- PADUA: Ficarra V, et al. Eur Urol 2009;56:786-93.
- TotalSegmentator: Wasserthal J, et al. Radiology: Artificial Intelligence 2023.

## Licensing

This repository doesn't grant a licence to reuse the CalyxView Renal code, design or original content. Those are all rights reserved unless I add an explicit project licence. Being able to see the repository isn't permission to reuse it.

Third-party material keeps its own terms:

- The five meshes in `public/models/` are adaptations of KiTS23 (Heller et al., [kits-challenge.org](https://kits-challenge.org/kits23/)), whose imaging and labels are CC BY-NC-SA 4.0. The meshes are shared under CC BY-NC-SA 4.0 as well. They were made by meshing, smoothing and decimating the KiTS expert outlines, plus, for Kidney C, AI outlines of the surrounding organs on the KiTS CT.
- The CT slices and outlines in `public/ct/` are cropped, windowed and resampled from the KiTS23 imaging and expert labels, so they are adaptations of KiTS23 and shared under CC BY-NC-SA 4.0 too. The full volumes aren't published.
- Kidney C's surrounding organs came from TotalSegmentator's `total` and `body` tasks, whose code and weights are Apache-2.0. They were drawn on the KiTS23 CT, so the published outlines also carry KiTS23's CC BY-NC-SA 4.0 terms.
- The nnU-Net model weights used in the benchmark are CC BY 4.0. nnU-Net software has its own licence.

No licence is granted for clinical use, for patient data, or for any medical-device claim.
