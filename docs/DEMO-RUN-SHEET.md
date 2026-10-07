# Run sheet: showing CalyxView Renal to a consultant (5 minutes)

For a one-to-one on a laptop. Have the site open before you start, and a public outline ready (see step 3). Use only public or synthetic outlines; nothing you load is uploaded, but trust rules on patient data still apply to the laptop.

## Before you start

- Open the live site in Chrome or Edge, on the overview page.
- Download one KiTS23 label map in advance from the KiTS23 GitHub repository (https://github.com/neheller/kits23): any case folder's `segmentation.nii.gz`. Rename it to something neutral, such as `outline.nii.gz`. Don't download the CT.
- Close other tabs. The builder runs on the laptop's CPU.

## 0:00 Open (30 seconds)

"I wanted to see whether nephrometry could be scored from the outline by explicit rules, rather than by eye, and shown in 3D. This is a research and teaching prototype, not a device."

Point at the strip at the top: research and teaching only, not for patient care.

## 0:30 Try the sample (1 minute)

- On the overview, under **Make a 3D kidney**, press **Try the sample**.
- It builds in under a second. Turn the kidney: Ant, then R. The tumour is on the lateral lower pole of a right kidney.
- Say: "This is my pipeline's own synthetic test kidney, built here in the browser. On it the browser and the Python pipeline agree on every score and volume."

## 1:30 Load a real outline (1 minute)

- Press **Load another outline** and choose the KiTS23 file.
- While it runs (a few seconds), say: "Step 1, outlining the CT, still happens outside, in 3D Slicer or TotalSegmentator. This does steps 2 and 3. Nothing leaves the laptop."
- If both kidneys are outlined, point out that the one carrying the tumour is scored and the other is shown faintly.

## 2:30 Scores (1 minute 30)

- Open the **Scores** tab. Walk down R, E, N, A, L: each point has its rule beside it (for example, "N: distance to the collecting system or sinus; 4 mm or less scores 3").
- Be straight about N: "KiTS doesn't outline the collecting system, so N is measured to a sinus estimated from the outline. It can read long." Show the estimated sinus layer in the left panel.
- Point at the flags at the bottom of the tab (polar lines, no vessels, no collecting system).
- Open **Plan** and move the margin slider from 5 to 10 mm: the kidney kept updates. "Volume, not function, and not a resection plan."

## 4:00 Export (30 seconds)

- In **Download**, mention GLB (for a viewer or a print), STL (for a slicer) and the report as JSON or Markdown, with the rules and flags written into it. Files are named `calyxview-renal-*`, never after the input.

## 4:30 Limits and the ask (30 seconds)

- Open **Limits**: not validated, no vessels or collecting system, outlining not done here.
- The ask: "None of this has been compared with clinicians' scoring. I'd like to run that retrospectively on our own partial nephrectomies, two clinicians scoring independently. The proposal is linked under Next step."

## If something goes wrong

- **"This looks like a CT, not an outline"**: you picked the imaging file. Choose `segmentation.nii.gz`.
- **"This browser can't unzip .nii.gz files"**: use a current Chrome or Edge, or unzip the file to .nii first.
- **Nothing happens on a big file**: give it 15 seconds; very thin-slice volumes are sampled down and the report says so.
- **The 3D view is blank**: WebGL is off. The scores still work; use the Scores tab.
