"""Local draft segmentation and review bundles. No public upload or clinical approval."""
from __future__ import annotations

import hashlib
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import time
import platform
from importlib.metadata import version
from datetime import datetime, timezone
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage
from skimage.filters import threshold_multiotsu

from .io import Volume, load_nifti
from .mesh import MeshParams, mask_to_mesh, scene_from

BA_REV = "14a336e20101e474204efc308106bae503431dcb"
MODEL_MD5 = "fb22a9730070fdf45ed3923b1d82b4d2"
STRUCTURES = ("kidney", "tumour", "renal_artery", "renal_vein", "collecting_system")
COLOURS = {"kidney": [194, 154, 127, 110], "tumour": [183, 66, 46, 255],
           "renal_artery": [211, 79, 73, 255], "renal_vein": [83, 122, 174, 255],
           "collecting_system": [74, 167, 160, 255]}
NOTICE = "Research draft. Every structure needs source-CT review. Not for patient care."


def digest(path: Path, algorithm="sha256") -> str:
    result = hashlib.new(algorithm)
    with Path(path).open("rb") as stream:
        while block := stream.read(8 * 1024 * 1024):
            result.update(block)
    return result.hexdigest()


def checked_volume(path: Path, *, labels=False) -> Volume:
    volume = load_nifti(path)
    data, affine = volume.data, volume.affine
    if data.ndim != 3 or min(data.shape) < 2 or data.size > 200_000_000:
        raise ValueError("Expected a bounded 3D volume, not 4D or an oversized input")
    if not np.isfinite(data).all() or not np.isfinite(affine).all():
        raise ValueError("Non-finite image or geometry")
    if not 0.1 <= min(volume.spacing) <= max(volume.spacing) <= 10:
        raise ValueError("Unsupported spacing; use a thin-section CT")
    if abs(np.linalg.det(affine[:3, :3])) < 1e-8:
        raise ValueError("Singular image geometry")
    directions = affine[:3, :3] / np.array(volume.spacing)
    if not np.allclose(directions.T @ directions, np.eye(3), atol=1e-4):
        raise ValueError("Sheared geometry requires explicit correction before inference or review")
    units = nib.load(path).header.get_xyzt_units()[0]
    if units != "mm":
        raise ValueError("NIfTI spatial units must explicitly be millimetres")
    if not labels and (data.min() < -5000 or data.max() > 10000 or data.max() < 100):
        raise ValueError("Expected original CT Hounsfield units")
    volume.meta = {}
    return volume


def same_grid(a: Volume, b: Volume) -> bool:
    return a.data.shape == b.data.shape and np.allclose(a.affine, b.affine, atol=1e-4)


def kipa_masks(prediction: Volume, reference: Volume) -> dict[str, np.ndarray]:
    if not same_grid(prediction, reference):
        raise ValueError("Prediction differs from source grid; do not silently resample it")
    values = np.unique(prediction.data)
    if not set(values.tolist()).issubset({0, 1, 2, 3, 4}):
        raise ValueError("KiPA labels must be 0 background, 1 vein, 2 kidney, 3 artery, 4 tumour")
    return {name: prediction.data == value for name, value in
            [("kidney", 2), ("tumour", 4), ("renal_artery", 3), ("renal_vein", 1)]}


def crop_volume(reference: Volume, coarse: np.ndarray, margin_mm=40.) -> tuple[Volume, np.ndarray, np.ndarray]:
    if coarse.shape != reference.data.shape or coarse.sum() < 100:
        raise ValueError("No adequate kidney localisation; do not run BA-Net on a guessed crop")
    points = np.argwhere(coarse)
    padding = np.ceil(margin_mm / np.array(reference.spacing)).astype(int)
    lo = np.maximum(points.min(axis=0) - padding, 0)
    hi = np.minimum(points.max(axis=0) + padding + 1, reference.data.shape)
    selection = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))
    shift = np.eye(4); shift[:3, 3] = lo
    return Volume(reference.data[selection], reference.affine @ shift), lo, hi


def restore_crop(prediction: Volume, crop: Volume, reference: Volume, lo, hi) -> Volume:
    kipa_masks(prediction, crop)
    data = np.zeros(reference.data.shape, np.uint8)
    data[tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))] = prediction.data.astype(np.uint8)
    return Volume(data, reference.affine.copy())


