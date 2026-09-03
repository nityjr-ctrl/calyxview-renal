# CalyxView Renal: CT-to-3D planning support for partial nephrectomy

*Proposal and plain-English summary for Mr Nambirajan (Clinical Director) and
the Aeropark hospitals group. September 2026.*

CalyxView Renal is a research and teaching prototype. It is not a medical
device and is not yet for use in the care of any patient. This document says
what exists today, what it produces, how it has been checked, and what is
needed to take it towards a validated product.

---

## 1. The idea in one paragraph

A partial nephrectomy is planned from a CT scan: how big the tumour is, how
deep it sits, how close it lies to the collecting system and the hilar vessels,
and how much healthy kidney would be left. Surgeons already summarise this with
nephrometry scores (R.E.N.A.L., PADUA) worked out by eye from the slices.
CalyxView Renal takes the same CT, outlines the kidney and tumour, builds a 3D
model the surgeon can turn over in a browser, and computes those measurements
from the geometry itself, with every assumption written down. The aim is a
consistent, explainable pre-operative summary and a teaching tool for trainees,
and in time, with validation, a planning aid.

## 2. What exists now

**Software, tested.** A Python pipeline (`pipeline/`, the `renalplan` command)
that takes a CT and a kidney / tumour / cyst outline and produces, per case:

- a 3D model with named parts: tumour-side kidney, other kidney, tumour, cyst,
  the renal sinus region, a resection-margin envelope, the parenchyma that
  would remain, hilar vessels and the body outline;
- computed R.E.N.A.L. and PADUA components with the reasoning shown;
- volumes: tumour, each kidney, tissue inside a chosen margin, residual
  parenchyma and the preserved fraction, the tumour-parenchyma contact surface,
  and distances from tumour to sinus, vessels and collecting system;
- a one-page report and a machine-readable file.

It also contains the evaluation and optimisation tools a product needs:
scoring any segmentation against a reference (Dice, surface Dice, HD95, volume
error, with confidence intervals), a search over explainable clean-up rules for
model output, and a check that the 3D surfaces stay faithful to the outlines
they came from.

**Evidence, so far.**

- Run on real kidneys: eight tumour cases from the open KiTS23 dataset, with
  expert outlines, produce nephrometry, volumes and 3D bundles in under a
  minute each on a laptop (`pipeline/results/`).
- The existing 20-study benchmark on this site shows a published research
  model (nnU-Net, KiTS23) reaching a mean kidney-plus-mass Dice of 0.92, but
  with occasional far-away false positives that ruin the surface distance
  metric. The new clean-up rules target exactly that failure and their effect
  is measured, not assumed.
- The 3D surfaces reproduce the outlines they came from with Dice above 0.97
  at the recommended smoothing and decimation settings (see the results
  folder for the exact numbers).
- Automated tests check the nephrometry and volumes against a synthetic
  kidney of known geometry.

**Companion work.** The endourology viewer (CalyxView) provides the browser 3D
viewer, DICOM intake with an identity audit, and the PCNL and URS planning
modules. The renal pipeline writes bundles that viewer can load.

## 3. What it does not do yet

- It does not outline the kidney and tumour by itself on a hospital scan. The
  outlines come from the open dataset or from a research model run on a GPU
  workstation. That model has not been tuned or validated on our scanners.
- It does not separate arteries from veins, or find the collecting system,
  without the right contrast phases (arterial, and excretory).
- Its nephrometry has not been compared with scores assigned by surgeons.
- None of it has been through information governance, clinical validation,
  human-factors testing or regulatory review.

## 4. What is being asked for

| Ask | Why | From whom |
| --- | --- | --- |
| Honorary clinical lecturer and clinical researcher appointment for the developer | Legitimate access to PACS and to clinical colleagues under the trust's governance | Clinical Director / HR |
| PACS access and an anonymised export route (arterial, nephrographic and, where done, excretory phases; thin axial; uncompressed DICOM; `PatientIdentityRemoved = YES`) | The pipeline needs hospital scans to be tuned and checked; no open dataset has the vessel and collecting-system phases | Radiology / PACS, IG |
| A first retrospective cohort of 30 to 50 partial nephrectomy cases with the operating surgeon's R.E.N.A.L. and PADUA scores from the notes | The first study: does the computed score agree with the surgeon's? | Urology |
| One consultant hour per fortnight for case review | Clinical fidelity, and the corrections that make the model better | Mr Nambirajan / nominee |
| A GPU workstation slot (an existing RTX-class card is enough) | Model inference and tuning | IT |
| No licence or cloud spend | The stack is open source and runs on trust hardware | Nobody |

## 5. The first study (what the researcher role would do)

**Question.** In patients who had a partial nephrectomy, how well do
computed nephrometry components agree with the surgeon-assigned score, and how
accurately does the research model outline the kidney and tumour on our
scanners?

**Design.** Retrospective, single centre, 30 to 50 consecutive cases,
anonymised at source. Reference outlines drawn or corrected by a radiologist or
urologist. Model outlines produced on the GPU workstation. Computed scores
compared with the recorded surgeon scores.

**Endpoints.** Dice, surface Dice and HD95 for kidney and tumour against the
reference; agreement (weighted kappa) for each R.E.N.A.L. and PADUA component
and the totals; absolute error in tumour and kidney volumes; time per case.

**Governance.** Anonymised secondary use for service evaluation and teaching,
via the trust's IG route; a DPIA if IG advises; no re-identification key held by
the project; data stays on trust hardware.

**Output.** A results section on this site, a report to the department, and the
tuned clean-up rules and mesh settings written back into the pipeline with their
measured effect.

## 6. Where this could go

1. **Teaching library** of reconstructed cases with computed nephrometry, used
   in trainee teaching and for pre-operative discussion.
2. **Pre-operative summary sheet** generated per case for MDT, once agreement
   with surgeon scores is shown.
3. **Planning aid** (margin envelope, residual volume, vessel proximity) after
   prospective validation and a regulatory route is chosen.

Each step needs the evidence from the one before it. Nothing in this proposal
asks for clinical use ahead of that evidence.

---

## Appendix: how the numbers are computed, briefly

- **Size.** The longest straight line across the tumour.
- **Exophytic / endophytic.** How much of the tumour sits outside the smooth
  outer shape of the kidney.
- **Nearness to the collecting system.** Distance from the tumour to the renal
  sinus (the fatty hollow that holds the pelvis and vessels), or to the
  collecting system itself when an excretory-phase scan is available.
- **Anterior / posterior and polar location.** Where the tumour centre sits
  relative to the kidney's own axes and the sinus's upper and lower limits.
- **Volumes and margin.** Counted from the outlines; the margin is a uniform
  band around the tumour, an illustration rather than a plan.
- **Dice.** The overlap between two outlines: 1.0 is identical, 0.9 is very
  good for a kidney, tumours are harder.
