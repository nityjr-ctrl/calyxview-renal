"""Tests against the synthetic phantom (known geometry), small hand-made masks,
the score cut-offs and rules, and the DICOM identity tripwire."""
from pathlib import Path

import numpy as np
import pytest

from renalplan import io, metrics, postprocess, nephrometry, planning, mesh, phantom
from renalplan.io import Volume


@pytest.fixture(scope="module")
def phantom_case():
    lab, ct, truth = phantom.build()
    return lab, ct, truth, phantom.affine(), phantom.SPACING


def test_dice_and_surface_metrics_on_shifted_cube():
    a = np.zeros((40, 40, 40), bool)
    a[10:30, 10:30, 10:30] = True
    b = np.roll(a, 2, axis=0)
    m = metrics.overlap_metrics(b, a, (1, 1, 1), tolerance_mm=1.0)
    assert 0.85 < m.dice < 0.95
    assert m.hd95_mm == pytest.approx(2.0, abs=0.01)
    assert m.volume_error_ml == pytest.approx(0.0)
    assert 0.0 < m.surface_dice < 1.0


def test_identical_masks_are_perfect():
    a = np.zeros((20, 20, 20), bool)
    a[5:15, 5:15, 5:15] = True
    m = metrics.overlap_metrics(a, a, (1, 1, 1))
    assert m.dice == 1.0 and m.hd95_mm == 0.0 and m.surface_dice == 1.0


def test_postprocess_removes_detached_mass_and_speckle():
    lab = np.zeros((60, 60, 60), np.uint8)
    lab[10:40, 10:40, 10:40] = 1          # kidney
    lab[38:44, 20:26, 20:26] = 2          # tumour touching the kidney
    lab[55:58, 55:58, 55:58] = 2          # detached tumour blob far away
    lab[2:3, 2:3, 2:3] = 1                # kidney speckle
    out = postprocess.apply(lab, (1, 1, 1), postprocess.PostprocessConfig(mass_attach_mm=3.0, kidney_min_ml=0.01))
    assert (out == 1).sum() == 30 ** 3 - 2 * 6 * 6   # tumour wins where it overlaps
    assert (out == 2).sum() == 6 ** 3


def test_phantom_nephrometry_matches_truth(phantom_case):
    lab, ct, truth, aff, sp = phantom_case
    g = nephrometry.build_geometry(lab, aff, sp)
    r = nephrometry.renal_score(g)
    assert r.radius_cm == pytest.approx(truth["tumour_diameter_mm"] / 10, abs=0.15)
    assert r.radius_pts == 1
    assert r.exophytic_fraction == pytest.approx(truth["tumour_exophytic_fraction"], abs=0.12)
    assert r.location_pts == 1            # lower pole, below the polar line
    assert r.total == 4
    # The phantom's hilum is big and central, so its lines come from the sinus.
    assert nephrometry.NOTE_POLAR_LINES in r.notes
    assert not any("polar lines assumed" in n.lower() or "implausibly large" in n.lower() for n in r.notes)
    p = nephrometry.padua_score(g, r)
    assert p.polar_location == "inferior" and p.rim == "lateral"
    # R.E.N.A.L. and PADUA score the same stored (rounded) values.
    assert r.radius_pts == nephrometry.renal_r_points(r.radius_cm)
    assert p.size_pts == nephrometry.padua_size_points(r.radius_cm)
    assert p.exophytic_pts == r.exophytic_pts


def test_phantom_planning_volumes(phantom_case):
    lab, ct, truth, aff, sp = phantom_case
    g = nephrometry.build_geometry(lab, aff, sp)
    m, masks = planning.plan(lab, g, margin_mm=5.0)
    assert m.tumour_ml == pytest.approx(truth["tumour_ml"], rel=0.02)
    assert m.ipsilateral_kidney_ml == pytest.approx(truth["kidney_right_ml"], rel=0.05)
    assert m.contralateral_kidney_ml == pytest.approx(truth["kidney_left_ml"], rel=0.05)
    assert 0.85 < m.preserved_fraction_ipsilateral < 1.0
    assert m.residual_ipsilateral_ml + m.parenchyma_removed_ml == pytest.approx(m.ipsilateral_kidney_ml, rel=1e-6)
    assert masks["margin_envelope"].any()
    m0, _ = planning.plan(lab, g, margin_mm=0.0)
    assert m0.parenchyma_removed_ml == pytest.approx(0.0)


