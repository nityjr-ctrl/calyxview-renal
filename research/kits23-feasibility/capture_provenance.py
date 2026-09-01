#!/usr/bin/env python3
"""Capture independently verified data, model, runtime, and execution provenance."""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


DISCLAIMER = (
    "RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE. NOT FOR DIAGNOSIS, "
    "TREATMENT SELECTION, SURGICAL PLANNING, MARGIN SELECTION, OR PATIENT CARE."
)
EXPECTED_CASE_IDS = [f"case_{number:05d}" for number in range(400, 420)]
EXPECTED_KITS23_COMMIT = "c1088353084c17b8882a11db71429e7c022b7785"
EXPECTED_IMAGING_REVISION = "65f1f295873a326230153c7e1de0c7dba10f0b29"
EXPECTED_NNUNET_COMMIT = "db16c6cef5fdd5a180159184e46b58bcca670446"
EXPECTED_PORTABLE_MANIFEST_SHA256 = (
    "bc529b7e5edfa9c5ac0979de1d38a027735b741760e3e82c14acc78ec900c561"
)
EXPECTED_MODEL_BYTES = 3_505_803_654
EXPECTED_MODEL_MD5 = "b27ab702742083080b95baac00ba186f"
EXPECTED_MODEL_SHA256 = (
    "a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3"
)
EXPECTED_FOLDS = [0, 1, 2, 3, 4]
EXPECTED_VALIDATOR_SHA256 = (
    "9203f0ccfe10385a24e11ec7c77bd2d00d56aa7a0ed49d1c91a3ea16dc1d8abc"
)
EXPECTED_PLANS = {
    "bytes": 143_080,
    "sha256": "d15d46664240f0a9056ef1320e00df46fbd866ea94323a98e47b3e9eff1f4e39",
}
EXPECTED_CHECKPOINTS = {
    0: {
        "checkpoint_bytes": 249_826_698,
        "checkpoint_sha256": "d64a21c10973c459870297e57e39811304c689e3b9bddd5bbaeb7a8384d64cf7",
        "metadata_bytes": 143_564,
        "metadata_sha256": "9f6f0d03dcbe0a67a2e5894f2f10ea6b0f58dd5de5348b3c6a7b6c0e1bede0b2",
    },
    1: {
        "checkpoint_bytes": 249_826_570,
        "checkpoint_sha256": "6038808474337ca2f27cc2592847622f3665f8c526165dfe945ca8d905a0e27c",
        "metadata_bytes": 143_564,
        "metadata_sha256": "d1d5dafb9de471634a1d3ded474ca6554f6b731f49154c30ff81a18fac6174f6",
    },
    2: {
        "checkpoint_bytes": 249_826_762,
        "checkpoint_sha256": "54e61742f2acf83fe6b163d73e41c3a4629cecfa3441b70257c9e6b96d64efc9",
        "metadata_bytes": 143_564,
        "metadata_sha256": "99acda476f067ac55236dfe01ea0f220d86867cba094366733b5e9eef338731b",
    },
    3: {
        "checkpoint_bytes": 249_826_570,
        "checkpoint_sha256": "abddc1d98252bd1b8f90af10b42a58ebd6c27059f4360af9307618f2977bcd0b",
        "metadata_bytes": 143_564,
        "metadata_sha256": "fcd1ea1b1eced829852f64a42d9d8a5b6cbee35190a87dace853255124227adf",
    },
    4: {
        "checkpoint_bytes": 249_826_826,
        "checkpoint_sha256": "849e9bad2031ca99096fd4a827283838541c7822d84063b74337621d649b92ef",
        "metadata_bytes": 143_564,
        "metadata_sha256": "975843163c8150e60c12f651b437a9256de48c5a3810fa21c6d77a2f2be77898",
    },
}
MODEL_RELATIVE = Path(
    "nnUNet/3d_fullres/Task135_KiTS2021/"
    "nnUNetTrainerV2__nnUNetPlansv2.1"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture frozen benchmark provenance.")
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--kits23-source", type=Path, required=True)
    parser.add_argument("--nnunet-source", type=Path, required=True)
    parser.add_argument("--results-folder", type=Path, required=True)
    parser.add_argument("--model-archive", type=Path, required=True)
    parser.add_argument("--folds", type=int, nargs="+", default=EXPECTED_FOLDS)
    parser.add_argument("--tta-enabled", action="store_true")
    parser.add_argument("--require-complete-run", action="store_true")
    return parser.parse_args()


def hash_file(path: Path, algorithm: str = "sha256") -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


def run_git(path: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(path), *arguments],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def git_diff_is_quiet(path: Path, *arguments: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(path), "diff", *arguments, "--quiet", "--"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(f"Git diff failed for {path}: {result.stderr.strip()}")
    return result.returncode == 0


def inventory_ignored_artifacts(path: Path) -> dict[str, Any]:
    """Hash Git-ignored untracked artefacts without treating them as commit content."""

    ignored_paths = sorted(
        line
        for line in run_git(
            path, "ls-files", "--others", "--ignored", "--exclude-standard"
        ).splitlines()
        if line
    )
    records: list[dict[str, Any]] = []
    executable_suffixes = {
        ".dll",
        ".dylib",
        ".egg",
        ".pth",
        ".pyd",
        ".py",
        ".pyc",
        ".pyo",
        ".so",
        ".zip",
    }
    executable_names = {"sitecustomize.py", "usercustomize.py"}
    potentially_executable = 0
    for relative_value in ignored_paths:
        relative = Path(relative_value)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Ignored source artefact escaped the checkout: {relative_value!r}")
        artifact = path / relative
        if artifact.is_symlink():
            link_value = os.readlink(artifact)
            payload = os.fsencode(link_value)
            artifact_type = "symlink"
        elif artifact.is_file():
            payload = None
            artifact_type = "file"
        else:
            raise ValueError(f"Ignored source artefact is not a regular file: {relative_value!r}")
        suffix = relative.suffix.lower()
        is_potentially_executable = (
            suffix in executable_suffixes
            or relative.name.lower() in executable_names
            or "__pycache__" in relative.parts
        )
        potentially_executable += int(is_potentially_executable)
        records.append(
            {
                "path": relative.as_posix(),
                "type": artifact_type,
                "bytes": len(payload) if payload is not None else artifact.stat().st_size,
                "sha256": (
                    hashlib.sha256(payload).hexdigest()
                    if payload is not None
                    else hash_file(artifact)
                ),
                "potentially_executable": is_potentially_executable,
            }
        )
    serialized = json.dumps(
        records, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return {
        "ignored_untracked_files": len(records),
        "ignored_untracked_bytes": sum(int(record["bytes"]) for record in records),
        "ignored_untracked_inventory_sha256": hashlib.sha256(serialized).hexdigest(),
        "ignored_potentially_executable_files": potentially_executable,
    }


def verify_git_source(
    path: Path,
    expected_commit: str,
    label: str,
    *,
    allow_crlf_equivalent: bool = False,
) -> dict[str, Any]:
    resolved = path.resolve()
    if not resolved.is_dir():
        raise FileNotFoundError(f"{label} source directory not found: {resolved}")
    commit = run_git(resolved, "rev-parse", "HEAD")
    if commit != expected_commit:
        raise ValueError(f"{label} revision mismatch: expected {expected_commit}, got {commit}")
    unignored_untracked = run_git(
        resolved, "ls-files", "--others", "--exclude-standard"
    )
    if unignored_untracked:
        raise ValueError(f"{label} runtime source has unignored untracked files")
    ignored_inventory = inventory_ignored_artifacts(resolved)
    status = run_git(resolved, "status", "--porcelain")
    if not status:
        return {
            "commit": commit,
            "tracked_working_tree_clean": True,
            "tracked_source_commit_equivalent": True,
            "crlf_only_changed_files": 0,
            "unignored_untracked_files": 0,
            **ignored_inventory,
        }
    if not allow_crlf_equivalent:
        raise ValueError(f"{label} checkout has tracked, staged, or unignored changes")
    if not git_diff_is_quiet(resolved, "--cached"):
        raise ValueError(f"{label} runtime source has staged changes")
    if not git_diff_is_quiet(resolved, "--ignore-cr-at-eol"):
        raise ValueError(
            f"{label} runtime source differs from the frozen commit beyond CRLF conversion"
        )
    changed_files = [
        line for line in run_git(resolved, "diff", "--name-only", "--").splitlines() if line
    ]
    if not changed_files:
        raise ValueError(f"{label} status is dirty but no CRLF-only files were identified")
    return {
        "commit": commit,
        "tracked_working_tree_clean": False,
        "tracked_source_commit_equivalent": True,
        "crlf_only_changed_files": len(changed_files),
        "unignored_untracked_files": 0,
        **ignored_inventory,
    }


def load_json(path: Path, label: str) -> Mapping[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read {label}: {exc}") from exc
    if not isinstance(payload, Mapping):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def read_manifests(run_root: Path) -> tuple[list[dict[str, str]], Mapping[str, Any], str, str]:
    local_path = run_root / "manifests" / "manifest.csv"
    portable_path = run_root / "manifests" / "manifest.portable.json"
    if not local_path.is_file() or not portable_path.is_file():
        raise FileNotFoundError("Both manifest.csv and manifest.portable.json are required")
    with local_path.open("r", encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    if [row.get("case_id") for row in rows] != EXPECTED_CASE_IDS:
        raise ValueError("Local manifest is not ordered case_00400..case_00419")

    portable_sha256 = hash_file(portable_path)
    if portable_sha256 != EXPECTED_PORTABLE_MANIFEST_SHA256:
        raise ValueError(
            "Portable manifest SHA-256 mismatch: "
            f"expected {EXPECTED_PORTABLE_MANIFEST_SHA256}, got {portable_sha256}"
        )
    portable = load_json(portable_path, "portable manifest")
    cases = portable.get("cases")
    if not isinstance(cases, list) or [case.get("caseId") for case in cases] != EXPECTED_CASE_IDS:
        raise ValueError("Portable manifest is not ordered case_00400..case_00419")
    for row, case in zip(rows, cases, strict=True):
        expected = {
            "caseId": row["case_id"],
            "selectionOrder": int(row["selection_order"]),
            "imageSha256": row["image_sha256"].lower(),
            "labelSha256": row["label_sha256"].lower(),
            "imageBytes": int(row["image_bytes"]),
            "labelBytes": int(row["label_bytes"]),
        }
        for key, value in expected.items():
            if case.get(key) != value:
                raise ValueError(f"Portable/local manifest mismatch for {row['case_id']}: {key}")
    return rows, portable, hash_file(local_path), portable_sha256


def verify_data_assets(run_root: Path, rows: list[dict[str, str]]) -> dict[str, Any]:
    image_bytes = 0
    label_bytes = 0
    input_bytes = 0
    for row in rows:
        case_id = row["case_id"]
        expected_image_size = int(row["image_bytes"])
        expected_label_size = int(row["label_bytes"])
        assets = (
            (run_root / "source" / "images" / f"{case_id}.nii.gz", expected_image_size, row["image_sha256"].lower(), "source image"),
            (run_root / "labels" / f"{case_id}.nii.gz", expected_label_size, row["label_sha256"].lower(), "reference label"),
            (run_root / "nnunet_input" / f"{case_id}_0000.nii.gz", expected_image_size, row["image_sha256"].lower(), "nnU-Net input"),
        )
        for path, expected_size, expected_sha, label in assets:
            if not path.is_file():
                raise FileNotFoundError(f"Missing {label} for {case_id}")
            if path.stat().st_size != expected_size:
                raise ValueError(f"{label} byte-count mismatch for {case_id}")
            if hash_file(path) != expected_sha:
                raise ValueError(f"{label} SHA-256 mismatch for {case_id}")
        image_bytes += expected_image_size
        label_bytes += expected_label_size
        input_bytes += expected_image_size
    return {
        "source_images_verified": len(rows),
        "reference_labels_verified": len(rows),
        "nnunet_inputs_verified": len(rows),
        "source_image_bytes": image_bytes,
        "reference_label_bytes": label_bytes,
        "nnunet_input_bytes": input_bytes,
        "verification": "independent byte-count and SHA-256 match",
    }


def verify_model_install(results_folder: Path) -> list[dict[str, Any]]:
    model_directory = results_folder.resolve() / MODEL_RELATIVE
    if (model_directory / "postprocessing.json").exists():
        raise ValueError(
            "Frozen model must not contain postprocessing.json; outputs would change"
        )
    plans = model_directory / "plans.pkl"
    if not plans.is_file():
        raise FileNotFoundError("Installed model plans.pkl is missing")
    if (
        plans.stat().st_size != EXPECTED_PLANS["bytes"]
        or hash_file(plans) != EXPECTED_PLANS["sha256"]
    ):
        raise ValueError("Installed model plans.pkl does not match the frozen model")
    evidence: list[dict[str, Any]] = []
    for fold in EXPECTED_FOLDS:
        fold_dir = model_directory / f"fold_{fold}"
        checkpoint = fold_dir / "model_final_checkpoint.model"
        metadata = fold_dir / "model_final_checkpoint.model.pkl"
        specification = EXPECTED_CHECKPOINTS[fold]
        for path, bytes_key, hash_key in (
            (checkpoint, "checkpoint_bytes", "checkpoint_sha256"),
            (metadata, "metadata_bytes", "metadata_sha256"),
        ):
            if not path.is_file():
                raise FileNotFoundError(f"Installed fold {fold} is incomplete")
            if path.stat().st_size != specification[bytes_key]:
                raise ValueError(f"Installed fold {fold} {path.name} byte-count mismatch")
            if hash_file(path) != specification[hash_key]:
                raise ValueError(f"Installed fold {fold} {path.name} SHA-256 mismatch")
        evidence.append({"fold": fold, **specification})
    return evidence


def require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return value


def verify_prediction(path: Path, reference_path: Path) -> int:
    import nibabel as nib
    import numpy as np

    if not path.is_file() or path.stat().st_size <= 0:
        raise FileNotFoundError(f"Validated prediction is missing: {path.name}")
    prediction = nib.load(str(path))
    reference = nib.load(str(reference_path))
    if len(prediction.shape) != 3 or prediction.shape != reference.shape:
        raise ValueError(f"Prediction shape mismatch: {path.name}")
    if not np.allclose(prediction.affine, reference.affine, rtol=0, atol=1e-4):
        raise ValueError(f"Prediction affine mismatch: {path.name}")
    values = np.asanyarray(prediction.dataobj)
    if not np.issubdtype(values.dtype, np.number) or not np.isfinite(values).all():
        raise ValueError(f"Prediction contains invalid values: {path.name}")
    rounded = np.rint(values)
    if not np.allclose(values, rounded, rtol=0, atol=1e-6):
        raise ValueError(f"Prediction contains non-integer labels: {path.name}")
    if not set(np.unique(rounded).astype(int).tolist()).issubset({0, 1, 2, 3}):
        raise ValueError(f"Prediction contains labels outside 0..3: {path.name}")
    return path.stat().st_size


def verify_complete_run(
    run_root: Path, expected_folds: list[int], tta_enabled: bool
) -> tuple[dict[str, Any], set[Path], set[Path]]:
    timings_root = run_root / "timings"
    expected_names = {f"{case_id}.json" for case_id in EXPECTED_CASE_IDS}
    actual_names = {path.name for path in timings_root.glob("case_*.json")}
    if actual_names != expected_names:
        missing = sorted(expected_names - actual_names)
        extra = sorted(actual_names - expected_names)
        raise ValueError(f"Canonical timing set mismatch; missing={missing}, extra={extra}")

    source_paths: set[Path] = set()
    results_paths: set[Path] = set()
    statuses = {"succeeded": 0, "failed": 0}
    validated_predictions = 0
    prediction_bytes = 0
    qualified_attempts = 0
    python_paths: set[Path] = set()
    fold_strings = [str(fold) for fold in expected_folds]
    expected_suffix = [
        "-t", "Task135_KiTS2021", "-m", "3d_fullres",
        "--num_threads_preprocessing", "1",
        "--num_threads_nifti_save", "1", "-f", *fold_strings,
    ] + ([] if tta_enabled else ["--disable_tta"])

    for position, case_id in enumerate(EXPECTED_CASE_IDS, start=1):
        record = load_json(timings_root / f"{case_id}.json", f"timing for {case_id}")
        if record.get("case_id") != case_id or record.get("cohort_position") != position:
            raise ValueError(f"Timing identity/order mismatch for {case_id}")
        status = record.get("status")
        if status not in statuses:
            raise ValueError(f"Unexpected timing status for {case_id}: {status!r}")
        statuses[status] += 1
        runtime = record.get("runtime_seconds")
        if isinstance(runtime, bool) or not isinstance(runtime, (int, float)):
            raise ValueError(f"Runtime is not numeric for {case_id}")
        if not math.isfinite(float(runtime)) or float(runtime) < 0:
            raise ValueError(f"Runtime is invalid for {case_id}")

        configuration = record.get("command_configuration")
        if not isinstance(configuration, Mapping):
            raise ValueError(f"Command configuration missing for {case_id}")
        expected_scalars = {
            "launcher": "wsl.exe",
            "python_module": "nnunet.inference.predict_simple",
            "task": "Task135_KiTS2021",
            "model": "3d_fullres",
            "tta_enabled": tta_enabled,
            "retry_policy": "one identical retry after failure",
        }
        for key, value in expected_scalars.items():
            if configuration.get(key) != value:
                raise ValueError(f"Timing configuration mismatch for {case_id}: {key}")
        if configuration.get("folds") != fold_strings:
            raise ValueError(f"Fold configuration mismatch for {case_id}")

        source_value = configuration.get("nnunet_source_wsl")
        results_value = configuration.get("results_folder_wsl")
        if not isinstance(source_value, str) or not isinstance(results_value, str):
            raise ValueError(f"Runtime source/model paths missing for {case_id}")
        source_paths.add(Path(source_value).resolve())
        results_paths.add(Path(results_value).resolve())

        python_value = configuration.get("python")
        native_root = configuration.get("native_scratch_root_wsl")
        if not isinstance(python_value, str) or not isinstance(native_root, str):
            raise ValueError(f"Runtime Python or native scratch path missing for {case_id}")
        python_paths.add(Path(python_value).resolve())
        native_root = native_root.rstrip("/")
        expected_input = f"{native_root}/case-inputs/{case_id}"
        expected_output = f"{native_root}/case-outputs/{case_id}"
        if (
            configuration.get("input_directory_wsl") != expected_input
            or configuration.get("output_directory_wsl") != expected_output
            or configuration.get("prediction_relative") != f"predictions/{case_id}.nii.gz"
        ):
            raise ValueError(f"Case-specific input/output binding mismatch for {case_id}")

        validator_value = configuration.get("validator_script_wsl")
        if not isinstance(validator_value, str):
            raise ValueError(f"Validator path missing for {case_id}")
        validator_path = Path(validator_value).resolve()
        if validator_path.name != "validate_prediction.py" or not validator_path.is_file():
            raise ValueError(f"Validator script is missing or unexpected for {case_id}")
        if hash_file(validator_path) != EXPECTED_VALIDATOR_SHA256:
            raise ValueError(f"Validator script hash mismatch for {case_id}")

        environment = configuration.get("environment")
        if not isinstance(environment, Mapping):
            raise ValueError(f"Recorded environment missing for {case_id}")
        expected_environment = {
            "PYTHONPATH": source_value,
            "RESULTS_FOLDER": results_value,
            "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD": "1",
            "OMP_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
            "ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS": "1",
            "PYTHONNOUSERSITE": "1",
            "nnUNet_raw_data_base": f"{native_root}/raw-data-base",
            "nnUNet_preprocessed": f"{native_root}/preprocessed",
            "MPLCONFIGDIR": f"{native_root}/matplotlib",
        }
        for key, value in expected_environment.items():
            if environment.get(key) != value:
                raise ValueError(f"Recorded environment mismatch for {case_id}: {key}")

        predict_arguments = require_list(
            configuration.get("predict_arguments"), f"predict arguments for {case_id}"
        )
        expected_arguments = [
            "-m",
            "nnunet.inference.predict_simple",
            "-i",
            expected_input,
            "-o",
            expected_output,
            *expected_suffix,
        ]
        if predict_arguments != expected_arguments:
            raise ValueError(f"Predict command protocol mismatch for {case_id}")

        attempts = record.get("attempts")
        attempt_records = require_list(record.get("attempt_records"), f"attempts for {case_id}")
        if isinstance(attempts, bool) or not isinstance(attempts, int) or not 1 <= attempts <= 2:
            raise ValueError(f"Attempt count is invalid for {case_id}")
        if len(attempt_records) != attempts:
            raise ValueError(f"Attempt record count mismatch for {case_id}")
        qualified_attempts += attempts

        attempt_runtime_total = 0.0
        for attempt_index, attempt_record in enumerate(attempt_records, start=1):
            if not isinstance(attempt_record, Mapping):
                raise ValueError(f"Attempt {attempt_index} is invalid for {case_id}")
            if attempt_record.get("attempt") != attempt_index:
                raise ValueError(f"Attempt ordering mismatch for {case_id}")
            attempt_status = attempt_record.get("status")
            if attempt_status not in ("succeeded", "failed"):
                raise ValueError(f"Attempt status is invalid for {case_id}")
            attempt_runtime = attempt_record.get("runtime_seconds")
            if (
                isinstance(attempt_runtime, bool)
                or not isinstance(attempt_runtime, (int, float))
                or not math.isfinite(float(attempt_runtime))
                or float(attempt_runtime) < 0
            ):
                raise ValueError(f"Attempt runtime is invalid for {case_id}")
            attempt_runtime_total += float(attempt_runtime)
            for log_key, suffix in (
                ("stdout_log_relative", "stdout.log"),
                ("stderr_log_relative", "stderr.log"),
            ):
                expected_log = f"logs/{case_id}.attempt-{attempt_index}.{suffix}"
                if attempt_record.get(log_key) != expected_log or not (run_root / expected_log).is_file():
                    raise ValueError(f"Attempt log binding mismatch for {case_id}: {log_key}")
            for log_key, suffix in (
                ("validation_stdout_relative", "validation.stdout.log"),
                ("validation_stderr_relative", "validation.stderr.log"),
            ):
                log_value = attempt_record.get(log_key)
                if log_value is not None:
                    expected_log = f"logs/{case_id}.attempt-{attempt_index}.{suffix}"
                    if log_value != expected_log or not (run_root / expected_log).is_file():
                        raise ValueError(
                            f"Validation log binding mismatch for {case_id}: {log_key}"
                        )
        if not math.isclose(attempt_runtime_total, float(runtime), rel_tol=0, abs_tol=0.01):
            raise ValueError(f"Attempt runtimes do not sum to case runtime for {case_id}")

        if attempts == 2 and attempt_records[0].get("status") != "failed":
            raise ValueError(f"Retry was not preceded by a failed first attempt for {case_id}")
        if status == "failed" and (
            attempts != 2
            or any(attempt.get("status") != "failed" for attempt in attempt_records)
        ):
            raise ValueError(f"Failed case does not satisfy the one-retry policy: {case_id}")

        final_attempt = attempt_records[-1]
        if not isinstance(final_attempt, Mapping):
            raise ValueError(f"Final attempt is invalid for {case_id}")
        if status == "succeeded":
            if (
                final_attempt.get("status") != "succeeded"
                or final_attempt.get("exit_code") != 0
                or final_attempt.get("prediction_validated") is not True
                or final_attempt.get("validation_exit_code") != 0
                or final_attempt.get("finalization_exit_code") != 0
                or final_attempt.get("final_prediction_created") is not True
            ):
                raise ValueError(f"Successful timing lacks validated final evidence for {case_id}")
            prediction_bytes += verify_prediction(
                run_root / "predictions" / f"{case_id}.nii.gz",
                run_root / "labels" / f"{case_id}.nii.gz",
            )
            validated_predictions += 1
        elif (run_root / "predictions" / f"{case_id}.nii.gz").exists():
            raise ValueError(f"Failed case has a canonical prediction: {case_id}")

    if python_paths != {Path(sys.executable).resolve()}:
        raise ValueError("Timing records were not produced with the captured Python runtime")

    return (
        {
            "timing_records_verified": len(EXPECTED_CASE_IDS),
            "successful_records": statuses["succeeded"],
            "failed_records": statuses["failed"],
            "qualified_attempts": qualified_attempts,
            "validated_predictions": validated_predictions,
            "validated_prediction_bytes": prediction_bytes,
            "task": "Task135_KiTS2021",
            "configuration": "3d_fullres",
            "folds": expected_folds,
            "tta_enabled": tta_enabled,
            "preprocessing_threads": 1,
            "nifti_save_threads": 1,
            "validator_sha256": EXPECTED_VALIDATOR_SHA256,
            "retry_sequence_verified": True,
            "all_records_match_frozen_contract": True,
        },
        source_paths,
        results_paths,
    )


def main() -> None:
    args = parse_args()
    if args.folds != EXPECTED_FOLDS or args.tta_enabled:
        raise ValueError("Frozen protocol requires folds 0 1 2 3 4 and TTA disabled")

    run_root = args.run_root.resolve()
    rows, _portable, local_manifest_sha256, portable_manifest_sha256 = read_manifests(run_root)
    data_evidence = verify_data_assets(run_root, rows)
    kits23_identity = verify_git_source(
        args.kits23_source,
        EXPECTED_KITS23_COMMIT,
        "KiTS23",
        allow_crlf_equivalent=True,
    )

    archive = args.model_archive.resolve()
    if not archive.is_file() or archive.stat().st_size != EXPECTED_MODEL_BYTES:
        raise FileNotFoundError("Model archive is missing or has the wrong byte count")
    archive_md5 = hash_file(archive, "md5")
    archive_sha256 = hash_file(archive, "sha256")
    if archive_md5 != EXPECTED_MODEL_MD5 or archive_sha256 != EXPECTED_MODEL_SHA256:
        raise ValueError("Model archive checksum mismatch")

    run_verification: dict[str, Any] | None = None
    recorded_sources: set[Path] = set()
    recorded_results: set[Path] = set()
    if args.require_complete_run:
        run_verification, recorded_sources, recorded_results = verify_complete_run(
            run_root, args.folds, args.tta_enabled
        )

    recorded_sources.add(args.nnunet_source.resolve())
    recorded_results.add(args.results_folder.resolve())
    source_evidence = [
        verify_git_source(
            source,
            EXPECTED_NNUNET_COMMIT,
            "nnU-Net",
            allow_crlf_equivalent=True,
        )
        for source in sorted(recorded_sources, key=lambda value: str(value))
    ]
    ignored_inventory_digest = hashlib.sha256(
        json.dumps(
            sorted(
                item["ignored_untracked_inventory_sha256"]
                for item in source_evidence
            ),
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    canonical_fold_evidence: list[dict[str, Any]] | None = None
    for results_folder in recorded_results:
        evidence = verify_model_install(results_folder)
        if results_folder == args.results_folder.resolve():
            canonical_fold_evidence = evidence
    if canonical_fold_evidence is None:
        raise RuntimeError("Canonical model installation was not verified")

    import numpy as np
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available; the frozen inference gate failed")
    gpu = torch.cuda.get_device_properties(0)

    record = {
        "schema_version": 2,
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
        "research_only": True,
        "cohort": {
            "case_count": len(rows),
            "first_case": rows[0]["case_id"],
            "last_case": rows[-1]["case_id"],
            "portable_manifest_sha256": portable_manifest_sha256,
            "portable_manifest_path_free": True,
            "local_manifest_sha256": local_manifest_sha256,
            "kits23_commit": kits23_identity["commit"],
            "kits23_tracked_source_commit_equivalent": kits23_identity[
                "tracked_source_commit_equivalent"
            ],
            "kits23_tracked_working_tree_clean": kits23_identity[
                "tracked_working_tree_clean"
            ],
            "kits23_crlf_only_changed_files": kits23_identity[
                "crlf_only_changed_files"
            ],
            "kits23_unignored_untracked_files": kits23_identity[
                "unignored_untracked_files"
            ],
            "kits23_ignored_untracked_files": kits23_identity[
                "ignored_untracked_files"
            ],
            "kits23_ignored_untracked_bytes": kits23_identity[
                "ignored_untracked_bytes"
            ],
            "kits23_ignored_potentially_executable_files": kits23_identity[
                "ignored_potentially_executable_files"
            ],
            "kits23_ignored_inventory_sha256": kits23_identity[
                "ignored_untracked_inventory_sha256"
            ],
            "kits23_ignored_inventory_complete": True,
            "imaging_revision": EXPECTED_IMAGING_REVISION,
            "asset_verification": data_evidence,
        },
        "model": {
            "zenodo_record": "https://zenodo.org/records/5126443",
            "task": "Task135_KiTS2021",
            "configuration": "3d_fullres",
            "folds": args.folds,
            "tta_enabled": args.tta_enabled,
            "archive_bytes": archive.stat().st_size,
            "archive_md5": archive_md5,
            "archive_sha256": archive_sha256,
            "installed_folds": canonical_fold_evidence,
            "installed_plans": EXPECTED_PLANS,
            "postprocessing_file_present": False,
            "runtime_model_locations_verified": len(recorded_results),
            "legacy_checkpoint_notice": (
                "Official checksums establish transfer provenance, not pickle safety; "
                "loaded only in this isolated research environment."
            ),
        },
        "framework": {
            "nnunet_commit": EXPECTED_NNUNET_COMMIT,
            "runtime_source_locations_verified": len(recorded_sources),
            "all_runtime_tracked_sources_commit_equivalent": all(
                item["tracked_source_commit_equivalent"] for item in source_evidence
            ),
            "runtime_source_tracked_worktrees_clean": sum(
                bool(item["tracked_working_tree_clean"]) for item in source_evidence
            ),
            "runtime_source_tracked_worktrees_with_crlf_only_changes": sum(
                int(item["crlf_only_changed_files"] > 0) for item in source_evidence
            ),
            "runtime_source_unignored_untracked_files": sum(
                int(item["unignored_untracked_files"]) for item in source_evidence
            ),
            "runtime_source_ignored_untracked_files": sum(
                int(item["ignored_untracked_files"]) for item in source_evidence
            ),
            "runtime_source_ignored_untracked_bytes": sum(
                int(item["ignored_untracked_bytes"]) for item in source_evidence
            ),
            "runtime_source_ignored_potentially_executable_files": sum(
                int(item["ignored_potentially_executable_files"])
                for item in source_evidence
            ),
            "runtime_source_ignored_inventory_sha256": ignored_inventory_digest,
            "runtime_source_ignored_inventory_complete": True,
            "runtime_executable_source_purity_claimed": False,
            "crlf_equivalence_rule": (
                "Tracked runtime source is commit-equivalent only when there are no "
                "unignored untracked or staged files and git diff --ignore-cr-at-eol "
                "is empty. Git-ignored artefacts are separately inventoried."
            ),
            "ignored_artifact_caveat": (
                "Ignored runtime artefacts are counted and content-inventoried at capture "
                "time but are not upstream commit content; this record does not claim a "
                "pure executable source tree."
            ),
            "nnunet_package": package_version("nnunet"),
            "python": platform.python_version(),
            "torch": torch.__version__,
            "torch_cuda_runtime": torch.version.cuda,
            "numpy": np.__version__,
            "nibabel": package_version("nibabel"),
            "surface_distance": package_version("surface-distance"),
            "simpleitk": package_version("SimpleITK"),
            "platform": platform.platform(),
        },
        "hardware": {
            "cuda_available": True,
            "gpu_name": torch.cuda.get_device_name(0),
            "gpu_compute_capability": list(torch.cuda.get_device_capability(0)),
            "gpu_total_memory_bytes": int(gpu.total_memory),
        },
        "inference_contract": {
            "preprocessing_threads": 1,
            "nifti_save_threads": 1,
            "case_execution": "portable-manifest order; one case per WSL process",
            "retry_policy": "at most one identical retry per case",
            "prediction_gate": "3D, nonempty, finite, geometry-matched, integer labels 0..3",
            "actual_run_verification": run_verification,
        },
        "privacy": {
            "contains_patient_metadata": False,
            "contains_ct_voxels": False,
            "contains_prediction_voxels": False,
            "local_paths_omitted": True,
        },
    }
    output_path = run_root / "provenance.json"
    temporary = output_path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(temporary, output_path)
    print(json.dumps({"status": "ok", "provenance": str(output_path)}, indent=2))


if __name__ == "__main__":
    main()