def model_input(crop: Volume, hu_offset: int) -> Volume:
    if hu_offset not in [0, 1024]:
        raise ValueError("Only the explicitly qualified model-input offsets are supported")
    return Volume(crop.data.astype(np.float32) + hu_offset, crop.affine.copy())


def locate_kidneys(ct: Path, reference: Volume, output: Path, weights: Path) -> tuple[Volume, dict, np.ndarray, np.ndarray]:
    if version("totalsegmentator") != "2.14.0":
        raise ValueError("Kidney localisation is qualified with TotalSegmentator 2.14.0")
    task = weights / "Dataset298_TotalSegmentator_total_6mm_1559subj"
    checkpoints = list(task.rglob("checkpoint_final.pth"))
    if len(checkpoints) != 1:
        raise ValueError("Supply the preinstalled TotalSegmentator Dataset298 weights; no automatic download")
    frozen = {p.relative_to(weights).as_posix(): digest(p) for p in task.rglob("*") if p.is_file()}
    coarse_dir = output / "localisation"; coarse_dir.mkdir()
    config = coarse_dir / "config"; config.mkdir()
    (config / "config.json").write_text(json.dumps({"totalseg_id": "totalseg_research", "send_usage_stats": False, "prediction_counter": 0}))
    clean = coarse_dir / "source.nii.gz"; reference.to_nifti(clean)
    env = {**os.environ, "TOTALSEG_HOME_DIR": str(config), "TOTALSEG_WEIGHTS_PATH": str(weights),
           "PYTHONUNBUFFERED": "1", "OMP_NUM_THREADS": "4"}
    args = [sys.executable, "-m", "totalsegmentator.bin.TotalSegmentator", "-i", str(clean),
            "-o", str(coarse_dir / "masks"), "--fastest", "--roi_subset", "kidney_left", "kidney_right",
            "--nr_thr_resamp", "1", "--nr_thr_saving", "1", "--device", "gpu"]
    with (output / "localisation.log").open("w") as log:
        result = subprocess.run(args, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=600)
    if result.returncode:
        raise RuntimeError("Kidney localisation failed; inspect local localisation.log")
    if any(digest(weights / name) != expected for name, expected in frozen.items()):
        raise ValueError("Localisation model files changed during the run")
    coarse = np.zeros(reference.data.shape, bool)
    detected, hashes = [], {}
    for name in ["kidney_left", "kidney_right"]:
        file = coarse_dir / "masks" / f"{name}.nii.gz"
        mask = checked_volume(file, labels=True)
        if not same_grid(mask, reference) or not set(np.unique(mask.data)).issubset({0, 1}):
            raise ValueError("Localisation mask must be binary on the source grid")
        if mask.data.any(): detected.append(name)
        coarse |= mask.data > 0
        hashes[name] = digest(file)
    crop, lo, hi = crop_volume(reference, coarse)
    return crop, {"method": "TotalSegmentator 6 mm kidney localisation", "version": "2.14.0",
                  "task": 298, "weightFiles": frozen, "maskSha256": hashes, "detected": detected,
                  "cropMarginMm": 40, "telemetry": False, "usedAsFinalMask": False}, lo, hi