def test_mesh_roundtrip_fidelity(phantom_case):
    lab, ct, truth, aff, sp = phantom_case
    tum = lab == 2
    mm = mesh.mask_to_mesh(tum, aff, mesh.MeshParams(taubin_iter=10, target_faces=4000))
    assert mm is not None and mm.is_watertight
    vol_ml = abs(mm.volume) / 1000.0
    assert vol_ml == pytest.approx(truth["tumour_ml"], rel=0.06)
    f = mesh.fidelity(mm, tum, aff, sp)
    assert f.dice > 0.95 and f.hd95_mm <= 2.0


def test_volume_class_spacing_and_resample(phantom_case):
    lab, ct, truth, aff, sp = phantom_case
    v = Volume(lab, aff)
    assert v.spacing == pytest.approx(sp)
    same = __import__("renalplan.io", fromlist=["resample_labels_to"]).resample_labels_to(v, v)
    assert same is lab


# Score cut-offs, at and either side of each boundary.
@pytest.mark.parametrize("cm,pts", [(4.0, 1), (4.01, 2), (6.99, 2), (7.0, 3)])
def test_renal_r_cutoffs(cm, pts):
    assert nephrometry.renal_r_points(cm) == pts


@pytest.mark.parametrize("cm,pts", [(4.0, 1), (4.01, 2), (7.0, 2), (7.01, 3)])
def test_padua_size_cutoffs(cm, pts):
    assert nephrometry.padua_size_points(cm) == pts


@pytest.mark.parametrize("mm,pts", [(4.0, 3), (4.01, 2), (6.99, 2), (7.0, 1)])
def test_nearness_cutoffs(mm, pts):
    assert nephrometry.nearness_points(mm) == pts


@pytest.mark.parametrize("f,pts", [(0.0, 3), (0.05, 3), (0.051, 2), (0.499, 2), (0.5, 1)])
def test_exophytic_cutoffs(f, pts):
    assert nephrometry.exophytic_points(f) == pts


def test_off_centre_sinus_estimate_is_not_used_for_the_polar_lines():
    # Positions along the long axis in mm from the kidney centroid. The sinus
    # estimate is a sliver above the middle, as it came out for two KiTS23 kidneys.
    kidney_along = np.linspace(-50, 50, 1001)
    sliver = np.linspace(8, 20, 200)
    lo, hi, from_sinus = nephrometry.polar_lines(sliver, kidney_along)
    assert not from_sinus and lo < 0 < hi
    assert lo == pytest.approx(-20, abs=0.5) and hi == pytest.approx(20, abs=0.5)
    # A tumour reaching up to the kidney's middle isn't polar (L 1).
    tumour_along = np.linspace(-26, -1, 500)
    assert nephrometry.renal_location(tumour_along, lo, hi)[0] != 1
    # The sliver's own lines would have scored it 1.
    s_lo, s_hi = float(np.percentile(sliver, 5)), float(np.percentile(sliver, 95))
    assert nephrometry.renal_location(tumour_along, s_lo, s_hi)[0] == 1
    # A usable estimate is kept.
    good = np.linspace(-15, 15, 300)
    assert nephrometry.polar_lines(good, kidney_along)[2]


def _spread(lo, hi, n=90):
    """Positions whose 5th and 95th percentiles are exactly lo and hi."""
    return np.r_[np.full(5, float(lo)), np.linspace(lo, hi, n), np.full(5, float(hi))]


