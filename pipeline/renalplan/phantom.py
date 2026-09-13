"""Synthetic kidney + tumour phantom (labels and a matching CT) for tests.

Two ellipsoid kidneys with a hilar concavity, an exophytic lower-pole tumour
on the left, a small cyst on the right, an aorta and a body outline, on a
1.0 x 1.0 x 1.5 mm grid. Known geometry gives the tests something exact to
check nephrometry and planning against. Never presented as a patient.
"""
from __future__ import annotations

from pathlib import Path

import nibabel as nib
import numpy as np

SHAPE = (160, 140, 96)
SPACING = (1.0, 1.0, 1.5)

# RAS mm geometry (origin at the volume centre)
LK_C, LK_R = (55.0, -10.0, 0.0), (26.0, 16.0, 52.0)      # patient-left kidney (+X = right, so left is -X? see note)
RK_C, RK_R = (-55.0, -8.0, 4.0), (25.0, 15.0, 50.0)
TUMOUR_C, TUMOUR_R = (72.0, -6.0, -34.0), 15.0           # exophytic, lateral, lower pole of the +X kidney
CYST_C, CYST_R = (-62.0, -4.0, 20.0), 7.0
SINUS_DEPTH = 12.0

# NOTE: in RAS, +X is patient RIGHT. The tumour-bearing kidney sits at +X,
# i.e. it is the RIGHT kidney anatomically. Names above are grid-side labels.


def _grid():
    i, j, k = np.ogrid[: SHAPE[0], : SHAPE[1], : SHAPE[2]]
    x = (i - SHAPE[0] / 2) * SPACING[0]
    y = (j - SHAPE[1] / 2) * SPACING[1]
    z = (k - SHAPE[2] / 2) * SPACING[2]
    return x, y, z


def _ellipsoid(c, r):
    x, y, z = _grid()
    return ((x - c[0]) / r[0]) ** 2 + ((y - c[1]) / r[1]) ** 2 + ((z - c[2]) / r[2]) ** 2 <= 1.0


def affine() -> np.ndarray:
    a = np.diag([*SPACING, 1.0])
    a[:3, 3] = [-SHAPE[0] / 2 * SPACING[0], -SHAPE[1] / 2 * SPACING[1], -SHAPE[2] / 2 * SPACING[2]]
    return a


def build() -> tuple[np.ndarray, np.ndarray, dict]:
    x, y, z = _grid()
    lab = np.zeros(SHAPE, np.uint8)
    ct = np.full(SHAPE, -90.0, np.float32)  # fat

    body = (x / 110.0) ** 2 + (y / 80.0) ** 2 <= 1.0
    body = body & np.ones((1, 1, SHAPE[2]), bool)
    ct[~body] = -1000.0
    aorta = (x - 4) ** 2 + (y - 10) ** 2 <= 9 ** 2
    ct[aorta & body] = 260.0

    truth = {}
    for name, c, r, sign in (("right", LK_C, LK_R, +1), ("left", RK_C, RK_R, -1)):
        kid = _ellipsoid(c, r)
        # hilar concavity on the medial side (towards x = 0)
        hil_c = (c[0] - sign * (r[0] - SINUS_DEPTH + 4), c[1], c[2])
        sinus = _ellipsoid(hil_c, (SINUS_DEPTH, 9.0, 22.0))
        kid_p = kid & ~sinus
        lab[kid_p] = 1
        ct[kid_p] = 160.0
        ct[kid & sinus] = -60.0
        truth[f"kidney_{name}_ml"] = float(kid_p.sum() * np.prod(SPACING) / 1000.0)
        truth[f"sinus_{name}"] = kid & sinus

    tum = _ellipsoid(TUMOUR_C, (TUMOUR_R,) * 3)
    lab[tum] = 2
    ct[tum] = 90.0
    cyst = _ellipsoid(CYST_C, (CYST_R,) * 3)
    lab[cyst] = 3
    ct[cyst] = 10.0
    # volumes as they stand in the final label map (tumour overwrites parenchyma)
    vox_ml = float(np.prod(SPACING)) / 1000.0
    truth["kidney_right_ml"] = float(((lab == 1) & (x > 0)).sum() * vox_ml)
    truth["kidney_left_ml"] = float(((lab == 1) & (x < 0)).sum() * vox_ml)
    truth["tumour_ml"] = float(tum.sum() * vox_ml)
    truth["tumour_diameter_mm"] = 2 * TUMOUR_R
    kid_r = _ellipsoid(LK_C, LK_R)
    truth["tumour_exophytic_fraction"] = float(1.0 - (tum & kid_r).sum() / tum.sum())
    return lab, np.rint(ct).astype(np.int16), truth


def write_phantom(out: Path, seed: int = 0) -> dict:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    lab, ct, truth = build()
    rng = np.random.default_rng(seed)
    ct = (ct + rng.normal(0, 12, ct.shape)).astype(np.int16)
    aff = affine()
    nib.save(nib.Nifti1Image(lab, aff), str(out / "segmentation.nii.gz"))
    nib.save(nib.Nifti1Image(ct, aff), str(out / "imaging.nii.gz"))
    summary = {k: v for k, v in truth.items() if not isinstance(v, np.ndarray)}
    (out / "truth.json").write_text(__import__("json").dumps(summary, indent=2))
    print(f"[phantom] wrote {out} : {summary}")
    return truth