def infer_kipa(ct: Path, output: Path, source: Path, weights: Path, archive: Path,
               folds: list[str], lock_path: Path, coarse_weights: Path | None = None,
               renal_crop=False, hu_offset=0) -> tuple[Path, dict]:
    if digest(archive, "md5") != MODEL_MD5:
        raise ValueError("KiPA model archive does not match the published checksum")
    if not (source / "nnunet/inference/predict_simple.py").is_file():
        raise ValueError("Supply the pinned BA-Net nnUNet source directory")
    lock = json.loads(lock_path.read_text())
    if lock["sourceRevision"] != BA_REV or lock["archiveMd5"] != MODEL_MD5:
        raise ValueError("Wrong model/source lock")
    if set(lock["sourceFiles"]) != {p.relative_to(source).as_posix() for p in source.rglob("*.py")}:
        raise ValueError("Runtime Python source inventory differs from its lock")
    if not lock["weightFiles"]:
        raise ValueError("Model lock has no checkpoints")
    for kind, root in [("sourceFiles", source), ("weightFiles", weights)]:
        for name, expected in lock[kind].items():
            path = (root / name).resolve()
            if not path.is_relative_to(root.resolve()) or digest(path) != expected:
                raise ValueError("Runtime source or checkpoint differs from its lock")
    reference = checked_volume(ct)
    if coarse_weights is not None:
        crop, localisation, lo, hi = locate_kidneys(ct, reference, output, coarse_weights)
    elif renal_crop:
        crop, lo, hi = reference, np.zeros(3, int), np.array(reference.data.shape)
        localisation = {"method": "User-declared renal crop", "expertReview": "pending"}
    else:
        raise ValueError("Supply --coarse-model-root for automatic localisation, or declare an already reviewed --renal-crop")
    estimated = int(np.prod(np.ceil(np.array(crop.data.shape) * np.array(crop.spacing) / .6328129768371582)))
    if estimated > 100_000_000:
        raise ValueError("Renal crop exceeds the qualified memory budget; provide a smaller reviewed renal CT crop")
    input_dir = output / "inference/input"
    pred_dir = output / "inference/prediction"
    input_dir.mkdir(parents=True)
    pred_dir.mkdir()
    model_file = input_dir / "research_0000.nii.gz"
    model_input(crop, hu_offset).to_nifti(model_file)
    # The reviewed upstream archive contains legacy PyTorch checkpoints. Limit
    # legacy pickle loading to this checksum-verified subprocess, not the host.
    env = {**os.environ, "RESULTS_FOLDER": str(weights), "nnUNet_raw_data_base": str(output / "inference/raw"),
           "nnUNet_preprocessed": str(output / "inference/preprocessed"),
           "PYTHONPATH": str(source) + os.pathsep + os.environ.get("PYTHONPATH", ""),
           "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD": "1", "OMP_NUM_THREADS": "4", "PYTHONUNBUFFERED": "1"}
    probe = subprocess.run([sys.executable, "-c", "import torch; assert torch.cuda.is_available(), 'CUDA required'"],
                           env=env, capture_output=True, text=True, timeout=60)
    if probe.returncode:
        raise RuntimeError("CUDA runtime qualification failed; see local environment")
    args = [sys.executable, "-m", "nnunet.inference.predict_simple", "-i", str(input_dir),
            "-o", str(pred_dir), "-t", "Task1001_KiPA22", "-m", "3d_fullres",
            "-tr", "BANetV2Trainer_1000Epoch", "-p", "nnUNetPlans_FabiansResUNet_v2.1",
            "-f", *folds, "--num_threads_preprocessing", "1", "--num_threads_nifti_save", "1"]
    with (output / "inference.log").open("w", encoding="utf-8") as log:
        result = subprocess.run(args, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=3600)
    if result.returncode:
        raise RuntimeError("BA-Net inference failed; inspect the local inference.log")
    full = output / "inference/restored.nii.gz"
    restore_crop(checked_volume(pred_dir / "research.nii.gz", labels=True), crop, reference, lo, hi).to_nifti(full)
    assessed = np.zeros(reference.data.shape, np.uint8)
    assessed[tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))] = 1
    Volume(assessed, reference.affine).to_nifti(output / "assessed-region.nii.gz")
    return full, {"method": "KiPA22 BA-Net", "sourceRevision": BA_REV,
            "localisation": localisation, "cropStart": lo.tolist(), "cropEndExclusive": hi.tolist(),
            "inputIntensity": {"offsetAppliedToModelCopy": hu_offset, "modelInputSha256": digest(model_file),
                               "sourceCtChanged": False, "status": "Experimental input-encoding adaptation; needs external qualification"},
            "estimatedResampledVoxels": estimated, "coverage": "Only the recorded renal crop was assessed; zero outside is not evidence of absent anatomy",
            "modelArchiveMd5": MODEL_MD5, "modelArchiveSha256": digest(archive),
            "modelLockSha256": digest(lock_path),
            "folds": folds, "testTimeMirroring": True, "expertReview": "pending"}


