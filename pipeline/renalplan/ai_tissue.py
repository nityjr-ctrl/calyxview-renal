"""Verified KiTS21 tissue inference; vessel and collecting models remain separate."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import numpy as np
from .ai import checked_volume, digest, same_grid
from .io import Volume

SOURCE_SHA = "797535faf36163ffbd24f9ae26587719b98b5eae9624b0533acc80364b2e5892"


def kits_masks(prediction, reference):
    if not same_grid(prediction, reference) or not set(np.unique(prediction.data)).issubset({0, 1, 2, 3}):
        raise ValueError("KiTS tissue prediction must be labels 0..3 on the source grid")
    return {"kidney": prediction.data == 1, "tumour": prediction.data == 2}


def infer_tissue(reference, lo, hi, output, source, source_archive, weights, folds):
    if (lo.shape != (3,) or hi.shape != (3,) or not np.issubdtype(lo.dtype, np.integer)
            or not np.issubdtype(hi.dtype, np.integer) or np.any(lo < 0)
            or np.any(hi <= lo) or np.any(hi > reference.data.shape)):
        raise ValueError("Tissue crop must be bounded integer indices on the source grid")
    probe = subprocess.run([sys.executable, "-c", "import torch; assert torch.cuda.is_available(), 'CUDA unavailable'"],
                           capture_output=True, timeout=60)
    if probe.returncode:
        raise RuntimeError("KiTS tissue inference requires the qualified CUDA runtime")
    spec = json.loads((Path(__file__).parent / "model_specs/task135.json").read_text())
    if digest(source_archive) != SOURCE_SHA:
        raise ValueError("Task135 source archive differs from the qualified upstream download")
    frozen_source = {}
    with tarfile.open(source_archive) as archive:
        for member in archive.getmembers():
            parts = Path(member.name).parts
            if member.isfile() and len(parts) > 1 and member.name.endswith(".py"):
                frozen_source[Path(*parts[1:]).as_posix()] = hashlib.sha256(archive.extractfile(member).read()).hexdigest()
    actual_source = {p.relative_to(source).as_posix(): digest(p) for p in source.rglob("*.py")}
    if not frozen_source or frozen_source != actual_source:
        raise ValueError("Task135 Python source differs from the pinned source archive")
    model = weights / spec["modelRelative"]
    verified = {"plans.pkl": spec["plans"]["sha256"]}
    for fold, expected in spec["folds"].items():
        verified[f"fold_{fold}/model_final_checkpoint.model"] = expected["checkpoint_sha256"]
        verified[f"fold_{fold}/model_final_checkpoint.model.pkl"] = expected["metadata_sha256"]
    if any(digest(model / name) != expected for name, expected in verified.items()):
        raise ValueError("Task135 checkpoint or metadata differs from the published model identities")
    if (model / "postprocessing.json").exists():
        raise ValueError("Unqualified Task135 postprocessing file")
    folder = output / "tissue-inference"; (folder / "input").mkdir(parents=True)
    (folder / "prediction").mkdir()
    selection = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))
    shift = np.eye(4); shift[:3, 3] = lo
    crop = Volume(reference.data[selection], reference.affine @ shift)
    crop.to_nifti(folder / "input/research_0000.nii.gz")
    env = {**os.environ, "PYTHONPATH": str(source) + os.pathsep + os.environ.get("PYTHONPATH", ""),
           "RESULTS_FOLDER": str(weights), "nnUNet_raw_data_base": str(folder / "raw"),
           "nnUNet_preprocessed": str(folder / "preprocessed"), "PYTHONUNBUFFERED": "1",
           "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD": "1", "OMP_NUM_THREADS": "4"}
    args = [sys.executable, "-m", "nnunet.inference.predict_simple", "-i", str(folder / "input"),
            "-o", str(folder / "prediction"), "-t", "Task135_KiTS2021", "-m", "3d_fullres",
            "-tr", "nnUNetTrainerV2", "-p", "nnUNetPlansv2.1", "-f", *folds,
            "--disable_tta", "--num_threads_preprocessing", "1", "--num_threads_nifti_save", "1"]
    with (output / "tissue-inference.log").open("w") as log:
        result = subprocess.run(args, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=1800)
    if result.returncode:
        raise RuntimeError("KiTS tissue inference failed; inspect tissue-inference.log")
    if any(digest(model / name) != expected for name, expected in verified.items()):
        raise ValueError("Task135 model files changed during inference")
    prediction = checked_volume(folder / "prediction/research.nii.gz", labels=True)
    masks = kits_masks(prediction, crop)
    full = {}
    for name, mask in masks.items():
        data = np.zeros(reference.data.shape, bool); data[selection] = mask
        full[name] = data
    return full, {"method": "nnU-Net v1 Task135_KiTS2021 tissue", "sourceRevision": spec["sourceRevision"],
                  "sourceArchiveSha256": SOURCE_SHA, "sourceFilesSha256": hashlib.sha256(json.dumps(frozen_source, sort_keys=True).encode()).hexdigest(),
                  "weightFiles": verified, "folds": folds, "testTimeMirroring": False,
                  "inputIntensity": "Original HU; no offset", "labels": "1 kidney, 2 tumour; class 3 cyst is not exported in this version",
                  "expertReview": "pending", "clinicalValidation": False}
