# CalyxView Renal: a research and teaching prototype for partial nephrectomy

*Proposal for a hospital urology department.
September 2026.*

From Nity G, nity@uroref.com.

Python library and coding by Nity G. Content organisation and presentation
done with help of AI.

CalyxView Renal isn't a medical device, and it isn't for use in anyone's care.
Here I set out what I've built and checked so far, and what I'd need to test it
properly on hospital scans.

---

## 1. The idea

A partial nephrectomy is planned from a CT scan: how big the tumour is, how
deep it sits, how close it lies to the collecting system and the hilar vessels,
and how much healthy kidney would be left. Surgeons already summarise this with
nephrometry scores (R.E.N.A.L., PADUA) worked out by eye from the slices.
CalyxView Renal starts from outlines of the kidney and tumour on that CT, drawn
by hand or by a research model. It builds a 3D model you can turn over in a
browser, and it works out those measurements from the outlines, with the rules
it used written down. I want it to give the same summary every time, with its
working shown, and to be something trainees can learn from. With validation, it
might one day help with planning.

This isn't the first attempt. The KiTS team scored R.E.N.A.L. automatically
from model outlines in 300 patients, the KiTS19 cohort that the eight KiTS23
cases in section 2 also come from. Agreement with expert scores was 0.59 (Lin's
concordance), and the two sets of scores predicted outcomes about as well as
each other (Heller et al., J Urol 2022). They did the same for PADUA, the
C-index and contact surface area (Wood et al., BJU Int 2024). 3D models for
partial nephrectomy aren't new either. Commercial services make them, and a
370-patient multicentre randomised trial of one has finished (NCT06056505).
What I'd add is a check on our own scanners and against our own clinicians'
scores, with every rule written down and a 3D model to look at.

## 2. What exists now

