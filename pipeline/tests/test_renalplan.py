"""Tests against the synthetic phantom (known geometry) and small hand-made masks."""
from pathlib import Path

import numpy as np
import pytest

from renalplan import metrics, postprocess, nephrometry, planning, mesh, phantom
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
    p = nephrometry.padua_score(g, r)
    assert p.polar_location == "inferior" and p.rim == "lateral"


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
