"""Nephrometry from masks: R.E.N.A.L. and PADUA components.

Everything is computed geometrically from the kidney and tumour masks (plus a
collecting-system or vessel mask when available). Where the scoring systems
rely on landmarks that are not in the masks, the approximation is stated in
the output so a clinician can see what was assumed:

  * Renal sinus: approximated as the space inside the kidney's convex hull
    that is neither parenchyma nor tumour (sinus fat, pelvis, hilum). With an
    excretory phase the real collecting system replaces it for N and for
    PADUA collecting-system involvement.
    The cavity is opened with a 4 mm ball and cut to its largest piece, so
    anything narrower than about 8 mm, such as an infundibulum, is dropped and
    N can read long.
  * Polar lines: the planes, perpendicular to the kidney long axis, at the
    5th and 95th percentiles of that sinus region along the axis, standing in
    for the upper and lower limits of the hilum. A real hilum straddles the
    kidney's middle, so when the estimate spans less than 20 mm or sits to one
    side of the centroid, the lines go where 30% of the kidney's volume lies
    beyond each (its 30th and 70th percentiles along the axis) and the output
    says so. On the KiTS23 kidneys those planes land roughly a third and two
    thirds of the way along, not at 30% and 70% of the length.
    Both scoring systems set their lines on axial CT slices, and differently:
    R.E.N.A.L. where the medial lip of parenchyma is broken by the hilum,
    PADUA at the upper and lower margins of the sinus fat. Here one pair of
    planes across the kidney's own long axis serves both, so L and PADUA's
    polar item are approximations for every case, and the output says so.
  * A sinus estimate bigger than a quarter of the kidney, or spanning more
    than half its length, means the kidney isn't the usual shape (a horseshoe
    kidney does this). The lines are still taken from it, but the output flags
    L, N and PADUA's polar, rim and sinus items as unreliable for that kidney.
  * Anterior / posterior: sign of the tumour centroid along the patient's
    anterior axis relative to the kidney's own centroid, after removing the
    component along the kidney long axis.

References: Kutikov & Uzzo, J Urol 2009 (R.E.N.A.L.); Ficarra et al., Eur
Urol 2009 (PADUA); Wood et al., BJU Int 2024 (the more-than-half rule for
PADUA's polar item, from their automated PADUA). Research and teaching use
only.
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
    polar_lo: float                # lower polar line, mm along the long axis from the kidney centroid
    polar_hi: float                # upper polar line (see polar_lines for where they come from)
    notes: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Score cut-offs and rules. Small pure functions so they can be tested alone.
# ---------------------------------------------------------------------------
def renal_r_points(diameter_cm: float) -> int:
    """R.E.N.A.L. R: 4 cm or less = 1, over 4 and under 7 cm = 2, 7 cm or more = 3.
    (PADUA's size item is different: over 7 cm = 3.)"""
    return 1 if diameter_cm <= 4 else (2 if diameter_cm < 7 else 3)


def exophytic_points(exophytic_fraction: float) -> int:
    """R.E.N.A.L. E and PADUA exophytic rate: 50% or more outside = 1, some
    outside = 2, entirely endophytic = 3. A tumour with 5% or less outside the
    parenchyma's convex hull is treated as entirely endophytic."""
    return 1 if exophytic_fraction >= 0.5 else (2 if exophytic_fraction > 0.05 else 3)


def nearness_points(nearness_mm: float) -> int:
    """R.E.N.A.L. N: 7 mm or more = 1, over 4 and under 7 mm = 2, 4 mm or less = 3."""
    return 1 if nearness_mm >= 7 else (2 if nearness_mm > 4 else 3)


def padua_size_points(diameter_cm: float) -> int:
    """PADUA size: 4 cm or less = 1, over 4 up to 7 cm = 2, over 7 cm = 3."""
    return 1 if diameter_cm <= 4 else (2 if diameter_cm <= 7 else 3)


MIN_POLAR_SPAN_MM = 20.0
FALLBACK_PERCENTILES = (30, 70)
# A sinus estimate beyond either limit means the kidney isn't the usual shape.
# In the eight KiTS23 kidneys run so far, the estimates that passed the polar-line
# checks were at most 11% of the kidney's volume and 26% of its length; the one
# horseshoe-shaped kidney came out at 62% and 60%.
MAX_SINUS_VOLUME_FRACTION = 0.25
MAX_SINUS_SPAN_FRACTION = 0.5

# Note text. make_public_summary.py sets its summary flags by matching the
# phrases in the comments, so keep them if the wording changes.
NOTE_POLAR_LINES = (
    "Polar lines here are planes across the kidney's own long axis, not axial CT slices, and one "
    "pair serves both R.E.N.A.L. L and PADUA's polar item, though the two systems define their lines "
    "differently. PADUA's polar item is middle (2) when more than half the tumour lies between the "
    "lines, the rule Wood et al. (BJU Int 2024) used to automate PADUA. So L and PADUA's polar item "
    "are approximations."
)
_FALLBACK_LINES = (
    "polar lines assumed where 30% of the kidney's volume lies beyond each (its 30th and 70th "
    "percentiles along the long axis), so L and PADUA's polar item are approximate."
)
# Both fallback notes contain "polar lines assumed" (summary flag polarLinesAssumed).
NOTE_NO_SINUS_LINES = "No sinus estimate to set the polar lines; " + _FALLBACK_LINES
NOTE_SINUS_TOO_SMALL = (
    "Sinus estimate too short or off-centre to set the polar lines; " + _FALLBACK_LINES
    + " N and PADUA's rim and renal-sinus items still use that estimate, so they are approximate "
    "too, and N can read long."
)
# Contains "sinus estimate implausibly large" (summary flag sinusEstimateTooLarge).
NOTE_SINUS_TOO_LARGE = (
    "Sinus estimate implausibly large ({volume:.0%} of the kidney's volume, spanning {span:.0%} of its "
    "length): the kidney isn't the usual shape, as with a horseshoe or malrotated kidney. The long "
    "axis, polar lines and sinus all rest on that shape, so L, N and PADUA's polar, rim and "
    "renal-sinus items are unreliable for this kidney."
)


def polar_lines(sinus_along: np.ndarray | None, kidney_along: np.ndarray) -> tuple[float, float, bool]:
    """Polar lines along the long axis, in mm from the kidney centroid, and
    whether they came from the sinus estimate. The sinus lines are its 5th and
    95th percentiles. A real hilum straddles the kidney's middle, so an
    estimate that spans less than 20 mm or doesn't straddle the centroid isn't
    used. The lines then go where 30% of the kidney's volume lies beyond each:
    the 30th and 70th percentiles of kidney voxel positions along the axis.
    That is a volume split, not 30% and 70% of the length. On the KiTS23
    kidneys it lands roughly a third and two thirds of the way along, close
    to where the sinus lines sit when the estimate is usable."""
    if sinus_along is not None and sinus_along.size:
        lo, hi = float(np.percentile(sinus_along, 5)), float(np.percentile(sinus_along, 95))
        if hi - lo >= MIN_POLAR_SPAN_MM and lo < 0.0 < hi:
            return lo, hi, True
    p_lo, p_hi = FALLBACK_PERCENTILES
    return float(np.percentile(kidney_along, p_lo)), float(np.percentile(kidney_along, p_hi)), False


def sinus_estimate_too_large(sinus_voxels: int, kidney_voxels: int, span_mm: float,
                             kidney_length_mm: float) -> bool:
    """True when the sinus estimate is more than a quarter of the kidney's
    volume or its 5th to 95th percentile span is more than half the kidney's
    length. A renal sinus is neither, so the kidney isn't the shape the long
    axis, polar lines and sinus estimate assume (a horseshoe kidney, for one)."""
    return (sinus_voxels > MAX_SINUS_VOLUME_FRACTION * kidney_voxels
            or span_mm > MAX_SINUS_SPAN_FRACTION * kidney_length_mm)


def renal_location(t_along: np.ndarray, polar_lo: float, polar_hi: float) -> tuple[int, str]:
    """R.E.N.A.L. L from tumour positions along the long axis (mm from the
    kidney centroid). The tumour's extent is its 2nd to 98th percentile.
    The axial renal midline is the plane half-way between the polar lines, as
    Kutikov and Uzzo define it, not the kidney's centroid.
    3: entirely between the polar lines, crossing that midline, or more than
    half between the lines. 1: entirely above or below the lines. 2: otherwise
    (it crosses a line with half or less between them).
    With the midline between the lines, no tumour meets a 3-point test and the
    1-point test at once, so the order of the tests can't change a score."""
    t_lo, t_hi = float(np.percentile(t_along, 2)), float(np.percentile(t_along, 98))
    between = float(((t_along >= polar_lo) & (t_along <= polar_hi)).mean())
    midline = 0.5 * (polar_lo + polar_hi)
    if t_lo >= polar_lo and t_hi <= polar_hi:
        return 3, "entirely between the polar lines"
    if t_lo < midline < t_hi:
        return 3, "crosses the axial renal midline"
    if between > 0.5:
        return 3, "more than half between the polar lines"
    if t_hi <= polar_lo or t_lo >= polar_hi:
        return 1, "entirely above or below the polar lines"
    return 2, "crosses a polar line"


def padua_polar(t_along: np.ndarray, polar_lo: float, polar_hi: float) -> tuple[str, int]:
    """PADUA polar (longitudinal) location: middle (2) when more than half the
    tumour lies between the lines, otherwise superior or inferior (1), named
    by the pole that holds more of the tumour. Exactly half is polar.
    Ficarra et al. 2009 score superior or inferior 1 and middle 2. The
    more-than-half rule for a tumour that crosses a line is the one Wood et
    al. (BJU Int 2024) used to automate PADUA, and later descriptions of PADUA
    also split crossing tumours at 50% (some count exactly half as middle).
    Ficarra's own wording on crossing tumours
    hasn't been checked (the paper isn't open access). Wood's lines are the
    axial extent of sinus fat on CT. Here they're the same planes as
    R.E.N.A.L. L (see polar_lines), so this is an approximation."""
    between = float(((t_along >= polar_lo) & (t_along <= polar_hi)).mean())
    if between > 0.5:
        return "middle", 2
    above = float((t_along > polar_hi).mean())
    below = float((t_along < polar_lo).mean())
    return ("superior" if above >= below else "inferior"), 1


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
    k_along = (pts - c) @ long_axis
    s_along = ((_coords_mm(sinus, affine) - c) @ long_axis) if sinus.any() else None
    polar_lo, polar_hi, from_sinus = polar_lines(s_along, k_along)
    notes.append(NOTE_POLAR_LINES)
    if not from_sinus:
        notes.append(NOTE_NO_SINUS_LINES if s_along is None else NOTE_SINUS_TOO_SMALL)
    else:
        kidney_length = float(k_along.max() - k_along.min())
        if sinus_estimate_too_large(int(sinus.sum()), int(kidney.sum()), polar_hi - polar_lo, kidney_length):
            notes.append(NOTE_SINUS_TOO_LARGE.format(volume=float(sinus.sum()) / float(kidney.sum()),
                                                     span=(polar_hi - polar_lo) / kidney_length))
    return Geometry(kidney, tumour, sinus, tuple(spacing), affine, c, long_axis, ant, med,
                    polar_lo, polar_hi, notes)


def max_diameter_mm(mask: np.ndarray, affine: np.ndarray) -> float:
    """Maximum diameter of the mask, in mm: the largest pairwise distance between
    surface-voxel centres (up to 8,000 sampled surface voxels, compared over their
    convex hull vertices). Measured centre to centre, so it can read up to about
    one voxel short of the outer extent along that chord, which matters most on
    thick-slice scans."""
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
    # Each measurement is rounded to the precision it's stored and reported at
    # before it's scored, so R.E.N.A.L., PADUA (which reuses these values) and
    # the report can't disagree at a cut-off.
    # R
    dmm = max_diameter_mm(g.tumour, g.affine)
    r_cm = round(dmm / 10.0, 2)
    r_pts = renal_r_points(r_cm)
    # E: fraction of tumour outside the convex hull of the parenchyma alone
    hull_k = convex_hull_mask(g.kidney, g.affine, g.kidney.shape)
    inside = (g.tumour & hull_k).sum()
    exo = round(float(1.0 - inside / max(1, g.tumour.sum())), 3)
    e_pts = exophytic_points(exo)
    # N: distance to collecting system if known, else to the sinus region
    target = collecting if (collecting is not None and collecting.any()) else g.sinus
    n_mm = _dist_mm(g.tumour, target, sp)
    if n_mm != n_mm:
        n_pts, notes = 1, notes + ["No sinus or collecting system found; N scored 1."]
    else:
        n_mm = round(n_mm, 1)
        n_pts = nearness_points(n_mm)
    # A
    tc = _coords_mm(g.tumour, g.affine).mean(0)
    a_off = float((tc - g.kidney_centroid) @ g.anterior_axis)
    ap = "a" if a_off > 5 else ("p" if a_off < -5 else "x")
    # L: tumour extent along the long axis vs polar lines
    t_along = (_coords_mm(g.tumour, g.affine) - g.kidney_centroid) @ g.long_axis
    l_pts, l_detail = renal_location(t_along, g.polar_lo, g.polar_hi)
    hilar = False
    if vessels is not None and vessels.any():
        hilar = _dist_mm(g.tumour, vessels, sp) <= 2.0
    else:
        notes.append("No vessel mask; hilar suffix not assessed.")
    total = r_pts + e_pts + n_pts + l_pts
    cx = "low" if total <= 6 else ("moderate" if total <= 9 else "high")
    return RenalScore(r_cm, r_pts, exo, e_pts, n_mm, n_pts, ap, l_pts, l_detail, hilar, total, cx, notes)


def padua_score(g: Geometry, renal: RenalScore, collecting: np.ndarray | None = None) -> PaduaScore:
    sp = g.spacing
    t_along = (_coords_mm(g.tumour, g.affine) - g.kidney_centroid) @ g.long_axis
    polar, p_pts = padua_polar(t_along, g.polar_lo, g.polar_hi)
    e_pts = exophytic_points(renal.exophytic_fraction)
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
    size_pts = padua_size_points(renal.radius_cm)
    total = p_pts + e_pts + rim_pts + s_pts + c_pts + size_pts
    cx = "low" if total <= 7 else ("intermediate" if total <= 9 else "high")
    return PaduaScore(polar, p_pts, e_pts, rim, rim_pts, sinus_inv, s_pts, cs_inv, c_pts, size_pts, total, cx)
