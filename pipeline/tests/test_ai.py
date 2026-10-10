"""Spatial/provenance failure cases for drafts; synthetic arrays are not AI evidence."""
import json
from argparse import Namespace
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest

from renalplan import ai
from renalplan.io import Volume


def volume(data=None, affine=None):
    return Volume(np.zeros((24, 24, 24), np.float32) if data is None else data,
                  np.eye(4) if affine is None else affine)


def test_kipa_convention_keeps_vein_and_artery_distinct():
    labels = np.zeros((24, 24, 24), np.uint8)
    labels[1, 1, 1], labels[2, 2, 2], labels[3, 3, 3], labels[4, 4, 4] = 1, 2, 3, 4
    masks = ai.kipa_masks(volume(labels), volume())
    assert masks["renal_vein"][1, 1, 1] and masks["kidney"][2, 2, 2]
    assert masks["renal_artery"][3, 3, 3] and masks["tumour"][4, 4, 4]
    assert sum(m.sum() for m in masks.values()) == 4


@pytest.mark.parametrize("label", [5, -1, .5, np.nan])
def test_unexpected_labels_cannot_be_reinterpreted(label):
    labels = volume(); labels.data[0, 0, 0] = label
    with pytest.raises(ValueError): ai.kipa_masks(labels, volume())


def test_prediction_grid_mismatch_is_not_silently_resampled():
    shifted = np.eye(4); shifted[0, 3] = 1
    with pytest.raises(ValueError): ai.kipa_masks(volume(affine=shifted), volume())


def test_renal_crop_restores_labels_to_original_physical_grid():
    affine = np.diag([.8, 1.2, 2., 1.]); affine[:3, 3] = [10, -40, 30]
    reference = volume(affine=affine)
    coarse = np.zeros(reference.data.shape, bool); coarse[8:14, 9:15, 10:16] = True
    crop, lo, hi = ai.crop_volume(reference, coarse, margin_mm=1.)
    labels = np.zeros(crop.data.shape, np.uint8); labels[3, 3, 3] = 4
    restored = ai.restore_crop(Volume(labels, crop.affine), crop, reference, lo, hi)
    assert ai.same_grid(restored, reference)
    assert restored.data[tuple(lo + 3)] == 4 and restored.data.sum() == 4
    assert np.allclose((crop.affine @ [3, 3, 3, 1])[:3], (reference.affine @ np.r_[lo + 3, 1])[:3])


def test_empty_localisation_cannot_turn_into_guessed_roi():
    with pytest.raises(ValueError, match="localisation"):
        ai.crop_volume(volume(), np.zeros((24, 24, 24), bool))


def test_checkpoint_intensity_adapter_preserves_original_hu_and_geometry():
    source = volume(); source.data[:] = -1024; source.data[10, 10, 10] = 125
    adapted = ai.model_input(source, 1024)
    assert source.data[0, 0, 0] == -1024 and source.data[10, 10, 10] == 125
    assert adapted.data[0, 0, 0] == 0 and adapted.data[10, 10, 10] == 1149
    assert ai.same_grid(source, adapted) and not np.shares_memory(source.data, adapted.data)
    with pytest.raises(ValueError): ai.model_input(source, 1000)


def test_kits_tissue_mapping_cannot_use_kipa_convention():
    from renalplan.ai_tissue import kits_masks
    labels = volume(); labels.data[2, 2, 2] = 1; labels.data[3, 3, 3] = 2; labels.data[4, 4, 4] = 3
    result = kits_masks(labels, volume())
    assert result["kidney"][2, 2, 2] and result["tumour"][3, 3, 3]
    assert not result["kidney"][4, 4, 4] and not result["tumour"][4, 4, 4]
    labels.data[5, 5, 5] = 4
    with pytest.raises(ValueError): kits_masks(labels, volume())


def test_collecting_phase_gate_rejects_bright_parenchyma():
    ct = volume(); ct.data[:] = 700
    kidney = np.ones(ct.data.shape, bool)
    mask, report = ai.contrast_lumen(ct, kidney, np.zeros_like(kidney), "nephrographic")
    assert not mask.any() and report["status"] == "not_assessed"


def test_collecting_keeps_gaps_and_excludes_vessels():
    ct = volume(); ct.data[:] = -50
    kidney = np.zeros(ct.data.shape, bool); kidney[5:18, 5:18, 5:18] = True
    ct.data[kidney] = 120
    ct.data[7:12, 7:12, 7:12] = 900
    ct.data[15:18, 7:12, 7:12] = 900
    excluded = np.zeros_like(kidney); excluded[15:18, 7:12, 7:12] = True
    mask, report = ai.contrast_lumen(ct, kidney, excluded, "excretory")
    assert mask[8, 8, 8] and not mask[13, 8, 8] and not mask[16, 8, 8]
    assert report["artificialBridging"] is False and report["completeTree"] is False


