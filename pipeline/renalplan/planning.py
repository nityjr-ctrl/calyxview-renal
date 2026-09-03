"""Resection-planning quantities from masks.

Illustrative geometry for teaching and research. The margin envelope is a
uniform dilation of the tumour; a real resection plane is chosen by the
surgeon. Nothing here selects a margin or recommends an approach.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
from scipy import ndimage

from .postprocess import KIDNEY, TUMOUR, CYST, component_sizes
from .nephrometry import Geometry, _dist_mm


@dataclass
class PlanningMetrics:
    margin_mm: float
    tumour_ml: float
    ipsilateral_kidney_ml: float
    contralateral_kidney_ml: float
    resection_ml: float             # tumour + margin, within the renal outline
    parenchyma_removed_ml: float    # margin shell of parenchyma
    residual_ipsilateral_ml: float
    preserved_fraction_ipsilateral: float
    ipsilateral_share_of_total: float
    cyst_ml: float
    tumour_to_sinus_mm: float
    tumour_to_collecting_mm: float | None
    tumour_to_vessels_mm: float | None
    contact_surface_area_cm2: float  # parenchyma in contact with the tumour
    notes: list

    def as_dict(self) -> dict:
        return asdict(self)


def contact_surface_cm2(tumour: np.ndarray, kidney: np.ndarray, spacing) -> float:
    """Approximate area of the tumour surface in contact with parenchyma
    (voxel faces between tumour and kidney)."""
    sp = np.asarray(spacing, float)
    faces = [sp[1] * sp[2], sp[0] * sp[2], sp[0] * sp[1]]
    area = 0.0
    for ax, fa in enumerate(faces):
        t_lo = np.take(tumour, range(0, tumour.shape[ax] - 1), axis=ax)
        k_hi = np.take(kidney, range(1, kidney.shape[ax]), axis=ax)
        t_hi = np.take(tumour, range(1, tumour.shape[ax]), axis=ax)
        k_lo = np.take(kidney, range(0, kidney.shape[ax] - 1), axis=ax)
        area += ((t_lo & k_hi).sum() + (t_hi & k_lo).sum()) * fa
    return float(area) / 100.0


def margin_envelope(tumour: np.ndarray, margin_mm: float, spacing) -> np.ndarray:
    if margin_mm <= 0:
        return tumour.copy()
    dt = ndimage.distance_transform_edt(~tumour, sampling=spacing)
    return dt <= margin_mm


def plan(labels: np.ndarray, g: Geometry, margin_mm: float = 5.0,
         collecting: np.ndarray | None = None, vessels: np.ndarray | None = None) -> tuple[PlanningMetrics, dict]:
    sp = g.spacing
    vox_ml = float(np.prod(sp)) / 1000.0
    kidney_all = labels == KIDNEY
    ipsi = g.kidney
    contra = kidney_all & ~ipsi
    tumour = g.tumour
    cyst = labels == CYST
    env = margin_envelope(tumour, margin_mm, sp)
    outline = ipsi | tumour
    resection = env & outline
    removed_parenchyma = env & ipsi
    residual = ipsi & ~env
    ipsi_ml, contra_ml = ipsi.sum() * vox_ml, contra.sum() * vox_ml
    notes = ["Margin envelope is a uniform dilation of the tumour; not a surgical plan."]
    if not contra.any():
        notes.append("No contralateral kidney in the label map (single kidney or cropped scan).")
    m = PlanningMetrics(
        margin_mm=margin_mm,
        tumour_ml=tumour.sum() * vox_ml,
        ipsilateral_kidney_ml=ipsi_ml,
        contralateral_kidney_ml=contra_ml,
        resection_ml=resection.sum() * vox_ml,
        parenchyma_removed_ml=removed_parenchyma.sum() * vox_ml,
        residual_ipsilateral_ml=residual.sum() * vox_ml,
        preserved_fraction_ipsilateral=float(residual.sum() / max(1, ipsi.sum())),
        ipsilateral_share_of_total=float(ipsi_ml / max(1e-6, ipsi_ml + contra_ml)),
        cyst_ml=cyst.sum() * vox_ml,
        tumour_to_sinus_mm=_dist_mm(tumour, g.sinus, sp),
        tumour_to_collecting_mm=_dist_mm(tumour, collecting, sp) if collecting is not None and collecting.any() else None,
        tumour_to_vessels_mm=_dist_mm(tumour, vessels, sp) if vessels is not None and vessels.any() else None,
        contact_surface_area_cm2=contact_surface_cm2(tumour, ipsi, sp),
        notes=notes,
    )
    masks = {"margin_envelope": env & ~tumour, "residual_parenchyma": residual}
    return m, masks
