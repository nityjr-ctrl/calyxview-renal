"""Configurable clean-up rules for kidney / tumour / cyst label maps.

These are the knobs the `optimise-postprocess` command sweeps. Each rule is
deliberately simple and explainable: a surgeon or radiologist can read the
config and know exactly what was done to the model output.

Label convention (KiTS23): 0 background, 1 kidney, 2 tumour, 3 cyst.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
from scipy import ndimage

KIDNEY, TUMOUR, CYST = 1, 2, 3


@dataclass
class PostprocessConfig:
    """Rules applied in order. Volumes in ml, distances in mm."""
    # kidney: keep the N largest connected components (two kidneys), drop tiny bits
    kidney_max_components: int = 2
    kidney_min_ml: float = 15.0
    # masses (tumour + cyst): drop components smaller than this
    mass_min_ml: float = 0.05
    # masses must sit within this distance of the kidney (0 disables the rule)
    mass_attach_mm: float = 5.0
    # fill internal holes in the kidney+mass region
    fill_holes: bool = True
    # binary opening radius (voxels) on the kidney to cut thin bridges (0 disables)
    kidney_open_iter: int = 0

    def as_dict(self) -> dict:
        return asdict(self)

    def name(self) -> str:
        return (f"k{self.kidney_max_components}_kmin{self.kidney_min_ml:g}_mmin{self.mass_min_ml:g}"
                f"_att{self.mass_attach_mm:g}_fill{int(self.fill_holes)}_open{self.kidney_open_iter}")


def component_sizes(mask: np.ndarray):
    lab, n = ndimage.label(mask)
    if n == 0:
        return lab, np.array([], int)
    sizes = ndimage.sum(mask, lab, range(1, n + 1)).astype(int)
    return lab, sizes


def keep_largest(mask: np.ndarray, n: int, min_voxels: int = 0) -> np.ndarray:
    lab, sizes = component_sizes(mask)
    if sizes.size == 0:
        return mask
    order = np.argsort(sizes)[::-1]
    keep = np.zeros_like(mask, bool)
    for rank, idx in enumerate(order):
        if rank >= n or sizes[idx] < min_voxels:
            break
        keep |= lab == (idx + 1)
    return keep


def remove_small(mask: np.ndarray, min_voxels: int) -> np.ndarray:
    lab, sizes = component_sizes(mask)
    keep = np.zeros_like(mask, bool)
    for i, s in enumerate(sizes):
        if s >= min_voxels:
            keep |= lab == (i + 1)
    return keep


def attach_to(mask: np.ndarray, anchor: np.ndarray, max_mm: float, spacing) -> np.ndarray:
    """Keep only components of `mask` within `max_mm` of `anchor`."""
    if not anchor.any() or not mask.any():
        return np.zeros_like(mask, bool)
    dt = ndimage.distance_transform_edt(~anchor, sampling=spacing)
    lab, sizes = component_sizes(mask)
    keep = np.zeros_like(mask, bool)
    for i in range(sizes.size):
        comp = lab == (i + 1)
        if dt[comp].min() <= max_mm:
            keep |= comp
    return keep


def fill_holes_3d(mask: np.ndarray) -> np.ndarray:
    return ndimage.binary_fill_holes(mask)


def apply(labels: np.ndarray, spacing, cfg: PostprocessConfig) -> np.ndarray:
    """Return a cleaned copy of a KiTS-style label map."""
    vox_ml = float(np.prod(spacing)) / 1000.0
    kidney = labels == KIDNEY
    tumour = labels == TUMOUR
    cyst = labels == CYST

    if cfg.kidney_open_iter > 0:
        kidney = ndimage.binary_opening(kidney, iterations=cfg.kidney_open_iter)
    kidney = keep_largest(kidney, cfg.kidney_max_components,
                          min_voxels=int(round(cfg.kidney_min_ml / vox_ml)))

    min_mass = int(round(cfg.mass_min_ml / vox_ml))
    tumour = remove_small(tumour, min_mass)
    cyst = remove_small(cyst, min_mass)
    if cfg.mass_attach_mm > 0:
        tumour = attach_to(tumour, kidney, cfg.mass_attach_mm, spacing)
        cyst = attach_to(cyst, kidney, cfg.mass_attach_mm, spacing)

    if cfg.fill_holes:
        region = fill_holes_3d(kidney | tumour | cyst)
        # holes become kidney unless they were mass
        kidney = kidney | (region & ~tumour & ~cyst)

    out = np.zeros_like(labels, dtype=np.uint8)
    out[kidney] = KIDNEY
    out[cyst] = CYST
    out[tumour] = TUMOUR   # tumour wins where labels overlap
    return out


DEFAULT_GRID = {
    "kidney_max_components": [2],
    "kidney_min_ml": [0.0, 15.0],
    "mass_min_ml": [0.0, 0.05],
    "mass_attach_mm": [0.0, 5.0, 10.0],
    "fill_holes": [False, True],
    "kidney_open_iter": [0],
}


def grid(overrides: dict | None = None) -> list[PostprocessConfig]:
    from itertools import product
    g = {**DEFAULT_GRID, **(overrides or {})}
    keys = list(g)
    return [PostprocessConfig(**dict(zip(keys, vals))) for vals in product(*[g[k] for k in keys])]
