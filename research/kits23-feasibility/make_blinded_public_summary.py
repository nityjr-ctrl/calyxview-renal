#!/usr/bin/env python3
"""Publish a privacy-minimised summary of the script-blinded KiTS evaluation.

This is a separate release gate for the blinded protocol.  It consumes only
JSON evidence, verifies the complete 20-study denominator and all immutable
bindings, then constructs a new object from an explicit aggregate allow-list.
It never copies case records, paths, URLs, failure text, or medical artefacts
into the public output.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import stat
import tempfile
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import numpy as np


EXPECTED_CASES = 20
PROTOCOL_NAMESPACE = "calyxview-renal-kits23-blinded-v1"
PUBLIC_SEED = 20260901
ELIGIBLE_COUNT = 169
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
KITS23_REPOSITORY = "https://github.com/neheller/kits23"
KITS23_COMMIT = "c1088353084c17b8882a11db71429e7c022b7785"
NNUNET_COMMIT = "db16c6cef5fdd5a180159184e46b58bcca670446"
MODEL_ARCHIVE_SHA256 = (
    "a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3"
)
MODEL_ARCHIVE_BYTES = 3_505_803_654
EXPECTED_PLANS = {
    "sha256": "d15d46664240f0a9056ef1320e00df46fbd866ea94323a98e47b3e9eff1f4e39",
    "bytes": 143_080,
}
EXPECTED_FOLDS = [
    {
        "fold": 0,
        "checkpoint": {
            "sha256": "d64a21c10973c459870297e57e39811304c689e3b9bddd5bbaeb7a8384d64cf7",
            "bytes": 249_826_698,
        },
        "metadata": {
            "sha256": "9f6f0d03dcbe0a67a2e5894f2f10ea6b0f58dd5de5348b3c6a7b6c0e1bede0b2",
            "bytes": 143_564,
        },
    },
    {
        "fold": 1,
        "checkpoint": {
            "sha256": "6038808474337ca2f27cc2592847622f3665f8c526165dfe945ca8d905a0e27c",
            "bytes": 249_826_570,
        },
        "metadata": {
            "sha256": "d1d5dafb9de471634a1d3ded474ca6554f6b731f49154c30ff81a18fac6174f6",
            "bytes": 143_564,
        },
    },
    {
        "fold": 2,
        "checkpoint": {
            "sha256": "54e61742f2acf83fe6b163d73e41c3a4629cecfa3441b70257c9e6b96d64efc9",
            "bytes": 249_826_762,
        },
        "metadata": {
            "sha256": "99acda476f067ac55236dfe01ea0f220d86867cba094366733b5e9eef338731b",
            "bytes": 143_564,
        },
    },
    {
        "fold": 3,
        "checkpoint": {
            "sha256": "abddc1d98252bd1b8f90af10b42a58ebd6c27059f4360af9307618f2977bcd0b",
            "bytes": 249_826_570,
        },
        "metadata": {
            "sha256": "fcd1ea1b1eced829852f64a42d9d8a5b6cbee35190a87dace853255124227adf",
            "bytes": 143_564,
        },
    },
    {
        "fold": 4,
        "checkpoint": {
            "sha256": "849e9bad2031ca99096fd4a827283838541c7822d84063b74337621d649b92ef",
            "bytes": 249_826_826,
        },
        "metadata": {
            "sha256": "975843163c8150e60c12f651b437a9256de48c5a3810fa21c6d77a2f2be77898",
            "bytes": 143_564,
        },
    },
]
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
PREDICTION_LOCK_KEYS = {
    "schema_version",
    "lock_type",
    "created_at_utc",
    "research_only",
    "disclaimer",
    "reference_state",
    "cohort",
    "model",
    "pipeline_artifact_hashes",
    "pipeline_source_artifact_hashes",
    "locking_tool",
    "inference_provenance",
    "inference",
}
REFERENCE_RELEASE_KEYS = {
    "schema_version",
    "release_type",
    "released_at_utc",
    "research_only",
    "disclaimer",
    "custody_mode",
    "operator_blinded",
    "custody_limitation",
    "prediction_lock_sha256",
    "cohort_lock_sha256",
    "manifest_sha256",
    "public_prediction_lock_receipt",
    "kits23_repository",
    "kits23_commit",
    "case_count",
    "case_ids",
    "cases",
}
PUBLIC_RECEIPT_KEYS = {"url", "repository", "commit", "verified_at_utc"}
PIPELINE_ARTIFACT_KEYS = {
    "runner_sha256",
    "validator_sha256",
    "scratch_manager_sha256",
}
PROVENANCE_SOURCE_KEYS = {
    "runner_sha256",
    "validator_sha256",
    "scratch_manager_sha256",
    "cohort_preparer_sha256",
    "model_locker_sha256",
    "prediction_locker_sha256",
    "provenance_capturer_sha256",
    "evaluator_sha256",
    "reference_releaser_sha256",
    "public_summary_builder_sha256",
}
PROVENANCE_SOURCE_FILES = {
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
INFERENCE_KEYS = {
    "status",
    "evaluated_cases",
    "successful_predictions",
    "failed_predictions",
    "all_timing_records_verified",
    "all_successes_geometry_validated_against_ct",
    "all_failures_exhausted_two_attempts",
    "image_copies",
    "cases",
}
IMAGE_COPY_KEYS = {
    "case_id",
    "selection_order",
    "selection_hash",
    "image_sha256",
    "image_bytes",
    "input_relative",
    "source_cache_relative",
}
LOCKED_CASE_KEYS = {
    "case_id",
    "selection_order",
    "status",
    "input_image_relative",
    "input_image_sha256",
    "input_image_bytes",
    "timing_relative",
    "timing_sha256",
    "timing_bytes",
    "configuration_sha256",
    "attempts",
    "prediction",
}
LOCKED_ATTEMPT_KEYS = {
    "attempt",
    "status",
    "runtime_seconds",
    "configuration_sha256",
    "logs",
}
LOCKED_LOG_KEYS = {"relative", "sha256", "bytes"}
LOCKED_PREDICTION_KEYS = {
    "relative",
    "sha256",
    "bytes",
    "geometry_validated_against_ct",
    "shape",
}
LOCKED_COHORT_KEYS = {
    "case_count",
    "manifest_relative",
    "manifest_sha256",
    "manifest_bytes",
    "cohort_lock_relative",
    "cohort_lock_sha256",
    "cohort_lock_bytes",
    "protocol_namespace",
    "public_seed",
    "case_ids",
    "selection_hashes",
}
LOCKED_MODEL_KEYS = {
    "model_lock_relative",
    "model_lock_sha256",
    "model_lock_bytes",
    "frozen_model_lock",
}
LOCKED_PROVENANCE_KEYS = {"relative", "sha256", "bytes", "frozen_provenance"}
PROVENANCE_KEYS = {
    "schema_version",
    "research_only",
    "created_utc",
    "disclaimer",
    "protocol_mode",
    "manifest_sha256",
    "cohort_lock_sha256",
    "model_lock_sha256",
    "cohort",
    "model",
    "source_artifacts",
    "execution",
    "runtime",
    "data_access",
}
AGGREGATE_KEYS = {
    "n",
    "mean",
    "median",
    "standard_deviation",
    "minimum",
    "maximum",
    "bootstrap_95_ci_of_mean",
}
REGION_MAP = {
    "kidneyAndMass": "kidney_and_mass",
    "mass": "mass",
    "tumour": "tumour",
}
REGION_TOLERANCES_MM = {
    "kidney_and_mass": 1.0330772532390826,
    "mass": 1.1328796488598762,
    "tumour": 1.1498198361434828,
}
METRIC_MAP = {
    "dice": ("dice", True),
    "surfaceDice": ("surface_dice", True),
    "hd95Mm": ("hd95_mm", False),
    "volumeMaeMl": ("absolute_volume_error_ml", False),
}
OVERALL_MAP = {
    "meanDiceAcrossRegions": ("mean_dice_across_regions_per_case", True),
    "meanSurfaceDiceAcrossRegions": (
        "mean_surface_dice_across_regions_per_case",
        True,
    ),
    "meanHd95MmAcrossRegions": ("mean_hd95_mm_across_regions_per_case", False),
}
CSV_FIELDS = [
    "case_id",
    "status",
    "failure_reason",
    "inference_status",
    "runtime_seconds",
    "shape",
    "spacing_mm",
    "reference_label_values",
    "prediction_label_values",
    "mean_dice",
    "mean_surface_dice",
    "mean_hd95_mm",
]
for _csv_region in REGION_MAP.values():
    CSV_FIELDS.extend(
        [
            f"{_csv_region}_dice",
            f"{_csv_region}_surface_dice",
            f"{_csv_region}_surface_tolerance_mm",
            f"{_csv_region}_hd95_mm",
            f"{_csv_region}_reference_volume_ml",
            f"{_csv_region}_prediction_volume_ml",
            f"{_csv_region}_volume_error_ml",
            f"{_csv_region}_absolute_volume_error_ml",
            f"{_csv_region}_relative_volume_error_pct",
        ]
    )
BOOTSTRAP_SAMPLES = 10_000
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CASE_ID_RE = re.compile(r"^case_[0-9]{5}$")
CASE_ID_ANYWHERE_RE = re.compile(r"case_[0-9]{5}", re.IGNORECASE)
URL_RE = re.compile(r"(?:https?|file)://", re.IGNORECASE)
WINDOWS_PATH_RE = re.compile(r"(?:^|\s)[a-z]:[\\/]", re.IGNORECASE)
MEDICAL_OR_REPORT_SUFFIX_RE = re.compile(
    r"\.(?:nii(?:\.gz)?|dcm|dicom|mha|mhd|nrrd|seg|csv|json|html|png|log)(?:$|\s)",
    re.IGNORECASE,
)
FORBIDDEN_PUBLIC_KEY_FRAGMENTS = {
    "artifact",
    "caseid",
    "directory",
    "failure_reason",
    "file",
    "mask",
    "path",
    "prediction",
    "scan",
    "uri",
    "url",
}
RESEARCH_ONLY_WORDING = (
    "Research prototype only. Not a medical device. Not for diagnosis, treatment "
    "selection, surgical planning, margin selection, or patient care."
)


class PublicSummaryError(ValueError):
    """Raised when private evidence is incomplete, inconsistent, or unsafe."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create the aggregate-only public summary for the blinded KiTS run."
    )
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--cohort-lock", type=Path, required=True)
    parser.add_argument("--model-lock", type=Path, required=True)
    parser.add_argument("--prediction-lock", type=Path, required=True)
    parser.add_argument("--reference-release", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _require_int(value: Any, label: str, *, expected: int | None = None) -> int:
    if not _is_int(value):
        raise PublicSummaryError(f"{label} must be an integer")
    if expected is not None and value != expected:
        raise PublicSummaryError(f"{label} must equal {expected}; got {value}")
    return value


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise PublicSummaryError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PublicSummaryError(f"{label} must be a non-empty string")
    return value


def _require_utc(value: Any, label: str) -> str:
    text = _require_string(value, label)
    candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise PublicSummaryError(f"{label} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise PublicSummaryError(f"{label} must explicitly use UTC")
    return text


def _utc_datetime(value: Any, label: str) -> datetime:
    text = _require_utc(value, label)
    return datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)


def _require_exact_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise PublicSummaryError(
            f"{label} key set is not exact; "
            f"missing={sorted(expected - actual)}, extra={sorted(actual - expected)}"
        )


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PublicSummaryError(f"{label} must be an object")
    return value


def _require_regular_file(path: Path, label: str) -> None:
    try:
        details = path.lstat()
    except FileNotFoundError as exc:
        raise PublicSummaryError(f"{label} is missing") from exc
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISREG(details.st_mode):
        raise PublicSummaryError(f"{label} must be a regular, non-symlink file")
    if details.st_size <= 0:
        raise PublicSummaryError(f"{label} is empty")


def _absolute_without_resolution(path: Path) -> Path:
    """Return an absolute lexical path without following any filesystem links."""

    return Path(os.path.abspath(os.fspath(path)))


def _require_symlink_free_chain(path: Path, label: str) -> None:
    """Reject symlinks and Windows junctions in every existing path component."""

    absolute = _absolute_without_resolution(path)
    candidates = [*reversed(absolute.parents), absolute]
    for candidate in candidates:
        try:
            details = candidate.lstat()
        except FileNotFoundError:
            continue
        is_junction = bool(getattr(candidate, "is_junction", lambda: False)())
        if stat.S_ISLNK(details.st_mode) or is_junction:
            raise PublicSummaryError(f"{label} contains a symlink or junction")


def _canonical_input_file(path: Path, label: str) -> Path:
    lexical = _absolute_without_resolution(path)
    _require_symlink_free_chain(lexical, label)
    _require_regular_file(lexical, label)
    return lexical.resolve(strict=True)


def _verify_live_pipeline_sources(value: Any) -> dict[str, Any]:
    source_hashes = _require_object(value, "Model lock pipeline_source_artifact_hashes")
    _require_exact_keys(
        source_hashes,
        PROVENANCE_SOURCE_KEYS,
        "Model lock pipeline_source_artifact_hashes",
    )
    pipeline_root = Path(__file__).resolve().parent
    for key, filename in PROVENANCE_SOURCE_FILES.items():
        expected = _require_sha256(
            source_hashes.get(key), f"Model lock pipeline source hash {key}"
        )
        source = _canonical_input_file(
            pipeline_root / filename, f"Frozen pipeline source {filename}"
        )
        if sha256_file(source) != expected:
            raise PublicSummaryError(
                f"Live pipeline source {filename} differs from the pre-inference model lock"
            )
    return source_hashes


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _load_json(path: Path, label: str) -> dict[str, Any]:
    _require_regular_file(path, label)

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise PublicSummaryError(f"{label} contains duplicate key {key!r}")
            result[key] = value
        return result

    def reject_constant(value: str) -> None:
        raise PublicSummaryError(f"{label} contains non-finite JSON number {value}")

    try:
        parsed = json.loads(
            path.read_text(encoding="utf-8-sig"),
            object_pairs_hook=reject_duplicates,
            parse_constant=reject_constant,
        )
    except PublicSummaryError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PublicSummaryError(f"{label} is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise PublicSummaryError(f"{label} must contain one JSON object")
    return parsed


def _expected_selection_hashes() -> list[str]:
    return [
        hashlib.sha256(
            f"{PROTOCOL_NAMESPACE}|seed={PUBLIC_SEED}|{case_id}".encode("utf-8")
        ).hexdigest()
        for case_id in EXPECTED_CASE_IDS
    ]


def verify_cohort_lock(path: Path) -> tuple[dict[str, Any], str]:
    if path.name != "cohort-lock.public.json":
        raise PublicSummaryError("Cohort evidence must use the canonical lock name")
    cohort = _load_json(path, "Cohort lock")
    _require_exact_keys(cohort, COHORT_LOCK_KEYS, "Cohort lock")
    expected = {
        "schema_version": 1,
        "protocol_namespace": PROTOCOL_NAMESPACE,
        "public_seed": PUBLIC_SEED,
        "eligible_start": ELIGIBLE_START,
        "eligible_end": ELIGIBLE_END,
        "eligible_count": ELIGIBLE_COUNT,
        "eligible_list_sha256": ELIGIBLE_LIST_SHA256,
        "selection_count": EXPECTED_CASES,
        "selection_algorithm": SELECTION_ALGORITHM,
        "manifest_columns": [
            "case_id",
            "selection_order",
            "selection_hash",
            "image_sha256",
            "image_bytes",
        ],
        "case_ids": list(EXPECTED_CASE_IDS),
        "selection_hashes": _expected_selection_hashes(),
        "imaging_repository": IMAGING_REPOSITORY,
        "imaging_revision": IMAGING_REVISION,
        "research_only": True,
    }
    for key, expected_value in expected.items():
        if cohort.get(key) != expected_value:
            raise PublicSummaryError(f"Cohort lock has an invalid {key} binding")
    _require_sha256(cohort.get("manifest_sha256"), "Cohort manifest_sha256")
    _require_int(cohort.get("total_image_bytes"), "Cohort total_image_bytes")
    if cohort["total_image_bytes"] <= 0:
        raise PublicSummaryError("Cohort total_image_bytes must be positive")
    _require_utc(cohort.get("created_utc"), "Cohort created_utc")
    _require_string(cohort.get("disclaimer"), "Cohort disclaimer")
    return cohort, sha256_file(path)


def verify_model_lock(path: Path) -> tuple[dict[str, Any], str]:
    if path.name != "model-lock.json":
        raise PublicSummaryError("Model evidence must use the canonical lock name")
    model = _load_json(path, "Model lock")
    _require_exact_keys(model, MODEL_LOCK_KEYS, "Model lock")
    expected = {
        "schema_version": 1,
        "research_only": True,
        "model": "Published nnU-Net v1 KiTS21 ensemble",
        "task": "Task135_KiTS2021",
        "configuration": "3d_fullres",
        "folds": [0, 1, 2, 3, 4],
        "tta_enabled": False,
        "source_archive": {
            "sha256": MODEL_ARCHIVE_SHA256,
            "bytes": MODEL_ARCHIVE_BYTES,
        },
        "nnunet_source_commit": NNUNET_COMMIT,
        "installed_plans": EXPECTED_PLANS,
        "installed_folds": EXPECTED_FOLDS,
    }
    for key, expected_value in expected.items():
        if model.get(key) != expected_value:
            raise PublicSummaryError(f"Model lock has an invalid {key} binding")
    _require_utc(model.get("created_at_utc"), "Model created_at_utc")
    _require_string(model.get("disclaimer"), "Model disclaimer")
    _require_string(model.get("provenance_note"), "Model provenance_note")
    _verify_live_pipeline_sources(model.get("pipeline_source_artifact_hashes"))
    return model, sha256_file(path)


def _require_case_ids(value: Any, label: str) -> list[str]:
    if (
        not isinstance(value, list)
        or value != list(EXPECTED_CASE_IDS)
        or any(not isinstance(item, str) or CASE_ID_RE.fullmatch(item) is None for item in value)
    ):
        raise PublicSummaryError(f"{label} must match the exact frozen 20-study order")
    return value


def verify_prediction_lock(
    path: Path,
    cohort: Mapping[str, Any],
    cohort_sha256: str,
    model: Mapping[str, Any],
    model_sha256: str,
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    if path.name != "prediction-lock.json":
        raise PublicSummaryError("Inference evidence must use the canonical private lock name")
    lock = _load_json(path, "Prediction lock")
    _require_exact_keys(lock, PREDICTION_LOCK_KEYS, "Prediction lock")
    if (
        lock.get("schema_version") != 1
        or lock.get("lock_type") != "prediction_lock_before_reference_release"
        or lock.get("research_only") is not True
    ):
        raise PublicSummaryError("Prediction lock has an invalid schema, type, or safety scope")
    _require_utc(lock.get("created_at_utc"), "Prediction lock created_at_utc")
    _require_string(lock.get("disclaimer"), "Prediction lock disclaimer")

    reference_state = _require_object(lock.get("reference_state"), "reference_state")
    if reference_state != {
        "reference_material_present": False,
        "reference_material_loaded": False,
        "custody_claim": "script_inference_blinded_not_independently_custodied",
    }:
        raise PublicSummaryError("Prediction lock does not prove reference-free inference")

    lock_cohort = _require_object(lock.get("cohort"), "Prediction lock cohort")
    _require_exact_keys(lock_cohort, LOCKED_COHORT_KEYS, "Prediction lock cohort")
    expected_cohort = {
        "case_count": EXPECTED_CASES,
        "manifest_relative": "manifests/manifest.csv",
        "manifest_sha256": cohort["manifest_sha256"],
        "cohort_lock_relative": "manifests/cohort-lock.public.json",
        "cohort_lock_sha256": cohort_sha256,
        "protocol_namespace": PROTOCOL_NAMESPACE,
        "public_seed": PUBLIC_SEED,
        "case_ids": list(EXPECTED_CASE_IDS),
        "selection_hashes": _expected_selection_hashes(),
    }
    for key, expected_value in expected_cohort.items():
        if lock_cohort.get(key) != expected_value:
            raise PublicSummaryError(f"Prediction lock cohort has an invalid {key} binding")
    _require_int(lock_cohort.get("manifest_bytes"), "Locked manifest bytes")
    _require_int(lock_cohort.get("cohort_lock_bytes"), "Locked cohort bytes")

    lock_model = _require_object(lock.get("model"), "Prediction lock model")
    _require_exact_keys(lock_model, LOCKED_MODEL_KEYS, "Prediction lock model")
    if (
        lock_model.get("model_lock_relative") != "manifests/model-lock.json"
        or lock_model.get("model_lock_sha256") != model_sha256
        or lock_model.get("frozen_model_lock") != model
    ):
        raise PublicSummaryError("Prediction lock does not bind the exact model lock")
    _require_int(lock_model.get("model_lock_bytes"), "Locked model bytes")

    pipeline_hashes = _require_object(
        lock.get("pipeline_artifact_hashes"), "Prediction lock pipeline_artifact_hashes"
    )
    _require_exact_keys(
        pipeline_hashes, PIPELINE_ARTIFACT_KEYS, "Prediction lock pipeline_artifact_hashes"
    )
    for name, value in pipeline_hashes.items():
        _require_sha256(value, f"pipeline_artifact_hashes.{name}")
    source_hashes = _require_object(
        lock.get("pipeline_source_artifact_hashes"),
        "Prediction lock pipeline_source_artifact_hashes",
    )
    _require_exact_keys(
        source_hashes,
        PROVENANCE_SOURCE_KEYS,
        "Prediction lock pipeline_source_artifact_hashes",
    )
    for name, value in source_hashes.items():
        _require_sha256(value, f"pipeline_source_artifact_hashes.{name}")
    if source_hashes != model.get("pipeline_source_artifact_hashes"):
        raise PublicSummaryError(
            "Prediction lock source hashes differ from the pre-inference model lock"
        )
    locking_tool = _require_object(lock.get("locking_tool"), "Prediction locking tool")
    _require_exact_keys(locking_tool, {"name", "sha256"}, "Prediction locking tool")
    if locking_tool.get("name") != "lock_predictions.py":
        raise PublicSummaryError("Prediction locking tool identity is invalid")
    _require_sha256(locking_tool.get("sha256"), "Prediction locking tool hash")

    provenance_lock = _require_object(
        lock.get("inference_provenance"), "Locked inference provenance"
    )
    _require_exact_keys(provenance_lock, LOCKED_PROVENANCE_KEYS, "Locked inference provenance")
    if provenance_lock.get("relative") != "provenance.inference.json":
        raise PublicSummaryError("Locked inference provenance name is invalid")
    _require_sha256(provenance_lock.get("sha256"), "Inference provenance hash")
    _require_int(provenance_lock.get("bytes"), "Inference provenance bytes")
    provenance = _require_object(
        provenance_lock.get("frozen_provenance"), "Frozen inference provenance"
    )
    _require_exact_keys(provenance, PROVENANCE_KEYS, "Frozen inference provenance")
    if (
        provenance.get("schema_version") != 1
        or provenance.get("research_only") is not True
        or provenance.get("manifest_sha256") != cohort["manifest_sha256"]
        or provenance.get("cohort_lock_sha256") != cohort_sha256
        or provenance.get("model_lock_sha256") != model_sha256
    ):
        raise PublicSummaryError("Frozen inference provenance lock bindings are invalid")
    provenance_sources = _require_object(
        provenance.get("source_artifacts"), "Provenance source_artifacts"
    )
    _require_exact_keys(provenance_sources, PROVENANCE_SOURCE_KEYS, "Provenance source_artifacts")
    for name, value in provenance_sources.items():
        _require_sha256(value, f"Provenance source_artifacts.{name}")
    if source_hashes != provenance_sources:
        raise PublicSummaryError("Prediction lock source hashes differ from frozen provenance")
    timing_sources = _require_object(
        lock.get("pipeline_artifact_hashes"), "Prediction lock timing source hashes"
    )
    if any(provenance_sources.get(key) != value for key, value in timing_sources.items()):
        raise PublicSummaryError("Prediction lock timing source hashes are not provenance-bound")
    if locking_tool.get("sha256") != provenance_sources.get("prediction_locker_sha256"):
        raise PublicSummaryError("Prediction locking tool hash differs from frozen provenance")
    data_access = _require_object(provenance.get("data_access"), "Provenance data_access")
    expected_access = {
        "annotation_data_accessed": False,
        "ct_voxel_arrays_loaded": False,
        "case_level_metrics_emitted": False,
        "absolute_or_relative_paths_emitted": False,
    }
    if data_access != expected_access:
        raise PublicSummaryError("Inference provenance overstates its privacy boundary")

    inference = _require_object(lock.get("inference"), "Prediction lock inference")
    _require_exact_keys(inference, INFERENCE_KEYS, "Prediction lock inference")
    if (
        inference.get("evaluated_cases") != EXPECTED_CASES
        or inference.get("all_timing_records_verified") is not True
        or inference.get("all_successes_geometry_validated_against_ct") is not True
        or inference.get("all_failures_exhausted_two_attempts") is not True
    ):
        raise PublicSummaryError("Prediction lock does not prove the complete inference gate")
    successful = _require_int(
        inference.get("successful_predictions"), "Successful locked studies"
    )
    failed = _require_int(inference.get("failed_predictions"), "Failed locked studies")
    if successful < 0 or failed < 0 or successful + failed != EXPECTED_CASES:
        raise PublicSummaryError("Prediction lock does not preserve the 20-study denominator")
    expected_status = "complete" if failed == 0 else "complete_with_failures"
    if inference.get("status") != expected_status:
        raise PublicSummaryError("Prediction lock completion status is inconsistent")
    image_copies = inference.get("image_copies")
    if not isinstance(image_copies, list) or len(image_copies) != EXPECTED_CASES:
        raise PublicSummaryError("Prediction lock must bind exactly 20 CT image copies")
    image_records: dict[str, Mapping[str, Any]] = {}
    for position, (case_id, selection_hash, record) in enumerate(
        zip(EXPECTED_CASE_IDS, _expected_selection_hashes(), image_copies, strict=True), start=1
    ):
        image_record = _require_object(record, "Locked CT image copy")
        _require_exact_keys(image_record, IMAGE_COPY_KEYS, "Locked CT image copy")
        if (
            image_record.get("case_id") != case_id
            or image_record.get("selection_order") != position
            or image_record.get("selection_hash") != selection_hash
            or image_record.get("input_relative") != f"nnunet_input/{case_id}_0000.nii.gz"
            or image_record.get("source_cache_relative") != f"source/images/{case_id}.nii.gz"
        ):
            raise PublicSummaryError("Locked CT image copy is incomplete or cross-bound")
        _require_sha256(image_record.get("image_sha256"), "Locked CT image hash")
        if _require_int(image_record.get("image_bytes"), "Locked CT image bytes") <= 0:
            raise PublicSummaryError("Locked CT image bytes must be positive")
        image_records[case_id] = image_record

    cases = inference.get("cases")
    if not isinstance(cases, list) or len(cases) != EXPECTED_CASES:
        raise PublicSummaryError("Prediction lock must contain exactly 20 private case records")
    if [record.get("case_id") for record in cases if isinstance(record, dict)] != list(
        EXPECTED_CASE_IDS
    ):
        raise PublicSummaryError("Prediction lock private records are incomplete or reordered")
    status_values: list[str] = []
    total_attempt_runtime = 0.0
    for position, record in enumerate(cases, start=1):
        case = _require_object(record, "Private locked case record")
        _require_exact_keys(case, LOCKED_CASE_KEYS, "Private locked case record")
        case_id = EXPECTED_CASE_IDS[position - 1]
        image_record = image_records[case_id]
        if (
            case.get("case_id") != case_id
            or case.get("selection_order") != position
            or case.get("input_image_relative") != f"nnunet_input/{case_id}_0000.nii.gz"
            or case.get("input_image_sha256") != image_record["image_sha256"]
            or case.get("input_image_bytes") != image_record["image_bytes"]
            or case.get("timing_relative") != f"timings/{case_id}.json"
        ):
            raise PublicSummaryError("Private locked case record is incomplete or cross-bound")
        _require_sha256(case.get("timing_sha256"), "Locked timing hash")
        if _require_int(case.get("timing_bytes"), "Locked timing bytes") <= 0:
            raise PublicSummaryError("Locked timing bytes must be positive")
        configuration_sha256 = _require_sha256(
            case.get("configuration_sha256"), "Locked configuration hash"
        )
        status_value = case.get("status")
        if status_value not in {"succeeded", "failed"}:
            raise PublicSummaryError("Private locked case status is invalid")
        attempts = case.get("attempts")
        if not isinstance(attempts, list) or len(attempts) not in {1, 2}:
            raise PublicSummaryError("Private locked case must contain one or two attempts")
        if status_value == "failed" and len(attempts) != 2:
            raise PublicSummaryError("Private locked failure must contain exactly two attempts")
        attempt_statuses: list[str] = []
        for attempt_number, attempt in enumerate(attempts, start=1):
            attempt_record = _require_object(attempt, "Locked attempt evidence")
            _require_exact_keys(attempt_record, LOCKED_ATTEMPT_KEYS, "Locked attempt evidence")
            attempt_status = attempt_record.get("status")
            if (
                attempt_record.get("attempt") != attempt_number
                or attempt_status not in {"succeeded", "failed"}
                or attempt_record.get("configuration_sha256") != configuration_sha256
            ):
                raise PublicSummaryError("Locked attempt evidence is incomplete or cross-bound")
            attempt_runtime = _finite(
                attempt_record.get("runtime_seconds"),
                "Locked attempt runtime_seconds",
                unit_interval=False,
            )
            total_attempt_runtime += attempt_runtime
            logs = attempt_record.get("logs")
            if not isinstance(logs, list) or len(logs) not in {2, 4}:
                raise PublicSummaryError("Locked attempt must contain two or four bound logs")
            allowed_logs = {
                f"logs/{case_id}.attempt-{attempt_number}.stdout.log",
                f"logs/{case_id}.attempt-{attempt_number}.stderr.log",
                f"logs/{case_id}.attempt-{attempt_number}.validation.stdout.log",
                f"logs/{case_id}.attempt-{attempt_number}.validation.stderr.log",
            }
            required_logs = {
                f"logs/{case_id}.attempt-{attempt_number}.stdout.log",
                f"logs/{case_id}.attempt-{attempt_number}.stderr.log",
            }
            seen_logs: set[str] = set()
            for log in logs:
                log_record = _require_object(log, "Locked attempt log")
                _require_exact_keys(log_record, LOCKED_LOG_KEYS, "Locked attempt log")
                relative = log_record.get("relative")
                if relative not in allowed_logs or relative in seen_logs:
                    raise PublicSummaryError("Locked attempt log is duplicated or cross-bound")
                seen_logs.add(relative)
                _require_sha256(log_record.get("sha256"), "Locked attempt log hash")
                if _require_int(log_record.get("bytes"), "Locked attempt log bytes") < 0:
                    raise PublicSummaryError("Locked attempt log bytes must be non-negative")
            if not required_logs.issubset(seen_logs) or len(seen_logs) != len(logs):
                raise PublicSummaryError("Locked attempt omits a canonical stdout/stderr log")
            if len(logs) == 4 and seen_logs != allowed_logs:
                raise PublicSummaryError("Locked validation log pair is incomplete")
            attempt_statuses.append(attempt_status)
        if status_value == "succeeded":
            if attempt_statuses[-1] != "succeeded" or any(
                value != "failed" for value in attempt_statuses[:-1]
            ):
                raise PublicSummaryError("Locked success attempt history is invalid")
        elif attempt_statuses != ["failed", "failed"]:
            raise PublicSummaryError("Locked failure attempt history is invalid")

        prediction = case.get("prediction")
        if (status_value == "succeeded") is not isinstance(prediction, dict):
            raise PublicSummaryError("Private locked success/failure evidence is inconsistent")
        if status_value == "succeeded":
            prediction_record = _require_object(prediction, "Locked prediction")
            _require_exact_keys(prediction_record, LOCKED_PREDICTION_KEYS, "Locked prediction")
            shape = prediction_record.get("shape")
            if (
                prediction_record.get("relative") != f"predictions/{case_id}.nii.gz"
                or prediction_record.get("geometry_validated_against_ct") is not True
                or not isinstance(shape, list)
                or len(shape) != 3
                or any(not isinstance(axis, int) or isinstance(axis, bool) or axis <= 0 for axis in shape)
            ):
                raise PublicSummaryError("Locked prediction is incomplete or cross-bound")
            _require_sha256(prediction_record.get("sha256"), "Locked prediction hash")
            if _require_int(prediction_record.get("bytes"), "Locked prediction bytes") <= 0:
                raise PublicSummaryError("Locked prediction bytes must be positive")
        status_values.append(status_value)
    if status_values.count("succeeded") != successful or status_values.count("failed") != failed:
        raise PublicSummaryError("Private locked case records disagree with aggregate counts")
    execution = _require_object(provenance.get("execution"), "Inference provenance execution")
    provenance_runtime = _finite(
        execution.get("runtime_seconds"),
        "Inference provenance runtime_seconds",
        unit_interval=False,
    )
    if not math.isclose(total_attempt_runtime, provenance_runtime, rel_tol=0, abs_tol=0.01):
        raise PublicSummaryError("Locked attempt runtimes disagree with inference provenance")

    receipt_path = path.with_name("prediction-lock.sha256")
    _require_regular_file(receipt_path, "Public prediction-lock receipt")
    lock_sha256 = sha256_file(path)
    if receipt_path.read_bytes() != (lock_sha256 + "\n").encode("ascii"):
        raise PublicSummaryError("Public prediction-lock receipt does not match the private lock")
    return lock, lock_sha256, provenance


def verify_reference_release(
    path: Path,
    prediction_lock_sha256: str,
    cohort: Mapping[str, Any],
    cohort_sha256: str,
) -> tuple[dict[str, Any], str]:
    if path.name != "reference-release.json":
        raise PublicSummaryError("Reference evidence must use the canonical release name")
    release = _load_json(path, "Reference release")
    _require_exact_keys(release, REFERENCE_RELEASE_KEYS, "Reference release")
    if (
        release.get("schema_version") != 1
        or release.get("release_type") != "reference_release_after_prediction_lock"
        or release.get("research_only") is not True
    ):
        raise PublicSummaryError("Reference release has an invalid schema, type, or safety scope")
    _require_utc(release.get("released_at_utc"), "Reference released_at_utc")
    _require_string(release.get("disclaimer"), "Reference release disclaimer")
    if (
        release.get("prediction_lock_sha256") != prediction_lock_sha256
        or release.get("cohort_lock_sha256") != cohort_sha256
        or release.get("manifest_sha256") != cohort["manifest_sha256"]
    ):
        raise PublicSummaryError("Reference release does not bind the frozen inference evidence")
    custody_mode = release.get("custody_mode")
    if custody_mode not in {"same_operator_script_blinded", "independent_custodian"}:
        raise PublicSummaryError("Reference release custody_mode is invalid")
    operator_blinded = release.get("operator_blinded")
    if operator_blinded is not (custody_mode == "independent_custodian"):
        raise PublicSummaryError("Reference release overstates operator blinding")
    _require_string(release.get("custody_limitation"), "Custody limitation")
    public_receipt = _require_object(
        release.get("public_prediction_lock_receipt"), "Public prediction-lock receipt"
    )
    _require_exact_keys(public_receipt, PUBLIC_RECEIPT_KEYS, "Public prediction-lock receipt")
    receipt_url = _require_string(public_receipt.get("url"), "Public receipt URL")
    parsed_receipt_url = urllib.parse.urlparse(receipt_url)
    receipt_parts = [part for part in parsed_receipt_url.path.split("/") if part]
    if (
        parsed_receipt_url.scheme != "https"
        or parsed_receipt_url.netloc.lower() != "raw.githubusercontent.com"
        or parsed_receipt_url.query
        or parsed_receipt_url.fragment
        or not parsed_receipt_url.path.endswith("/prediction-lock.sha256")
        or len(receipt_parts) < 5
    ):
        raise PublicSummaryError(
            "Public receipt URL must be a commit-pinned raw.githubusercontent.com digest"
        )
    receipt_commit = _require_string(public_receipt.get("commit"), "Public receipt commit")
    if re.fullmatch(r"[0-9a-f]{40}", receipt_commit) is None or receipt_parts[2] != receipt_commit:
        raise PublicSummaryError("Public receipt commit is invalid or does not match its URL")
    expected_receipt_repository = f"https://github.com/{receipt_parts[0]}/{receipt_parts[1]}"
    if public_receipt.get("repository") != expected_receipt_repository:
        raise PublicSummaryError("Public receipt repository does not match its URL")
    _require_utc(public_receipt.get("verified_at_utc"), "Public receipt verified_at_utc")
    if (
        release.get("kits23_repository") != KITS23_REPOSITORY
        or release.get("kits23_commit") != KITS23_COMMIT
    ):
        raise PublicSummaryError("Reference release dataset source identity is invalid")
    _require_int(release.get("case_count"), "Reference release case_count", expected=EXPECTED_CASES)
    _require_case_ids(release.get("case_ids"), "Reference release case_ids")
    cases = release.get("cases")
    if not isinstance(cases, list) or len(cases) != EXPECTED_CASES:
        raise PublicSummaryError("Reference release must contain exactly 20 private records")
    for case_id, record in zip(EXPECTED_CASE_IDS, cases, strict=True):
        record = _require_object(record, "Reference release private record")
        if set(record) != {"case_id", "relative", "sha256", "bytes"}:
            raise PublicSummaryError("Reference release private record schema is invalid")
        if record.get("case_id") != case_id or record.get("relative") != f"references/{case_id}.nii.gz":
            raise PublicSummaryError("Reference release private record is cross-bound")
        _require_sha256(record.get("sha256"), "Released reference hash")
        if _require_int(record.get("bytes"), "Released reference bytes") <= 0:
            raise PublicSummaryError("Released reference bytes must be positive")
    return release, sha256_file(path)


def verify_evaluator_hash_manifest(
    summary_path: Path,
) -> tuple[str, int, dict[str, Mapping[str, Any]], str]:
    if summary_path.name != "summary.json":
        raise PublicSummaryError("Evaluator evidence must use the canonical summary name")
    hashes_path = _canonical_input_file(
        summary_path.with_name("output-hashes.json"), "Evaluator output-hashes"
    )
    hashes = _load_json(hashes_path, "Evaluator output-hashes")
    if set(hashes) != {"schema_version", "research_only", "generated_at_utc", "files"}:
        raise PublicSummaryError("Evaluator output-hashes schema is not exact")
    if hashes.get("schema_version") != 1 or hashes.get("research_only") is not True:
        raise PublicSummaryError("Evaluator output-hashes safety scope is invalid")
    generated_at = _require_utc(
        hashes.get("generated_at_utc"), "Evaluator hash generated_at_utc"
    )
    records = hashes.get("files")
    if not isinstance(records, list) or not records:
        raise PublicSummaryError("Evaluator output-hashes files must be a non-empty array")
    seen: set[str] = set()
    records_by_name: dict[str, Mapping[str, Any]] = {}
    for record in records:
        record = _require_object(record, "Evaluator output hash record")
        if set(record) != {"path", "bytes", "sha256"}:
            raise PublicSummaryError("Evaluator output hash record schema is invalid")
        relative = _require_string(record.get("path"), "Evaluator output relative name")
        if relative in seen:
            raise PublicSummaryError("Evaluator output-hashes contains a duplicate name")
        seen.add(relative)
        _require_sha256(record.get("sha256"), "Evaluator output hash")
        _require_int(record.get("bytes"), "Evaluator output bytes")
        records_by_name[relative] = record

    expected_names = {
        "case-results.csv",
        "summary.json",
        "report.html",
        "worst-cases.html",
        "worst-cases.png",
        *(f"qc/{case_id}.png" for case_id in EXPECTED_CASE_IDS),
    }
    if set(records_by_name) != expected_names:
        raise PublicSummaryError("Evaluator output-hashes does not bind the exact report file set")

    report_root = summary_path.parent
    _require_symlink_free_chain(report_root, "Evaluator report directory")
    actual_names: set[str] = set()
    for candidate in report_root.rglob("*"):
        relative = candidate.relative_to(report_root).as_posix()
        try:
            details = candidate.lstat()
        except FileNotFoundError as exc:
            raise PublicSummaryError("Evaluator report changed during verification") from exc
        is_junction = bool(getattr(candidate, "is_junction", lambda: False)())
        if stat.S_ISLNK(details.st_mode) or is_junction:
            raise PublicSummaryError("Evaluator report contains a symlink or junction")
        if stat.S_ISREG(details.st_mode):
            actual_names.add(relative)
        elif not stat.S_ISDIR(details.st_mode):
            raise PublicSummaryError("Evaluator report contains an unsupported filesystem entry")
    if actual_names != expected_names | {"output-hashes.json"}:
        raise PublicSummaryError("Evaluator report directory is not the exact hashed file set")

    for relative, record in records_by_name.items():
        candidate = _canonical_input_file(report_root / relative, f"Evaluator report {relative}")
        if (
            record.get("bytes") != candidate.stat().st_size
            or record.get("sha256") != sha256_file(candidate)
        ):
            raise PublicSummaryError(f"Evaluator report artefact {relative} was modified")
    return (
        sha256_file(hashes_path),
        hashes_path.stat().st_size,
        records_by_name,
        generated_at,
    )


def _csv_number(
    row: Mapping[str, Any], column: str, *, unit_interval: bool = False
) -> float:
    value = row.get(column)
    if not isinstance(value, str) or not value.strip():
        raise PublicSummaryError(f"Evaluator case results has no value for {column}")
    try:
        number = float(value)
    except ValueError as exc:
        raise PublicSummaryError(f"Evaluator case results {column} is not numeric") from exc
    if not math.isfinite(number) or number < 0:
        raise PublicSummaryError(f"Evaluator case results {column} is invalid")
    if unit_interval and number > 1:
        raise PublicSummaryError(f"Evaluator case results {column} lies outside [0, 1]")
    return number


def _csv_signed_number(row: Mapping[str, Any], column: str) -> float:
    value = row.get(column)
    if not isinstance(value, str) or not value.strip():
        raise PublicSummaryError(f"Evaluator case results has no value for {column}")
    try:
        number = float(value)
    except ValueError as exc:
        raise PublicSummaryError(f"Evaluator case results {column} is not numeric") from exc
    if not math.isfinite(number):
        raise PublicSummaryError(f"Evaluator case results {column} is invalid")
    return number


def _bootstrap_mean_summary(values: list[float], rng: np.random.Generator) -> dict[str, Any]:
    array = np.asarray(values, dtype=np.float64)
    if array.size != EXPECTED_CASES:
        raise PublicSummaryError("Aggregate recomputation lost part of the 20-study denominator")
    indices = rng.integers(0, array.size, size=(BOOTSTRAP_SAMPLES, array.size))
    bootstrap_means = array[indices].mean(axis=1)
    return {
        "n": int(array.size),
        "mean": float(array.mean()),
        "median": float(np.median(array)),
        "standard_deviation": float(array.std(ddof=1)),
        "minimum": float(array.min()),
        "maximum": float(array.max()),
        "bootstrap_95_ci_of_mean": [
            float(np.quantile(bootstrap_means, 0.025)),
            float(np.quantile(bootstrap_means, 0.975)),
        ],
    }


def verify_and_recompute_case_results(
    summary_path: Path,
    prediction_lock: Mapping[str, Any],
) -> dict[str, Any]:
    """Verify the bound private CSV and independently recompute every published number."""

    results_path = _canonical_input_file(
        summary_path.with_name("case-results.csv"), "Evaluator case results"
    )
    try:
        with results_path.open("r", newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != CSV_FIELDS:
                raise PublicSummaryError("Evaluator case-results header is not exact")
            raw_rows = list(reader)
    except UnicodeDecodeError as exc:
        raise PublicSummaryError("Evaluator case-results is not valid UTF-8 CSV") from exc
    if len(raw_rows) != EXPECTED_CASES:
        raise PublicSummaryError("Evaluator case-results must contain exactly 20 rows")

    locked_cases = _require_object(prediction_lock.get("inference"), "Locked inference").get(
        "cases"
    )
    if not isinstance(locked_cases, list) or len(locked_cases) != EXPECTED_CASES:
        raise PublicSummaryError("Prediction lock lacks the exact private case set")

    rows: list[dict[str, Any]] = []
    for position, (case_id, raw, locked) in enumerate(
        zip(EXPECTED_CASE_IDS, raw_rows, locked_cases, strict=True), start=1
    ):
        if set(raw) != set(CSV_FIELDS) or None in raw:
            raise PublicSummaryError("Evaluator case-results row schema is not exact")
        if raw.get("case_id") != case_id:
            raise PublicSummaryError("Evaluator case-results is incomplete or reordered")
        locked = _require_object(locked, "Locked case for evaluator cross-check")
        locked_status = locked.get("status")
        expected_evaluator_status = "ok" if locked_status == "succeeded" else "failed"
        if (
            raw.get("status") != expected_evaluator_status
            or raw.get("inference_status") != locked_status
        ):
            raise PublicSummaryError("Evaluator case-results status disagrees with inference lock")
        failure_reason = raw.get("failure_reason")
        if not isinstance(failure_reason, str) or bool(failure_reason.strip()) is (
            expected_evaluator_status == "ok"
        ):
            raise PublicSummaryError("Evaluator case-results failure state is inconsistent")

        parsed: dict[str, Any] = {
            "case_id": case_id,
            "status": expected_evaluator_status,
            "runtime_seconds": _csv_number(raw, "runtime_seconds"),
        }
        locked_runtime = sum(
            _finite(
                _require_object(attempt, "Locked attempt").get("runtime_seconds"),
                "Locked attempt runtime",
                unit_interval=False,
            )
            for attempt in _require_object(locked, "Locked case").get("attempts", [])
        )
        if not math.isclose(
            parsed["runtime_seconds"], locked_runtime, rel_tol=5e-9, abs_tol=5e-9
        ):
            raise PublicSummaryError("Evaluator case runtime disagrees with locked attempts")

        for region in REGION_MAP.values():
            tolerance = _csv_number(raw, f"{region}_surface_tolerance_mm")
            if not math.isclose(
                tolerance,
                REGION_TOLERANCES_MM[region],
                rel_tol=5e-9,
                abs_tol=5e-9,
            ):
                raise PublicSummaryError(
                    f"Evaluator case-results {region} surface tolerance changed"
                )
            parsed[f"{region}_dice"] = _csv_number(
                raw, f"{region}_dice", unit_interval=True
            )
            parsed[f"{region}_surface_dice"] = _csv_number(
                raw, f"{region}_surface_dice", unit_interval=True
            )
            parsed[f"{region}_hd95_mm"] = _csv_number(raw, f"{region}_hd95_mm")
            parsed[f"{region}_absolute_volume_error_ml"] = _csv_number(
                raw, f"{region}_absolute_volume_error_ml"
            )
            reference_volume = _csv_number(raw, f"{region}_reference_volume_ml")
            prediction_volume = _csv_number(raw, f"{region}_prediction_volume_ml")
            signed_volume_error = _csv_signed_number(raw, f"{region}_volume_error_ml")
            if (
                not math.isclose(
                    prediction_volume - reference_volume,
                    signed_volume_error,
                    rel_tol=1e-8,
                    abs_tol=1e-8,
                )
                or not math.isclose(
                    abs(signed_volume_error),
                    parsed[f"{region}_absolute_volume_error_ml"],
                    rel_tol=1e-8,
                    abs_tol=1e-8,
                )
            ):
                raise PublicSummaryError(
                    f"Evaluator case-results {region} volume fields are inconsistent"
                )
            parsed[f"{region}_reference_volume_ml"] = reference_volume
            parsed[f"{region}_prediction_volume_ml"] = prediction_volume
            parsed[f"{region}_volume_error_ml"] = signed_volume_error
        parsed["mean_dice"] = _csv_number(raw, "mean_dice", unit_interval=True)
        parsed["mean_surface_dice"] = _csv_number(
            raw, "mean_surface_dice", unit_interval=True
        )
        parsed["mean_hd95_mm"] = _csv_number(raw, "mean_hd95_mm")
        for mean_column, suffix in (
            ("mean_dice", "dice"),
            ("mean_surface_dice", "surface_dice"),
            ("mean_hd95_mm", "hd95_mm"),
        ):
            region_mean = sum(parsed[f"{region}_{suffix}"] for region in REGION_MAP.values()) / 3
            if not math.isclose(
                parsed[mean_column], region_mean, rel_tol=5e-9, abs_tol=5e-9
            ):
                raise PublicSummaryError(f"Evaluator case-results {mean_column} is inconsistent")
        if expected_evaluator_status == "failed":
            for region in REGION_MAP.values():
                if (
                    parsed[f"{region}_dice"] != 0
                    or parsed[f"{region}_surface_dice"] != 0
                    or parsed[f"{region}_prediction_volume_ml"] != 0
                    or not math.isclose(
                        parsed[f"{region}_volume_error_ml"],
                        -parsed[f"{region}_reference_volume_ml"],
                        rel_tol=1e-8,
                        abs_tol=1e-8,
                    )
                ):
                    raise PublicSummaryError(
                        "Locked failure does not receive the preregistered metric penalty"
                    )
            if parsed["mean_dice"] != 0 or parsed["mean_surface_dice"] != 0:
                raise PublicSummaryError(
                    "Locked failure does not receive the preregistered metric penalty"
                )
            shape_text = raw.get("shape")
            spacing_text = raw.get("spacing_mm")
            if (
                not isinstance(shape_text, str)
                or re.fullmatch(r"[1-9][0-9]*x[1-9][0-9]*x[1-9][0-9]*", shape_text) is None
                or not isinstance(spacing_text, str)
            ):
                raise PublicSummaryError("Locked failure lacks valid reference geometry")
            try:
                shape = [int(value) for value in shape_text.split("x")]
                spacing = [float(value) for value in spacing_text.split("x")]
            except ValueError as exc:
                raise PublicSummaryError("Locked failure lacks valid reference geometry") from exc
            if len(spacing) != 3 or any(not math.isfinite(value) or value <= 0 for value in spacing):
                raise PublicSummaryError("Locked failure lacks valid reference geometry")
            diagonal = math.sqrt(
                sum(((axis - 1) * voxel) ** 2 for axis, voxel in zip(shape, spacing, strict=True))
            )
            expected_hd95 = diagonal if math.isfinite(diagonal) and diagonal > 0 else 1000.0
            if any(
                not math.isclose(
                    parsed[f"{region}_hd95_mm"],
                    expected_hd95,
                    rel_tol=2e-5,
                    abs_tol=1e-4,
                )
                for region in REGION_MAP.values()
            ):
                raise PublicSummaryError(
                    "Locked failure does not receive the reference-diagonal HD95 penalty"
                )
        rows.append(parsed)

    rng = np.random.default_rng(PUBLIC_SEED)
    regions: dict[str, Any] = {}
    for region in REGION_MAP.values():
        regions[region] = {
            metric: _bootstrap_mean_summary(
                [float(row[f"{region}_{metric}"]) for row in rows], rng
            )
            for metric in (
                "dice",
                "surface_dice",
                "hd95_mm",
                "absolute_volume_error_ml",
            )
        }
    overall = {
        metric: _bootstrap_mean_summary([float(row[metric]) for row in rows], rng)
        for metric in (
            "mean_dice",
            "mean_surface_dice",
            "mean_hd95_mm",
        )
    }
    runtime_values = [float(row["runtime_seconds"]) for row in rows]
    runtime = {
        **_bootstrap_mean_summary(runtime_values, rng),
        "total": float(sum(runtime_values)),
        "cases_with_timing": EXPECTED_CASES,
        "cases_without_timing": 0,
    }
    return {"regions": regions, "overall": overall, "runtime_seconds": runtime}


def _assert_recomputed_aggregate(
    actual: Any, expected: Mapping[str, Any], label: str
) -> None:
    aggregate = _require_object(actual, label)
    _require_exact_keys(aggregate, AGGREGATE_KEYS, label)
    if aggregate.get("n") != EXPECTED_CASES:
        raise PublicSummaryError(f"{label}.n must equal 20")
    for key in AGGREGATE_KEYS - {"n", "bootstrap_95_ci_of_mean"}:
        value = _finite(aggregate.get(key), f"{label}.{key}", unit_interval=False)
        if not math.isclose(value, float(expected[key]), rel_tol=5e-9, abs_tol=5e-9):
            raise PublicSummaryError(f"{label} differs from recomputed case results")
    interval = aggregate.get("bootstrap_95_ci_of_mean")
    if not isinstance(interval, list) or len(interval) != 2:
        raise PublicSummaryError(f"{label} confidence interval is malformed")
    for actual_bound, expected_bound in zip(
        interval, expected["bootstrap_95_ci_of_mean"], strict=True
    ):
        bound = _finite(actual_bound, f"{label} confidence interval", unit_interval=False)
        if not math.isclose(
            bound, float(expected_bound), rel_tol=5e-9, abs_tol=5e-9
        ):
            raise PublicSummaryError(f"{label} differs from recomputed case results")


def verify_recomputed_aggregates(
    summary: Mapping[str, Any], recomputed: Mapping[str, Any]
) -> None:
    regions = _require_object(summary.get("regions"), "Evaluator regions")
    for region in REGION_MAP.values():
        actual_region = _require_object(regions.get(region), f"Region {region}")
        expected_region = _require_object(
            _require_object(recomputed.get("regions"), "Recomputed regions").get(region),
            f"Recomputed region {region}",
        )
        for metric in ("dice", "surface_dice", "hd95_mm", "absolute_volume_error_ml"):
            _assert_recomputed_aggregate(
                actual_region.get(metric), expected_region[metric], f"{region}.{metric}"
            )
    overall = _require_object(summary.get("overall"), "Evaluator overall")
    recomputed_overall = _require_object(recomputed.get("overall"), "Recomputed overall")
    for metric in ("mean_dice", "mean_surface_dice", "mean_hd95_mm"):
        source_name = f"{metric}_across_regions_per_case"
        _assert_recomputed_aggregate(
            overall.get(source_name), recomputed_overall[metric], f"overall.{source_name}"
        )
    runtime = _require_object(summary.get("runtime_seconds"), "Evaluator runtime")
    recomputed_runtime = _require_object(
        recomputed.get("runtime_seconds"), "Recomputed runtime"
    )
    _assert_recomputed_aggregate(
        {key: runtime.get(key) for key in AGGREGATE_KEYS},
        recomputed_runtime,
        "runtime_seconds",
    )
    if (
        runtime.get("cases_with_timing") != EXPECTED_CASES
        or runtime.get("cases_without_timing") != 0
        or not math.isclose(
            _finite(runtime.get("total"), "runtime_seconds.total", unit_interval=False),
            float(recomputed_runtime["total"]),
            rel_tol=5e-9,
            abs_tol=5e-9,
        )
    ):
        raise PublicSummaryError("Evaluator runtime differs from recomputed case results")


def _finite(value: Any, label: str, *, unit_interval: bool) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PublicSummaryError(f"{label} must be numeric")
    number = float(value)
    if not math.isfinite(number):
        raise PublicSummaryError(f"{label} must be finite")
    if unit_interval and not 0 <= number <= 1:
        raise PublicSummaryError(f"{label} must lie in [0, 1]")
    if not unit_interval and number < 0:
        raise PublicSummaryError(f"{label} must be non-negative")
    return number


def _public_metric(value: Any, label: str, *, unit_interval: bool) -> dict[str, Any]:
    aggregate = _require_object(value, label)
    _require_exact_keys(aggregate, AGGREGATE_KEYS, label)
    _require_int(aggregate.get("n"), f"{label}.n", expected=EXPECTED_CASES)
    mean = _finite(aggregate.get("mean"), f"{label}.mean", unit_interval=unit_interval)
    median = _finite(
        aggregate.get("median"), f"{label}.median", unit_interval=unit_interval
    )
    standard_deviation = _finite(
        aggregate.get("standard_deviation"),
        f"{label}.standard_deviation",
        unit_interval=False,
    )
    minimum = _finite(
        aggregate.get("minimum"), f"{label}.minimum", unit_interval=unit_interval
    )
    maximum = _finite(
        aggregate.get("maximum"), f"{label}.maximum", unit_interval=unit_interval
    )
    if not minimum <= mean <= maximum or not minimum <= median <= maximum:
        raise PublicSummaryError(f"{label} mean/median lie outside the observed range")
    interval = aggregate.get("bootstrap_95_ci_of_mean")
    if not isinstance(interval, list) or len(interval) != 2:
        raise PublicSummaryError(f"{label} confidence interval must have exactly two bounds")
    low = _finite(interval[0], f"{label}.ci.low", unit_interval=unit_interval)
    high = _finite(interval[1], f"{label}.ci.high", unit_interval=unit_interval)
    if low > high:
        raise PublicSummaryError(f"{label} confidence interval is reversed")
    return {
        "n": EXPECTED_CASES,
        "mean": mean,
        "median": median,
        "standardDeviation": standard_deviation,
        "minimum": minimum,
        "maximum": maximum,
        "ci95": [low, high],
    }


def verify_evaluator_summary(
    summary_path: Path,
    cohort: Mapping[str, Any],
    cohort_sha256: str,
    model_sha256: str,
    prediction_lock: Mapping[str, Any],
    prediction_lock_sha256: str,
    provenance: Mapping[str, Any],
    release: Mapping[str, Any],
    release_sha256: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    summary = _load_json(summary_path, "Blinded evaluator summary")
    if summary.get("research_only") is not True:
        raise PublicSummaryError("Evaluator summary must state research_only=true")
    if summary.get("title") != "CalyxView Renal — 20-case KiTS23 script-blinded evaluation":
        raise PublicSummaryError("Evaluator summary is not the blinded protocol report")
    generated_at = _require_utc(summary.get("generated_at_utc"), "Evaluator generated_at_utc")
    disclaimer = _require_string(summary.get("disclaimer"), "Evaluator disclaimer").lower()
    for phrase in ("not a medical device", "not for diagnosis", "not for", "patient care"):
        if phrase not in disclaimer:
            raise PublicSummaryError("Evaluator disclaimer lacks explicit non-clinical wording")
    warnings = summary.get("timing_warnings")
    if warnings != []:
        raise PublicSummaryError("Evaluator timing warnings must be resolved before publication")
    privacy = _require_object(summary.get("privacy"), "Evaluator privacy")
    if (
        privacy.get("patient_metadata_in_report") is not False
        or privacy.get("source_ct_in_report") is not False
        or privacy.get("source_nifti_or_predictions_in_report") is not False
    ):
        raise PublicSummaryError("Evaluator report privacy claims are unsafe")

    manifest = _require_object(summary.get("manifest"), "Evaluator manifest")
    if (
        manifest.get("path") != "manifests/manifest.csv"
        or manifest.get("sha256") != cohort["manifest_sha256"]
        or manifest.get("path_free") is not True
        or manifest.get("image_only_five_column_contract") is not True
        or manifest.get("case_count") != EXPECTED_CASES
    ):
        raise PublicSummaryError("Evaluator manifest evidence is incomplete or mismatched")

    lock_inference = _require_object(prediction_lock.get("inference"), "Locked inference")
    successful = int(lock_inference["successful_predictions"])
    failed = int(lock_inference["failed_predictions"])
    completion = _require_object(summary.get("completion"), "Evaluator completion")
    if (
        completion.get("manifest_cases") != EXPECTED_CASES
        or completion.get("evaluated_successfully") != successful
        or completion.get("failed") != failed
        or completion.get("failed_cases_in_metric_denominator") is not True
    ):
        raise PublicSummaryError("Evaluator completion does not preserve the locked denominator")
    success_rate = _finite(
        completion.get("success_rate"), "Evaluator success_rate", unit_interval=True
    )
    if not math.isclose(success_rate, successful / EXPECTED_CASES, rel_tol=0, abs_tol=1e-12):
        raise PublicSummaryError("Evaluator success_rate disagrees with locked counts")
    _require_string(completion.get("failure_rule"), "Full-denominator failure rule")
    failures = completion.get("failures")
    if not isinstance(failures, list) or len(failures) != failed:
        raise PublicSummaryError("Evaluator private failure records are incomplete")
    locked_cases = lock_inference.get("cases")
    failed_ids = [
        record["case_id"]
        for record in locked_cases
        if isinstance(record, dict) and record.get("status") == "failed"
    ]
    reported_failed_ids: list[str] = []
    for record in failures:
        record = _require_object(record, "Evaluator private failure record")
        if set(record) != {"case_id", "reason"}:
            raise PublicSummaryError("Evaluator private failure schema is invalid")
        case_id = record.get("case_id")
        if not isinstance(case_id, str) or CASE_ID_RE.fullmatch(case_id) is None:
            raise PublicSummaryError("Evaluator private failure identity is invalid")
        _require_string(record.get("reason"), "Evaluator private failure reason")
        reported_failed_ids.append(case_id)
    if reported_failed_ids != failed_ids:
        raise PublicSummaryError("Evaluator private failures disagree with the locked run")

    blinding = _require_object(summary.get("blinding_and_custody"), "Blinding evidence")
    expected_blinding = {
        "mode": "script_inference_blinded",
        "operator_blinded": release["operator_blinded"],
        "custody_mode": release["custody_mode"],
        "custody_limitation": release["custody_limitation"],
        "prediction_lock_sha256": prediction_lock_sha256,
        "cohort_lock_sha256": cohort_sha256,
        "manifest_sha256": cohort["manifest_sha256"],
        "reference_release_sha256": release_sha256,
        "public_prediction_lock_receipt": release["public_prediction_lock_receipt"],
    }
    if blinding != expected_blinding:
        raise PublicSummaryError("Evaluator blinding/custody evidence is not exact")

    if summary.get("execution_provenance") != provenance:
        raise PublicSummaryError("Evaluator provenance differs from the immutable prediction lock")
    execution = _require_object(provenance.get("execution"), "Inference provenance execution")
    if (
        execution.get("attempted_cases") != EXPECTED_CASES
        or execution.get("timing_records_verified") != EXPECTED_CASES
        or execution.get("succeeded_predictions") != successful
        or execution.get("exhausted_failures") != failed
        or execution.get("full_denominator_preserved") is not True
    ):
        raise PublicSummaryError("Inference provenance aggregate counts are incomplete")
    provenance_model = _require_object(provenance.get("model"), "Inference provenance model")
    if (
        provenance_model.get("source_archive") != {
            "bytes": MODEL_ARCHIVE_BYTES,
            "sha256": MODEL_ARCHIVE_SHA256,
        }
        or provenance_model.get("installed_plans") != EXPECTED_PLANS
        or provenance_model.get("installed_folds") != EXPECTED_FOLDS
        or provenance_model.get("folds") != [0, 1, 2, 3, 4]
        or provenance_model.get("tta_enabled") is not False
    ):
        raise PublicSummaryError("Inference provenance model verification is incomplete")
    if provenance.get("model_lock_sha256") != model_sha256:
        raise PublicSummaryError("Evaluator provenance model-lock binding is invalid")

    bootstrap = _require_object(summary.get("bootstrap"), "Evaluator bootstrap")
    if (
        bootstrap.get("samples") != 10_000
        or bootstrap.get("seed") != PUBLIC_SEED
        or bootstrap.get("method") != "non-parametric case bootstrap of the arithmetic mean"
        or bootstrap.get("confidence_interval") != "percentile 2.5% to 97.5%"
    ):
        raise PublicSummaryError("Evaluator bootstrap contract differs from the frozen protocol")

    regions = _require_object(summary.get("regions"), "Evaluator regions")
    if set(regions) != set(REGION_MAP.values()):
        raise PublicSummaryError("Evaluator region set is not exact")
    public_regions: dict[str, Any] = {}
    for public_name, private_name in REGION_MAP.items():
        private_region = _require_object(regions.get(private_name), f"Region {private_name}")
        if set(private_region) != {source for source, _ in METRIC_MAP.values()}:
            raise PublicSummaryError(f"Region {private_name} metric set is not exact")
        public_regions[public_name] = {
            public_metric_name: _public_metric(
                private_region.get(private_metric_name),
                f"{private_name}.{private_metric_name}",
                unit_interval=unit_interval,
            )
            for public_metric_name, (private_metric_name, unit_interval) in METRIC_MAP.items()
        }

    overall = _require_object(summary.get("overall"), "Evaluator overall metrics")
    if set(overall) != {source for source, _ in OVERALL_MAP.values()}:
        raise PublicSummaryError("Evaluator overall metric set is not exact")
    public_overall = {
        public_name: _public_metric(
            overall.get(private_name),
            f"overall.{private_name}",
            unit_interval=unit_interval,
        )
        for public_name, (private_name, unit_interval) in OVERALL_MAP.items()
    }

    runtime = _require_object(summary.get("runtime_seconds"), "Evaluator runtime")
    if set(runtime) != AGGREGATE_KEYS | {"total", "cases_with_timing", "cases_without_timing"}:
        raise PublicSummaryError("Evaluator runtime metric set is not exact")
    if (
        runtime.get("cases_with_timing") != EXPECTED_CASES
        or runtime.get("cases_without_timing") != 0
    ):
        raise PublicSummaryError("Every study must have a timing record before publication")
    runtime_metric = _public_metric(
        {key: runtime[key] for key in AGGREGATE_KEYS},
        "runtime_seconds",
        unit_interval=False,
    )
    total_runtime = _finite(runtime.get("total"), "runtime_seconds.total", unit_interval=False)
    if not math.isclose(
        total_runtime,
        runtime_metric["mean"] * EXPECTED_CASES,
        rel_tol=1e-9,
        abs_tol=0.01,
    ):
        raise PublicSummaryError("Evaluator runtime total disagrees with the 20-study mean")
    execution_runtime = _finite(
        execution.get("runtime_seconds"),
        "Inference provenance runtime_seconds",
        unit_interval=False,
    )
    if not math.isclose(execution_runtime, total_runtime, rel_tol=0, abs_tol=0.001):
        raise PublicSummaryError("Evaluator runtime differs from immutable inference provenance")
    public_runtime = {
        "n": EXPECTED_CASES,
        "medianSecondsPerStudy": runtime_metric["median"],
        "meanSecondsPerStudy": runtime_metric["mean"],
        "totalSeconds": total_runtime,
    }
    return summary, {
        "generated_at_utc": generated_at,
        "successful": successful,
        "failed": failed,
        "success_rate": success_rate,
        "regions": public_regions,
        "overall": public_overall,
        "runtime": public_runtime,
    }


def assert_public_privacy(value: Any) -> None:
    """Reject public objects that contain case-level or location-bearing content."""

    def inspect(item: Any, trail: tuple[str, ...]) -> None:
        if isinstance(item, dict):
            for key, nested in item.items():
                if not isinstance(key, str):
                    raise PublicSummaryError("Public object keys must be strings")
                normalized = re.sub(r"[^a-z0-9_]", "", key.lower())
                if any(fragment in normalized for fragment in FORBIDDEN_PUBLIC_KEY_FRAGMENTS):
                    raise PublicSummaryError(f"Unsafe public field: {'.'.join((*trail, key))}")
                inspect(nested, (*trail, key))
            return
        if isinstance(item, list):
            if not trail or trail[-1] != "ci95" or len(item) != 2:
                raise PublicSummaryError("Public arrays are restricted to two-number confidence intervals")
            if any(isinstance(entry, bool) or not isinstance(entry, (int, float)) for entry in item):
                raise PublicSummaryError("Public confidence interval contains non-numeric content")
            return
        if isinstance(item, str):
            if CASE_ID_ANYWHERE_RE.search(item):
                raise PublicSummaryError("Public text contains a case-like identifier")
            if URL_RE.search(item) or WINDOWS_PATH_RE.search(item):
                raise PublicSummaryError("Public text contains a URL or local path")
            if item.startswith(("/", "\\", "./", "../")) or MEDICAL_OR_REPORT_SUFFIX_RE.search(item):
                raise PublicSummaryError("Public text contains a path or artefact name")
            return
        if item is None or isinstance(item, (bool, int, float)):
            if isinstance(item, float) and not math.isfinite(item):
                raise PublicSummaryError("Public object contains a non-finite number")
            return
        raise PublicSummaryError(f"Unsupported public value type at {'.'.join(trail)}")

    inspect(value, ())
    serialized = json.dumps(value, ensure_ascii=False, allow_nan=False)
    lowered = serialized.lower()
    for forbidden in ("failure_reason", "case_id", ".nii", "predictions/"):
        if forbidden in lowered:
            raise PublicSummaryError(f"Public JSON contains forbidden content: {forbidden}")


def verify_evidence_chronology(
    *,
    cohort: Mapping[str, Any],
    model: Mapping[str, Any],
    prediction_lock: Mapping[str, Any],
    provenance: Mapping[str, Any],
    release: Mapping[str, Any],
    evaluator_generated_at: str,
    evaluator_receipt_generated_at: str,
) -> None:
    prediction_created = _utc_datetime(
        prediction_lock.get("created_at_utc"), "Prediction lock created_at_utc"
    )
    for label, value in (
        ("Cohort lock created_utc", cohort.get("created_utc")),
        ("Model lock created_at_utc", model.get("created_at_utc")),
        ("Inference provenance created_utc", provenance.get("created_utc")),
    ):
        if _utc_datetime(value, label) > prediction_created:
            raise PublicSummaryError(f"Evidence chronology is reversed at {label}")

    public_receipt = _require_object(
        release.get("public_prediction_lock_receipt"), "Public prediction-lock receipt"
    )
    ordered = [
        ("prediction lock", prediction_created),
        (
            "public receipt verification",
            _utc_datetime(
                public_receipt.get("verified_at_utc"), "Public receipt verified_at_utc"
            ),
        ),
        (
            "reference release",
            _utc_datetime(release.get("released_at_utc"), "Reference released_at_utc"),
        ),
        (
            "evaluator summary",
            _utc_datetime(evaluator_generated_at, "Evaluator generated_at_utc"),
        ),
        (
            "evaluator receipt",
            _utc_datetime(
                evaluator_receipt_generated_at, "Evaluator hash generated_at_utc"
            ),
        ),
    ]
    for (earlier_label, earlier), (later_label, later) in zip(ordered, ordered[1:]):
        if later < earlier:
            raise PublicSummaryError(
                f"Evidence chronology is reversed: {later_label} precedes {earlier_label}"
            )


def build_public_summary(
    *,
    summary_path: Path,
    cohort_lock_path: Path,
    model_lock_path: Path,
    prediction_lock_path: Path,
    reference_release_path: Path,
) -> dict[str, Any]:
    summary_path = _canonical_input_file(summary_path, "Evaluator summary")
    cohort_lock_path = _canonical_input_file(cohort_lock_path, "Cohort lock")
    model_lock_path = _canonical_input_file(model_lock_path, "Model lock")
    prediction_lock_path = _canonical_input_file(prediction_lock_path, "Prediction lock")
    reference_release_path = _canonical_input_file(
        reference_release_path, "Reference release"
    )

    cohort, cohort_sha256 = verify_cohort_lock(cohort_lock_path)
    model, model_sha256 = verify_model_lock(model_lock_path)
    prediction_lock, prediction_lock_sha256, provenance = verify_prediction_lock(
        prediction_lock_path,
        cohort,
        cohort_sha256,
        model,
        model_sha256,
    )
    release, release_sha256 = verify_reference_release(
        reference_release_path,
        prediction_lock_sha256,
        cohort,
        cohort_sha256,
    )
    evaluator_receipt_sha256, _, _, evaluator_receipt_created_at = (
        verify_evaluator_hash_manifest(summary_path)
    )
    recomputed = verify_and_recompute_case_results(summary_path, prediction_lock)
    private_summary, aggregates = verify_evaluator_summary(
        summary_path,
        cohort,
        cohort_sha256,
        model_sha256,
        prediction_lock,
        prediction_lock_sha256,
        provenance,
        release,
        release_sha256,
    )
    verify_recomputed_aggregates(private_summary, recomputed)
    verify_evidence_chronology(
        cohort=cohort,
        model=model,
        prediction_lock=prediction_lock,
        provenance=provenance,
        release=release,
        evaluator_generated_at=aggregates["generated_at_utc"],
        evaluator_receipt_generated_at=evaluator_receipt_created_at,
    )

    if release["custody_mode"] == "independent_custodian":
        custody_statement = (
            "Reference data were held by an independent custodian until the inference lock."
        )
    else:
        custody_statement = (
            "The same operator could access the KiTS reference data; inference was "
            "script-blinded but not independently operator-blinded."
        )
    public = {
        "schemaVersion": 3,
        "status": "complete",
        "researchOnly": True,
        "clinicalUse": RESEARCH_ONLY_WORDING,
        "title": "20-study protocol-frozen KiTS23 script-blinded evaluation",
        "generatedAtUtc": aggregates["generated_at_utc"],
        "evaluation": {
            "mode": "scriptBlinded",
            "operatorBlinded": release["operator_blinded"],
            "custodyStatement": custody_statement,
            "scope": "Within-KiTS research feasibility only; not an external clinical validation.",
            "fullDenominatorPolicy": (
                "All 20 studies remain in every metric denominator, including model failures."
            ),
        },
        "protocol": {
            "dataset": "KiTS23",
            "datasetRevision": KITS23_COMMIT,
            "imagingRevision": IMAGING_REVISION,
            "selectionNamespace": PROTOCOL_NAMESPACE,
            "publicSeed": PUBLIC_SEED,
            "eligibleStudyCount": ELIGIBLE_COUNT,
            "cohortSize": EXPECTED_CASES,
            "model": model["model"],
            "modelTask": model["task"],
            "configuration": model["configuration"],
            "foldCount": len(model["folds"]),
            "ttaEnabled": model["tta_enabled"],
            "postprocessing": "None",
        },
        "completion": {
            "evaluatedCases": EXPECTED_CASES,
            "successfulCases": aggregates["successful"],
            "failedCases": aggregates["failed"],
            "successRate": aggregates["success_rate"],
        },
        "metrics": aggregates["regions"],
        "overall": aggregates["overall"],
        "runtime": aggregates["runtime"],
        "integrity": {
            "manifestSha256": cohort["manifest_sha256"],
            "cohortLockSha256": cohort_sha256,
            "modelLockSha256": model_sha256,
            "inferenceLockSha256": prediction_lock_sha256,
            "releaseEvidenceSha256": release_sha256,
            "evaluatorSummarySha256": sha256_file(summary_path),
            "evaluatorReceiptSha256": evaluator_receipt_sha256,
        },
        "limitations": {
            "clinical": (
                "This feasibility result is not evidence for diagnosis, treatment, or patient care."
            ),
            "custody": custody_statement,
            "generalisability": (
                "Results are limited to one small within-dataset cohort and require independent external validation."
            ),
        },
    }
    assert_public_privacy(public)
    return public


def write_public_summary(path: Path, public: Mapping[str, Any]) -> str:
    assert_public_privacy(public)
    destination = _absolute_without_resolution(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    _require_symlink_free_chain(destination.parent, "Public summary output directory")
    payload = (
        json.dumps(public, indent=2, sort_keys=False, ensure_ascii=False, allow_nan=False)
        + "\n"
    ).encode("utf-8")
    try:
        destination_details = destination.lstat()
    except FileNotFoundError:
        destination_details = None
    if destination_details is not None:
        is_junction = bool(getattr(destination, "is_junction", lambda: False)())
        if (
            stat.S_ISREG(destination_details.st_mode)
            and not stat.S_ISLNK(destination_details.st_mode)
            and not is_junction
            and destination.read_bytes() == payload
        ):
            return hashlib.sha256(payload).hexdigest()
        raise PublicSummaryError("Refusing to replace a different public summary")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError as exc:
            raise PublicSummaryError("Public summary appeared during publication") from exc
        except OSError as exc:
            raise PublicSummaryError(
                f"Filesystem cannot publish an atomic no-clobber public summary: {exc}"
            ) from exc
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return hashlib.sha256(payload).hexdigest()


def main() -> None:
    args = parse_args()
    try:
        public = build_public_summary(
            summary_path=args.summary,
            cohort_lock_path=args.cohort_lock,
            model_lock_path=args.model_lock,
            prediction_lock_path=args.prediction_lock,
            reference_release_path=args.reference_release,
        )
        digest = write_public_summary(args.output, public)
    except (OSError, PublicSummaryError) as exc:
        raise SystemExit(f"Public summary refused: {exc}") from exc
    print(
        json.dumps(
            {
                "status": "ok",
                "evaluated": public["completion"]["evaluatedCases"],
                "successful": public["completion"]["successfulCases"],
                "failed": public["completion"]["failedCases"],
                "sha256": digest,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