def contrast_lumen(ct: Volume, kidney: np.ndarray, excluded: np.ndarray,
                   phase: str) -> tuple[np.ndarray, dict]:
    """Conservative seeded contrast candidate, never gap filling or a pelvis guess."""
    empty = np.zeros(ct.data.shape, bool)
    report = {"method": "Seeded multi-Otsu contrast extraction inspired by ASSIST-U",
              "phaseDeclaration": phase, "expertReview": "pending", "artificialBridging": False,
              "completeTree": False, "pelvisSeparatelyLabelled": False, "seedMarginMm": 3, "roiMarginMm": 12}
    if phase != "excretory":
        return empty, {**report, "status": "not_assessed", "reason": "No declared excretory phase"}
    if kidney.sum() < 100:
        return empty, {**report, "status": "not_assessed", "reason": "Kidney mask too small"}
    distance = ndimage.distance_transform_edt(~kidney, sampling=ct.spacing)
    roi = distance <= 12.0
    region = roi & ~excluded & (ct.data > -100) & (ct.data < 1800)
    values = ct.data[region]
    if values.size < 100 or np.unique(values).size < 3:
        return empty, {**report, "status": "not_assessed", "reason": "Insufficient intensity separation"}
    thresholds = threshold_multiotsu(values, classes=3)
    # This floor is a conservative research exclusion rule, not a validated
    # contrast-phase classifier. Bright vessels/stones may still contaminate it.
    floor = max(float(thresholds[-1]), 350.0)
    candidate = region & (ct.data >= floor)
    # Parenchymal tissue masks can exclude urine-filled calyces. Expand only
    # the seed search, not the lumen: every output voxel still meets the HU rule.
    core = candidate & (distance <= 3.0)
    if core.sum() < 100 or not (ct.data[core] >= 500).any():
        return empty, {**report, "status": "not_assessed", "reason": "No adequate dense-contrast seed",
                       "thresholdHu": floor}
    pieces, count = ndimage.label(candidate, structure=np.ones((3, 3, 3)))
    keep = np.unique(pieces[core]); keep = keep[keep > 0]
    mask = np.isin(pieces, keep) if count else empty
    return mask, {**report, "status": "draft", "thresholdHu": floor,
                  "reason": "Partial contrast-visible lumen; vessels/stones can be false positives"}


def to_sitk(volume: Volume):
    import SimpleITK as sitk
    directions = volume.affine[:3, :3] / np.array(volume.spacing)
    if not np.allclose(directions.T @ directions, np.eye(3), atol=1e-4):
        raise ValueError("Sheared geometry requires explicit correction before registration")
    lps = np.diag([-1., -1., 1.])
    image = sitk.GetImageFromArray(volume.data.astype(np.float32).transpose(2, 1, 0))
    image.SetSpacing(volume.spacing)
    image.SetDirection(tuple((lps @ directions).ravel()))
    image.SetOrigin(tuple(lps @ volume.affine[:3, 3]))
    return image


def align_phase(reference: Volume, moving: Volume, output: Path) -> tuple[Volume, dict]:
    import SimpleITK as sitk
    if same_grid(reference, moving) and np.array_equal(reference.data, moving.data):
        return moving, {"method": "Identical input", "expertReview": "not_required"}
    fixed_img, moving_img = to_sitk(reference), to_sitk(moving)
    initial = sitk.CenteredTransformInitializer(fixed_img, moving_img, sitk.Euler3DTransform(),
                                               sitk.CenteredTransformInitializerFilter.GEOMETRY)
    registration = sitk.ImageRegistrationMethod()
    registration.SetMetricAsMattesMutualInformation(32)
    registration.SetMetricSamplingStrategy(registration.RANDOM)
    registration.SetMetricSamplingPercentage(0.1, 42)
    registration.SetInterpolator(sitk.sitkLinear)
    registration.SetOptimizerAsRegularStepGradientDescent(1., 0.001, 150)
    registration.SetOptimizerScalesFromPhysicalShift()
    registration.SetShrinkFactorsPerLevel([4, 2, 1])
    registration.SetSmoothingSigmasPerLevel([2, 1, 0])
    registration.SmoothingSigmasAreSpecifiedInPhysicalUnitsOn()
    registration.SetInitialTransform(initial, inPlace=False)
    transform = registration.Execute(fixed_img, moving_img)
    sitk.WriteTransform(transform, str(output / "phase-to-reference.tfm"))
    resampled = sitk.Resample(moving_img, fixed_img, transform, sitk.sitkLinear, -1024., sitk.sitkFloat32)
    report = {"method": "Rigid Mattes mutual information", "expertReview": "pending",
              "metric": float(registration.GetMetricValue()),
              "stop": registration.GetOptimizerStopConditionDescription(),
              "parameters": list(transform.GetParameters()),
              "reason": "Numerical convergence is not proof of anatomical alignment"}
    if not np.isfinite(report["metric"]):
        raise ValueError("Registration failed")
    return Volume(sitk.GetArrayFromImage(resampled).transpose(2, 1, 0), reference.affine.copy()), report


