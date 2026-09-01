#!/usr/bin/env python3
"""Build a deterministic, path-free cohort manifest for provenance and release."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any


CASE_PATTERN = re.compile(r"^case_[0-9]{5}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
EXPECTED_CASE_IDS = [f"case_{number:05d}" for number in range(400, 420)]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create the deterministic path-free KiTS23 cohort manifest."
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def require_integer(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be an integer") from exc
    if parsed < 0:
        raise ValueError(f"{label} must be non-negative")
    return parsed


def require_float(value: str, label: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be numeric") from exc
    if not parsed >= 0:
        raise ValueError(f"{label} must be non-negative")
    return parsed


def canonical_case(row: dict[str, str]) -> dict[str, Any]:
    case_id = row.get("case_id", "").strip()
    if not CASE_PATTERN.fullmatch(case_id):
        raise ValueError(f"Invalid case_id: {case_id!r}")
    image_sha256 = row.get("image_sha256", "").strip().lower()
    label_sha256 = row.get("label_sha256", "").strip().lower()
    if not SHA256_PATTERN.fullmatch(image_sha256):
        raise ValueError(f"Invalid image SHA-256 for {case_id}")
    if not SHA256_PATTERN.fullmatch(label_sha256):
        raise ValueError(f"Invalid label SHA-256 for {case_id}")

    return {
        "caseId": case_id,
        "selectionOrder": require_integer(row.get("selection_order", ""), "selection_order"),
        "imageSha256": image_sha256,
        "labelSha256": label_sha256,
        "imageBytes": require_integer(row.get("image_bytes", ""), "image_bytes"),
        "labelBytes": require_integer(row.get("label_bytes", ""), "label_bytes"),
        "shape": row.get("shape", "").strip(),
        "spacingMm": row.get("spacing_mm", "").strip(),
        "labelValues": row.get("label_values", "").strip(),
        "referenceVolumesMl": {
            "kidneyAndMass": require_float(
                row.get("reference_kidney_and_mass_ml", ""),
                "reference_kidney_and_mass_ml",
            ),
            "mass": require_float(row.get("reference_mass_ml", ""), "reference_mass_ml"),
            "tumour": require_float(
                row.get("reference_tumour_ml", ""), "reference_tumour_ml"
            ),
        },
    }


def main() -> None:
    args = parse_args()
    manifest_path = args.manifest.resolve()
    with manifest_path.open("r", encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    cases = [canonical_case(row) for row in rows]
    if [case["caseId"] for case in cases] != EXPECTED_CASE_IDS:
        raise ValueError("Cohort must be the ordered case_00400..case_00419 set")
    if [case["selectionOrder"] for case in cases] != list(range(1, 21)):
        raise ValueError("selectionOrder must be the ordered values 1..20")

    payload = {
        "schemaVersion": 1,
        "researchOnly": True,
        "cohortDefinition": (
            "20 public KiTS23 studies, case_00400 through case_00419 inclusive; "
            "non-overlapping with documented KiTS21 training identifiers"
        ),
        "cases": cases,
    }
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2, separators=(",", ": ")) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(temporary, output_path)
    portable_sha256 = sha256_file(output_path)
    metadata_path = manifest_path.parent / "manifest.metadata.json"
    if metadata_path.is_file():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if not isinstance(metadata, dict):
            raise ValueError("manifest.metadata.json must be an object")
        metadata["local_manifest_sha256"] = sha256_file(manifest_path)
        metadata["local_manifest_path_dependent"] = True
        metadata["portable_manifest_sha256"] = portable_sha256
        metadata["portable_manifest_path_free"] = True
        metadata_temporary = metadata_path.with_name(f".{metadata_path.name}.tmp")
        metadata_temporary.write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        os.replace(metadata_temporary, metadata_path)
    print(
        json.dumps(
            {
                "status": "ok",
                "cases": len(cases),
                "output": str(output_path),
                "sha256": portable_sha256,
            }
        )
    )


if __name__ == "__main__":
    main()