def test_weak_contrast_is_not_rescued_by_lowering_threshold():
    ct = volume(); ct.data[5:18, 5:18, 5:18] = 180
    ct.data[8:10, 8:10, 8:10] = 300
    kidney = ct.data > 0
    mask, report = ai.contrast_lumen(ct, kidney, np.zeros_like(kidney), "excretory")
    assert not mask.any() and report["status"] == "not_assessed"


def test_contrast_adjacent_to_parenchyma_can_seed_lumen_without_filling_tissue():
    ct = volume(); ct.data[:] = -50
    kidney = np.zeros(ct.data.shape, bool); kidney[5:15, 5:18, 5:18] = True
    ct.data[kidney] = 120; ct.data[15:18, 7:14, 7:14] = 900
    mask, report = ai.contrast_lumen(ct, kidney, np.zeros_like(kidney), "excretory")
    assert mask[16, 9, 9] and not mask[kidney].any()
    assert report["seedMarginMm"] == 3 and not report["artificialBridging"]


def test_ras_to_lps_conversion_preserves_physical_coordinates():
    affine = np.diag([.8, 1.2, 2., 1.]); affine[:3, 3] = [12, -8, 45]
    image = ai.to_sitk(volume(affine=affine))
    point = np.array([3, 4, 5])
    ras = (affine @ np.r_[point, 1])[:3]
    assert np.allclose(image.TransformIndexToPhysicalPoint(tuple(int(v) for v in point)), ras * [-1, -1, 1])


def test_sheared_geometry_requires_explicit_handling():
    affine = np.eye(4); affine[0, 1] = .3
    with pytest.raises(ValueError): ai.to_sitk(volume(affine=affine))


def test_identical_phase_needs_no_registration(tmp_path):
    ct = volume(); aligned, report = ai.align_phase(ct, ct, tmp_path)
    assert aligned is ct and report["expertReview"] == "not_required"


def test_rigid_registration_restores_known_physical_translation(tmp_path):
    from scipy.ndimage import gaussian_filter
    data = np.zeros((48, 48, 48), np.float32)
    data[10:23, 12:25, 9:29] = 180
    data[28:40, 24:36, 18:36] = 350
    data = gaussian_filter(data, 1.5) - 100
    reference = volume(data)
    shifted = np.eye(4); shifted[:3, 3] = [7, -4, 3]
    aligned, report = ai.align_phase(reference, volume(data.copy(), shifted), tmp_path)
    assert ai.same_grid(reference, aligned)
    assert np.mean(np.abs(aligned.data[5:-5, 5:-5, 5:-5] - data[5:-5, 5:-5, 5:-5])) < 3
    assert report["expertReview"] == "pending" and (tmp_path / "phase-to-reference.tfm").is_file()


def test_units_and_four_dimensional_volumes_are_rejected(tmp_path):
    path = tmp_path / "image.nii.gz"
    nib.save(nib.Nifti1Image(np.ones((24, 24, 24), np.float32) * 120, np.eye(4)), path)
    with pytest.raises(ValueError, match="millimetres"): ai.checked_volume(path)
    image = nib.Nifti1Image(np.zeros((10, 10, 10, 2), np.float32), np.eye(4)); image.header.set_xyzt_units("mm")
    nib.save(image, path)
    with pytest.raises(ValueError, match="3D"): ai.checked_volume(path)


def test_outputs_do_not_enter_git_or_overwrite_existing_work(tmp_path):
    (tmp_path / ".git").mkdir()
    with pytest.raises(ValueError, match="outside Git"): ai.prepare_output(tmp_path, "research-demo")
    with pytest.raises(ValueError, match="neutral"): ai.prepare_output(tmp_path, "patient-name")


@pytest.fixture
def bundle(tmp_path):
    ct = volume(); ct.data[:] = 120
    masks = {name: np.zeros(ct.data.shape, bool) for name in ai.STRUCTURES}
    masks["kidney"][4:10, 4:10, 4:10] = True
    masks["kidney"][15:20, 15:20, 15:20] = True
    record = {"caseCode": "research-synthetic", "model": {"method": "Synthetic test fixture", "sourceRevision": "not-an-AI-run"},
              "collecting": {"status": "not_assessed", "reason": "No phase"},
              "registration": {"expertReview": "pending", "reason": "Synthetic test"},
              "inputs": {"referenceSha256": "synthetic"}, "protocolCaveat": "Synthetic test only"}
    out = ai.prepare_output(tmp_path, record["caseCode"])
    ai.export_bundle(out, ct, masks, record)
    return out, record


