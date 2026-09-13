"""Segmentation backends.

Two kinds:
  * **Model outputs** (GPU): TotalSegmentator and nnU-Net are wrapped as
    subprocess calls and their outputs are mapped to the KiTS label
    convention. They are the intended clinical-grade route once the
    workstation GPU is available. Neither is run in tests.
  * **CPU baselines**: reference labels (KiTS23), an interactive region-grow
    from a seed point, and threshold-based contrast-vessel extraction. The
    baselines exist so the whole planning chain can run and be scored on a
    laptop, and so the value of a trained model over a naive rule is
    measurable rather than assumed.

Label convention: 0 background, 1 kidney, 2 tumour, 3 cyst; vessels are a
separate boolean mask (arterial vs venous needs a dedicated arterial phase).
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage

from .io import Volume, load_nifti, resample_labels_to
from .postprocess import KIDNEY, TUMOUR, CYST, keep_largest

# TotalSegmentator (v2) ROI names that map onto the KiTS classes.
TS_KIDNEY = ["kidney_left", "kidney_right"]
TS_CYST = ["kidney_cyst_left", "kidney_cyst_right"]
TS_VESSELS = ["aorta", "inferior_vena_cava"]


def from_reference(seg_path: Path) -> Volume:
    """KiTS-style reference labels (or any model output already in that convention)."""
    return load_nifti(seg_path, dtype=np.uint8)


# ---------------------------------------------------------------------------
# GPU model wrappers (subprocess; not executed in tests)
# ---------------------------------------------------------------------------
def totalsegmentator(ct_path: Path, out_dir: Path, fast: bool = False) -> dict[str, Path]:
    """Run TotalSegmentator for kidneys, kidney cysts and the great vessels.
    Returns {roi: nifti path}. Requires the `TotalSegmentator` CLI on PATH (GPU)."""
    if not shutil.which("TotalSegmentator"):
        raise RuntimeError("TotalSegmentator is not on PATH (install it in the GPU environment)")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["TotalSegmentator", "-i", str(ct_path), "-o", str(out_dir),
           "--roi_subset", *TS_KIDNEY, *TS_CYST, *TS_VESSELS]
    if fast:
        cmd.append("--fast")
    subprocess.run(cmd, check=True)
    return {p.stem.replace(".nii", ""): p for p in out_dir.glob("*.nii.gz")}


def labels_from_totalsegmentator(roi_paths: dict[str, Path], like: Volume) -> Volume:
    """Assemble KiTS-style labels from TotalSegmentator ROIs on the CT grid.
    TotalSegmentator has no tumour class: the tumour must come from nnU-Net
    or a reference label and be merged afterwards (see merge_tumour)."""
    lab = np.zeros(like.data.shape, np.uint8)
    for roi, cls in [(r, KIDNEY) for r in TS_KIDNEY] + [(r, CYST) for r in TS_CYST]:
        p = roi_paths.get(roi)
        if p is None:
            continue
        m = resample_labels_to(load_nifti(p, dtype=np.uint8), like) > 0
        lab[m] = cls
    return Volume(lab, like.affine, {"source": "TotalSegmentator"})


def nnunet_predict(ct_path: Path, out_dir: Path, task: str = "Task135_KiTS2021",
                   folds: str = "0 1 2 3 4") -> Path:
    """Run nnU-Net v1 inference (the model benchmarked in research/kits23-feasibility).
    Requires nnUNet_predict on PATH and RESULTS_FOLDER set. Returns the label NIfTI."""
    if not shutil.which("nnUNet_predict"):
        raise RuntimeError("nnUNet_predict is not on PATH (see research/kits23-feasibility/README.md)")
    if not os.environ.get("RESULTS_FOLDER"):
        raise RuntimeError("RESULTS_FOLDER is not set for nnU-Net")
    in_dir = Path(out_dir) / "input"
    in_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(ct_path, in_dir / "case_0000.nii.gz")
    pred_dir = Path(out_dir) / "pred"
    subprocess.run(["nnUNet_predict", "-i", str(in_dir), "-o", str(pred_dir), "-t", task,
                    "-m", "3d_fullres", "-f", *folds.split(), "--disable_tta"], check=True)
    return pred_dir / "case.nii.gz"


def merge_tumour(base: Volume, tumour_labels: Volume) -> Volume:
    """Overlay the tumour class from one label volume onto another."""
    t = resample_labels_to(tumour_labels, base) == TUMOUR
    out = base.data.copy()
    out[t] = TUMOUR
    return Volume(out, base.affine, {**base.meta, "tumour_source": tumour_labels.meta.get("source")})


# ---------------------------------------------------------------------------
# CPU baselines
# ---------------------------------------------------------------------------
def region_grow_kidney(ct: Volume, seed_ras_mm, hu_lo: float = 90.0, hu_hi: float = 400.0,
                       radius_mm: float = 90.0, close_iter: int = 2) -> np.ndarray:
    """Semi-automatic baseline: connected HU window around a seed inside the
    kidney, limited to a sphere, closed and hole-filled. Deliberately naive; it
    is the yardstick a trained model has to beat."""
    inv = np.linalg.inv(ct.affine)
    seed_vox = np.rint(inv @ np.array([*seed_ras_mm, 1.0]))[:3].astype(int)
    sp = np.asarray(ct.spacing)
    idx = np.indices(ct.data.shape).astype(np.float32)
    for a in range(3):
        idx[a] = (idx[a] - seed_vox[a]) * sp[a]
    sphere = (idx ** 2).sum(0) <= radius_mm ** 2
    cand = (ct.data >= hu_lo) & (ct.data <= hu_hi) & sphere
    cand = ndimage.binary_opening(cand, iterations=1)
    lab, n = ndimage.label(cand)
    if n == 0 or not cand[tuple(seed_vox)]:
        # fall back to the largest component if the seed missed
        return keep_largest(cand, 1)
    m = lab == lab[tuple(seed_vox)]
    m = ndimage.binary_closing(m, iterations=close_iter)
    return ndimage.binary_fill_holes(m)


def extract_vessels(ct: Volume, kidney: np.ndarray, hu_min: float = 180.0,
                    reach_mm: float = 30.0, min_ml: float = 0.2) -> np.ndarray:
    """Contrast-filled vessels around the hilum on an enhanced phase: bright
    voxels within `reach_mm` of the kidney but outside the parenchyma, kept
    when they form a component of at least `min_ml`. On a corticomedullary
    or arterial phase these are mostly arteries; on a nephrographic phase
    veins join in. Separation needs a dedicated arterial phase."""
    sp = ct.spacing
    vox_ml = float(np.prod(sp)) / 1000.0
    dt = ndimage.distance_transform_edt(~kidney, sampling=sp)
    near = (dt <= reach_mm) & ~ndimage.binary_dilation(kidney, iterations=1)
    cand = (ct.data >= hu_min) & near
    cand = ndimage.binary_opening(cand, iterations=1)
    lab, n = ndimage.label(cand)
    keep = np.zeros_like(cand)
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() * vox_ml >= min_ml:
            keep |= comp
    return keep


def body_outline(ct: Volume, hu_min: float = -400.0) -> np.ndarray:
    body = ct.data > hu_min
    body = ndimage.binary_opening(body, iterations=2)
    body = keep_largest(body, 1)
    for k in range(body.shape[2]):
        body[:, :, k] = ndimage.binary_fill_holes(body[:, :, k])
    return body


def save_labels(vol: Volume, path: Path) -> Path:
    nib.save(nib.Nifti1Image(vol.data.astype(np.uint8), vol.affine), str(path))
    return Path(path)
