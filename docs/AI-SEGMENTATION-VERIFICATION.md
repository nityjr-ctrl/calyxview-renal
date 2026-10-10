# AI draft workflow verification

10 October 2026. Scope: local research inference and review, plus a public
explanation in the existing CalyxView Renal tab. This is not clinical validation.

## Source provenance

Repository: https://github.com/nityjr-ctrl/calyxview-renal.
Implementation checkout: `C:/NityProjects/CalyxView-Renal/worktrees/ai-segmentation-20261010`.
Branch: `feature/ai-segmentation-20261010`, starting at
`85d9a7d0112f869858ba6278cc6ae237e14aa785`, committed 10:41:35 BST.
The clean integration checkout and separate company-details worktree were
inspected and preserved. The parent includes the earlier assistant-authored
site, Python geometry pipeline, KiTS feasibility study and historical benchmark.
No new pilot result replaces that benchmark. Git commit and remote identities
for the release are recorded in the main site's release record and project map.

## Measured engineering runs

Both studies are public adult research data. Inputs originally omitted NIfTI
spatial units. Prepared copies explicitly declare millimetres using the known
public geometry; data, dimensions, affine and intensities were unchanged.
The qualification record preserves original and prepared hashes. This is not
a rule for guessing units on a clinical scan.

| Public input | Completed final bundle | Kidney draft | Tumour draft | Artery candidate | Vein candidate | Collecting system |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| KiTS23 engineering case | `research-kits23-00002-joint-fold0` | 483.69 ml | 37.64 ml | 13.73 ml | 29.08 ml | Unassessed: no declared excretory phase |
| TCIA TCGA-BLCA excretory CT | `research-tcia-excretory-final-fold0` | 122.65 ml | 4.90 ml | 2.10 ml | 23.29 ml | Unassessed: no adequate dense-contrast seed |

These are mask volumes, not confirmed anatomy. The urogram tumour prediction
is not a diagnosis. Each nonempty structure still requires source-CT review.
The runs used BA-Net fold 0 with mirroring and Task135 fold 0 without mirroring.
The full default ensembles have not been measured here.

The first whole-abdomen BA-Net run exceeded WSL memory and was killed. The
new localisation/crop path completed. BA-Net's raw-HU and +1024 tissue predictions
both failed the compatibility comparison, so the final architecture discards
those tissue labels. On the KiTS engineering case, Task135 tumour Dice was
0.9603367 and combined kidney/mass Dice was 0.9353200. That case is from the
model-training era of KiTS, not an independent held-out validation. These
numbers establish an engineering compatibility check only. Reference labels
were loaded for comparison after inference, never supplied as predictions.
The comparison includes the stated label convention and cyst omission.

The +1024 BA-Net vessel input adaptation is inferred from checkpoint statistics;
the authors' exact input encoding remains unconfirmed. Neither pilot has a
vascular reference. Vessel candidates remain unqualified. Moving the contrast
seed search to within 3 mm of parenchyma still failed on this urogram; the
pipeline retained an empty collecting mask. It does not bridge missing branches
or manufacture a renal pelvis label. All earlier experiments and logs remain
outside Git for inspection.

## Verification evidence

- 63 Python tests pass, including distinct KiPA/KiTS label mapping, crop affine
  restoration, source units and invalid geometry, contrast absence and gaps,
  physical registration, corrupted artifacts, correction grids, review guards,
  disconnected outward meshes and single-phase exports.
- 64 frontend tests pass; lint, typecheck, build and deployment privacy scan
  pass. The public bundle contains no raw CT, NIfTI, checkpoints or pilot masks.
- Both final review bundles pass Chromium checks at 320, 390 and 1440 px:
  all four view buttons, each available layer, each CT plane and slider,
  keyboard focus, no horizontal overflow, all eight downloads returning 200,
  zero page errors, zero external requests and zero reported WCAG A/AA violations.
- Loading and failed GLB, missing slice manifest and missing CT image have
  checked recovery states. A browser-only fixture checks phase switching;
  it is not a clinical registration experiment.
- The 58,093-byte Python wheel includes the current HTML, JavaScript and
  frozen Task135 model specification. SHA-256:
  `7319c3ee2c047823239bd5aaab1bf8efb403ac5fd8cf32b1c4ce371e7742c964`.
- Bundles verify source, masks, coverage, GLB and provenance hashes. Refreshing
  derived review assets preserved the anatomical provenance. Screenshots show
  mobile reading order and actual source CT/model rendering.

Local evidence: `C:/NityProjects/CalyxView-Renal/archive/ai-segmentation-20261010`.
Raw inputs/outputs: `C:/NityProjects/CalyxView-Renal/data/ai-segmentation-20261010`.
Native model/runtime cache: `/var/tmp/calyxview-renal-ai-20261010`.
None of these data directories is part of the public deploy or Git commit.

The unchanged frontend dependency lock reports one high and two critical npm
advisories, involving source-map-js and the oxfmt/tinypool development tools.
Installation scripts were disabled; the formatter was not run. Dependency
remediation is separate work and this release makes no security-certification
claim. The full audit is preserved in the local evidence directory.

## Acceptance outcomes and remaining limits

The local command, separate masks, recorded model identities, explicit phase
handling, source review and fresh-bundle correction path are implemented and
verified. Publication describes that behaviour and retains the research limit.

Automatic reconstruction of a usable collecting tree or separate renal pelvis
is not achieved on the public urogram. An expert can supply a corrected binary
mask on the source grid through `ai-review`. A specialised, independently
validated model and adequate imaging are still needed for automatic coverage.
The workflow has not undergone clinical or paediatric validation, vascular
ground-truth assessment, real paired-phase registration validation or surgical
planning validation. Reviewer decisions do not remove these limitations.
The command withholds nephrometry, margin selection and planning measurements.

The item-by-item UI and copy review is in [AI-REVIEW-DESIGN.md](AI-REVIEW-DESIGN.md).
Setup and CLI usage are in [AI-SEGMENTATION.md](AI-SEGMENTATION.md).