**Software, tested.** A Python pipeline called renalplan (code at
https://github.com/nityjr-ctrl/calyxview-renal/tree/main/pipeline) that takes a
kidney / tumour / cyst outline, and optionally the CT, and produces, per case:

- a 3D model with named parts: tumour-side kidney, other kidney, tumour, cyst,
  an approximate renal sinus, a resection-margin envelope and the parenchyma
  that would remain. Given the CT, it can also add a vessel map (a simple
  contrast threshold, with artery and vein not separated) and the body
  outline. So far that's only been run on the pipeline's synthetic test
  phantom, a computer-made set of kidneys and a tumour of known shape. Its only
  vessel is an aorta, so the vessel map hasn't met a renal artery or vein yet;
- computed R.E.N.A.L. and PADUA components with the reasoning shown;
- volumes: tumour, each kidney, tissue inside a chosen margin, residual
  parenchyma and the preserved fraction, the tumour-parenchyma contact surface,
  and the distance from tumour to sinus. It can also measure distances to
  vessels and to the collecting system. The vessel distance has only been run
  on the phantom. The collecting-system steps haven't run on anything yet,
  because there's no collecting-system outline, synthetic or real;
- a one-page report and a machine-readable file.

It also has tools to check and clean up its output. They score any outline
against a reference (Dice, surface Dice, HD95 and volume error, with confidence
intervals), try out simple clean-up rules on model outlines, and check that the
3D surfaces still match the outlines they came from.

**Evidence, so far.**

- Real kidneys: I ran eight tumour cases from the open KiTS23 dataset through
  it, using the expert outlines only (no CT). Each gave scores, volumes and a
  3D model in 2 to 18 seconds on a CPU, median about 8 (full results:
  https://github.com/nityjr-ctrl/calyxview-renal/blob/main/pipeline/results/README.md).
  Without the CT, the hilar suffix and the distances to vessels and collecting
  system weren't assessed. PADUA's collecting-system item defaulted to 1 point,
  so a PADUA total can be one point low. Polar location is approximate
  throughout (see the appendix). In two kidneys the estimated sinus was too
  small to place the polar lines, so they were assumed, and one kidney looks
  like a horseshoe kidney, where the location items don't mean much.
- The 20-scan benchmark on the project site (calyxview-renal.netlify.app)
  runs a published nnU-Net model, trained for KiTS21, unchanged on 20 later
  KiTS23 cases that weren't in its training data. They come from the same
  source, so it's a check within KiTS, not an external test. One scan failed
  and is scored 0. Mean kidney + mass Dice is 0.924 over all 20, or about 0.97
  over the 19 that ran. The tumour alone is weaker: 0.70 over all 20, or about
  0.73 over the 19. The scores depend on the tumour outline, so that's the part
  that most needs checking on our scans. The surface-distance figure (HD95) is
  poor, partly because of that failed scan and partly because of stray false
  positives far from the kidney.
- The pipeline's clean-up rules are aimed at those false positives. So far
  I've only tested them on errors I added to the KiTS outlines on purpose, not
  on this model's output.
- Averaged over three cases, every smoothing and simplification setting I
  tried kept the 3D surfaces at Dice 0.980 or better against the outlines they
  came from, with mean volume error of 2.33% or less. Single cases went down to
  Dice 0.970 and up to 3.7%. The recommended setting is 4,000 faces (Dice
  0.981, HD95 1.6 mm). The pipeline's own 3D models still use 15 smoothing
  passes, which wasn't one of the settings tried. The meshes shown on the
  project site were made separately, by CalyxView, and weren't part of this
  check.
- Automated tests check the nephrometry and volumes against the same phantom.

**Companion work.** CalyxView, a separate endourology teaching project (not
public yet), made the five KiTS23 kidney meshes shown on the project site from
the same expert outlines. It has its own browser 3D viewer, a local DICOM
intake check, and URS and PCNL teaching views. The renal pipeline's 3D models
open in that viewer.

## 3. What it doesn't do yet

- It doesn't outline the kidney and tumour on a hospital scan by itself. The
  outlines come from the open dataset, or from a research model run on a GPU
  workstation, and that model hasn't been tuned or validated on our scanners.
- It doesn't separate arteries from veins. The vessel map is a single contrast
  threshold. It doesn't find the collecting system either, so that has to be
  supplied as an outline drawn on an excretory-phase scan.
- Its scores haven't been compared with clinicians' scores.
- None of it has been through information governance, clinical safety
  assessment (DCB0129), clinical validation, human-factors testing or
  regulatory review.
- Anything built on KiTS23 (the reference meshes, the benchmark, any rules
  tuned on it) is non-commercial under the dataset's licence. A product would
  need its own training and test data.

## 4. What I'm asking for

| Ask | Why | From whom |
| --- | --- | --- |
| Research access for me through whichever route the trust's R&D office uses (for example an honorary research contract or letter of access), with the Clinical Director's support | To work on the study with clinical colleagues under the trust's governance | Clinical Director, R&D office, HR |
| A coded export of the cohort's pre-operative CTs, made by the PACS team through the trust's de-identification route under the study's approval (arterial, nephrographic and, where done, excretory phases; thin axial; uncompressed DICOM; `PatientIdentityRemoved = YES`). It's separate from the CalyxView teaching export, and the scans are kept until the study ends (see Governance). I don't need access to PACS or to identifiable records myself | The pipeline needs hospital scans to be tested. Public data only goes part of the way (note 1) | Radiology / PACS, IG |
| A first retrospective cohort of 30 to 50 consecutive partial nephrectomy cases, each scored for R.E.N.A.L. and PADUA by two clinicians working independently from the pre-operative CT without seeing the computed scores, plus any score recorded before surgery | The first study: does the computed score agree with clinicians' scores as well as two clinicians agree with each other? | Urology |
| One consultant hour per fortnight for case review | Checking the reference outlines and 3D models against the scans | Consultant urologist or nominee |
| Time on a trust GPU workstation, and IT's agreement to install Python, PyTorch and the published model (a 3.5 GB download) on it. The benchmark ran on a graphics card with 16 GB of memory in a machine with 32 GB of RAM, at about 7 minutes a scan. A 15 GB memory limit wasn't enough, and smaller cards haven't been tried | Running the research model on the study scans | IT |
| No licence or cloud spend | The tools it uses are free, and it runs on trust hardware | Nobody |

**Note 1.** KiTS23 has kidney, tumour and cyst outlines but no vessels. KiPA22
has 130 CT angiograms with the kidney, tumour, renal artery and renal vein
outlined, but you have to register for the challenge to get it, and it's
CC BY-NC-ND (non-commercial, no derivatives). No public set I know of has the
collecting system, and none comes from our scanners.

## 5. The first study I'd run

**Question.** In patients who had a partial nephrectomy, how well do computed
nephrometry components agree with clinicians' scores, compared with how well
two clinicians agree with each other, and how accurately does the research
model outline the kidney and tumour on our scanners?

**Design.** A retrospective, single-centre pilot: every partial nephrectomy
over a fixed period, aiming for 30 to 50 cases. A member of the urology team
who already has access to the records picks the cases, gives each a study code
in date order, and copies against that code any R.E.N.A.L. or PADUA score
recorded before surgery, for example in the clinic letter or the MDT outcome.
The PACS team exports the scans under the same code. I get only the coded scans
and scores. I don't see names, hospital numbers or dates, or which surgeon is
linked to which case, and results won't be reported by surgeon.

Two clinicians score each case from the pre-operative CT, working
independently and without seeing the computed scores. Reference outlines of
the kidney and tumour are drawn from scratch, before the model is run on that
scan, and checked by a radiologist or urologist. The research model is used as
published. It isn't retrained on trust scans in this study. Scores are computed
twice, once from the reference outlines (to test the scoring rules) and once
from the model's outlines (to test the whole chain). Both sets are locked
before I see any clinician's score. Any clean-up rules or mesh settings are
tuned on the first third of cases, then fixed, and results that depend on them
are reported on the other two thirds. The clinical lead and the timeline are
for us to agree.

**Endpoints.** The main one is agreement on the R.E.N.A.L. total between the
score computed from the reference outlines and each clinician's score, set
beside the agreement between the two clinicians. Each is an intraclass
correlation (two-way, absolute agreement, single score) with Bland-Altman
limits of agreement. The rest are secondary:

- the same for the total computed from the model's outlines, for the PADUA
  total, and against any score recorded before surgery;
- for each R.E.N.A.L. and PADUA item the pipeline can measure, and for the
  complexity group, the share of cases that agree, the full cross-table and
  kappa (linear weights for the ordered items, unweighted for the a/p/x suffix
  and, where it's measured, the hilar suffix);
- Dice, surface Dice and HD95 for kidney and tumour against the reference
  outlines;
- the signed and absolute differences in tumour and kidney volume;
- time per case, from export to report.

PADUA's collecting-system item is left out, and PADUA totals compared without
it, unless the collecting system is outlined on the excretory phase. The hilar
suffix is only measured if the main renal artery and vein are outlined apart
from their branches, because R.E.N.A.L. gives h only when the tumour touches
them.

**Size.** This is a pilot. With 30 to 50 cases, an intraclass correlation near
0.8 would be known to about 0.1 to 0.13 either way, and a kappa to about 0.2
either way. That's enough to decide whether a bigger study is worth doing, and
not enough to settle agreement. I'll write the analysis plan down and date it
before any scan is exported, and run the analysis from that plan.

**Governance.** Whether this counts as research or service evaluation is for
the trust's R&D office to confirm, using the HRA decision tool. If it's
research, it needs a sponsor (usually the trust), a chief investigator and HRA
Approval through IRAS before anything is exported, and R&D will say whether it
also needs a research ethics committee. The care team picks, links and codes
the cases (see Design), so I never see identifiable records. If that had to
change, it would need patients' consent or CAG (section 251) support. The trust
keeps the key and the project never holds it, so for the trust this is
pseudonymised data, which is still personal data. That means a DPIA, or IG's
screening to show one isn't needed, and the Caldicott Guardian's agreement if
the trust asks for it. The data stay on trust hardware until the study ends,
then are archived or deleted under the trust's policy for research records.
Who owns anything made with trust data, such as tuned settings or results, is
for R&D to agree under the trust's IP policy before the study starts.

**Output.** A report to the department. The project site and the pipeline code
are public, so anything that goes there needs R&D's agreement first. With it,
I'd add aggregate results to the site, with no case-level rows and nothing that
could point to a patient or a surgeon, and write the tuned clean-up rules and
mesh settings back into the pipeline with their measured effect.

## 6. Where this could go

1. **Teaching library** of reconstructed past cases with computed nephrometry,
   used in trainee teaching.
2. **Pre-operative summary sheet** for MDT. Using it for a current patient is
   clinical use. It would come only after the agreement study, with a
   regulatory route (UKCA or CE marking, or whatever the MHRA then requires for
   software made and used in-house) and clinical safety sign-off under DCB0129
   and DCB0160 in place.
3. **Planning aid** (margin envelope, residual volume, vessel proximity), after
   prospective validation and the same regulatory and clinical safety steps.

Each step needs the evidence from the one before it. Nothing in this proposal
asks to use the software in any patient's care.

---

## Appendix: how the numbers are computed, briefly

- **Size.** The longest straight line across the tumour in 3D. This can be a
  little longer than a diameter measured on one slice, which matters near the
  4 and 7 cm cut-offs.
- **Exophytic / endophytic.** How much of the tumour sits outside the kidney's
  convex outline (as if the kidney were shrink-wrapped). A tumour with 5% or
  less outside is scored as entirely endophytic.
- **Nearness to the collecting system.** R.E.N.A.L. measures to the collecting
  system or the renal sinus. Without a collecting-system outline, the distance
  is to the sinus (the central space that holds the calyces, pelvis, vessels
  and fat), approximated from the kidney outline.
- **Anterior / posterior.** Whether the tumour centre lies more than 5 mm in
  front of or behind the kidney centre, measured front to back across the
  kidney's long axis ('x' if neither).
- **Polar location.** How the tumour sits against two lines across the
  kidney's long axis, set at the upper and lower limits of the estimated sinus.
  They stand in for the polar lines, which both scores set on axial slices and
  define differently, so this item is approximate. If the sinus estimate is too
  small or off to one side to use, the lines go where 30% of the kidney's
  volume lies beyond each, and the output says so. For PADUA, a tumour counts
  as between the poles only if more than half of it lies between the lines
  (the rule Wood et al. used to automate PADUA, BJU Int 2024).
- **Volumes and margin.** Counted from the outlines; the margin is a uniform
  band around the tumour, an illustration rather than a plan.
- **Dice.** The overlap between two outlines, from 0 (none) to 1 (identical).
  On the KiTS19 test set the winning model reached 0.97 for kidney and 0.85
  for tumour. Repeating the whole outlining process on 30 KiTS19 cases gave
  0.98 for kidney and 0.92 for tumour (Heller et al., Med Image Anal
  2021;67:101821). In KiTS19, "kidney" includes the tumour. On KiTS23, the
  2023 winner averaged 0.84 across kidney + mass, mass and tumour (Myronenko
  et al., arXiv 2310.04110). The benchmark here averages 0.81 on those three
  over all 20 scans. That's only a rough guide, because the challenge figure
  comes from a different test set.

**References.** R.E.N.A.L.: Kutikov A, Uzzo RG. J Urol 2009;182:844-53.
PADUA: Ficarra V, et al. Eur Urol 2009;56:786-93. Automated scores: Heller N,
et al. J Urol 2022;207:1105-15. Wood AM, et al. BJU Int 2024;133:690-8.