def prepare_output(path: Path, case_id: str) -> Path:
    if not re.fullmatch(r"research-[A-Za-z0-9_-]{1,48}", case_id):
        raise ValueError("Use a neutral research- case code, without patient identifiers")
    path = Path(path).resolve() / case_id
    if any((parent / ".git").exists() for parent in [path, *path.parents]):
        raise ValueError("Raw images and review output must stay outside Git repositories")
    if path.exists():
        raise FileExistsError("Output exists; choose a fresh research case code or output folder")
    path.mkdir(parents=True)
    return path


def export_bundle(output: Path, ct: Volume, masks: dict, record: dict,
                  collecting_ct: Volume | None = None, three_dir: Path | None = None) -> dict:
    from .ai_review import export_review
    if collecting_ct is not None and same_grid(ct, collecting_ct) and np.array_equal(ct.data, collecting_ct.data):
        collecting_ct = None
    folder = output / "masks"; folder.mkdir()
    structures, meshes = [], {}
    for name in STRUCTURES:
        mask = masks.get(name, np.zeros(ct.data.shape, bool))
        if mask.shape != ct.data.shape:
            raise ValueError("Mask shape differs from source")
        file = folder / f"{name}.nii.gz"
        Volume(mask.astype(np.uint8), ct.affine).to_nifti(file)
        voxels = int(mask.sum())
        method = record["collecting"] if name == "collecting_system" else record.get("tissueModel", record["model"]) if name in ["kidney", "tumour"] else record["model"]
        structures.append({"name": name, "voxels": voxels, "volumeMl": voxels * ct.voxel_ml,
                           "meshIncluded": voxels >= 10,
                           "status": "draft" if voxels else "not_detected" if name != "collecting_system" else method["status"],
                           "expertReview": record.get("reviews", {}).get(name, {}).get("decision", "pending" if voxels else "not_assessed"), "method": method,
                           "mask": f"masks/{name}.nii.gz", "sha256": digest(file)})
        if voxels >= 10:
            meshes[name] = mask_to_mesh(mask, ct.affine, MeshParams(taubin_iter=0, target_faces=0,
                                                                    keep_largest=False, closing_iter=0))
    if not meshes:
        raise ValueError("No anatomical structure was detected")
    scene = scene_from(meshes, COLOURS)
    scene.export(str(output / "draft.glb"), include_normals=True)
    ct.to_nifti(output / "source.nii.gz")
    if collecting_ct is not None:
        collecting_ct.to_nifti(output / "aligned-excretory.nii.gz")
    record.update({"schemaVersion": 1, "notice": NOTICE, "createdAt": datetime.now(timezone.utc).isoformat(),
                   "structures": structures, "coordinateSystem": "RAS millimetres",
                   "mesh": {"closing": False, "smoothing": False, "largestComponentRemoval": False},
                   "measurements": "Withheld: masks and any inter-phase registration are unreviewed",
                   "renalPelvis": "Included only where visible in collecting candidate; no separate automatic label"})
    record["files"] = {name: digest(output / name) for name in ["draft.glb", "source.nii.gz"]}
    if collecting_ct is not None:
        record["files"]["aligned-excretory.nii.gz"] = digest(output / "aligned-excretory.nii.gz")
    if (output / "phase-to-reference.tfm").is_file():
        record["files"]["phase-to-reference.tfm"] = digest(output / "phase-to-reference.tfm")
    if (output / "assessed-region.nii.gz").is_file():
        record["files"]["assessed-region.nii.gz"] = digest(output / "assessed-region.nii.gz")
    (output / "review.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    export_review(output, ct, masks, record, collecting_ct, three_dir)
    (output / "complete.json").write_text(json.dumps({"reviewSha256": digest(output / "review.json")}))
    return record


def run_ai(args):
    start = time.monotonic()
    ct = checked_volume(args.ct)
    if args.excretory and not args.same_study:
        raise ValueError("Declare --same-study only after confirming both phases belong to the same patient/study")
    moving = checked_volume(args.excretory) if args.excretory else None
    output = prepare_output(args.out, args.case_id)
    try:
        if args.vessel_bundle:
            parent, _, masks, _ = checked_bundle(args.vessel_bundle)
            if parent["inputs"]["referenceSha256"] != digest(args.ct):
                raise ValueError("Vessel bundle must originate from the exact same reference CT")
            model = copy.deepcopy(parent["model"])
            model["parentBundleSha256"] = digest(args.vessel_bundle / "review.json")
            shutil.copyfile(args.vessel_bundle / "assessed-region.nii.gz", output / "assessed-region.nii.gz")
        else:
            prediction, model = infer_kipa(args.ct, output, args.model_source, args.model_root,
                                          args.model_archive, args.folds, args.model_lock,
                                          args.coarse_model_root, args.renal_crop, args.model_hu_offset)
            masks = kipa_masks(checked_volume(prediction, labels=True), ct)
        from .ai_tissue import infer_tissue
        tissue, tissue_model = infer_tissue(ct, np.array(model["cropStart"]), np.array(model["cropEndExclusive"]),
                        output, args.tissue_model_source, args.tissue_source_archive, args.tissue_model_root, args.tissue_folds)
        masks.update(tissue)
        collecting_ct = ct if args.phase == "excretory" else None
        registration = {"status": "not_assessed", "reason": "Single input phase"}
        if moving is not None:
            collecting_ct, registration = align_phase(ct, moving, output)
        collecting, details = contrast_lumen(collecting_ct or ct, masks["kidney"],
                masks["renal_artery"] | masks["renal_vein"] | masks["tumour"],
                "excretory" if collecting_ct is not None else args.phase)
        masks["collecting_system"] = collecting
        record = {"caseCode": args.case_id, "inputs": {"referenceSha256": digest(args.ct),
                  "referencePhaseDeclaration": args.phase, "excretorySha256": digest(args.excretory) if args.excretory else None,
                  "sameStudyDeclared": bool(args.same_study)}, "model": model, "tissueModel": tissue_model, "collecting": details,
                  "registration": registration, "preExportSeconds": round(time.monotonic() - start, 2),
                  "runtime": {"python": platform.python_version(), **{name: version(name) for name in
                              ["torch", "numpy", "scipy", "nibabel", "SimpleITK", "scikit-image", "trimesh", "Pillow"]}},
                  "protocolCaveat": "KiPA22 model trained on renal CTA crops; other phases/protocols are out of distribution"}
        export_bundle(output, ct, masks, record, collecting_ct, args.three_dir)
    except Exception as error:
        (output / "failed.json").write_text(json.dumps({"status": "failed", "type": type(error).__name__,
                    "notice": NOTICE, "reason": "See local error; no completed review bundle is claimed"}))
        raise
    print(f"Draft ready: {args.case_id}; {output / 'index.html'}")


def checked_bundle(path: Path) -> tuple[dict, Volume, dict, Volume | None]:
    if (path / "failed.json").exists() or not (path / "complete.json").is_file():
        raise ValueError("Incomplete or failed bundle")
    if json.loads((path / "complete.json").read_text())["reviewSha256"] != digest(path / "review.json"):
        raise ValueError("Provenance changed since export")
    record = json.loads((path / "review.json").read_text())
    for name, expected in record["files"].items():
        target = (path / name).resolve()
        if not target.is_relative_to(path.resolve()) or digest(target) != expected:
            raise ValueError("Bundle artifact changed since export")
    ct = checked_volume(path / "source.nii.gz")
    masks = {}
    for structure in record["structures"]:
        name = structure["name"]
        if name not in STRUCTURES:
            raise ValueError("Unexpected structure in bundle")
        file = (path / structure["mask"]).resolve()
        if not file.is_relative_to(path.resolve()) or digest(file) != structure["sha256"]:
            raise ValueError("Mask changed since export")
        volume = checked_volume(file, labels=True)
        if not same_grid(volume, ct) or not set(np.unique(volume.data)).issubset({0, 1}):
            raise ValueError("Mask must be binary and on the source grid")
        masks[name] = volume.data > 0
    if set(masks) != set(STRUCTURES):
        raise ValueError("Incomplete mask inventory")
    delayed = checked_volume(path / "aligned-excretory.nii.gz") if (path / "aligned-excretory.nii.gz").is_file() else None
    return record, ct, masks, delayed


def run_review(args):
    if not re.fullmatch(r"reviewer-[A-Za-z0-9_-]{1,32}", args.reviewer_code):
        raise ValueError("Use a neutral reviewer- code")
    record, ct, masks, delayed = checked_bundle(args.bundle)
    record = copy.deepcopy(record)
    if "preExportSeconds" in record:
        record["originPreExportSeconds"] = record.pop("preExportSeconds")
    if args.corrected:
        replacement = checked_volume(args.corrected, labels=True)
        if not same_grid(replacement, ct) or not set(np.unique(replacement.data)).issubset({0, 1}):
            raise ValueError("Corrected mask must be binary and on the exported source CT grid")
        masks[args.structure] = replacement.data > 0
    if args.decision == "accepted" and not masks[args.structure].any():
        raise ValueError("An empty mask cannot be accepted as a reconstructed structure")
    if args.decision == "not-assessable" and masks[args.structure].any():
        raise ValueError("A not-assessable structure must have an empty corrected mask")
    if args.structure == "collecting_system" and args.decision == "accepted" and record["registration"].get("expertReview") == "pending" and not args.alignment_checked:
        raise ValueError("Inspect inter-phase alignment before accepting the collecting mask")
    if args.alignment_checked:
        record["registration"]["expertReview"] = "reviewer-declared checked"
    record.setdefault("reviews", {})[args.structure] = {
        "decision": args.decision, "reviewerCode": args.reviewer_code,
        "at": datetime.now(timezone.utc).isoformat(),
        "correctionSha256": digest(args.corrected) if args.corrected else None,
        "parentMaskSha256": next(s["sha256"] for s in record["structures"] if s["name"] == args.structure),
        "clinicalValidation": False}
    record["parentBundleSha256"] = digest(args.bundle / "review.json")
    record["caseCode"] = args.case_id
    output = prepare_output(args.out, args.case_id)
    if (args.bundle / "phase-to-reference.tfm").is_file():
        shutil.copyfile(args.bundle / "phase-to-reference.tfm", output / "phase-to-reference.tfm")
    if (args.bundle / "assessed-region.nii.gz").is_file():
        shutil.copyfile(args.bundle / "assessed-region.nii.gz", output / "assessed-region.nii.gz")
    export_bundle(output, ct, masks, record, delayed, args.three_dir)
    print(f"Reviewer-declared decision recorded in new bundle: {output}")


def add_parser(sub):
    parser = sub.add_parser("ai", help="local KiTS tissue and KiPA vessel drafts with CT review (research only)")
    parser.add_argument("--ct", type=Path, required=True)
    parser.add_argument("--phase", choices=["arterial", "corticomedullary", "nephrographic", "excretory"], required=True)
    parser.add_argument("--excretory", type=Path)
    parser.add_argument("--same-study", action="store_true")
    parser.add_argument("--model-source", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--model-archive", type=Path, required=True)
    parser.add_argument("--model-lock", type=Path, required=True)
    parser.add_argument("--tissue-model-source", type=Path, required=True)
    parser.add_argument("--tissue-source-archive", type=Path, required=True)
    parser.add_argument("--tissue-model-root", type=Path, required=True)
    parser.add_argument("--tissue-folds", nargs="+", choices=["0", "1", "2", "3", "4"], default=["0", "1", "2", "3", "4"])
    parser.add_argument("--vessel-bundle", type=Path, help="reuse a hash-verified BA-Net bundle from this exact CT; no reference outlines")
    parser.add_argument("--model-hu-offset", type=int, choices=[0, 1024], required=True,
                        help="explicit model-copy intensity offset; 1024 is an inferred KiPA stored-value adaptation, not a source-CT change")
    crop_mode = parser.add_mutually_exclusive_group(required=True)
    crop_mode.add_argument("--coarse-model-root", type=Path, help="preinstalled TotalSegmentator nnunet/results directory for kidney localisation")
    crop_mode.add_argument("--renal-crop", action="store_true", help="declare input already cropped to the renal region after review")
    parser.add_argument("--folds", nargs="+", choices=["0", "1", "2", "3"], default=["0", "1", "2", "3"])
    parser.add_argument("--three-dir", type=Path, help="local three package for the offline 3D review")
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.set_defaults(fn=run_ai)
    review = sub.add_parser("ai-review", help="record a reviewer-declared decision/correction in a new local bundle")
    review.add_argument("--bundle", type=Path, required=True)
    review.add_argument("--structure", choices=STRUCTURES, required=True)
    review.add_argument("--decision", choices=["accepted", "needs-correction", "not-assessable"], required=True)
    review.add_argument("--reviewer-code", required=True)
    review.add_argument("--corrected", type=Path)
    review.add_argument("--alignment-checked", action="store_true")
    review.add_argument("--three-dir", type=Path)
    review.add_argument("--case-id", required=True)
    review.add_argument("--out", type=Path, required=True)
    review.set_defaults(fn=run_review)
