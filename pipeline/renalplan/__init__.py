"""renalplan: 3D models and computed nephrometry from kidney and tumour outlines.

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
  ai           pinned KiPA22 inference, phase registration and draft provenance
  ai_review    local source-CT overlays and reviewer interface
  cli          `renalplan` command line
"""

__version__ = "0.3.0"

DISCLAIMER = (
    "Research and teaching prototype. Not a medical device. Not for diagnosis, "
    "treatment selection, surgical planning, margin selection or patient care."
)
