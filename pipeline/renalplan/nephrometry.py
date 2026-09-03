"""Nephrometry from masks: R.E.N.A.L. and PADUA components.

Everything is computed geometrically from the kidney and tumour masks (plus a
collecting-system or vessel mask when available). Where the scoring systems
rely on landmarks that are not in the masks, the approximation is stated in
the output so a clinician can see what was assumed:

  * Renal sinus: approximated as the space inside the kidney's convex hull
    that is neither parenchyma nor tumour (sinus fat, pelvis, hilum). With an
    excretory phase the real collecting system replaces it for N and for
    PADUA collecting-system involvement.
  * Polar lines: the planes, perpendicular to the kidney long axis, at the
    upper and lower extent of that sinus region (the medial lip of the sinus).
  * Anterior / posterior: sign of the tumour centroid along the patient's
    anterior axis relative to the kidney's own centroid, after removing the
    component along the kidney long axis.

References: Kutikov & Uzzo, J Urol 2009 (R.E.N.A.L.); Ficarra et al., Eur
Urol 2009 (PADUA). Research and teaching use only.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np
from scipy import ndimage
from scipy.spatial import ConvexHull, Delaunay

from .postprocess import KIDNEY, TUMOUR, CYST, component_sizes


@dataclass
class Geometry:
    """Reusable geometry of the tumour-bearing kidney (all in RAS mm)."""
    kidney: np.ndarray
    tumour: np.ndarray
    sinus: np.ndarray
    spacing: tuple
    affine: np.ndarray
    kidney_centroid: np.ndarray
    long_axis: np.ndarray          # unit vector, pointing superior
    anterior_axis: np.ndarray      # unit vector, patient anterior, orthogonal to long axis
    medial_axis: np.ndarray        # unit vector, from kidney centroid towards the sinus
    polar_lo: float                # sinus extent along the long axis (mm, relative to centroid)
    polar_hi: float
    notes: list = field(default_factory=list)


def _coords_mm(mask: np.ndarray, affine: np.ndarray, max_points: int = 60000) -> np.ndarray:
    idx = np.argwhere(mask)
    if idx.shape[0] > max_points:
        sel = np.random.default_rng(0).choice(idx.shape[0], max_points, replace=False)
        idx = idx[sel]
    hom = np.c_[idx, np.ones(len(idx))]
    return (affine @ hom.T).T[:, :3]


def index_lesion(tumour: np.ndarray) -> tuple[np.ndarray, int]:
    """Largest tumour component (the index lesion) and the number of others."""
    lab, sizes = component_sizes(tumour)
    if sizes.size <= 1:
        return tumour, 0
    return lab == (int(np.argmax(sizes)) + 1), int(sizes.size - 1)


def tumour_bearing_kidney(labels: np.ndarray, spacing, tumour: np.ndarray | None = None) -> np.ndarray:
    """The kidney that carries the (index) tumour: among substantial kidney
    components (at least 10% of the largest, or 20 ml) the one nearest the
    tumour, plus any small fragments of the same kidney within 5 mm of it."""
    kidney = labels == KIDNEY
    tumour = (labels == TUMOUR) if tumour is None else tumour
    lab, sizes = component_sizes(kidney)
    if sizes.size <= 1 or not tumour.any():
        return kidney
    vox_ml = float(np.prod(spacing)) / 1000.0
    floor = min(0.1 * sizes.max(), 20.0 / vox_ml)
    dt = ndimage.distance_transform_edt(~tumour, sampling=spacing)
    best, best_d = None, np.inf
    for i in range(sizes.size):
        if sizes[i] < floor:
            continue
        comp = lab == (i + 1)
        d = dt[comp].min()
        if d < best_d:
            best, best_d = comp, d
    if best is None:
        best = lab == (int(np.argmax(sizes)) + 1)
    near = ndimage.distance_transform_edt(~best, sampling=spacing) <= 5.0
    for i in range(sizes.size):
        comp = lab == (i + 1)
        if sizes[i] < floor and (comp & near).any():
            best = best | comp
    return best


def convex_hull_mask(mask: np.ndarray, affine: np.ndarray, shape) -> np.ndarray:
    """Voxel mask of the convex hull of `mask` (computed on a bounding box)."""
    idx = np.argwhere(mask)
    if idx.shape[0] < 5:
        return mask.copy()
    lo, hi = idx.min(0), idx.max(0) + 1
    sub = mask[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    surf = sub & ~ndimage.binary_erosion(sub)
    pts = np.argwhere(surf).astype(float)
    if pts.shape[0] > 20000:
        pts = pts[np.random.default_rng(0).choice(pts.shape[0], 20000, replace=False)]
    try:
        hull = Delaunay(pts[ConvexHull(pts).vertices])
    except Exception:
        return mask.copy()
    grid = np.indices(sub.shape).reshape(3, -1).T.astype(float)
    inside = hull.find_simplex(grid) >= 0
    out = np.zeros(shape, bool)
    out[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = inside.reshape(sub.shape)
    return out


def build_geometry(labels: np.ndarray, affine: np.ndarray, spacing,
                   collecting: np.ndarray | None = None) -> Geometry:
    notes = []
    tumour, n_other = index_lesion(labels == TUMOUR)
    if n_other:
        notes.append(f"{n_other} additional tumour component(s) present; scores refer to the largest (index) lesion.")
    kidney = tumour_bearing_kidney(labels, spacing, tumour)
    outline = kidney | tumour
    hull = convex_hull_mask(outline, affine, labels.shape)
    cavity = hull & ~outline
    # Keep only the deep medial concavity: open the cavity with a physical 4 mm
    # radius so the thin rind the hull adds over convex surfaces, and narrow
    # gaps beside the tumour, are discarded. Falls back to the raw cavity.
    if cavity.any():
        core = ndimage.distance_transform_edt(cavity, sampling=spacing) >= 4.0
        sinus = (ndimage.distance_transform_edt(~core, sampling=spacing) <= 4.0) & cavity if core.any() else cavity
    else:
        sinus = cavity
    lab, sizes = component_sizes(sinus)
    if sizes.size > 1:
        sinus = lab == (int(np.argmax(sizes)) + 1)
    if collecting is not None and collecting.any():
        notes.append("Collecting system from an excretory phase used for N and sinus involvement.")
    else:
        notes.append("Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour.")

    if kidney.sum() < 50:
        raise ValueError("no usable kidney parenchyma in the label map (fewer than 50 voxels)")
    if tumour.sum() < 10:
        raise ValueError("no tumour in the label map; nephrometry needs a tumour label (2)")
    pts = _coords_mm(kidney, affine)
    c = pts.mean(0)
    cov = np.cov((pts - c).T)
    w, v = np.linalg.eigh(cov)
    long_axis = v[:, np.argmax(w)]
    if long_axis[2] < 0:
        long_axis = -long_axis
    ant = np.array([0.0, 1.0, 0.0])
    ant = ant - ant.dot(long_axis) * long_axis
    ant /= np.linalg.norm(ant) or 1.0
    if sinus.any():
        sc = _coords_mm(sinus, affine).mean(0)
        med = sc - c
    else:
        med = np.array([-np.sign(c[0]) or 1.0, 0.0, 0.0])
        notes.append("No sinus region found; medial axis assumed towards the midline.")
    med = med - med.dot(long_axis) * long_axis
    med /= np.linalg.norm(med) or 1.0
    if sinus.any():
        s_along = (_coords_mm(sinus, affine) - c) @ long_axis
        polar_lo, polar_hi = float(np.percentile(s_along, 5)), float(np.percentile(s_along, 95))
    else:
        k_along = (pts - c) @ long_axis
        polar_lo, polar_hi = float(np.percentile(k_along, 30)), float(np.percentile(k_along, 70))
        notes.append("Polar lines assumed at 30/70% of kidney length.")
    return Geometry(kidney, tumour, sinus, tuple(spacing), affine, c, long_axis, ant, med,
                    polar_lo, polar_hi, notes)


def max_diameter_mm(mask: np.ndarray, affine: np.ndarray) -> float:
    """Longest axis of the mask: extent along its principal component plus the
    max pairwise distance of hull vertices (the latter is exact for convex shapes)."""
    surf = mask & ~ndimage.binary_erosion(mask)
    pts = _coords_mm(surf, affine, max_points=8000)
    if pts.shape[0] < 2:
        return 0.0
    try:
        hv = pts[ConvexHull(pts).vertices]
    except Exception:
        hv = pts
    d = np.sqrt(((hv[:, None, :] - hv[None, :, :]) ** 2).sum(-1))
    return float(d.max())


def _dist_mm(src: np.ndarray, target: np.ndarray, spacing) -> float:
    if not src.any() or not target.any():
        return float("nan")
    dt = ndimage.distance_transform_edt(~target, sampling=spacing)
    return float(dt[src].min())


@dataclass
class RenalScore:
    radius_cm: float
    radius_pts: int
    exophytic_fraction: float
    exophytic_pts: int
    nearness_mm: float
    nearness_pts: int
    ap: str
    location_pts: int
    location_detail: str
    hilar: bool
    total: int
    complexity: str
    notes: list

    def as_dict(self) -> dict:
        return asdict(self)

    def label(self) -> str:
        return f"{self.total}{self.ap}{'h' if self.hilar else ''}"


@dataclass
class PaduaScore:
    polar_location: str
    polar_pts: int
    exophytic_pts: int
    rim: str
    rim_pts: int
    sinus_involved: bool
    sinus_pts: int
    collecting_involved: bool | None
    collecting_pts: int
    size_pts: int
    total: int
    complexity: str

    def as_dict(self) -> dict:
        return asdict(self)


def renal_score(g: Geometry, collecting: np.ndarray | None = None,
                vessels: np.ndarray | None = None) -> RenalScore:
    notes = list(g.notes)
    sp = g.spacing
    # R
    dmm = max_diameter_mm(g.tumour, g.affine)
    r_cm = dmm / 10.0
    r_pts = 1 if r_cm <= 4 else (2 if r_cm <= 7 else 3)
    # E: fraction of tumour outside the convex hull of the parenchyma alone
    hull_k = convex_hull_mask(g.kidney, g.affine, g.kidney.shape)
    inside = (g.tumour & hull_k).sum()
    exo = 1.0 - inside / max(1, g.tumour.sum())
    e_pts = 1 if exo >= 0.5 else (2 if exo > 0.05 else 3)
    # N: distance to collecting system if known, else to the sinus region
    target = collecting if (collecting is not None and collecting.any()) else g.sinus
    n_mm = _dist_mm(g.tumour, target, sp)
    if n_mm != n_mm:
        n_pts, notes = 1, notes + ["No sinus or collecting system found; N scored 1."]
    else:
        n_pts = 1 if n_mm >= 7 else (2 if n_mm > 4 else 3)
    # A
    tc = _coords_mm(g.tumour, g.affine).mean(0)
    a_off = float((tc - g.kidney_centroid) @ g.anterior_axis)
    ap = "a" if a_off > 5 else ("p" if a_off < -5 else "x")
    # L: tumour extent along the long axis vs polar lines
    t_along = (_coords_mm(g.tumour, g.affine) - g.kidney_centroid) @ g.long_axis
    t_lo, t_hi = float(np.percentile(t_along, 2)), float(np.percentile(t_along, 98))
    between = float(((t_along >= g.polar_lo) & (t_along <= g.polar_hi)).mean())
    crosses_mid = t_lo < 0 < t_hi
    if t_hi <= g.polar_lo or t_lo >= g.polar_hi:
        l_pts, l_detail = 1, "entirely above or below the polar lines"
    elif between > 0.5 or crosses_mid or (t_lo >= g.polar_lo and t_hi <= g.polar_hi):
        l_pts, l_detail = 3, ("entirely between the polar lines" if (t_lo >= g.polar_lo and t_hi <= g.polar_hi)
                              else ("crosses the axial renal midline" if crosses_mid else "more than 50% across a polar line"))
    else:
        l_pts, l_detail = 2, "crosses a polar line"
    hilar = False
    if vessels is not None and vessels.any():
        hilar = _dist_mm(g.tumour, vessels, sp) <= 2.0
    else:
        notes.append("No vessel mask; hilar suffix not assessed.")
    total = r_pts + e_pts + n_pts + l_pts
    cx = "low" if total <= 6 else ("moderate" if total <= 9 else "high")
    return RenalScore(round(r_cm, 2), r_pts, round(exo, 3), e_pts, round(n_mm, 1) if n_mm == n_mm else n_mm,
                      n_pts, ap, l_pts, l_detail, hilar, total, cx, notes)


def padua_score(g: Geometry, renal: RenalScore, collecting: np.ndarray | None = None) -> PaduaScore:
    sp = g.spacing
    t_along = (_coords_mm(g.tumour, g.affine) - g.kidney_centroid) @ g.long_axis
    t_lo, t_hi = float(np.percentile(t_along, 2)), float(np.percentile(t_along, 98))
    if t_hi <= g.polar_lo or t_lo >= g.polar_hi:
        polar, p_pts = ("inferior" if t_hi <= g.polar_lo else "superior"), 1
    else:
        polar, p_pts = "middle", 2
    e_pts = 1 if renal.exophytic_fraction >= 0.5 else (2 if renal.exophytic_fraction > 0.05 else 3)
    tc = _coords_mm(g.tumour, g.affine).mean(0)
    m_off = float((tc - g.kidney_centroid) @ g.medial_axis)
    rim, rim_pts = ("medial", 2) if m_off > 0 else ("lateral", 1)
    sinus_inv = bool((g.tumour & ndimage.binary_dilation(g.sinus, iterations=1)).any()) if g.sinus.any() else False
    s_pts = 2 if sinus_inv else 1
    if collecting is not None and collecting.any():
        cs_inv = bool((g.tumour & ndimage.binary_dilation(collecting, iterations=1)).any())
        c_pts = 2 if cs_inv else 1
    else:
        cs_inv, c_pts = None, 1
    size_pts = 1 if renal.radius_cm <= 4 else (2 if renal.radius_cm <= 7 else 3)
    total = p_pts + e_pts + rim_pts + s_pts + c_pts + size_pts
    cx = "low" if total <= 7 else ("intermediate" if total <= 9 else "high")
    return PaduaScore(polar, p_pts, e_pts, rim, rim_pts, sinus_inv, s_pts, cs_inv, c_pts, size_pts, total, cx)
