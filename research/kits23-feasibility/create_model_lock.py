#!/usr/bin/env python3
"""Verify the frozen nnU-Net model and write a pre-inference model lock.

The resulting JSON is deliberately path-free. It proves which public model,
source revision, installed plans, fold artefacts, and exact ten-file pipeline
were approved before a blinded run starts; it contains no scans, labels or
patient information.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from capture_provenance import (
    EXPECTED_CHECKPOINTS,
    EXPECTED_FOLDS,
    EXPECTED_MODEL_BYTES,
    EXPECTED_MODEL_SHA256,
    EXPECTED_NNUNET_COMMIT,
    EXPECTED_PLANS,
    hash_file,
    verify_model_install,
)
from capture_blinded_provenance import SOURCE_FILES, collect_source_artifacts


DISCLAIMER = (
    "RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE. NOT FOR DIAGNOSIS, "
    "TREATMENT SELECTION, SURGICAL PLANNING, MARGIN SELECTION, OR PATIENT CARE."
)
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create the path-free frozen-model lock required before inference."
    )
    parser.add_argument("--results-folder", type=Path, required=True)
    parser.add_argument("--nnunet-source", type=Path, required=True)
    parser.add_argument("--model-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def git_commit(path: Path) -> str:
    resolved = path.resolve()
    result = subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={resolved.as_posix()}",
            "-C",
            str(resolved),
            "rev-parse",
            "HEAD",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    commit = result.stdout.strip().lower()
    if not COMMIT_PATTERN.fullmatch(commit):
        raise ValueError("nnU-Net source did not return a valid Git commit")
    return commit


def build_model_lock(
    *,
    results_folder: Path,
    nnunet_source: Path,
    model_archive: Path,
    pipeline_root: Path | None = None,
) -> dict[str, Any]:
    archive = model_archive.resolve()
    if not archive.is_file() or archive.stat().st_size != EXPECTED_MODEL_BYTES:
        raise ValueError("Frozen model archive is missing or has the wrong byte count")
    archive_sha256 = hash_file(archive)
    if archive_sha256 != EXPECTED_MODEL_SHA256:
        raise ValueError("Frozen model archive SHA-256 mismatch")

    commit = git_commit(nnunet_source)
    if commit != EXPECTED_NNUNET_COMMIT:
        raise ValueError(
            f"nnU-Net source commit mismatch: expected {EXPECTED_NNUNET_COMMIT}, got {commit}"
        )

    installed = verify_model_install(results_folder.resolve())
    if [record["fold"] for record in installed] != EXPECTED_FOLDS:
        raise ValueError("Installed fold ordering changed unexpectedly")

    installed_folds = []
    for record in installed:
        fold = int(record["fold"])
        expected = EXPECTED_CHECKPOINTS[fold]
        if record != {"fold": fold, **expected}:
            raise ValueError(f"Frozen installed fold {fold} evidence changed unexpectedly")
        installed_folds.append(
            {
                "fold": fold,
                "checkpoint": {
                    "sha256": record["checkpoint_sha256"],
                    "bytes": record["checkpoint_bytes"],
                },
                "metadata": {
                    "sha256": record["metadata_sha256"],
                    "bytes": record["metadata_bytes"],
                },
            }
        )

    source_hashes = collect_source_artifacts(
        pipeline_root.resolve() if pipeline_root is not None else Path(__file__).resolve().parent
    )
    if set(source_hashes) != set(SOURCE_FILES):
        raise ValueError("Pre-inference pipeline source hash set is incomplete")

    return {
        "schema_version": 1,
        "research_only": True,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
        "model": "Published nnU-Net v1 KiTS21 ensemble",
        "task": "Task135_KiTS2021",
        "configuration": "3d_fullres",
        "folds": EXPECTED_FOLDS,
        "tta_enabled": False,
        "source_archive": {
            "sha256": archive_sha256,
            "bytes": archive.stat().st_size,
        },
        "nnunet_source_commit": commit,
        "installed_plans": {
            "sha256": EXPECTED_PLANS["sha256"],
            "bytes": EXPECTED_PLANS["bytes"],
        },
        "installed_folds": installed_folds,
        "pipeline_source_artifact_hashes": source_hashes,
        "provenance_note": (
            "Created and verified before inference. Runtime provenance must independently "
            "re-verify the model and all frozen inference, evaluation, release, and public-"
            "summary source hashes before the prediction lock is accepted."
        ),
    }


def write_once(path: Path, payload: dict[str, Any]) -> None:
    destination = path.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if destination.exists():
        if destination.read_text(encoding="utf-8") != serialized:
            raise FileExistsError(f"Refusing to replace a different model lock: {destination}")
        return
    temporary = destination.with_name(f".{destination.name}.tmp")
    temporary.write_text(serialized, encoding="utf-8", newline="\n")
    os.replace(temporary, destination)


def main() -> None:
    args = parse_args()
    record = build_model_lock(
        results_folder=args.results_folder,
        nnunet_source=args.nnunet_source,
        model_archive=args.model_archive,
    )
    write_once(args.output, record)
    print(
        json.dumps(
            {
                "status": "ok",
                "output": str(args.output.resolve()),
                "sha256": hash_file(args.output.resolve()),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
