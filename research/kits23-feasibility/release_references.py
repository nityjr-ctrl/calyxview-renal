#!/usr/bin/env python3
"""Release KiTS references only after a public prediction-lock receipt exists.

This is a private scoring-stage tool. It deliberately has no inference logic and
must write outside the inference root. For a local single-account run the honest
custody label is ``same_operator_script_blinded``; that is not an independently
operator-blinded evaluation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


EXPECTED_KITS23_COMMIT = "c1088353084c17b8882a11db71429e7c022b7785"
EXPECTED_CASE_COUNT = 20
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CASE_ID_RE = re.compile(r"^case_[0-9]{5}$")
DISCLAIMER = (
    "RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE. NOT FOR DIAGNOSIS, "
    "TREATMENT SELECTION, SURGICAL PLANNING, MARGIN SELECTION, OR PATIENT CARE."
)


class ReleaseError(ValueError):
    """Raised before references are copied when a release gate fails."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json_object(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file() or path.is_symlink():
        raise ReleaseError(f"{label} must be a regular file: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReleaseError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ReleaseError(f"{label} must contain one JSON object")
    return value


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise ReleaseError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _case_ids(prediction_lock: Mapping[str, Any]) -> list[str]:
    cohort = prediction_lock.get("cohort")
    if not isinstance(cohort, dict):
        raise ReleaseError("Prediction lock lacks a cohort object")
    case_ids = cohort.get("case_ids")
    if (
        not isinstance(case_ids, list)
        or len(case_ids) != EXPECTED_CASE_COUNT
        or any(not isinstance(case_id, str) or CASE_ID_RE.fullmatch(case_id) is None for case_id in case_ids)
        or len(set(case_ids)) != len(case_ids)
    ):
        raise ReleaseError("Prediction lock must bind exactly 20 unique public case IDs")
    return case_ids


def verify_private_prediction_lock(path: Path) -> tuple[dict[str, Any], str]:
    value = load_json_object(path, "Private prediction lock")
    if value.get("schema_version") != 1:
        raise ReleaseError("Prediction lock schema_version must be 1")
    if value.get("lock_type") != "prediction_lock_before_reference_release":
        raise ReleaseError("Prediction lock has the wrong lock_type")
    if value.get("research_only") is not True:
        raise ReleaseError("Prediction lock must state research_only=true")
    reference_state = value.get("reference_state")
    if not isinstance(reference_state, dict):
        raise ReleaseError("Prediction lock lacks reference_state")
    if reference_state.get("reference_material_present") is not False:
        raise ReleaseError("Prediction lock does not prove a reference-free inference tree")
    if reference_state.get("reference_material_loaded") is not False:
        raise ReleaseError("Prediction lock does not prove references were unopened")
    _case_ids(value)
    return value, sha256_file(path)


def _safe_public_digest_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if (
        parsed.scheme != "https"
        or parsed.netloc.lower() != "raw.githubusercontent.com"
        or parsed.query
        or parsed.fragment
        or not parsed.path.endswith("/prediction-lock.sha256")
    ):
        raise ReleaseError(
            "Published receipt must be a commit-pinned raw.githubusercontent.com "
            "prediction-lock.sha256 URL"
        )
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 5 or not re.fullmatch(r"[0-9a-f]{40}", parts[2]):
        raise ReleaseError("Published receipt URL must contain an exact 40-hex Git commit")
    return value


def verify_published_digest(
    url: str,
    expected_sha256: str,
    *,
    opener: Any = urllib.request.urlopen,
) -> dict[str, str]:
    safe_url = _safe_public_digest_url(url)
    request = urllib.request.Request(
        safe_url,
        headers={"User-Agent": "CalyxView-Renal-reference-release/1.0"},
    )
    try:
        with opener(request, timeout=30) as response:
            payload = response.read(1024)
    except Exception as exc:
        raise ReleaseError(f"Could not verify the public prediction-lock receipt: {exc}") from exc
    try:
        text = payload.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ReleaseError("Published prediction-lock receipt is not ASCII") from exc
    if text != expected_sha256 + "\n":
        raise ReleaseError("Published prediction-lock digest does not match the private lock")
    parts = [part for part in urllib.parse.urlparse(safe_url).path.split("/") if part]
    return {
        "url": safe_url,
        "repository": f"https://github.com/{parts[0]}/{parts[1]}",
        "commit": parts[2],
        "verified_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


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
    return result.stdout.strip().lower()


def release_references(
    *,
    prediction_lock_path: Path,
    published_digest_url: str,
    kits23_repo: Path,
    output_root: Path,
    custody_mode: str,
    opener: Any = urllib.request.urlopen,
) -> dict[str, Any]:
    prediction_lock_path = prediction_lock_path.resolve()
    inference_root = prediction_lock_path.parent.resolve()
    output_root = output_root.resolve()
    if output_root == inference_root or output_root.is_relative_to(inference_root):
        raise ReleaseError("Reference release root must be outside the inference root")
    if inference_root.is_relative_to(output_root):
        raise ReleaseError("Inference root must not be nested inside the reference release root")
    if output_root.exists() or output_root.is_symlink():
        raise ReleaseError("Reference release is immutable; output root must not already exist")
    if custody_mode not in {"same_operator_script_blinded", "independent_custodian"}:
        raise ReleaseError("Unsupported custody mode")

    prediction_lock, prediction_lock_sha256 = verify_private_prediction_lock(
        prediction_lock_path
    )
    # This network receipt gate finishes before the first reference path is resolved.
    public_receipt = verify_published_digest(
        published_digest_url,
        prediction_lock_sha256,
        opener=opener,
    )

    repository = kits23_repo.resolve()
    if git_commit(repository) != EXPECTED_KITS23_COMMIT:
        raise ReleaseError("KiTS23 source revision does not match the frozen protocol")
    case_ids = _case_ids(prediction_lock)
    cohort = prediction_lock["cohort"]

    output_root.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{output_root.name}.", suffix=".tmp", dir=output_root.parent)
    )
    try:
        references = temporary / "references"
        references.mkdir()
        cases: list[dict[str, Any]] = []
        for case_id in case_ids:
            source = repository / "dataset" / case_id / "segmentation.nii.gz"
            if not source.is_file() or source.is_symlink() or source.stat().st_size <= 0:
                raise ReleaseError(f"Frozen KiTS reference is missing for {case_id}")
            destination = references / f"{case_id}.nii.gz"
            shutil.copy2(source, destination)
            cases.append(
                {
                    "case_id": case_id,
                    "relative": f"references/{case_id}.nii.gz",
                    "sha256": sha256_file(destination),
                    "bytes": destination.stat().st_size,
                }
            )

        record: dict[str, Any] = {
            "schema_version": 1,
            "release_type": "reference_release_after_prediction_lock",
            "released_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "research_only": True,
            "disclaimer": DISCLAIMER,
            "custody_mode": custody_mode,
            "operator_blinded": custody_mode == "independent_custodian",
            "custody_limitation": (
                "Separate-account/host custody asserted by the custodian."
                if custody_mode == "independent_custodian"
                else "Same operator/account could access KiTS references; this run is script/inference-blinded, not independently operator-blinded."
            ),
            "prediction_lock_sha256": prediction_lock_sha256,
            "cohort_lock_sha256": _require_sha256(
                cohort.get("cohort_lock_sha256"), "cohort_lock_sha256"
            ),
            "manifest_sha256": _require_sha256(
                cohort.get("manifest_sha256"), "manifest_sha256"
            ),
            "public_prediction_lock_receipt": public_receipt,
            "kits23_repository": "https://github.com/neheller/kits23",
            "kits23_commit": EXPECTED_KITS23_COMMIT,
            "case_count": EXPECTED_CASE_COUNT,
            "case_ids": case_ids,
            "cases": cases,
        }
        record_path = temporary / "reference-release.json"
        record_path.write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        os.replace(temporary, output_root)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return record


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Release frozen KiTS references after a public prediction-lock receipt."
    )
    parser.add_argument("--prediction-lock", type=Path, required=True)
    parser.add_argument("--published-digest-url", required=True)
    parser.add_argument("--kits23-repo", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument(
        "--custody-mode",
        required=True,
        choices=("same_operator_script_blinded", "independent_custodian"),
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    try:
        record = release_references(
            prediction_lock_path=args.prediction_lock,
            published_digest_url=args.published_digest_url,
            kits23_repo=args.kits23_repo,
            output_root=args.output_root,
            custody_mode=args.custody_mode,
        )
    except (OSError, ReleaseError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"Reference release refused: {exc}") from exc
    print(
        json.dumps(
            {
                "status": "ok",
                "case_count": record["case_count"],
                "custody_mode": record["custody_mode"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
