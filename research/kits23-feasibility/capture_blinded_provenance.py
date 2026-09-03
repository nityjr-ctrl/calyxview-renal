#!/usr/bin/env python3
"""Capture path-free, annotation-free provenance for a blinded inference run.

Run this after all frozen-cohort inference attempts have completed and before
``lock_predictions.py``.  The command has no annotation argument and never
loads an annotation or CT voxel array: it verifies byte counts, SHA-256
digests, the frozen model/source identity, and the runner's complete timing
evidence.  Case-level evidence is reduced to deterministic set digests in the
output so the record is safe to publish as an aggregate protocol artefact.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import io
import json
import math
import os
import platform
import re
import stat
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence


DISCLAIMER = (
    "RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE. NOT FOR DIAGNOSIS, "
    "TREATMENT SELECTION, SURGICAL PLANNING, MARGIN SELECTION, OR PATIENT CARE."
)
PROTOCOL_NAMESPACE = "calyxview-renal-kits23-blinded-v1"
PUBLIC_SEED = 20260901
SELECTION_COUNT = 20
ELIGIBLE_START = 420
ELIGIBLE_END = 588
ELIGIBLE_LIST_SHA256 = (
    "201fe1201cb06b666b1a497ddb0fd44edfe07fd8d9ed078d3db2bd82657acdea"
)
IMAGING_REPOSITORY = "neheller/KiTS-Challenge-Imaging"
IMAGING_REVISION = "65f1f295873a326230153c7e1de0c7dba10f0b29"
SELECTION_ALGORITHM = (
    "SHA-256(protocol_namespace + '|seed=' + decimal public_seed + '|' + "
    "case_id), sorted by ascending hexadecimal digest"
)
MANIFEST_COLUMNS = (
    "case_id",
    "selection_order",
    "selection_hash",
    "image_sha256",
    "image_bytes",
)

EXPECTED_NNUNET_COMMIT = "db16c6cef5fdd5a180159184e46b58bcca670446"
EXPECTED_MODEL_BYTES = 3_505_803_654
EXPECTED_MODEL_SHA256 = (
    "a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3"
)
EXPECTED_FOLDS = (0, 1, 2, 3, 4)
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

COHORT_LOCK_KEYS = {
    "schema_version",
    "protocol_namespace",
    "public_seed",
    "eligible_start",
    "eligible_end",
    "eligible_count",
    "eligible_list_sha256",
    "selection_count",
    "selection_algorithm",
    "manifest_sha256",
    "manifest_columns",
    "case_ids",
    "selection_hashes",
    "imaging_repository",
    "imaging_revision",
    "total_image_bytes",
    "created_utc",
    "research_only",
    "disclaimer",
}
MODEL_LOCK_KEYS = {
    "schema_version",
    "research_only",
    "created_at_utc",
    "disclaimer",
    "model",
    "task",
    "configuration",
    "folds",
    "tta_enabled",
    "source_archive",
    "nnunet_source_commit",
    "installed_plans",
    "installed_folds",
    "pipeline_source_artifact_hashes",
    "provenance_note",
}
TIMING_KEYS = {
    "schema_version",
    "run_mode",
    "disclaimer",
    "case_id",
    "cohort_position",
    "selection_order",
    "selection_hash",
    "input_image_relative",
    "input_image_sha256",
    "input_image_bytes",
    "prediction_relative",
    "manifest_sha256",
    "cohort_lock_sha256",
    "model_lock_sha256",
    "command_configuration_sha256",
    "artifact_hashes",
    "status",
    "attempts",
    "runtime_seconds",
    "started_utc",
    "finished_utc",
    "command_configuration",
    "attempt_records",
}
ATTEMPT_KEYS = {
    "case_id",
    "cohort_position",
    "selection_order",
    "selection_hash",
    "input_image_relative",
    "input_image_sha256",
    "input_image_bytes",
    "prediction_relative",
    "manifest_sha256",
    "cohort_lock_sha256",
    "model_lock_sha256",
    "command_configuration_sha256",
    "artifact_hashes",
    "attempt",
    "status",
    "exit_code",
    "runtime_seconds",
    "prediction_created",
    "prediction_validated",
    "validation_exit_code",
    "finalization_exit_code",
    "final_prediction_created",
    "process_start_error_type",
    "stdout_log_relative",
    "stderr_log_relative",
    "validation_stdout_relative",
    "validation_stderr_relative",
}
SOURCE_FILES = {
    "runner_sha256": "run_nnunet_wsl.ps1",
    "validator_sha256": "validate_prediction.py",
    "scratch_manager_sha256": "manage_native_scratch.py",
    "cohort_preparer_sha256": "prepare_blinded_cohort.py",
    "model_locker_sha256": "create_model_lock.py",
    "prediction_locker_sha256": "lock_predictions.py",
    "provenance_capturer_sha256": "capture_blinded_provenance.py",
    "evaluator_sha256": "evaluate_and_report.py",
    "reference_releaser_sha256": "release_references.py",
    "public_summary_builder_sha256": "make_blinded_public_summary.py",
}
TIMING_ARTIFACT_KEYS = {
    "runner_sha256",
    "validator_sha256",
    "scratch_manager_sha256",
}
CONFIGURATION_KEYS = {
    "launcher",
    "python",
    "python_module",
    "task",
    "model",
    "folds",
    "tta_enabled",
    "results_folder_wsl",
    "nnunet_source_wsl",
    "native_scratch_root_wsl",
    "input_directory_wsl",
    "output_directory_wsl",
    "prediction_relative",
    "predict_arguments",
    "validator_script_wsl",
    "retry_policy",
    "environment",
    "protocol_mode",
    "case_id",
    "cohort_position",
    "selection_order",
    "selection_hash",
    "input_image_relative",
    "input_image_wsl",
    "input_image_sha256",
    "input_image_bytes",
    "source_cache_relative",
    "manifest_sha256",
    "cohort_lock_sha256",
    "model_lock_sha256",
    "artifact_hashes",
}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
CASE_ID_PATTERN = re.compile(r"^case_[0-9]{5}$")
FORBIDDEN_NAME_PATTERN = re.compile(
    r"(?:^|[^a-z0-9])(?:labels?(?:tr|ts)?|references?|referencedata|"
    r"segmentations?|segments?|segs?|masks?|ground[-_ ]?truth|truth[-_ ]?masks?)"
    r"(?:$|[^a-z0-9])",
    re.IGNORECASE,
)
FORBIDDEN_MEDICAL_SUFFIXES = (
    ".dcm",
    ".dicom",
    ".mha",
    ".mhd",
    ".nrrd",
    ".rtstruct",
    ".seg",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Capture aggregate, path-free inference provenance before the prediction lock."
        )
    )
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--nnunet-source", type=Path, required=True)
    parser.add_argument("--results-folder", type=Path, required=True)
    parser.add_argument("--model-archive", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        help="Defaults to RUN_ROOT/provenance.inference.json.",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def compact_json(value: Any) -> str:
    """Match PowerShell ConvertTo-Json -Compress for the ASCII runner record."""

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def set_digest(records: Sequence[Mapping[str, Any]]) -> str:
    encoded = json.dumps(
        records, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_object(path: Path, label: str) -> dict[str, Any]:
    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"{label} contains duplicate JSON key {key!r}")
            result[key] = value
        return result

    try:
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raise ValueError(f"{label} must be UTF-8 without a byte-order mark")
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read {label}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def require_exact_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ValueError(f"{label} field mismatch; missing={missing}, extra={extra}")


def require_int(value: Any, label: str, *, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if minimum is not None and value < minimum:
        raise ValueError(f"{label} must be at least {minimum}")
    return value


def require_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    converted = float(value)
    if not math.isfinite(converted) or converted < 0:
        raise ValueError(f"{label} must be finite and non-negative")
    return converted


def require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return value


def require_utc(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty ISO-8601 timestamp")
    candidate = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as error:
        raise ValueError(f"{label} must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValueError(f"{label} must explicitly use UTC")
    return parsed


def reject_annotation_paths(run_root: Path) -> None:
    for candidate in sorted(run_root.rglob("*"), key=lambda item: item.as_posix()):
        relative = candidate.relative_to(run_root)
        if candidate.is_symlink():
            raise RuntimeError(f"Symlinks are forbidden below the inference root: {relative}")
        if any(FORBIDDEN_NAME_PATTERN.search(part) for part in relative.parts):
            raise RuntimeError(
                f"Annotation-like material is forbidden below the inference root: {relative}"
            )
        if not candidate.is_file():
            continue
        lower_name = candidate.name.lower()
        if any(lower_name.endswith(suffix) for suffix in FORBIDDEN_MEDICAL_SUFFIXES):
            raise RuntimeError(f"Forbidden medical file below the inference root: {relative}")
        if lower_name.endswith(".nii") or lower_name.endswith(".nii.gz"):
            parts = relative.parts
            allowed = False
            if len(parts) == 2 and parts[0] == "nnunet_input":
                allowed = re.fullmatch(r"case_[0-9]{5}_0000\.nii\.gz", parts[1]) is not None
            elif len(parts) == 3 and parts[:2] == ("source", "images"):
                allowed = re.fullmatch(r"case_[0-9]{5}\.nii\.gz", parts[2]) is not None
            elif len(parts) == 2 and parts[0] == "predictions":
                allowed = re.fullmatch(r"case_[0-9]{5}\.nii\.gz", parts[1]) is not None
            if not allowed:
                raise RuntimeError(
                    f"Unexpected NIfTI is forbidden below the inference root: {relative}"
                )


def expected_selection() -> tuple[tuple[str, str], ...]:
    eligible = tuple(
        f"case_{number:05d}" for number in range(ELIGIBLE_START, ELIGIBLE_END + 1)
    )
    eligible_bytes = ("\n".join(eligible) + "\n").encode("utf-8")
    if hashlib.sha256(eligible_bytes).hexdigest() != ELIGIBLE_LIST_SHA256:
        raise RuntimeError("Frozen eligible-list identity changed")
    ranked: list[tuple[str, str]] = []
    for case_id in eligible:
        material = f"{PROTOCOL_NAMESPACE}|seed={PUBLIC_SEED}|{case_id}".encode("utf-8")
        ranked.append((hashlib.sha256(material).hexdigest(), case_id))
    ranked.sort()
    return tuple((case_id, digest) for digest, case_id in ranked[:SELECTION_COUNT])


def read_manifest_and_locks(
    run_root: Path,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    manifest_path = run_root / "manifests" / "manifest.csv"
    cohort_path = run_root / "manifests" / "cohort-lock.public.json"
    model_path = run_root / "manifests" / "model-lock.json"
    for path, label in (
        (manifest_path, "manifest"),
        (cohort_path, "cohort lock"),
        (model_path, "model lock"),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"Required {label} is missing")

    raw_manifest = manifest_path.read_bytes()
    if raw_manifest.startswith(b"\xef\xbb\xbf") or b"\r" in raw_manifest:
        raise ValueError("Manifest must be UTF-8 without BOM and use LF line endings")
    if not raw_manifest.endswith(b"\n"):
        raise ValueError("Manifest must end with an LF newline")
    try:
        manifest_text = raw_manifest.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("Manifest is not valid UTF-8") from error
    reader = csv.DictReader(io.StringIO(manifest_text, newline=""))
    if tuple(reader.fieldnames or ()) != MANIFEST_COLUMNS:
        raise ValueError("Manifest does not have the exact frozen five-column schema")
    raw_rows = list(reader)
    if len(raw_rows) != SELECTION_COUNT or any(None in row for row in raw_rows):
        raise ValueError("Manifest must contain exactly 20 well-formed records")

    selected = expected_selection()
    rows: list[dict[str, Any]] = []
    for order, (raw, (expected_case, expected_hash)) in enumerate(
        zip(raw_rows, selected, strict=True), start=1
    ):
        if set(raw) != set(MANIFEST_COLUMNS):
            raise ValueError(f"Manifest row {order} has unexpected fields")
        case_id = raw["case_id"]
        if not isinstance(case_id, str) or not CASE_ID_PATTERN.fullmatch(case_id):
            raise ValueError(f"Manifest row {order} has an invalid case identifier")
        if case_id != expected_case or raw["selection_order"] != str(order):
            raise ValueError(f"Manifest row {order} violates frozen selection order")
        if raw["selection_hash"] != expected_hash:
            raise ValueError(f"Manifest selection hash mismatch at position {order}")
        image_sha256 = require_sha256(raw["image_sha256"], f"image digest at {order}")
        try:
            image_bytes = int(raw["image_bytes"])
        except (TypeError, ValueError) as error:
            raise ValueError(f"Manifest image byte count is invalid at {order}") from error
        if image_bytes <= 0 or raw["image_bytes"] != str(image_bytes):
            raise ValueError(f"Manifest image byte count is not canonical at {order}")
        rows.append(
            {
                "case_id": case_id,
                "selection_order": order,
                "selection_hash": expected_hash,
                "image_sha256": image_sha256,
                "image_bytes": image_bytes,
            }
        )

    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=list(MANIFEST_COLUMNS), lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    if buffer.getvalue().encode("utf-8") != raw_manifest:
        raise ValueError("Manifest bytes are not the canonical frozen encoding")

    manifest_sha256 = hashlib.sha256(raw_manifest).hexdigest()
    cohort = load_object(cohort_path, "cohort lock")
    require_exact_keys(cohort, COHORT_LOCK_KEYS, "Cohort lock")
    expected_ids = [record["case_id"] for record in rows]
    expected_hashes = [record["selection_hash"] for record in rows]
    fixed_values = {
        "schema_version": 1,
        "protocol_namespace": PROTOCOL_NAMESPACE,
        "public_seed": PUBLIC_SEED,
        "eligible_start": f"case_{ELIGIBLE_START:05d}",
        "eligible_end": f"case_{ELIGIBLE_END:05d}",
        "eligible_count": ELIGIBLE_END - ELIGIBLE_START + 1,
        "eligible_list_sha256": ELIGIBLE_LIST_SHA256,
        "selection_count": SELECTION_COUNT,
        "selection_algorithm": SELECTION_ALGORITHM,
        "manifest_sha256": manifest_sha256,
        "manifest_columns": list(MANIFEST_COLUMNS),
        "case_ids": expected_ids,
        "selection_hashes": expected_hashes,
        "imaging_repository": IMAGING_REPOSITORY,
        "imaging_revision": IMAGING_REVISION,
        "total_image_bytes": sum(record["image_bytes"] for record in rows),
        "research_only": True,
    }
    for key, expected in fixed_values.items():
        if cohort.get(key) != expected:
            raise ValueError(f"Cohort lock has an invalid {key} binding")
    require_utc(cohort.get("created_utc"), "Cohort lock creation time")

    model_lock = load_object(model_path, "model lock")
    require_exact_keys(model_lock, MODEL_LOCK_KEYS, "Model lock")
    if model_lock.get("schema_version") != 1 or model_lock.get("research_only") is not True:
        raise ValueError("Model lock must be the research-only schema v1 contract")
    require_utc(model_lock.get("created_at_utc"), "Model lock creation time")

    return rows, {
        "manifest_sha256": manifest_sha256,
        "cohort_lock_sha256": sha256_file(cohort_path),
        "model_lock_sha256": sha256_file(model_path),
    }


def verify_ct_files(run_root: Path, rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    source_root = run_root / "source" / "images"
    input_root = run_root / "nnunet_input"
    if not source_root.is_dir() or not input_root.is_dir():
        raise FileNotFoundError("Frozen source-image and inference-input directories are required")
    expected_source = {f"{row['case_id']}.nii.gz" for row in rows}
    expected_input = {f"{row['case_id']}_0000.nii.gz" for row in rows}
    actual_source = {item.name for item in source_root.iterdir() if item.is_file()}
    actual_input = {item.name for item in input_root.iterdir() if item.is_file()}
    if actual_source != expected_source or actual_input != expected_input:
        raise ValueError("Frozen CT directories do not contain exactly the 20 selected files")

    inventory: list[dict[str, Any]] = []
    total_bytes = 0
    for row in rows:
        case_id = str(row["case_id"])
        expected_sha = str(row["image_sha256"])
        expected_bytes = int(row["image_bytes"])
        for role, path in (
            ("source", source_root / f"{case_id}.nii.gz"),
            ("input", input_root / f"{case_id}_0000.nii.gz"),
        ):
            if not path.is_file() or path.stat().st_size != expected_bytes:
                raise ValueError(f"Frozen {role} CT byte-count mismatch for {case_id}")
            if sha256_file(path) != expected_sha:
                raise ValueError(f"Frozen {role} CT SHA-256 mismatch for {case_id}")
        total_bytes += expected_bytes
        inventory.append(
            {
                "case_id": case_id,
                "bytes": expected_bytes,
                "sha256": expected_sha,
            }
        )
    return {
        "ct_inputs_verified": len(rows),
        "ct_input_bytes": total_bytes,
        "ct_input_set_sha256": set_digest(inventory),
        "source_copies_verified": len(rows),
    }


def git_identity(source: Path) -> dict[str, Any]:
    resolved = source.resolve()
    if not resolved.is_dir():
        raise FileNotFoundError("nnU-Net source checkout is missing")
    base = ["git", "-c", f"safe.directory={resolved.as_posix()}", "-C", str(resolved)]
    commit_result = subprocess.run(
        [*base, "rev-parse", "HEAD"], check=True, capture_output=True, text=True
    )
    commit = commit_result.stdout.strip().lower()
    if commit != EXPECTED_NNUNET_COMMIT:
        raise ValueError(
            f"nnU-Net source commit mismatch: expected {EXPECTED_NNUNET_COMMIT}, got {commit}"
        )
    status_result = subprocess.run(
        [*base, "status", "--porcelain", "--untracked-files=no"],
        check=True,
        capture_output=True,
        text=True,
    )
    if status_result.stdout.strip():
        raise ValueError("nnU-Net tracked runtime source is not clean")
    return {"nnunet_source_commit": commit, "tracked_source_clean": True}


def _verify_file(path: Path, expected: Mapping[str, Any], label: str) -> dict[str, Any]:
    try:
        details = path.lstat()
    except FileNotFoundError:
        raise FileNotFoundError(f"{label} is missing")
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISREG(details.st_mode):
        raise ValueError(f"{label} must be a regular, non-symlink file")
    size = details.st_size
    digest = sha256_file(path)
    if size != expected.get("bytes") or digest != expected.get("sha256"):
        raise ValueError(f"{label} does not match its frozen identity")
    return {"bytes": size, "sha256": digest}


def verify_model(
    *,
    nnunet_source: Path,
    results_folder: Path,
    model_archive: Path,
    model_lock_path: Path,
    source_artifacts: Mapping[str, str],
) -> dict[str, Any]:
    model_lock = load_object(model_lock_path, "model lock")
    require_exact_keys(model_lock, MODEL_LOCK_KEYS, "Model lock")
    archive_expected = {"bytes": EXPECTED_MODEL_BYTES, "sha256": EXPECTED_MODEL_SHA256}
    archive = _verify_file(model_archive.resolve(), archive_expected, "Frozen model archive")
    if model_lock.get("source_archive") != archive:
        raise ValueError("Model lock does not bind the verified source archive")

    source_identity = git_identity(nnunet_source)
    fixed = {
        "schema_version": 1,
        "research_only": True,
        "task": "Task135_KiTS2021",
        "configuration": "3d_fullres",
        "folds": list(EXPECTED_FOLDS),
        "tta_enabled": False,
        "nnunet_source_commit": EXPECTED_NNUNET_COMMIT,
        "installed_plans": EXPECTED_PLANS,
    }
    for key, expected in fixed.items():
        if model_lock.get(key) != expected:
            raise ValueError(f"Model lock has an invalid {key} binding")
    locked_sources = model_lock.get("pipeline_source_artifact_hashes")
    if not isinstance(locked_sources, dict) or set(locked_sources) != set(SOURCE_FILES):
        raise ValueError("Model lock pipeline source hash set is incomplete or ambiguous")
    for key, value in locked_sources.items():
        require_sha256(value, f"Model lock pipeline source hash {key}")
    if locked_sources != dict(source_artifacts):
        raise ValueError("Live pipeline sources differ from the pre-inference model lock")

    model_root = results_folder.resolve() / MODEL_RELATIVE
    if (model_root / "postprocessing.json").exists():
        raise ValueError("Frozen runtime model unexpectedly contains postprocessing.json")
    plans = _verify_file(model_root / "plans.pkl", EXPECTED_PLANS, "Installed plans")
    installed_folds: list[dict[str, Any]] = []
    for fold in EXPECTED_FOLDS:
        specification = EXPECTED_CHECKPOINTS[fold]
        checkpoint = _verify_file(
            model_root / f"fold_{fold}" / "model_final_checkpoint.model",
            {
                "bytes": specification["checkpoint_bytes"],
                "sha256": specification["checkpoint_sha256"],
            },
            f"Installed fold {fold} checkpoint",
        )
        metadata = _verify_file(
            model_root / f"fold_{fold}" / "model_final_checkpoint.model.pkl",
            {
                "bytes": specification["metadata_bytes"],
                "sha256": specification["metadata_sha256"],
            },
            f"Installed fold {fold} metadata",
        )
        installed_folds.append(
            {"fold": fold, "checkpoint": checkpoint, "metadata": metadata}
        )
    if model_lock.get("installed_folds") != installed_folds:
        raise ValueError("Model lock does not bind the verified installed fold artefacts")

    return {
        **source_identity,
        "source_archive": archive,
        "installed_plans": plans,
        "installed_folds": installed_folds,
        "folds": list(EXPECTED_FOLDS),
        "tta_enabled": False,
    }


def collect_source_artifacts(pipeline_root: Path) -> dict[str, str]:
    evidence: dict[str, str] = {}
    for output_key, file_name in SOURCE_FILES.items():
        source = pipeline_root / file_name
        try:
            details = source.lstat()
        except FileNotFoundError:
            raise FileNotFoundError(f"Required frozen pipeline source is missing: {file_name}")
        if stat.S_ISLNK(details.st_mode) or not stat.S_ISREG(details.st_mode):
            raise ValueError(f"Frozen pipeline source must be a regular file: {file_name}")
        if details.st_size <= 0:
            raise ValueError(f"Frozen pipeline source is empty: {file_name}")
        evidence[output_key] = sha256_file(source)
    return evidence


def _verify_binding_fields(
    record: Mapping[str, Any],
    row: Mapping[str, Any],
    bindings: Mapping[str, str],
    artifact_hashes: Mapping[str, str],
    label: str,
) -> None:
    case_id = str(row["case_id"])
    expected = {
        "case_id": case_id,
        "cohort_position": int(row["selection_order"]),
        "selection_order": int(row["selection_order"]),
        "selection_hash": str(row["selection_hash"]),
        "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
        "input_image_sha256": str(row["image_sha256"]),
        "input_image_bytes": int(row["image_bytes"]),
        "prediction_relative": f"predictions/{case_id}.nii.gz",
        **bindings,
        "artifact_hashes": {
            key: artifact_hashes[key] for key in sorted(TIMING_ARTIFACT_KEYS)
        },
    }
    for key, expected_value in expected.items():
        actual = record.get(key)
        if key == "artifact_hashes" and isinstance(actual, dict):
            if set(actual) != TIMING_ARTIFACT_KEYS:
                raise ValueError(f"{label} has an invalid runner-artifact field set")
        if actual != expected_value:
            raise ValueError(f"{label} has an invalid {key} binding")


def _resolve_log(run_root: Path, relative: Any, expected: str, label: str) -> Path:
    if relative != expected:
        raise ValueError(f"{label} has a non-canonical log binding")
    parts = Path(expected).parts
    if Path(expected).is_absolute() or ".." in parts or not expected.startswith("logs/"):
        raise ValueError(f"{label} log binding escaped the run")
    path = run_root.joinpath(*expected.split("/"))
    if not path.is_file():
        raise FileNotFoundError(f"{label} bound log is missing")
    return path


def verify_execution(
    run_root: Path,
    rows: Sequence[Mapping[str, Any]],
    bindings: Mapping[str, str],
    artifact_hashes: Mapping[str, str],
    model_evidence: Mapping[str, Any],
) -> dict[str, Any]:
    timing_root = run_root / "timings"
    prediction_root = run_root / "predictions"
    if not timing_root.is_dir() or not prediction_root.is_dir():
        raise FileNotFoundError("Timing and prediction directories are required")
    expected_timing_names = {f"{row['case_id']}.json" for row in rows}
    actual_timing_names = {item.name for item in timing_root.iterdir() if item.is_file()}
    if actual_timing_names != expected_timing_names:
        raise ValueError("Timing directory does not contain exactly one record per frozen case")

    timing_inventory: list[dict[str, Any]] = []
    prediction_inventory: list[dict[str, Any]] = []
    log_inventory: list[dict[str, Any]] = []
    seen_logs: set[Path] = set()
    succeeded = 0
    failed = 0
    attempt_total = 0
    runtime_total = 0.0
    success_names: set[str] = set()

    for row in rows:
        case_id = str(row["case_id"])
        timing_path = timing_root / f"{case_id}.json"
        timing = load_object(timing_path, f"timing record {case_id}")
        require_exact_keys(timing, TIMING_KEYS, f"Timing record {case_id}")
        if timing.get("schema_version") != 2 or timing.get("run_mode") != (
            "research_feasibility_script_blinded"
        ):
            raise ValueError(f"Timing record {case_id} is not blinded schema v2")
        _verify_binding_fields(timing, row, bindings, artifact_hashes, f"Timing {case_id}")

        configuration = timing.get("command_configuration")
        if not isinstance(configuration, dict):
            raise ValueError(f"Timing {case_id} command configuration must be an object")
        require_exact_keys(
            configuration, CONFIGURATION_KEYS, f"Timing {case_id} command configuration"
        )
        configuration_sha256 = hashlib.sha256(
            compact_json(configuration).encode("utf-8")
        ).hexdigest()
        if timing.get("command_configuration_sha256") != configuration_sha256:
            raise ValueError(f"Timing {case_id} command configuration digest mismatch")
        configuration_expected = {
            "python_module": "nnunet.inference.predict_simple",
            "task": "Task135_KiTS2021",
            "model": "3d_fullres",
            "folds": [str(fold) for fold in model_evidence["folds"]],
            "tta_enabled": model_evidence["tta_enabled"],
            "retry_policy": "one identical retry after failure",
            "protocol_mode": "script_blinded_full_denominator",
            "case_id": case_id,
            "cohort_position": row["selection_order"],
            "selection_order": row["selection_order"],
            "selection_hash": row["selection_hash"],
            "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
            "input_image_sha256": row["image_sha256"],
            "input_image_bytes": row["image_bytes"],
            "source_cache_relative": f"source/images/{case_id}.nii.gz",
            "prediction_relative": f"predictions/{case_id}.nii.gz",
            **bindings,
            "artifact_hashes": {
                key: artifact_hashes[key] for key in sorted(TIMING_ARTIFACT_KEYS)
            },
        }
        for key, expected in configuration_expected.items():
            if configuration.get(key) != expected:
                raise ValueError(f"Timing {case_id} configuration has invalid {key}")
        for key in (
            "launcher",
            "python",
            "results_folder_wsl",
            "nnunet_source_wsl",
            "native_scratch_root_wsl",
            "validator_script_wsl",
        ):
            if not isinstance(configuration.get(key), str) or not configuration[key]:
                raise ValueError(f"Timing {case_id} configuration has empty {key}")
        for key in ("input_directory_wsl", "output_directory_wsl"):
            value = configuration.get(key)
            if not isinstance(value, str) or not value.replace("\\", "/").rstrip(
                "/"
            ).endswith(f"/{case_id}"):
                raise ValueError(f"Timing {case_id} configuration has cross-bound {key}")
        input_wsl = configuration.get("input_image_wsl")
        if not isinstance(input_wsl, str) or not input_wsl.replace("\\", "/").endswith(
            f"/{case_id}_0000.nii.gz"
        ):
            raise ValueError(f"Timing {case_id} configuration has cross-bound input image")
        if not isinstance(configuration.get("predict_arguments"), list) or not isinstance(
            configuration.get("environment"), dict
        ):
            raise ValueError(f"Timing {case_id} configuration structure is invalid")

        status = timing.get("status")
        attempts = timing.get("attempt_records")
        if status not in {"succeeded", "failed"} or not isinstance(attempts, list):
            raise ValueError(f"Timing {case_id} has invalid status or attempts")
        started = require_utc(timing.get("started_utc"), f"{case_id} started_utc")
        finished = require_utc(timing.get("finished_utc"), f"{case_id} finished_utc")
        if finished < started:
            raise ValueError(f"Timing {case_id} finishes before it starts")
        attempt_count = require_int(timing.get("attempts"), f"{case_id} attempts", minimum=1)
        if attempt_count != len(attempts) or attempt_count not in {1, 2}:
            raise ValueError(f"Timing {case_id} must contain one or two attempts")
        if status == "failed" and attempt_count != 2:
            raise ValueError(f"Failed case {case_id} must exhaust exactly two attempts")

        case_runtime = 0.0
        for attempt_index, attempt in enumerate(attempts, start=1):
            if not isinstance(attempt, dict):
                raise ValueError(f"Timing {case_id} attempt {attempt_index} is not an object")
            require_exact_keys(
                attempt, ATTEMPT_KEYS, f"Timing {case_id} attempt {attempt_index}"
            )
            _verify_binding_fields(
                attempt,
                row,
                bindings,
                artifact_hashes,
                f"Timing {case_id} attempt {attempt_index}",
            )
            if attempt.get("command_configuration_sha256") != configuration_sha256:
                raise ValueError(f"Timing {case_id} attempt configuration digest mismatch")
            if attempt.get("attempt") != attempt_index:
                raise ValueError(f"Timing {case_id} attempt sequence is not canonical")
            if isinstance(attempt.get("exit_code"), bool) or not isinstance(
                attempt.get("exit_code"), int
            ):
                raise ValueError(f"Timing {case_id} attempt exit_code must be an integer")
            for code_key in ("validation_exit_code", "finalization_exit_code"):
                code_value = attempt.get(code_key)
                if code_value is not None and (
                    isinstance(code_value, bool) or not isinstance(code_value, int)
                ):
                    raise ValueError(f"Timing {case_id} {code_key} is invalid")
            start_error = attempt.get("process_start_error_type")
            if start_error is not None and not isinstance(start_error, str):
                raise ValueError(f"Timing {case_id} process_start_error_type is invalid")
            expected_attempt_status = (
                "succeeded"
                if status == "succeeded" and attempt_index == attempt_count
                else "failed"
            )
            if attempt.get("status") != expected_attempt_status:
                raise ValueError(f"Timing {case_id} attempt status is inconsistent")
            attempt_runtime = require_number(
                attempt.get("runtime_seconds"), f"{case_id} attempt runtime"
            )
            case_runtime += attempt_runtime
            for boolean_key in (
                "prediction_created",
                "prediction_validated",
                "final_prediction_created",
            ):
                if not isinstance(attempt.get(boolean_key), bool):
                    raise ValueError(f"Timing {case_id} {boolean_key} must be Boolean")
            if expected_attempt_status == "succeeded":
                if (
                    attempt.get("exit_code") != 0
                    or attempt.get("validation_exit_code") != 0
                    or attempt.get("finalization_exit_code") != 0
                    or attempt.get("prediction_created") is not True
                    or attempt.get("prediction_validated") is not True
                    or attempt.get("final_prediction_created") is not True
                ):
                    raise ValueError(f"Timing {case_id} lacks successful final evidence")
            elif attempt.get("final_prediction_created") is not False:
                raise ValueError(f"Failed attempt for {case_id} claims a final prediction")

            log_specs = (
                (
                    "stdout_log_relative",
                    f"logs/{case_id}.attempt-{attempt_index}.stdout.log",
                ),
                (
                    "stderr_log_relative",
                    f"logs/{case_id}.attempt-{attempt_index}.stderr.log",
                ),
            )
            for key, expected_relative in log_specs:
                log_path = _resolve_log(
                    run_root,
                    attempt.get(key),
                    expected_relative,
                    f"Timing {case_id} attempt {attempt_index}",
                )
                if log_path not in seen_logs:
                    seen_logs.add(log_path)
                    log_inventory.append(
                        {
                            "case_id": case_id,
                            "attempt": attempt_index,
                            "kind": key,
                            "bytes": log_path.stat().st_size,
                            "sha256": sha256_file(log_path),
                        }
                    )
            for stream_name in ("stdout", "stderr"):
                key = f"validation_{stream_name}_relative"
                relative = attempt.get(key)
                if relative is None:
                    if expected_attempt_status == "succeeded":
                        raise ValueError(f"Successful attempt for {case_id} lacks validation logs")
                    continue
                expected_relative = (
                    f"logs/{case_id}.attempt-{attempt_index}.validation.{stream_name}.log"
                )
                log_path = _resolve_log(
                    run_root,
                    relative,
                    expected_relative,
                    f"Timing {case_id} attempt {attempt_index}",
                )
                if log_path not in seen_logs:
                    seen_logs.add(log_path)
                    log_inventory.append(
                        {
                            "case_id": case_id,
                            "attempt": attempt_index,
                            "kind": key,
                            "bytes": log_path.stat().st_size,
                            "sha256": sha256_file(log_path),
                        }
                    )

        recorded_runtime = require_number(timing.get("runtime_seconds"), f"{case_id} runtime")
        if abs(recorded_runtime - case_runtime) > 0.001:
            raise ValueError(f"Timing {case_id} runtime does not equal attempt runtimes")
        runtime_total += recorded_runtime
        attempt_total += attempt_count

        prediction = prediction_root / f"{case_id}.nii.gz"
        if status == "succeeded":
            if not prediction.is_file() or prediction.stat().st_size <= 0:
                raise FileNotFoundError(f"Successful case {case_id} is missing its prediction")
            prediction_inventory.append(
                {
                    "case_id": case_id,
                    "bytes": prediction.stat().st_size,
                    "sha256": sha256_file(prediction),
                }
            )
            success_names.add(prediction.name)
            succeeded += 1
        else:
            if prediction.exists():
                raise ValueError(f"Failed case {case_id} unexpectedly has a prediction")
            failed += 1

        timing_inventory.append(
            {
                "case_id": case_id,
                "bytes": timing_path.stat().st_size,
                "sha256": sha256_file(timing_path),
                "status": status,
            }
        )

    actual_prediction_names = {
        item.name for item in prediction_root.iterdir() if item.is_file()
    }
    if actual_prediction_names != success_names:
        raise ValueError("Prediction directory contains unbound or missing files")

    return {
        "attempted_cases": len(rows),
        "timing_records_verified": len(timing_inventory),
        "timing_set_sha256": set_digest(timing_inventory),
        "attempts_verified": attempt_total,
        "succeeded_predictions": succeeded,
        "exhausted_failures": failed,
        "prediction_bytes": sum(item["bytes"] for item in prediction_inventory),
        "prediction_set_sha256": set_digest(prediction_inventory),
        "bound_logs_verified": len(log_inventory),
        "bound_log_set_sha256": set_digest(log_inventory),
        "runtime_seconds": round(runtime_total, 3),
        "full_denominator_preserved": succeeded + failed == len(rows),
    }


def package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


def gpu_evidence() -> dict[str, Any]:
    command = [
        "nvidia-smi",
        "--query-gpu=name,driver_version,memory.total",
        "--format=csv,noheader,nounits",
    ]
    try:
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=10
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as error:
        return {"available": False, "probe_error_type": type(error).__name__}
    if result.returncode != 0:
        return {"available": False, "probe_exit_code": result.returncode}
    rows = []
    for line in result.stdout.splitlines():
        fields = [field.strip() for field in line.split(",")]
        if len(fields) != 3:
            continue
        try:
            memory_mib = int(fields[2])
        except ValueError:
            continue
        rows.append(
            {"name": fields[0], "driver_version": fields[1], "memory_mib": memory_mib}
        )
    return {
        "available": bool(rows),
        "devices": rows,
        "probe_output_sha256": hashlib.sha256(result.stdout.encode("utf-8")).hexdigest(),
    }


def runtime_evidence() -> dict[str, Any]:
    return {
        "python": {
            "implementation": platform.python_implementation(),
            "version": platform.python_version(),
        },
        "system": {
            "name": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "packages": {
            name: package_version(name)
            for name in ("nibabel", "numpy", "scipy", "torch")
        },
        "gpu": gpu_evidence(),
    }


def write_once(path: Path, payload: Mapping[str, Any]) -> None:
    destination = path.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(f"Refusing to replace existing inference provenance: {destination}")
    serialized = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, destination)
        temporary = None
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def capture_provenance(
    *,
    run_root: Path,
    nnunet_source: Path,
    results_folder: Path,
    model_archive: Path,
    output: Path | None = None,
    pipeline_root: Path | None = None,
) -> dict[str, Any]:
    run_root = run_root.resolve()
    if not run_root.is_dir():
        raise NotADirectoryError(run_root)
    output = output.resolve() if output is not None else run_root / "provenance.inference.json"
    if (run_root / "prediction-lock.json").exists() or (
        run_root / "prediction-lock.sha256"
    ).exists():
        raise RuntimeError("Prediction lock already exists; provenance must be captured first")
    if output.exists():
        raise FileExistsError(f"Inference provenance already exists: {output}")

    reject_annotation_paths(run_root)
    rows, bindings = read_manifest_and_locks(run_root)
    ct_evidence = verify_ct_files(run_root, rows)
    source_artifacts = collect_source_artifacts(
        pipeline_root.resolve() if pipeline_root is not None else Path(__file__).resolve().parent
    )
    model_evidence = verify_model(
        nnunet_source=nnunet_source,
        results_folder=results_folder,
        model_archive=model_archive,
        model_lock_path=run_root / "manifests" / "model-lock.json",
        source_artifacts=source_artifacts,
    )
    execution = verify_execution(
        run_root, rows, bindings, source_artifacts, model_evidence
    )
    if execution["attempted_cases"] != SELECTION_COUNT or not execution[
        "full_denominator_preserved"
    ]:
        raise ValueError("Complete 20-case denominator was not preserved")

    payload: dict[str, Any] = {
        "schema_version": 1,
        "research_only": True,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
        "protocol_mode": "script_blinded_full_denominator",
        **bindings,
        "cohort": ct_evidence,
        "model": model_evidence,
        "source_artifacts": source_artifacts,
        "execution": execution,
        "runtime": runtime_evidence(),
        "data_access": {
            "annotation_data_accessed": False,
            "ct_voxel_arrays_loaded": False,
            "case_level_metrics_emitted": False,
            "absolute_or_relative_paths_emitted": False,
        },
    }
    write_once(output, payload)
    reject_annotation_paths(run_root)
    return payload


def main() -> None:
    args = parse_args()
    payload = capture_provenance(
        run_root=args.run_root,
        nnunet_source=args.nnunet_source,
        results_folder=args.results_folder,
        model_archive=args.model_archive,
        output=args.output,
    )
    destination = (
        args.output.resolve()
        if args.output is not None
        else args.run_root.resolve() / "provenance.inference.json"
    )
    print(
        json.dumps(
            {
                "status": "ok",
                "sha256": sha256_file(destination),
                "attempted_cases": payload["execution"]["attempted_cases"],
                "succeeded_predictions": payload["execution"]["succeeded_predictions"],
                "exhausted_failures": payload["execution"]["exhausted_failures"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
