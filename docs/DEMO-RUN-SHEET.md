# Run sheet: CalyxView Renal, one-to-one demo (5 minutes)

Laptop, Chrome or Edge. Public or synthetic outlines only; trust rules on patient data apply to the laptop.

## Before

- Live site open on the overview.
- One KiTS23 label map downloaded from https://github.com/neheller/kits23 (any case folder's `segmentation.nii.gz`), renamed to something neutral such as `outline.nii.gz`. Not the CT.
- Other tabs closed. The builder runs on the laptop's CPU.

## 0:00 Open (30 seconds)

- The strip at the top: research and teaching only, not for patient care.

## 0:30 Sample (1 minute)

- **Make a 3D kidney**, then **Try the sample**.
- Ant, then R. Lateral lower-pole tumour, right kidney.
- renalplan's synthetic test kidney; browser and pipeline agree on every score and volume there; on real outlines raw E and N can differ slightly.

## 1:30 Real outline (1 minute)

- **Load another outline**, choose the KiTS23 file.
- Step 1 (outlining) is done outside, in 3D Slicer or TotalSegmentator; steps 2 and 3 run in the tab.
- With both kidneys outlined, the tumour-bearing one is scored and the other is shown faintly.

## 2:30 Scores (1 minute 30)

- **Scores** tab: R, E, N, A, L, each with its rule.
- N is measured to a sinus estimated from the outline, not to the collecting system; it can read long. Estimated sinus layer in the left panel.
- Flags at the bottom of the tab: polar lines, no vessels, no collecting system.
- **Plan** tab: margin slider 5 to 10 mm; kidney kept updates.

## 4:00 Export (30 seconds)

- **Download**: GLB (metres, y-up, centred), STL (RAS mm), report as JSON or Markdown, with rules and flags. Files are named `calyxview-renal-*`.

## 4:30 Limits and the ask (30 seconds)

- **Limits** tab: not validated, no vessels or collecting system, outlining not done here.
- The ask: a retrospective comparison with clinicians' scoring on our own partial nephrectomies, two clinicians scoring independently. Proposal linked under Next step.

## If something goes wrong

- **"This looks like a CT, not an outline"**: the imaging file was picked. Choose `segmentation.nii.gz`.
- **"This browser can't unzip .nii.gz files"**: current Chrome or Edge, or unzip to .nii first.
- **Nothing happens on a big file**: allow 15 seconds; very thin-slice volumes are sampled down and the report says so.
- **The 3D view is blank**: WebGL is off. The Scores tab still works.
