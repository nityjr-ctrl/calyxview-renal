#!/usr/bin/env python3
"""Freeze a reference-free nnU-Net run before any KiTS labels are released.

The locker accepts only the deliberately small blinded inference tree produced by
``prepare_blinded_cohort.py`` and ``run_nnunet_wsl.ps1``.  It never accepts a
reference path and never opens a reference segmentation.  Successful predictions
are checked against CT geometry, while failed cases must preserve two failed
attempts and no canonical prediction.

Private, case-linked evidence is written to ``prediction-lock.json``.  The only
public artefact is ``prediction-lock.sha256``, containing one SHA-256 digest and a
newline.  Existing lock artefacts are immutable and are never replaced.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Sequence

import nibabel as nib
import numpy as np


EXPECTED_CASE_COUNT = 20
PROTOCOL_NAMESPACE = "calyxview-renal-kits23-blinded-v1"
PUBLIC_SEED = 20260901
ELIGIBLE_START = "case_00420"
ELIGIBLE_END = "case_00588"
ELIGIBLE_LIST_SHA256 = (
    "201fe1201cb06b666b1a497ddb0fd44edfe07fd8d9ed078d3db2bd82657acdea"
)
EXPECTED_CASE_IDS = (
    "case_00474",
    "case_00537",
    "case_00572",
    "case_00501",
    "case_00465",
    "case_00546",
    "case_00585",
    "case_00468",
    "case_00584",
    "case_00459",
    "case_00503",
    "case_00504",
    "case_00542",
    "case_00505",
    "case_00523",
    "case_00583",
    "case_00462",
    "case_00498",
    "case_00502",
    "case_00510",
)
SELECTION_ALGORITHM = (
    "SHA-256(protocol_namespace + '|seed=' + decimal public_seed + '|' + "
    "case_id), sorted by ascending hexadecimal digest"
)
IMAGING_REPOSITORY = "neheller/KiTS-Challenge-Imaging"
IMAGING_REVISION = "65f1f295873a326230153c7e1de0c7dba10f0b29"
EXPECTED_MANIFEST_COLUMNS = [
    "case_id",
    "selection_order",
    "selection_hash",
    "image_sha256",
    "image_bytes",
]
CASE_ID_RE = re.compile(r"^case_\d{5}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
PIPELINE_ARTIFACTS = {
    "runner_sha256": "run_nnunet_wsl.ps1",
    "validator_sha256": "validate_prediction.py",
    "scratch_manager_sha256": "manage_native_scratch.py",
}
PROVENANCE_SOURCE_ARTIFACTS = {
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
EXPECTED_COHORT_LOCK_KEYS = {
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
EXPECTED_MODEL_LOCK_KEYS = {
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
EXPECTED_CONFIGURATION_KEYS = {
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
EXPECTED_TIMING_KEYS = {
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
EXPECTED_ATTEMPT_KEYS = {
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
PRIVATE_LOCK_NAME = "prediction-lock.json"
PUBLIC_LOCK_NAME = "prediction-lock.sha256"
DISCLAIMER = (
    "RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE. NOT FOR DIAGNOSIS, "
    "TREATMENT SELECTION, SURGICAL PLANNING, MARGIN SELECTION, OR PATIENT CARE."
)
FORBIDDEN_NAME_TOKENS = {
    "annotation",
    "annotations",
    "groundtruth",
    "label",
    "labels",
    "labelstr",
    "labelsts",
    "mask",
    "masks",
    "reference",
    "references",
    "segmentation",
    "segmentations",
    "truth",
}
FORBIDDEN_MEDICAL_SUFFIXES = {
    ".dcm",
    ".dicom",
    ".mha",
    ".mhd",
    ".nrrd",
    ".rtstruct",
    ".seg",
}


class LockError(ValueError):
    """Raised when the inference tree cannot be frozen safely."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Lock a 20-case blinded prediction run before reference release."
    )
    parser.add_argument("--run-root", type=Path, required=True)
    return parser.parse_args()


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _require_int(value: Any, label: str, *, minimum: int | None = None) -> int:
    if not _is_int(value):
        raise LockError(f"{label} must be an integer")
    if minimum is not None and value < minimum:
        raise LockError(f"{label} must be at least {minimum}")
    return value


def _require_nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise LockError(f"{label} must be a non-empty string")
    return value


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise LockError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _require_exact_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise LockError(
            f"{label} key set is not exact; "
            f"missing={sorted(expected - actual)}, extra={sorted(actual - expected)}"
        )


