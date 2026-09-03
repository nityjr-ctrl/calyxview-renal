"""renalplan: CT-to-3D reconstruction and planning support for partial nephrectomy.

Research and teaching prototype. Not a medical device. Not for diagnosis,
treatment selection, surgical planning, margin selection or patient care.

Modules
  io           DICOM / NIfTI loading, identity audit, canonical RAS volumes
  segment      segmentation backends (reference labels, TotalSegmentator,
               nnU-Net, CPU threshold baselines, contrast-vessel extraction)
  postprocess  configurable mask clean-up rules (the "optimisation" knobs)
  metrics      Dice, surface Dice, HD95, ASSD, volume error
  nephrometry  RENAL and PADUA components from masks
  planning     resection margin envelope, residual parenchyma, distances
  mesh         mask -> mesh, mesh fidelity back-check
  report       case bundle (GLB + planning.json) and Markdown/JSON reports
  cli          `renalplan` command line
"""

__version__ = "0.1.0"

DISCLAIMER = (
    "Research and teaching prototype. Not a medical device. Not for diagnosis, "
    "treatment selection, surgical planning, margin selection or patient care."
)