def test_sinus_lines_need_an_estimate_that_straddles_the_middle_and_spans_20_mm():
    kidney_along = np.linspace(-50, 50, 1001)
    lo, hi, from_sinus = nephrometry.polar_lines(_spread(-8, 12), kidney_along)
    assert from_sinus and lo == pytest.approx(-8) and hi == pytest.approx(12)   # exactly 20 mm is enough
    assert not nephrometry.polar_lines(_spread(-8, 11.9), kidney_along)[2]      # 19.9 mm, though it straddles
    assert not nephrometry.polar_lines(_spread(2, 32), kidney_along)[2]         # 30 mm, all above the middle
    assert not nephrometry.polar_lines(_spread(0, 25), kidney_along)[2]         # touching the middle isn't straddling
    assert not nephrometry.polar_lines(None, kidney_along)[2]


def test_fallback_polar_lines_split_the_kidney_by_volume_not_length():
    # An ellipsoid has more of its volume near the middle, so the planes with
    # 30% of the volume beyond each sit nearer the middle than 30% and 70% of
    # the length (-20 and +20 mm here).
    z = np.linspace(-50, 50, 2001)
    kidney_along = np.repeat(z, np.rint(50 * (1 - (z / 50) ** 2)).astype(int))
    lo, hi, from_sinus = nephrometry.polar_lines(None, kidney_along)
    assert not from_sinus
    assert lo == pytest.approx(np.percentile(kidney_along, 30))
    assert hi == pytest.approx(np.percentile(kidney_along, 70))
    assert -20 < lo < -10 and 10 < hi < 20


def test_the_axial_midline_is_half_way_between_the_polar_lines():
    # Lines at 8 and 20 mm put the midline at 14 mm, so a tumour from -10 to
    # 5 mm lies entirely below the lower line (L 1), though it crosses the
    # kidney's centroid.
    assert nephrometry.renal_location(np.linspace(-10, 5, 300), 8.0, 20.0) == (
        1, "entirely above or below the polar lines")
    # Lines at -20 and +10 mm put it at -5 mm. A tumour from -40 to -4 mm
    # crosses it, so it scores 3 with less than half of it between the lines.
    t = np.linspace(-40, -4, 361)
    assert ((t >= -20) & (t <= 10)).mean() < 0.5
    assert nephrometry.renal_location(t, -20.0, 10.0) == (3, "crosses the axial renal midline")


def test_exactly_half_between_the_lines_is_polar_for_padua_and_l2_for_renal():
    lo, hi = -15.0, 15.0
    t = np.r_[np.linspace(-30, -16, 50), np.linspace(-14, -6, 50)]
    assert ((t >= lo) & (t <= hi)).mean() == 0.5
    assert nephrometry.padua_polar(t, lo, hi) == ("inferior", 1)
    assert nephrometry.renal_location(t, lo, hi) == (2, "crosses a polar line")
    # One more point between the lines tips both over.
    t2 = np.r_[t, -10.0]
    assert nephrometry.padua_polar(t2, lo, hi) == ("middle", 2)
    assert nephrometry.renal_location(t2, lo, hi) == (3, "more than half between the polar lines")


def test_a_sinus_estimate_too_big_for_a_renal_sinus_is_flagged():
    # KiTS23 kidneys whose estimates passed the polar-line checks reached 11%
    # of the kidney's volume and 26% of its length; the horseshoe-shaped one
    # came out at 62% and 60%.
    assert not nephrometry.sinus_estimate_too_large(112, 1000, 29.5, 114.2)
    assert nephrometry.sinus_estimate_too_large(623, 1000, 96.9, 160.2)
    assert nephrometry.sinus_estimate_too_large(100, 1000, 70.0, 120.0)   # long but not bulky
    assert nephrometry.sinus_estimate_too_large(300, 1000, 30.0, 120.0)   # bulky but short


