#!/usr/bin/env python3
"""Create the aggregate-only website payload from a completed local report.

This release gate deliberately copies no case identifiers, rows, paths, images,
volumes, predictions, or failure reasons.  It also refuses to publish a partial
denominator or a metric whose aggregate does not contain all 20 frozen cases.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any, Mapping


EXPECTED_CASES = 20
EXPECTED_MANIFEST_SHA256 = (
    "bc529b7e5edfa9c5ac0979de1d38a027735b741760e3e82c14acc78ec900c561"
)
EXPECTED_IMAGE_BYTES = 1_030_320_853
EXPECTED_LABEL_BYTES = 3_669_644
EXPECTED_MODEL_BYTES = 3_505_803_654
EXPECTED_MODEL_MD5 = "b27ab702742083080b95baac00ba186f"
EXPECTED_MODEL_SHA256 = (
    "a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3"
)
EXPECTED_NNUNET_COMMIT = "db16c6cef5fdd5a180159184e46b58bcca670446"
EXPECTED_VALIDATOR_SHA256 = (
    "9203f0ccfe10385a24e11ec7c77bd2d00d56aa7a0ed49d1c91a3ea16dc1d8abc"
)
EXPECTED_PLANS = {
    "bytes": 143_080,
    "sha256": "d15d46664240f0a9056ef1320e00df46fbd866ea94323a98e47b3e9eff1f4e39",
}
DATASET_REVISION = "c1088353084c17b8882a11db71429e7c022b7785"
IMAGING_REVISION = "65f1f295873a326230153c7e1de0c7dba10f0b29"
EXPECTED_FOLDS = [
    {
        "fold": 0,
        "checkpoint_bytes": 249_826_698,
        "checkpoint_sha256": "d64a21c10973c459870297e57e39811304c689e3b9bddd5bbaeb7a8384d64cf7",
        "metadata_bytes": 143_564,
        "metadata_sha256": "9f6f0d03dcbe0a67a2e5894f2f10ea6b0f58dd5de5348b3c6a7b6c0e1bede0b2",
    },
    {
        "fold": 1,
        "checkpoint_bytes": 249_826_570,
        "checkpoint_sha256": "6038808474337ca2f27cc2592847622f3665f8c526165dfe945ca8d905a0e27c",
        "metadata_bytes": 143_564,
        "metadata_sha256": "d1d5dafb9de471634a1d3ded474ca6554f6b731f49154c30ff81a18fac6174f6",
    },
    {
        "fold": 2,
        "checkpoint_bytes": 249_826_762,
        "checkpoint_sha256": "54e61742f2acf83fe6b163d73e41c3a4629cecfa3441b70257c9e6b96d64efc9",
        "metadata_bytes": 143_564,
        "metadata_sha256": "99acda476f067ac55236dfe01ea0f220d86867cba094366733b5e9eef338731b",
    },
    {
        "fold": 3,
        "checkpoint_bytes": 249_826_570,
        "checkpoint_sha256": "abddc1d98252bd1b8f90af10b42a58ebd6c27059f4360af9307618f2977bcd0b",
        "metadata_bytes": 143_564,
        "metadata_sha256": "fcd1ea1b1eced829852f64a42d9d8a5b6cbee35190a87dace853255124227adf",
    },
    {
        "fold": 4,
        "checkpoint_bytes": 249_826_826,
        "checkpoint_sha256": "849e9bad2031ca99096fd4a827283838541c7822d84063b74337621d649b92ef",
        "metadata_bytes": 143_564,
        "metadata_sha256": "975843163c8150e60c12f651b437a9256de48c5a3810fa21c6d77a2f2be77898",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the privacy-minimised public KiTS23 benchmark summary."
    )
    parser.add_argument(
        "--summary",
        type=Path,
        required=True,
        help="Completed local report/summary.json produced by evaluate_and_report.py.",
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def require_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_report_hash_manifest(summary_path: Path) -> None:
    hashes_path = summary_path.parent / "output-hashes.json"
    hashes = require_mapping(
        json.loads(hashes_path.read_text(encoding="utf-8")), "output-hashes.json"
    )
    if hashes.get("schema_version") != 1 or hashes.get("research_only") is not True:
        raise ValueError("output-hashes.json has an unexpected schema or safety scope")
    files = hashes.get("files")
    if not isinstance(files, list):
        raise ValueError("output-hashes.json.files must be an array")
    matching = [
        record
        for record in files
        if isinstance(record, Mapping) and record.get("path") == summary_path.name
    ]
    if len(matching) != 1:
        raise ValueError("output-hashes.json must contain exactly one summary.json record")
    record = matching[0]
    if (
        record.get("bytes") != summary_path.stat().st_size
        or record.get("sha256") != sha256_file(summary_path)
    ):
        raise ValueError("summary.json does not match the evaluator output-hash manifest")


def require_count(value: Any, label: str, expected: int = EXPECTED_CASES) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if value != expected:
        raise ValueError(f"{label} must equal {expected}; got {value}")
    return value


def finite_number(value: Any, label: str, *, unit_interval: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite")
    if unit_interval and not 0.0 <= number <= 1.0:
        raise ValueError(f"{label} must lie in [0, 1]")
    if not unit_interval and number < 0.0:
        raise ValueError(f"{label} must be non-negative")
    return number


def metric_summary(
    region: Mapping[str, Any], source_key: str, public_stem: str, *, unit_interval: bool
) -> dict[str, Any]:
    aggregate = require_mapping(region.get(source_key), source_key)
    require_count(aggregate.get("n"), f"{source_key}.n")
    mean = finite_number(
        aggregate.get("mean"), f"{source_key}.mean", unit_interval=unit_interval
    )
    ci = aggregate.get("bootstrap_95_ci_of_mean")
    if not isinstance(ci, list) or len(ci) != 2:
        raise ValueError(f"{source_key}.bootstrap_95_ci_of_mean must have two bounds")
    low = finite_number(ci[0], f"{source_key}.ci[0]", unit_interval=unit_interval)
    high = finite_number(ci[1], f"{source_key}.ci[1]", unit_interval=unit_interval)
    if low > high:
        raise ValueError(f"{source_key} confidence interval is reversed")
    return {public_stem: mean, f"{public_stem}Ci95": [low, high]}


def public_region(region: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    result.update(metric_summary(region, "dice", "diceMean", unit_interval=True))
    result.update(
        metric_summary(
            region, "surface_dice", "surfaceDiceMean", unit_interval=True
        )
    )
    result.update(
        metric_summary(region, "hd95_mm", "hd95MmMean", unit_interval=False)
    )
    result.update(
        metric_summary(
            region,
            "absolute_volume_error_ml",
            "volumeMaeMlMean",
            unit_interval=False,
        )
    )
    return result


def main() -> None:
    args = parse_args()
    source_path = args.summary.resolve()
    source = require_mapping(json.loads(source_path.read_text(encoding="utf-8")), "summary")
    verify_report_hash_manifest(source_path)

    completion = require_mapping(source.get("completion"), "completion")
    manifest_cases = require_count(completion.get("manifest_cases"), "manifest_cases")
    successful = completion.get("evaluated_successfully")
    failed = completion.get("failed")
    if any(isinstance(value, bool) or not isinstance(value, int) for value in (successful, failed)):
        raise ValueError("successful and failed counts must be integers")
    if not 0 <= successful <= EXPECTED_CASES or not 0 <= failed <= EXPECTED_CASES:
        raise ValueError("successful and failed counts must lie between 0 and 20")
    if successful + failed != EXPECTED_CASES:
        raise ValueError("successful plus failed cases must equal the frozen denominator")
    if completion.get("failed_cases_in_metric_denominator") is not True:
        raise ValueError("Full-denominator failure policy was not recorded")

    manifest = require_mapping(source.get("manifest"), "manifest")
    if manifest.get("sha256") != EXPECTED_MANIFEST_SHA256:
        raise ValueError("Manifest SHA-256 does not match the frozen cohort")
    if manifest.get("path_free") is not True:
        raise ValueError("Report does not identify the canonical path-free manifest")
    require_count(manifest.get("case_count"), "manifest.case_count")

    provenance = require_mapping(source.get("execution_provenance"), "execution_provenance")
    cohort = require_mapping(provenance.get("cohort"), "execution_provenance.cohort")
    require_count(cohort.get("case_count"), "execution_provenance.cohort.case_count")
    if cohort.get("first_case") != "case_00400" or cohort.get("last_case") != "case_00419":
        raise ValueError("Execution provenance cohort bounds do not match the frozen cohort")
    if cohort.get("portable_manifest_sha256") != EXPECTED_MANIFEST_SHA256:
        raise ValueError("Execution provenance portable manifest does not match the report")
    if cohort.get("portable_manifest_path_free") is not True:
        raise ValueError("Execution provenance does not confirm a path-free manifest")
    if (
        cohort.get("kits23_commit") != DATASET_REVISION
        or cohort.get("kits23_tracked_source_commit_equivalent") is not True
        or cohort.get("kits23_unignored_untracked_files") != 0
        or cohort.get("imaging_revision") != IMAGING_REVISION
    ):
        raise ValueError("Dataset tracked-source identity or cleanliness is not frozen")
    kits23_clean = cohort.get("kits23_tracked_working_tree_clean")
    kits23_crlf = cohort.get("kits23_crlf_only_changed_files")
    if (
        not isinstance(kits23_clean, bool)
        or isinstance(kits23_crlf, bool)
        or not isinstance(kits23_crlf, int)
        or kits23_crlf < 0
        or (kits23_clean and kits23_crlf != 0)
        or (not kits23_clean and kits23_crlf == 0)
    ):
        raise ValueError("Dataset tracked-working-tree evidence is inconsistent")
    kits23_ignored = cohort.get("kits23_ignored_untracked_files")
    kits23_ignored_bytes = cohort.get("kits23_ignored_untracked_bytes")
    kits23_ignored_executable = cohort.get(
        "kits23_ignored_potentially_executable_files"
    )
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value < 0
        for value in (
            kits23_ignored,
            kits23_ignored_bytes,
            kits23_ignored_executable,
        )
    ) or kits23_ignored_executable > kits23_ignored:
        raise ValueError("Dataset ignored-artifact evidence is inconsistent")
    kits23_inventory_sha256 = cohort.get("kits23_ignored_inventory_sha256")
    if (
        cohort.get("kits23_ignored_inventory_complete") is not True
        or not isinstance(kits23_inventory_sha256, str)
        or len(kits23_inventory_sha256) != 64
        or any(
            character not in "0123456789abcdef"
            for character in kits23_inventory_sha256
        )
    ):
        raise ValueError("Dataset ignored-artifact inventory is invalid")
    assets = require_mapping(
        cohort.get("asset_verification"), "execution_provenance.cohort.asset_verification"
    )
    for key in ("source_images_verified", "reference_labels_verified", "nnunet_inputs_verified"):
        require_count(assets.get(key), f"asset_verification.{key}")
    if (
        assets.get("source_image_bytes") != EXPECTED_IMAGE_BYTES
        or assets.get("nnunet_input_bytes") != EXPECTED_IMAGE_BYTES
        or assets.get("reference_label_bytes") != EXPECTED_LABEL_BYTES
    ):
        raise ValueError("Verified cohort byte totals do not match the frozen data")

    model = require_mapping(provenance.get("model"), "execution_provenance.model")
    if model.get("archive_md5") != EXPECTED_MODEL_MD5:
        raise ValueError("Model archive MD5 does not match the frozen model")
    if model.get("archive_sha256") != EXPECTED_MODEL_SHA256:
        raise ValueError("Model archive SHA-256 does not match the frozen model")
    if model.get("archive_bytes") != EXPECTED_MODEL_BYTES:
        raise ValueError("Model archive byte count does not match the frozen model")
    if model.get("task") != "Task135_KiTS2021":
        raise ValueError("Unexpected model task")
    if model.get("configuration") != "3d_fullres":
        raise ValueError("Unexpected model configuration")
    if model.get("folds") != [0, 1, 2, 3, 4] or model.get("tta_enabled") is not False:
        raise ValueError("Unexpected fold ensemble or test-time augmentation setting")
    if model.get("installed_folds") != EXPECTED_FOLDS:
        raise ValueError("Installed checkpoint evidence does not match all five frozen folds")
    if model.get("installed_plans") != EXPECTED_PLANS:
        raise ValueError("Installed nnU-Net plans evidence does not match the frozen model")
    if model.get("postprocessing_file_present") is not False:
        raise ValueError("Frozen protocol requires no model postprocessing file")
    runtime_model_locations = model.get("runtime_model_locations_verified")
    if (
        isinstance(runtime_model_locations, bool)
        or not isinstance(runtime_model_locations, int)
        or runtime_model_locations < 1
    ):
        raise ValueError("No runtime model location was independently verified")
    framework = require_mapping(
        provenance.get("framework"), "execution_provenance.framework"
    )
    if framework.get("nnunet_commit") != EXPECTED_NNUNET_COMMIT:
        raise ValueError("nnU-Net source commit does not match the frozen framework")
    runtime_sources = framework.get("runtime_source_locations_verified")
    if (
        isinstance(runtime_sources, bool)
        or not isinstance(runtime_sources, int)
        or runtime_sources < 1
        or framework.get("all_runtime_tracked_sources_commit_equivalent") is not True
    ):
        raise ValueError("Runtime nnU-Net tracked-source identity was not independently verified")
    clean_sources = framework.get("runtime_source_tracked_worktrees_clean")
    crlf_sources = framework.get(
        "runtime_source_tracked_worktrees_with_crlf_only_changes"
    )
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value < 0
        for value in (clean_sources, crlf_sources)
    ) or clean_sources + crlf_sources != runtime_sources:
        raise ValueError("Runtime nnU-Net tracked-working-tree evidence is inconsistent")
    ignored_files = framework.get("runtime_source_ignored_untracked_files")
    ignored_bytes = framework.get("runtime_source_ignored_untracked_bytes")
    ignored_executable = framework.get(
        "runtime_source_ignored_potentially_executable_files"
    )
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value < 0
        for value in (ignored_files, ignored_bytes, ignored_executable)
    ) or ignored_executable > ignored_files:
        raise ValueError("Runtime ignored-artifact evidence is inconsistent")
    inventory_sha256 = framework.get("runtime_source_ignored_inventory_sha256")
    if (
        framework.get("runtime_source_unignored_untracked_files") != 0
        or framework.get("runtime_source_ignored_inventory_complete") is not True
        or framework.get("runtime_executable_source_purity_claimed") is not False
        or not isinstance(inventory_sha256, str)
        or len(inventory_sha256) != 64
        or any(character not in "0123456789abcdef" for character in inventory_sha256)
    ):
        raise ValueError("Runtime ignored-artifact scope was not truthfully recorded")

    inference_contract = require_mapping(
        provenance.get("inference_contract"), "execution_provenance.inference_contract"
    )
    run_evidence = require_mapping(
        inference_contract.get("actual_run_verification"),
        "execution_provenance.inference_contract.actual_run_verification",
    )
    require_count(run_evidence.get("timing_records_verified"), "timing_records_verified")
    if (
        run_evidence.get("successful_records") != successful
        or run_evidence.get("failed_records") != failed
        or run_evidence.get("validated_predictions") != successful
    ):
        raise ValueError("Execution records do not agree with report completion counts")
    qualified_attempts = run_evidence.get("qualified_attempts")
    if (
        isinstance(qualified_attempts, bool)
        or not isinstance(qualified_attempts, int)
        or not EXPECTED_CASES <= qualified_attempts <= EXPECTED_CASES * 2
    ):
        raise ValueError("Qualified attempt count violates the frozen retry policy")
    expected_execution = {
        "task": "Task135_KiTS2021",
        "configuration": "3d_fullres",
        "folds": [0, 1, 2, 3, 4],
        "tta_enabled": False,
        "preprocessing_threads": 1,
        "nifti_save_threads": 1,
        "validator_sha256": EXPECTED_VALIDATOR_SHA256,
        "retry_sequence_verified": True,
        "all_records_match_frozen_contract": True,
    }
    for key, value in expected_execution.items():
        if run_evidence.get(key) != value:
            raise ValueError(f"Actual-run evidence mismatch: {key}")

    regions = require_mapping(source.get("regions"), "regions")
    region_key_map = {
        "kidneyAndMass": "kidney_and_mass",
        "mass": "mass",
        "tumour": "tumour",
    }
    public_metrics = {
        public_key: public_region(require_mapping(regions.get(source_key), source_key))
        for public_key, source_key in region_key_map.items()
    }

    runtime = require_mapping(source.get("runtime_seconds"), "runtime_seconds")
    require_count(runtime.get("cases_with_timing"), "runtime.cases_with_timing")
    if runtime.get("cases_without_timing") != 0:
        raise ValueError("Every frozen case must have a timing record")
    median_runtime = finite_number(runtime.get("median"), "runtime.median")
    total_runtime = finite_number(runtime.get("total"), "runtime.total")

    generated_at = source.get("generated_at_utc")
    if not isinstance(generated_at, str) or not generated_at.strip():
        raise ValueError("generated_at_utc is missing")

    public = {
        "schemaVersion": 2,
        "status": "complete",
        "researchOnly": True,
        "title": "20-study KiTS23 non-overlapping, within-KiTS feasibility benchmark",
        "generatedAtUtc": generated_at,
        "protocol": {
            "dataset": "KiTS23",
            "model": "nnU-Net v1 Task135_KiTS2021",
            "configuration": "3d_fullres, five-fold ensemble, test-time augmentation disabled, no postprocessing file",
            "cohortSize": EXPECTED_CASES,
            "evaluatedCases": manifest_cases,
            "successfulCases": successful,
            "failedCases": failed,
            "labelSource": "KiTS23 training reference segmentations",
            "scope": "Non-overlapping, within-KiTS research feasibility only",
        },
        "metrics": public_metrics,
        "runtime": {
            "medianSecondsPerCase": median_runtime,
            "totalSeconds": total_runtime,
        },
        "provenance": {
            "datasetRevision": DATASET_REVISION,
            "imagingRevision": IMAGING_REVISION,
            "datasetSourceIdentityScope": (
                "Tracked source commit-equivalent; active images, labels, and inputs "
                "independently hash-verified"
            ),
            "portableManifestSha256": EXPECTED_MANIFEST_SHA256,
            "modelArchiveMd5": EXPECTED_MODEL_MD5,
            "modelArchiveSha256": EXPECTED_MODEL_SHA256,
            "nnunetCommit": EXPECTED_NNUNET_COMMIT,
            "runtimeSourceIdentityScope": (
                "Tracked source commit-equivalent; ignored runtime artefacts inventoried "
                "at capture time but not treated as upstream commit content"
            ),
        },
    }

    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.tmp")
    temporary.write_text(
        json.dumps(public, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )
    os.replace(temporary, output_path)
    print(
        json.dumps(
            {
                "status": "ok",
                "output": str(output_path),
                "cases": manifest_cases,
                "successful": successful,
                "failed": failed,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