def _require_iso_utc(value: Any, label: str) -> str:
    text = _require_nonempty_string(value, label)
    candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise LockError(f"{label} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise LockError(f"{label} must explicitly use UTC")
    return text


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_without_duplicate_keys(text: str, label: str) -> Any:
    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise LockError(f"{label} contains duplicate JSON key {key!r}")
            result[key] = value
        return result

    try:
        return json.loads(text, object_pairs_hook=object_pairs)
    except LockError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LockError(f"{label} is not valid UTF-8 JSON: {exc}") from exc


def load_json_object(path: Path, label: str) -> dict[str, Any]:
    require_regular_file(path, label)
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        raise LockError(f"{label} is not valid UTF-8") from exc
    value = _json_without_duplicate_keys(text, label)
    if not isinstance(value, dict):
        raise LockError(f"{label} must contain one JSON object")
    return value


def compact_json_sha256(value: Any) -> str:
    """Hash compact JSON while preserving the timing record's property order."""

    payload = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def require_regular_file(path: Path, label: str, *, allow_empty: bool = False) -> None:
    try:
        details = path.lstat()
    except FileNotFoundError as exc:
        raise LockError(f"{label} is missing: {path}") from exc
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISREG(details.st_mode):
        raise LockError(f"{label} must be a regular, non-symlink file: {path}")
    if not allow_empty and details.st_size <= 0:
        raise LockError(f"{label} is empty: {path}")


def _relative_posix(run_root: Path, path: Path) -> str:
    try:
        return path.relative_to(run_root).as_posix()
    except ValueError as exc:
        raise LockError(f"Path escapes the inference root: {path}") from exc


def _bound_relative_path(run_root: Path, value: Any, label: str) -> tuple[str, Path]:
    text = _require_nonempty_string(value, label)
    pure = PurePosixPath(text)
    if pure.is_absolute() or not pure.parts or any(part in ("", ".", "..") for part in pure.parts):
        raise LockError(f"{label} must be a normalized relative POSIX path")
    if "\\" in text or pure.as_posix() != text:
        raise LockError(f"{label} must use an exact normalized POSIX path")
    path = run_root.joinpath(*pure.parts)
    return text, path


def _name_tokens(name: str) -> set[str]:
    base = name.lower().replace("ground-truth", "groundtruth").replace("ground_truth", "groundtruth")
    return {token for token in re.split(r"[^a-z0-9]+", base) if token}


def reject_reference_material_before_reads(run_root: Path) -> None:
    """Fail before opening any NIfTI if reference-like material is present."""

    for path in run_root.rglob("*"):
        relative = _relative_posix(run_root, path)
        try:
            details = path.lstat()
        except FileNotFoundError as exc:
            raise LockError(f"Inference tree changed during inspection: {relative}") from exc
        if stat.S_ISLNK(details.st_mode):
            raise LockError(f"Symlinks are forbidden in the inference root: {relative}")
        for part in path.relative_to(run_root).parts:
            forbidden = _name_tokens(part) & FORBIDDEN_NAME_TOKENS
            if forbidden:
                raise LockError(
                    f"Reference/label-like material is forbidden before locking: {relative}"
                )
        if not stat.S_ISREG(details.st_mode):
            continue
        lower_name = path.name.lower()
        if any(lower_name.endswith(suffix) for suffix in FORBIDDEN_MEDICAL_SUFFIXES):
            raise LockError(f"Forbidden medical/reference file in inference root: {relative}")
        if lower_name.endswith(".nii") or lower_name.endswith(".nii.gz"):
            parts = path.relative_to(run_root).parts
            allowed = False
            if len(parts) == 2 and parts[0] == "nnunet_input":
                allowed = re.fullmatch(r"case_\d{5}_0000\.nii\.gz", parts[1]) is not None
            elif len(parts) == 3 and parts[:2] == ("source", "images"):
                allowed = re.fullmatch(r"case_\d{5}\.nii\.gz", parts[2]) is not None
            elif len(parts) == 2 and parts[0] == "predictions":
                allowed = re.fullmatch(r"case_\d{5}\.nii\.gz", parts[1]) is not None
            if not allowed:
                raise LockError(f"Unexpected NIfTI (possible reference material): {relative}")


def read_manifest(path: Path) -> tuple[list[dict[str, Any]], str]:
    require_regular_file(path, "Frozen manifest")
    payload = path.read_bytes()
    if payload.startswith(b"\xef\xbb\xbf"):
        raise LockError("Frozen manifest must be UTF-8 without a byte-order mark")
    if b"\r" in payload or not payload.endswith(b"\n"):
        raise LockError("Frozen manifest must use LF line endings and end in one newline")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise LockError("Frozen manifest is not valid UTF-8") from exc
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    try:
        rows = list(reader)
    except csv.Error as exc:
        raise LockError(f"Frozen manifest is not valid CSV: {exc}") from exc
    if not rows or rows[0] != EXPECTED_MANIFEST_COLUMNS:
        raise LockError(
            "Frozen manifest columns must be exactly: "
            + ",".join(EXPECTED_MANIFEST_COLUMNS)
        )
    if len(rows) != EXPECTED_CASE_COUNT + 1:
        raise LockError(f"Frozen manifest must contain exactly {EXPECTED_CASE_COUNT} rows")

    parsed: list[dict[str, Any]] = []
    seen: set[str] = set()
    for position, row in enumerate(rows[1:], start=1):
        if len(row) != len(EXPECTED_MANIFEST_COLUMNS):
            raise LockError(f"Manifest row {position + 1} has the wrong column count")
        case_id, order_text, selection_hash, image_sha256, bytes_text = row
        if CASE_ID_RE.fullmatch(case_id) is None or case_id in seen:
            raise LockError(f"Manifest case identity is invalid or duplicated at row {position + 1}")
        seen.add(case_id)
        if order_text != str(position):
            raise LockError(f"Manifest selection_order is not exact at {case_id}")
        _require_sha256(selection_hash, f"selection_hash for {case_id}")
        _require_sha256(image_sha256, f"image_sha256 for {case_id}")
        if not bytes_text.isascii() or not bytes_text.isdigit() or bytes_text.startswith("0"):
            raise LockError(f"image_bytes for {case_id} must be a positive canonical integer")
        image_bytes = int(bytes_text)
        if image_bytes <= 0:
            raise LockError(f"image_bytes for {case_id} must be positive")
        parsed.append(
            {
                "case_id": case_id,
                "selection_order": position,
                "selection_hash": selection_hash,
                "image_sha256": image_sha256,
                "image_bytes": image_bytes,
            }
        )
    return parsed, hashlib.sha256(payload).hexdigest()


def validate_cohort_lock(
    cohort: Mapping[str, Any], rows: Sequence[Mapping[str, Any]], manifest_sha256: str
) -> None:
    _require_exact_keys(cohort, EXPECTED_COHORT_LOCK_KEYS, "Cohort lock")
    if cohort.get("schema_version") != 1:
        raise LockError("Cohort lock schema_version must be 1")
    if cohort.get("research_only") is not True:
        raise LockError("Cohort lock must state research_only=true")
    if cohort.get("protocol_namespace") != PROTOCOL_NAMESPACE:
        raise LockError("Cohort protocol_namespace differs from the preregistered protocol")
    if cohort.get("public_seed") != PUBLIC_SEED:
        raise LockError("Cohort public_seed differs from the preregistered protocol")
    eligible_start_text = _require_nonempty_string(cohort.get("eligible_start"), "eligible_start")
    eligible_end_text = _require_nonempty_string(cohort.get("eligible_end"), "eligible_end")
    if CASE_ID_RE.fullmatch(eligible_start_text) is None or CASE_ID_RE.fullmatch(eligible_end_text) is None:
        raise LockError("Cohort eligible_start/eligible_end must be exact KiTS case-ID strings")
    eligible_start = int(eligible_start_text.removeprefix("case_"))
    eligible_end = int(eligible_end_text.removeprefix("case_"))
    if eligible_start_text != ELIGIBLE_START or eligible_end_text != ELIGIBLE_END:
        raise LockError("Cohort eligible range differs from the preregistered protocol")
    eligible_count = _require_int(cohort.get("eligible_count"), "eligible_count", minimum=EXPECTED_CASE_COUNT)
    if eligible_count != eligible_end - eligible_start + 1:
        raise LockError("Cohort eligible range does not match eligible_count")
    eligible_ids = [f"case_{number:05d}" for number in range(eligible_start, eligible_end + 1)]
    eligible_digest = hashlib.sha256(("\n".join(eligible_ids) + "\n").encode("utf-8")).hexdigest()
    if eligible_digest != ELIGIBLE_LIST_SHA256 or cohort.get("eligible_list_sha256") != eligible_digest:
        raise LockError("Cohort eligible-list identity differs from the preregistered protocol")
    if cohort.get("selection_algorithm") != SELECTION_ALGORITHM:
        raise LockError("Cohort selection_algorithm differs from the preregistered protocol")
    if cohort.get("imaging_repository") != IMAGING_REPOSITORY:
        raise LockError("Cohort imaging_repository differs from the preregistered protocol")
    if cohort.get("imaging_revision") != IMAGING_REVISION:
        raise LockError("Cohort imaging_revision differs from the preregistered protocol")
    _require_iso_utc(cohort.get("created_utc"), "cohort created_utc")
    if cohort.get("selection_count") != EXPECTED_CASE_COUNT:
        raise LockError(f"Cohort lock selection_count must be {EXPECTED_CASE_COUNT}")
    if cohort.get("manifest_sha256") != manifest_sha256:
        raise LockError("Cohort lock does not bind the exact manifest bytes")
    if cohort.get("manifest_columns") != EXPECTED_MANIFEST_COLUMNS:
        raise LockError("Cohort lock manifest_columns do not match the exact manifest contract")
    expected_ids = [row["case_id"] for row in rows]
    expected_selections = [row["selection_hash"] for row in rows]
    ranked = sorted(
        (
            hashlib.sha256(
                f"{PROTOCOL_NAMESPACE}|seed={PUBLIC_SEED}|{case_id}".encode("utf-8")
            ).hexdigest(),
            case_id,
        )
        for case_id in eligible_ids
    )[:EXPECTED_CASE_COUNT]
    preregistered_ids = [case_id for _, case_id in ranked]
    preregistered_hashes = [digest for digest, _ in ranked]
    if tuple(preregistered_ids) != EXPECTED_CASE_IDS:
        raise LockError("Internal preregistered case fixture no longer matches the selection formula")
    if expected_ids != preregistered_ids or expected_selections != preregistered_hashes:
        raise LockError("Manifest identity/order differs from the preregistered cohort")
    if cohort.get("case_ids") != expected_ids:
        raise LockError("Cohort lock case_ids do not match manifest identity/order")
    if cohort.get("selection_hashes") != expected_selections:
        raise LockError("Cohort lock selection_hashes do not match the manifest")
    if cohort.get("total_image_bytes") != sum(row["image_bytes"] for row in rows):
        raise LockError("Cohort lock total_image_bytes does not match the manifest")


def _validate_hash_and_size_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise LockError(f"{label} must be an object")
    digest = _require_sha256(value.get("sha256"), f"{label}.sha256")
    size = _require_int(value.get("bytes"), f"{label}.bytes", minimum=1)
    return {"sha256": digest, "bytes": size}


def validate_model_lock(model_lock: Mapping[str, Any]) -> None:
    _require_exact_keys(model_lock, EXPECTED_MODEL_LOCK_KEYS, "Model lock")
    if model_lock.get("schema_version") != 1:
        raise LockError("Model lock schema_version must be 1")
    if model_lock.get("research_only") is not True:
        raise LockError("Model lock must state research_only=true")
    _require_iso_utc(model_lock.get("created_at_utc"), "model lock created_at_utc")
    _require_nonempty_string(model_lock.get("model"), "model lock model")
    _require_nonempty_string(model_lock.get("task"), "model lock task")
    _require_nonempty_string(model_lock.get("configuration"), "model lock configuration")
    if not isinstance(model_lock.get("tta_enabled"), bool):
        raise LockError("Model lock tta_enabled must be a boolean")
    folds = model_lock.get("folds")
    if (
        not isinstance(folds, list)
        or not folds
        or any(not _is_int(fold) or fold < 0 for fold in folds)
        or len(set(folds)) != len(folds)
        or folds != sorted(folds)
    ):
        raise LockError("Model lock folds must be a non-empty ordered unique integer list")
    _validate_hash_and_size_object(model_lock.get("source_archive"), "source_archive")
    commit = model_lock.get("nnunet_source_commit")
    if not isinstance(commit, str) or GIT_COMMIT_RE.fullmatch(commit) is None:
        raise LockError("Model lock nnunet_source_commit must be a lowercase 40-hex commit")
    _validate_hash_and_size_object(model_lock.get("installed_plans"), "installed_plans")
    installed = model_lock.get("installed_folds")
    if not isinstance(installed, list) or len(installed) != len(folds):
        raise LockError("Model lock installed_folds must cover every frozen fold exactly once")
    installed_numbers: list[int] = []
    for index, record in enumerate(installed):
        if not isinstance(record, dict):
            raise LockError(f"installed_folds[{index}] must be an object")
        fold = _require_int(record.get("fold"), f"installed_folds[{index}].fold", minimum=0)
        installed_numbers.append(fold)
        _validate_hash_and_size_object(record.get("checkpoint"), f"fold {fold} checkpoint")
        _validate_hash_and_size_object(record.get("metadata"), f"fold {fold} metadata")
    if installed_numbers != folds:
        raise LockError("Model lock installed_folds order/identity does not match folds")
    source_artifacts = model_lock.get("pipeline_source_artifact_hashes")
    if (
        not isinstance(source_artifacts, dict)
        or set(source_artifacts) != set(PROVENANCE_SOURCE_ARTIFACTS)
    ):
        raise LockError("Model lock pipeline source hash set is incomplete or ambiguous")
    for key, value in source_artifacts.items():
        _require_sha256(value, f"model lock pipeline_source_artifact_hashes.{key}")


def _record_bound_file(
    bound: dict[Path, tuple[str, int]], path: Path, label: str, *, allow_empty: bool = False
) -> dict[str, Any]:
    require_regular_file(path, label, allow_empty=allow_empty)
    digest = sha256_file(path)
    size = path.stat().st_size
    previous = bound.setdefault(path, (digest, size))
    if previous != (digest, size):
        raise LockError(f"Bound artefact changed while being inspected: {path}")
    return {"sha256": digest, "bytes": size}


def verify_image_copies(
    run_root: Path,
    rows: Sequence[Mapping[str, Any]],
    bound: dict[Path, tuple[str, int]],
) -> tuple[set[str], list[dict[str, Any]]]:
    expected_files: set[str] = set()
    evidence: list[dict[str, Any]] = []
    for row in rows:
        case_id = row["case_id"]
        paths = {
            "input": run_root / "nnunet_input" / f"{case_id}_0000.nii.gz",
            "source_cache": run_root / "source" / "images" / f"{case_id}.nii.gz",
        }
        case_evidence: dict[str, Any] = {
            "case_id": case_id,
            "selection_order": row["selection_order"],
            "selection_hash": row["selection_hash"],
            "image_sha256": row["image_sha256"],
            "image_bytes": row["image_bytes"],
        }
        for kind, path in paths.items():
            relative = _relative_posix(run_root, path)
            expected_files.add(relative)
            actual = _record_bound_file(bound, path, f"{kind} CT for {case_id}")
            if actual["sha256"] != row["image_sha256"] or actual["bytes"] != row["image_bytes"]:
                raise LockError(f"{kind} CT does not match frozen manifest for {case_id}")
            case_evidence[f"{kind}_relative"] = relative
        evidence.append(case_evidence)
    return expected_files, evidence


def _normalise_folds(value: Any, label: str) -> list[int]:
    if not isinstance(value, list) or not value:
        raise LockError(f"{label} must be a non-empty list")
    result: list[int] = []
    for item in value:
        if _is_int(item):
            fold = item
        elif isinstance(item, str) and item.isascii() and item.isdigit():
            fold = int(item)
        else:
            raise LockError(f"{label} contains an invalid fold")
        result.append(fold)
    if len(set(result)) != len(result):
        raise LockError(f"{label} contains duplicate folds")
    return result


def _require_case_config_binding(
    configuration: Mapping[str, Any],
    case_id: str,
    position: int,
    row: Mapping[str, Any],
    prediction_relative: str,
    manifest_sha256: str,
    cohort_lock_sha256: str,
    model_lock_sha256: str,
    artifact_hashes: Mapping[str, str],
    model_lock: Mapping[str, Any],
) -> None:
    _require_exact_keys(configuration, EXPECTED_CONFIGURATION_KEYS, f"Command configuration for {case_id}")
    expected_scalars = {
        "protocol_mode": "script_blinded_full_denominator",
        "case_id": case_id,
        "cohort_position": position,
        "selection_order": position,
        "selection_hash": row["selection_hash"],
        "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
        "input_image_sha256": row["image_sha256"],
        "input_image_bytes": row["image_bytes"],
        "source_cache_relative": f"source/images/{case_id}.nii.gz",
        "manifest_sha256": manifest_sha256,
        "cohort_lock_sha256": cohort_lock_sha256,
        "model_lock_sha256": model_lock_sha256,
    }
    for key, expected in expected_scalars.items():
        if configuration.get(key) != expected:
            raise LockError(f"Command configuration {key} is not bound to {case_id}")
    if configuration.get("artifact_hashes") != artifact_hashes:
        raise LockError(f"Command configuration artefact hashes differ for {case_id}")
    if configuration.get("prediction_relative") != prediction_relative:
        raise LockError(f"Command configuration prediction path is cross-bound for {case_id}")
    for key in ("input_directory_wsl", "output_directory_wsl"):
        value = _require_nonempty_string(configuration.get(key), f"{key} for {case_id}")
        if not value.replace("\\", "/").rstrip("/").endswith("/" + case_id):
            raise LockError(f"Command configuration {key} is not bound to {case_id}")
    input_wsl = _require_nonempty_string(
        configuration.get("input_image_wsl"), f"input_image_wsl for {case_id}"
    )
    if not input_wsl.replace("\\", "/").endswith(f"/{case_id}_0000.nii.gz"):
        raise LockError(f"Command configuration input_image_wsl is not bound to {case_id}")
    if configuration.get("task") != model_lock.get("task"):
        raise LockError(f"Command task differs from model lock for {case_id}")
    if configuration.get("model") != model_lock.get("configuration"):
        raise LockError(f"Command configuration differs from model lock for {case_id}")
    if _normalise_folds(configuration.get("folds"), f"command folds for {case_id}") != model_lock.get("folds"):
        raise LockError(f"Command folds differ from model lock for {case_id}")
    if configuration.get("tta_enabled") is not model_lock.get("tta_enabled"):
        raise LockError(f"Command TTA setting differs from model lock for {case_id}")


def _validate_geometry(source_path: Path, prediction_path: Path, case_id: str) -> list[int]:
    """Read only the frozen CT and its prediction; never a reference image."""

    try:
        source = nib.load(str(source_path))
        prediction = nib.load(str(prediction_path))
    except Exception as exc:  # nibabel exposes format-specific exception types
        raise LockError(f"Could not open CT/prediction geometry for {case_id}: {exc}") from exc
    if len(source.shape) != 3 or len(prediction.shape) != 3:
        raise LockError(f"CT and prediction must both be 3D for {case_id}")
    if source.shape != prediction.shape:
        raise LockError(f"Prediction shape does not match frozen CT for {case_id}")
    source_affine = np.asarray(source.affine, dtype=np.float64)
    prediction_affine = np.asarray(prediction.affine, dtype=np.float64)
    if (
        source_affine.shape != (4, 4)
        or prediction_affine.shape != (4, 4)
        or not np.isfinite(source_affine).all()
        or not np.isfinite(prediction_affine).all()
        or not np.allclose(source_affine, prediction_affine, rtol=1e-5, atol=1e-4)
    ):
        raise LockError(f"Prediction affine does not match frozen CT for {case_id}")
    raw = np.asanyarray(prediction.dataobj)
    if not np.issubdtype(raw.dtype, np.number) or not np.isfinite(raw).all():
        raise LockError(f"Prediction contains invalid numeric data for {case_id}")
    rounded = np.rint(raw)
    if not np.array_equal(raw, rounded):
        raise LockError(f"Prediction contains non-integer values for {case_id}")
    labels = np.unique(rounded).astype(np.int64)
    if np.any((labels < 0) | (labels > 3)):
        raise LockError(f"Prediction contains values outside frozen model range 0..3 for {case_id}")
    return [int(value) for value in source.shape]


def _validate_validation_log(path: Path, case_id: str, expected_shape: Sequence[int]) -> None:
    try:
        lines = [line.strip() for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    except UnicodeDecodeError as exc:
        raise LockError(f"Validation stdout is not UTF-8 for {case_id}") from exc
    if not lines:
        raise LockError(f"Validation stdout is empty for successful {case_id}")
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise LockError(f"Validation stdout lacks final JSON evidence for {case_id}") from exc
    if not isinstance(payload, dict) or payload.get("status") != "ok" or payload.get("research_only") is not True:
        raise LockError(f"Validation stdout lacks successful research-only evidence for {case_id}")
    if payload.get("shape") != list(expected_shape):
        raise LockError(f"Validation stdout geometry is not bound to {case_id}")


def _require_same_binding(record: Mapping[str, Any], expected: Mapping[str, Any], label: str) -> None:
    for key, value in expected.items():
        if record.get(key) != value:
            raise LockError(f"{label} has mismatched {key} (possible cross-case substitution)")


def inspect_timing_records(
    run_root: Path,
    rows: Sequence[Mapping[str, Any]],
    manifest_sha256: str,
    cohort_lock_sha256: str,
    model_lock_sha256: str,
    model_lock: Mapping[str, Any],
    bound: dict[Path, tuple[str, int]],
) -> tuple[list[dict[str, Any]], set[str], set[str], dict[str, str]]:
    timing_root = run_root / "timings"
    require_exact_directory(timing_root, "timings")
    expected_timing_names = {f"{row['case_id']}.json" for row in rows}
    actual_timing_names = {entry.name for entry in timing_root.iterdir()}
    if actual_timing_names != expected_timing_names:
        raise LockError(
            "Timing record set is not the exact 20-case cohort; "
            f"missing={sorted(expected_timing_names - actual_timing_names)}, "
            f"extra={sorted(actual_timing_names - expected_timing_names)}"
        )

    pipeline_root = Path(__file__).resolve().parent
    actual_pipeline_hashes: dict[str, str] = {}
    for key, filename in PIPELINE_ARTIFACTS.items():
        evidence = _record_bound_file(
            bound,
            pipeline_root / filename,
            f"Pipeline artefact {filename}",
        )
        actual_pipeline_hashes[key] = evidence["sha256"]

    case_records: list[dict[str, Any]] = []
    expected_logs: set[str] = set()
    expected_predictions: set[str] = set()
    common_artifact_hashes: dict[str, str] | None = None

    for row in rows:
        case_id = row["case_id"]
        position = row["selection_order"]
        timing_path = timing_root / f"{case_id}.json"
        timing_file_evidence = _record_bound_file(bound, timing_path, f"Timing record for {case_id}")
        timing = load_json_object(timing_path, f"Timing record for {case_id}")
        _require_exact_keys(timing, EXPECTED_TIMING_KEYS, f"Timing record for {case_id}")
        if timing.get("schema_version") != 2:
            raise LockError(f"Timing schema_version must be 2 for {case_id}")
        prediction_relative = f"predictions/{case_id}.nii.gz"
        source_relative = f"nnunet_input/{case_id}_0000.nii.gz"
        binding = {
            "case_id": case_id,
            "cohort_position": position,
            "selection_order": position,
            "selection_hash": row["selection_hash"],
            "manifest_sha256": manifest_sha256,
            "cohort_lock_sha256": cohort_lock_sha256,
            "model_lock_sha256": model_lock_sha256,
            "input_image_relative": source_relative,
            "input_image_sha256": row["image_sha256"],
            "input_image_bytes": row["image_bytes"],
            "prediction_relative": prediction_relative,
        }
        _require_same_binding(timing, binding, f"Timing record for {case_id}")

        artifact_hashes = timing.get("artifact_hashes")
        if not isinstance(artifact_hashes, dict) or set(artifact_hashes) != set(PIPELINE_ARTIFACTS):
            raise LockError(f"Timing artifact_hashes are incomplete or ambiguous for {case_id}")
        for key, expected_hash in actual_pipeline_hashes.items():
            if artifact_hashes.get(key) != expected_hash:
                raise LockError(f"Timing {key} does not match the current pipeline artefact for {case_id}")
        if common_artifact_hashes is None:
            common_artifact_hashes = dict(artifact_hashes)
        elif artifact_hashes != common_artifact_hashes:
            raise LockError(f"Pipeline artefact hashes vary across timing records at {case_id}")

        configuration = timing.get("command_configuration")
        if not isinstance(configuration, dict):
            raise LockError(f"command_configuration must be an object for {case_id}")
        configuration_sha256 = compact_json_sha256(configuration)
        if timing.get("command_configuration_sha256") != configuration_sha256:
            raise LockError(f"Command configuration hash is invalid for {case_id}")
        _require_case_config_binding(
            configuration,
            case_id,
            position,
            row,
            prediction_relative,
            manifest_sha256,
            cohort_lock_sha256,
            model_lock_sha256,
            artifact_hashes,
            model_lock,
        )

        status_value = timing.get("status")
        if status_value not in ("succeeded", "failed"):
            raise LockError(f"Timing status is invalid for {case_id}")
        attempts_count = _require_int(timing.get("attempts"), f"attempts for {case_id}", minimum=1)
        attempts = timing.get("attempt_records")
        if not isinstance(attempts, list) or len(attempts) != attempts_count:
            raise LockError(f"Attempt record count is inconsistent for {case_id}")
        if attempts_count > 2:
            raise LockError(f"More than two qualified attempts are forbidden for {case_id}")

        total_runtime = timing.get("runtime_seconds")
        if (
            isinstance(total_runtime, bool)
            or not isinstance(total_runtime, (int, float))
            or not math.isfinite(float(total_runtime))
            or float(total_runtime) < 0
        ):
            raise LockError(f"runtime_seconds is invalid for {case_id}")

        attempt_runtime_sum = 0.0
        attempt_statuses: list[str] = []
        final_validation_stdout: Path | None = None
        attempt_evidence: list[dict[str, Any]] = []
        for attempt_number, attempt in enumerate(attempts, start=1):
            if not isinstance(attempt, dict):
                raise LockError(f"Attempt {attempt_number} is not an object for {case_id}")
            _require_exact_keys(
                attempt,
                EXPECTED_ATTEMPT_KEYS,
                f"Attempt {attempt_number} for {case_id}",
            )
            attempt_binding = dict(binding)
            attempt_binding["attempt"] = attempt_number
            attempt_binding["command_configuration_sha256"] = configuration_sha256
            attempt_binding["artifact_hashes"] = artifact_hashes
            _require_same_binding(
                attempt,
                attempt_binding,
                f"Attempt {attempt_number} for {case_id}",
            )
            attempt_status = attempt.get("status")
            if attempt_status not in ("succeeded", "failed"):
                raise LockError(f"Attempt {attempt_number} status is invalid for {case_id}")
            attempt_statuses.append(attempt_status)
            if attempt_status == "failed" and attempt.get("final_prediction_created") is not False:
                raise LockError(
                    f"Failed attempt {attempt_number} must not create a canonical prediction for {case_id}"
                )
            attempt_runtime = attempt.get("runtime_seconds")
            if (
                isinstance(attempt_runtime, bool)
                or not isinstance(attempt_runtime, (int, float))
                or not math.isfinite(float(attempt_runtime))
                or float(attempt_runtime) < 0
            ):
                raise LockError(f"Attempt {attempt_number} runtime is invalid for {case_id}")
            attempt_runtime_sum += float(attempt_runtime)

            log_evidence: list[dict[str, Any]] = []
            for key, suffix in (
                ("stdout_log_relative", "stdout.log"),
                ("stderr_log_relative", "stderr.log"),
            ):
                expected_relative = f"logs/{case_id}.attempt-{attempt_number}.{suffix}"
                if attempt.get(key) != expected_relative:
                    raise LockError(f"Attempt {attempt_number} {key} is cross-bound for {case_id}")
                _, log_path = _bound_relative_path(run_root, expected_relative, key)
                if expected_relative in expected_logs:
                    raise LockError(f"Log path is referenced more than once: {expected_relative}")
                expected_logs.add(expected_relative)
                evidence = _record_bound_file(
                    bound,
                    log_path,
                    f"Attempt log {expected_relative}",
                    allow_empty=True,
                )
                log_evidence.append({"relative": expected_relative, **evidence})

            validation_values = (
                attempt.get("validation_stdout_relative"),
                attempt.get("validation_stderr_relative"),
            )
            if (validation_values[0] is None) != (validation_values[1] is None):
                raise LockError(f"Validation log pair is incomplete for attempt {attempt_number} of {case_id}")
            if validation_values[0] is not None:
                for value, kind in zip(validation_values, ("stdout", "stderr"), strict=True):
                    expected_relative = f"logs/{case_id}.attempt-{attempt_number}.validation.{kind}.log"
                    if value != expected_relative:
                        raise LockError(
                            f"Validation {kind} log is cross-bound for attempt {attempt_number} of {case_id}"
                        )
                    _, log_path = _bound_relative_path(run_root, value, f"validation {kind} log")
                    if value in expected_logs:
                        raise LockError(f"Log path is referenced more than once: {value}")
                    expected_logs.add(value)
                    evidence = _record_bound_file(
                        bound,
                        log_path,
                        f"Validation log {value}",
                        allow_empty=True,
                    )
                    log_evidence.append({"relative": value, **evidence})
                    if kind == "stdout" and attempt_number == attempts_count:
                        final_validation_stdout = log_path

            attempt_evidence.append(
                {
                    "attempt": attempt_number,
                    "status": attempt_status,
                    "runtime_seconds": float(attempt_runtime),
                    "configuration_sha256": configuration_sha256,
                    "logs": log_evidence,
                }
            )

        if not math.isclose(attempt_runtime_sum, float(total_runtime), rel_tol=0, abs_tol=0.01):
            raise LockError(f"Attempt runtimes do not reconcile for {case_id}")
        prediction_path = run_root / "predictions" / f"{case_id}.nii.gz"
        case_prediction: dict[str, Any] | None = None
        if status_value == "succeeded":
            if attempts_count not in (1, 2) or attempt_statuses[-1] != "succeeded":
                raise LockError(f"Successful timing lacks a successful final attempt for {case_id}")
            if attempts_count == 2 and attempt_statuses[0] != "failed":
                raise LockError(f"Retry was not preceded by a failed first attempt for {case_id}")
            final_attempt = attempts[-1]
            if (
                final_attempt.get("exit_code") != 0
                or final_attempt.get("prediction_created") is not True
                or final_attempt.get("prediction_validated") is not True
                or final_attempt.get("validation_exit_code") != 0
                or final_attempt.get("finalization_exit_code") != 0
                or final_attempt.get("final_prediction_created") is not True
            ):
                raise LockError(f"Successful timing lacks validated/finalized evidence for {case_id}")
            prediction_evidence = _record_bound_file(bound, prediction_path, f"Prediction for {case_id}")
            expected_predictions.add(prediction_relative)
            shape = _validate_geometry(
                run_root / "nnunet_input" / f"{case_id}_0000.nii.gz",
                prediction_path,
                case_id,
            )
            if final_validation_stdout is None:
                raise LockError(f"Successful timing lacks validation stdout for {case_id}")
            _validate_validation_log(final_validation_stdout, case_id, shape)
            case_prediction = {
                "relative": prediction_relative,
                **prediction_evidence,
                "geometry_validated_against_ct": True,
                "shape": shape,
            }
        else:
            if attempts_count != 2 or attempt_statuses != ["failed", "failed"]:
                raise LockError(f"Failed case must preserve exactly two failed attempts for {case_id}")
            for attempt_number, attempt in enumerate(attempts, start=1):
                if attempt.get("final_prediction_created") is not False:
                    raise LockError(
                        f"Failed attempt {attempt_number} must state final_prediction_created=false for {case_id}"
                    )
            if prediction_path.exists() or prediction_path.is_symlink():
                raise LockError(f"Failed case must not have a canonical prediction: {case_id}")

        case_records.append(
            {
                "case_id": case_id,
                "selection_order": position,
                "status": status_value,
                "input_image_relative": source_relative,
                "input_image_sha256": row["image_sha256"],
                "input_image_bytes": row["image_bytes"],
                "timing_relative": f"timings/{case_id}.json",
                "timing_sha256": timing_file_evidence["sha256"],
                "timing_bytes": timing_file_evidence["bytes"],
                "configuration_sha256": configuration_sha256,
                "attempts": attempt_evidence,
                "prediction": case_prediction,
            }
        )

    if common_artifact_hashes is None:
        raise LockError("No timing records were inspected")
    return case_records, expected_logs, expected_predictions, common_artifact_hashes


def require_exact_directory(path: Path, label: str) -> None:
    try:
        details = path.lstat()
    except FileNotFoundError as exc:
        raise LockError(f"Required {label} directory is missing: {path}") from exc
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISDIR(details.st_mode):
        raise LockError(f"{label} must be a real, non-symlink directory: {path}")


def require_exact_tree(run_root: Path, expected_files: set[str]) -> None:
    expected_directories = {
        "manifests",
        "nnunet_input",
        "predictions",
        "source",
        "source/images",
        "timings",
        "logs",
    }
    actual_files: set[str] = set()
    actual_directories: set[str] = set()
    for path in run_root.rglob("*"):
        relative = _relative_posix(run_root, path)
        details = path.lstat()
        if stat.S_ISLNK(details.st_mode):
            raise LockError(f"Symlinks are forbidden in the inference tree: {relative}")
        if stat.S_ISDIR(details.st_mode):
            actual_directories.add(relative)
        elif stat.S_ISREG(details.st_mode):
            actual_files.add(relative)
        else:
            raise LockError(f"Unsupported filesystem entry in inference tree: {relative}")
    if actual_directories != expected_directories:
        raise LockError(
            "Inference directory set is not exact; "
            f"missing={sorted(expected_directories - actual_directories)}, "
            f"extra={sorted(actual_directories - expected_directories)}"
        )
    if actual_files != expected_files:
        raise LockError(
            "Inference file set is not exact; "
            f"missing={sorted(expected_files - actual_files)}, "
            f"extra={sorted(actual_files - expected_files)}"
        )


def _verify_bound_files_unchanged(bound: Mapping[Path, tuple[str, int]]) -> None:
    for path, (expected_hash, expected_size) in bound.items():
        require_regular_file(path, f"Bound artefact {path.name}", allow_empty=True)
        if path.stat().st_size != expected_size or sha256_file(path) != expected_hash:
            raise LockError(f"Bound artefact changed before lock publication: {path}")


def _publish_no_clobber_atomic(path: Path, payload: bytes) -> None:
    """Publish complete bytes atomically without ever replacing an existing file."""

    if path.exists() or path.is_symlink():
        raise LockError(f"Immutable lock artefact already exists; refusing replacement: {path}")
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as exc:
            raise LockError(f"Immutable lock artefact appeared during publication: {path}") from exc
        except OSError as exc:
            raise LockError(
                f"Filesystem cannot publish an atomic no-clobber lock at {path}: {exc}"
            ) from exc
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def create_prediction_lock(
    run_root: Path, *, created_at_utc: str | None = None
) -> dict[str, Any]:
    run_root = run_root.resolve(strict=True)
    if not run_root.is_dir():
        raise LockError(f"Run root must be a directory: {run_root}")
    private_path = run_root / PRIVATE_LOCK_NAME
    public_path = run_root / PUBLIC_LOCK_NAME
    if private_path.exists() or private_path.is_symlink() or public_path.exists() or public_path.is_symlink():
        raise LockError("Prediction lock is immutable; refusing to replace an existing lock artefact")

    # This gate deliberately precedes every NIfTI load.
    reject_reference_material_before_reads(run_root)

    manifest_path = run_root / "manifests" / "manifest.csv"
    cohort_path = run_root / "manifests" / "cohort-lock.public.json"
    model_path = run_root / "manifests" / "model-lock.json"
    provenance_path = run_root / "provenance.inference.json"
    rows, manifest_sha256 = read_manifest(manifest_path)
    cohort = load_json_object(cohort_path, "Cohort lock")
    validate_cohort_lock(cohort, rows, manifest_sha256)
    cohort_lock_sha256 = sha256_file(cohort_path)
    model_lock = load_json_object(model_path, "Model lock")
    validate_model_lock(model_lock)
    model_lock_sha256 = sha256_file(model_path)
    provenance = load_json_object(provenance_path, "Reference-free inference provenance")
    if provenance.get("schema_version") != 1:
        raise LockError("Inference provenance schema_version must be 1")
    if provenance.get("research_only") is not True:
        raise LockError("Inference provenance must state research_only=true")
    for key, expected in (
        ("manifest_sha256", manifest_sha256),
        ("cohort_lock_sha256", cohort_lock_sha256),
        ("model_lock_sha256", model_lock_sha256),
    ):
        if provenance.get(key) != expected:
            raise LockError(f"Inference provenance does not bind the exact {key}")

    bound: dict[Path, tuple[str, int]] = {}
    locking_tool_evidence = _record_bound_file(
        bound, Path(__file__).resolve(), "Prediction locking tool"
    )
    provenance_source_artifacts = provenance.get("source_artifacts")
    if (
        not isinstance(provenance_source_artifacts, dict)
        or set(provenance_source_artifacts) != set(PROVENANCE_SOURCE_ARTIFACTS)
    ):
        raise LockError("Inference provenance source_artifacts set is incomplete or ambiguous")
    if provenance_source_artifacts != model_lock.get("pipeline_source_artifact_hashes"):
        raise LockError(
            "Inference provenance source_artifacts differ from the pre-inference model lock"
        )
    pipeline_root = Path(__file__).resolve().parent
    for key, filename in PROVENANCE_SOURCE_ARTIFACTS.items():
        source_evidence = _record_bound_file(
            bound,
            pipeline_root / filename,
            f"Provenance source artefact {filename}",
        )
        if provenance_source_artifacts.get(key) != source_evidence["sha256"]:
            raise LockError(f"Inference provenance {key} does not match current source")
    manifest_evidence = _record_bound_file(bound, manifest_path, "Frozen manifest")
    cohort_evidence = _record_bound_file(bound, cohort_path, "Cohort lock")
    model_evidence = _record_bound_file(bound, model_path, "Model lock")
    provenance_evidence = _record_bound_file(
        bound, provenance_path, "Reference-free inference provenance"
    )
    image_files, image_evidence = verify_image_copies(run_root, rows, bound)
    case_records, log_files, prediction_files, artifact_hashes = inspect_timing_records(
        run_root,
        rows,
        manifest_sha256,
        cohort_lock_sha256,
        model_lock_sha256,
        model_lock,
        bound,
    )

    expected_files = {
        "manifests/manifest.csv",
        "manifests/cohort-lock.public.json",
        "manifests/model-lock.json",
        "provenance.inference.json",
        *(f"timings/{row['case_id']}.json" for row in rows),
        *image_files,
        *log_files,
        *prediction_files,
    }
    require_exact_tree(run_root, expected_files)
    _verify_bound_files_unchanged(bound)
    if private_path.exists() or private_path.is_symlink() or public_path.exists() or public_path.is_symlink():
        raise LockError("Prediction lock appeared during verification; refusing replacement")

    if created_at_utc is None:
        created_at_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    else:
        _require_iso_utc(created_at_utc, "prediction lock created_at_utc")
    succeeded = sum(record["status"] == "succeeded" for record in case_records)
    failed = EXPECTED_CASE_COUNT - succeeded
    lock = {
        "schema_version": 1,
        "lock_type": "prediction_lock_before_reference_release",
        "created_at_utc": created_at_utc,
        "research_only": True,
        "disclaimer": DISCLAIMER,
        "reference_state": {
            "reference_material_present": False,
            "reference_material_loaded": False,
            "custody_claim": "script_inference_blinded_not_independently_custodied",
        },
        "cohort": {
            "case_count": EXPECTED_CASE_COUNT,
            "manifest_relative": "manifests/manifest.csv",
            "manifest_sha256": manifest_evidence["sha256"],
            "manifest_bytes": manifest_evidence["bytes"],
            "cohort_lock_relative": "manifests/cohort-lock.public.json",
            "cohort_lock_sha256": cohort_evidence["sha256"],
            "cohort_lock_bytes": cohort_evidence["bytes"],
            "protocol_namespace": cohort["protocol_namespace"],
            "public_seed": cohort["public_seed"],
            "case_ids": [row["case_id"] for row in rows],
            "selection_hashes": [row["selection_hash"] for row in rows],
        },
        "model": {
            "model_lock_relative": "manifests/model-lock.json",
            "model_lock_sha256": model_evidence["sha256"],
            "model_lock_bytes": model_evidence["bytes"],
            "frozen_model_lock": model_lock,
        },
        "pipeline_artifact_hashes": artifact_hashes,
        "pipeline_source_artifact_hashes": provenance_source_artifacts,
        "inference_provenance": {
            "relative": "provenance.inference.json",
            "sha256": provenance_evidence["sha256"],
            "bytes": provenance_evidence["bytes"],
            "frozen_provenance": provenance,
        },
        "locking_tool": {
            "name": Path(__file__).name,
            "sha256": locking_tool_evidence["sha256"],
        },
        "inference": {
            "status": "complete" if failed == 0 else "complete_with_failures",
            "evaluated_cases": EXPECTED_CASE_COUNT,
            "successful_predictions": succeeded,
            "failed_predictions": failed,
            "all_timing_records_verified": True,
            "all_successes_geometry_validated_against_ct": True,
            "all_failures_exhausted_two_attempts": True,
            "image_copies": image_evidence,
            "cases": case_records,
        },
    }
    private_payload = (
        json.dumps(lock, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n"
    ).encode("utf-8")
    private_sha256 = hashlib.sha256(private_payload).hexdigest()
    public_payload = (private_sha256 + "\n").encode("ascii")

    # The private lock is authoritative; the aggregate-only digest is derived.
    _publish_no_clobber_atomic(private_path, private_payload)
    try:
        _publish_no_clobber_atomic(public_path, public_payload)
    except Exception:
        # Keep the authoritative private lock intact.  A missing public digest is
        # an explicit partial-publication state and must be repaired manually
        # after auditing; reruns never overwrite either artefact.
        raise
    return {
        "status": lock["inference"]["status"],
        "evaluated_cases": EXPECTED_CASE_COUNT,
        "successful_predictions": succeeded,
        "failed_predictions": failed,
        "prediction_lock_sha256": private_sha256,
    }


def main() -> None:
    args = parse_args()
    try:
        result = create_prediction_lock(args.run_root)
    except (LockError, OSError) as exc:
        raise SystemExit(f"Prediction lock refused: {exc}") from exc
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