def _load_summary_script():
    import importlib.util
    path = Path(__file__).resolve().parents[1] / "scripts" / "make_public_summary.py"
    spec = importlib.util.spec_from_file_location("make_public_summary", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_note_text_carries_the_phrases_the_summary_and_site_match():
    summary = _load_summary_script()
    always = nephrometry.NOTE_POLAR_LINES.lower()
    assert summary.POLAR_LINES_ASSUMED not in always and summary.SINUS_TOO_LARGE not in always
    for note in (nephrometry.NOTE_NO_SINUS_LINES, nephrometry.NOTE_SINUS_TOO_SMALL):
        assert summary.POLAR_LINES_ASSUMED in note.lower()
    # scripts/make-reference-cases.mjs turns this note into the viewer's note.
    assert "sinus estimate too short or off-centre" in nephrometry.NOTE_SINUS_TOO_SMALL.lower()
    big = nephrometry.NOTE_SINUS_TOO_LARGE.format(volume=0.62, span=0.6).lower()
    assert summary.SINUS_TOO_LARGE in big and summary.POLAR_LINES_ASSUMED not in big


def _notched_kidney(notch_z: float):
    """A 50 x 30 x 100 mm ellipsoid kidney on a 1 mm grid, with a round notch
    in its medial (-x) side at height notch_z and a small tumour inside the
    lower pole. The notch is the only concavity, so it becomes the sinus estimate."""
    shape = (70, 50, 130)
    i, j, k = np.ogrid[: shape[0], : shape[1], : shape[2]]
    x, y, z = i - 35.0, j - 25.0, k - 65.0
    kidney = (x / 25) ** 2 + (y / 15) ** 2 + (z / 50) ** 2 <= 1
    x_edge = -25 * np.sqrt(1 - (notch_z / 50) ** 2)
    notch = (x - x_edge) ** 2 + y ** 2 + (z - notch_z) ** 2 <= 12 ** 2
    lab = np.zeros(shape, np.uint8)
    lab[kidney & ~notch] = 1
    lab[kidney & ((x - 8) ** 2 + y ** 2 + (z + 30) ** 2 <= 7 ** 2)] = 2
    return lab, np.eye(4), (1.0, 1.0, 1.0)


def test_build_geometry_uses_the_fallback_lines_for_a_small_off_centre_sinus():
    summary = _load_summary_script()
    lab, aff, sp = _notched_kidney(notch_z=25.0)
    g = nephrometry.build_geometry(lab, aff, sp)
    assert g.sinus.any()
    notes = " ".join(g.notes).lower()
    assert "sinus estimate too short or off-centre" in notes
    assert summary.POLAR_LINES_ASSUMED in notes and summary.SINUS_TOO_LARGE not in notes
    k_along = (nephrometry._coords_mm(g.kidney, aff) - g.kidney_centroid) @ g.long_axis
    assert g.polar_lo == pytest.approx(np.percentile(k_along, 30))
    assert g.polar_hi == pytest.approx(np.percentile(k_along, 70))


def test_default_case_id():
    from renalplan.cli import default_case_id
    assert default_case_id(Path("kits") / "case_00000" / "segmentation.nii.gz") == "case_00000"
    assert default_case_id("pred.nii.gz") == "pred"
    assert default_case_id("pred.nii") == "pred"


def test_padua_polar_needs_more_than_half_between_the_lines():
    lo, hi = -15.0, 15.0
    # 20% between the lines, the rest below: R.E.N.A.L. L 2, PADUA inferior (1).
    mostly_below = np.r_[np.linspace(-40, -16, 80), np.linspace(-14, -5, 20)]
    assert nephrometry.renal_location(mostly_below, lo, hi)[0] == 2
    assert nephrometry.padua_polar(mostly_below, lo, hi) == ("inferior", 1)
    mostly_above = -mostly_below
    assert nephrometry.padua_polar(mostly_above, lo, hi) == ("superior", 1)
    # 80% between the lines: PADUA middle (2).
    mostly_between = np.r_[np.linspace(-20, -16, 20), np.linspace(-14, 10, 80)]
    assert nephrometry.padua_polar(mostly_between, lo, hi) == ("middle", 2)


def test_identity_tripwire():
    from pydicom.dataset import Dataset
    ds = Dataset()
    assert io.identity_audit(ds)["ok"] is True
    ds.PatientName = "Test^Synthetic"
    audit = io.identity_audit(ds)
    assert audit["ok"] is False and audit["identifiersPresent"] == ["PatientName"]
    ds.PatientIdentityRemoved = "YES"
    assert io.identity_audit(ds)["ok"] is True
