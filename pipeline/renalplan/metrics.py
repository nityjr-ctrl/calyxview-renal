"""Segmentation and mesh fidelity metrics.

All metrics take boolean masks on the same grid with a physical spacing in mm.
Implemented with SciPy distance transforms so there is no dependency beyond
numpy/scipy; conventions follow the KiTS23 evaluation (Dice, surface Dice at
a tolerance, robust Hausdorff at the 95th percentile).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Iterable

import numpy as np
from scipy import ndimage


@dataclass
class OverlapMetrics:
    dice: float
    surface_dice: float
    hd95_mm: float
    assd_mm: float
    volume_ref_ml: float
    volume_pred_ml: float
    volume_error_ml: float
    volume_error_pct: float
    tolerance_mm: float

    def as_dict(self) -> dict:
        return asdict(self)


def _surface(mask: np.ndarray) -> np.ndarray:
    return mask & ~ndimage.binary_erosion(mask)


def dice(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a.astype(bool), b.astype(bool)
    s = a.sum() + b.sum()
    if s == 0:
        return 1.0
    return float(2.0 * (a & b).sum() / s)


def surface_distances(pred: np.ndarray, ref: np.ndarray, spacing) -> tuple[np.ndarray, np.ndarray]:
    """Distances from each pred-surface voxel to the ref surface and vice versa (mm)."""
    sp = np.asarray(spacing, float)
    ps, rs = _surface(pred.astype(bool)), _surface(ref.astype(bool))
    if ps.sum() == 0 or rs.sum() == 0:
        return np.array([]), np.array([])
    dt_r = ndimage.distance_transform_edt(~rs, sampling=sp)
    dt_p = ndimage.distance_transform_edt(~ps, sampling=sp)
    return dt_r[ps], dt_p[rs]


def overlap_metrics(pred: np.ndarray, ref: np.ndarray, spacing,
                    tolerance_mm: float = 1.0) -> OverlapMetrics:
    pred, ref = pred.astype(bool), ref.astype(bool)
    vox_ml = float(np.prod(spacing)) / 1000.0
    v_ref, v_pred = ref.sum() * vox_ml, pred.sum() * vox_ml
    d_pr, d_rp = surface_distances(pred, ref, spacing)
    if d_pr.size == 0 or d_rp.size == 0:
        empty_both = pred.sum() == 0 and ref.sum() == 0
        return OverlapMetrics(
            dice=1.0 if empty_both else 0.0,
            surface_dice=1.0 if empty_both else 0.0,
            hd95_mm=0.0 if empty_both else float("nan"),
            assd_mm=0.0 if empty_both else float("nan"),
            volume_ref_ml=v_ref, volume_pred_ml=v_pred,
            volume_error_ml=v_pred - v_ref,
            volume_error_pct=float("nan") if v_ref == 0 else 100.0 * (v_pred - v_ref) / v_ref,
            tolerance_mm=tolerance_mm,
        )
    all_d = np.concatenate([d_pr, d_rp])
    sd = float(((d_pr <= tolerance_mm).sum() + (d_rp <= tolerance_mm).sum()) / (d_pr.size + d_rp.size))
    return OverlapMetrics(
        dice=dice(pred, ref),
        surface_dice=sd,
        hd95_mm=float(np.percentile(all_d, 95)),
        assd_mm=float(all_d.mean()),
        volume_ref_ml=v_ref, volume_pred_ml=v_pred,
        volume_error_ml=v_pred - v_ref,
        volume_error_pct=float("nan") if v_ref == 0 else 100.0 * (v_pred - v_ref) / v_ref,
        tolerance_mm=tolerance_mm,
    )


# KiTS23 hierarchical evaluation classes: label sets and official tolerances.
KITS_REGIONS = {
    "kidney_and_mass": {"labels": (1, 2, 3), "tolerance_mm": 1.0330772532390826},
    "mass": {"labels": (2, 3), "tolerance_mm": 1.1328796488598762},
    "tumour": {"labels": (2,), "tolerance_mm": 1.1498198361434828},
}


def kits_region_metrics(pred_labels: np.ndarray, ref_labels: np.ndarray, spacing) -> dict[str, OverlapMetrics]:
    out = {}
    for name, r in KITS_REGIONS.items():
        p = np.isin(pred_labels, r["labels"])
        g = np.isin(ref_labels, r["labels"])
        out[name] = overlap_metrics(p, g, spacing, tolerance_mm=r["tolerance_mm"])
    return out


def bootstrap_mean_ci(values: Iterable[float], n: int = 10_000, seed: int = 20260901,
                      alpha: float = 0.05) -> tuple[float, float, float]:
    """Mean and percentile-bootstrap CI, ignoring NaNs."""
    v = np.asarray([x for x in values if x == x], float)
    if v.size == 0:
        return float("nan"), float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, v.size, size=(n, v.size))
    means = v[idx].mean(axis=1)
    return float(v.mean()), float(np.percentile(means, 100 * alpha / 2)), float(np.percentile(means, 100 * (1 - alpha / 2)))