def test_export_has_empty_masks_explicitly_and_keeps_disconnected_kidneys(bundle):
    import trimesh
    out, record = bundle
    checked, ct, masks, delayed = ai.checked_bundle(out)
    assert masks["kidney"].sum() == 6**3 + 5**3
    assert all(s["status"] != "draft" for s in checked["structures"] if s["name"] != "kidney")
    assert checked["mesh"]["closing"] is False
    assert "Withheld" in checked["measurements"]
    assert (out / "draft.glb").stat().st_size > 1000
    meshes = trimesh.load(out / "draft.glb", force="scene")
    kidney = meshes.geometry["kidney"]
    assert len(kidney.split()) == 2 and all(part.volume > 0 for part in kidney.split())
    assert np.isfinite(kidney.vertex_normals).all()


def test_changed_source_artifact_invalidates_bundle(bundle):
    out, _ = bundle
    (out / "draft.glb").write_bytes(b"changed")
    with pytest.raises(ValueError, match="artifact changed"): ai.checked_bundle(out)


def test_changed_provenance_invalidates_bundle(bundle):
    out, _ = bundle
    record = json.loads((out / "review.json").read_text())
    record["model"]["method"] = "Changed claim"
    (out / "review.json").write_text(json.dumps(record))
    with pytest.raises(ValueError, match="Provenance changed"): ai.checked_bundle(out)


def test_correction_on_shifted_grid_is_rejected(bundle, tmp_path):
    out, _ = bundle
    affine = np.eye(4); affine[0, 3] = 2
    file = tmp_path / "correction.nii.gz"
    volume(np.ones((24, 24, 24), np.uint8), affine).to_nifti(file)
    args = Namespace(bundle=out, structure="kidney", decision="accepted", reviewer_code="reviewer-test",
                     corrected=file, alignment_checked=False, out=tmp_path, case_id="research-correction", three_dir=None)
    with pytest.raises(ValueError, match="source CT grid"): ai.run_review(args)


def test_collecting_acceptance_requires_registration_review(bundle, tmp_path):
    out, _ = bundle
    file = tmp_path / "correction.nii.gz"
    volume(np.ones((24, 24, 24), np.uint8)).to_nifti(file)
    args = Namespace(bundle=out, structure="collecting_system", decision="accepted", reviewer_code="reviewer-test",
                     corrected=file, alignment_checked=False, out=tmp_path, case_id="research-correction", three_dir=None)
    with pytest.raises(ValueError, match="alignment"): ai.run_review(args)


def test_review_cannot_accept_an_empty_structure(bundle, tmp_path):
    out, _ = bundle
    args = Namespace(bundle=out, structure="tumour", decision="accepted", reviewer_code="reviewer-test",
                     corrected=None, alignment_checked=False, out=tmp_path, case_id="research-review", three_dir=None)
    with pytest.raises(ValueError, match="empty mask"): ai.run_review(args)


def test_review_creates_new_bundle_and_preserves_original(bundle, tmp_path):
    out, _ = bundle
    before = ai.digest(out / "review.json")
    args = Namespace(bundle=out, structure="kidney", decision="needs-correction", reviewer_code="reviewer-test",
                     corrected=None, alignment_checked=False, out=tmp_path, case_id="research-review", three_dir=None)
    ai.run_review(args)
    assert ai.digest(out / "review.json") == before
    record, *_ = ai.checked_bundle(tmp_path / "research-review")
    assert record["reviews"]["kidney"]["decision"] == "needs-correction"
    assert record["reviews"]["kidney"]["clinicalValidation"] is False


def test_single_excretory_source_is_not_presented_as_an_aligned_second_phase(bundle, tmp_path):
    out, _ = bundle
    record, ct, masks, _ = ai.checked_bundle(out)
    record["caseCode"] = "research-single-phase"
    target = ai.prepare_output(tmp_path, record["caseCode"])
    ai.export_bundle(target, ct, masks, record, ct)
    checked, _, _, delayed = ai.checked_bundle(target)
    assert delayed is None
    assert "aligned-excretory.nii.gz" not in checked["files"]
    assert all("excretoryImage" not in frame for frames in json.loads((target / "slices.json").read_text()).values() for frame in frames)
