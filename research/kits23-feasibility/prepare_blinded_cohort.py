#!/usr/bin/env python3
"""Freeze and acquire an image-only KiTS23 benchmark cohort.

This is deliberately a pre-reference step.  It has no argument, code path, or
dependency for obtaining KiTS annotations.  The output manifest is restricted
to five image/selection fields so it can be consumed by inference without
exposing outcome information.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence


PROTOCOL_NAMESPACE = "calyxview-renal-kits23-blinded-v1"
PUBLIC_SEED = 20260901
ELIGIBLE_START = "case_00420"
ELIGIBLE_END = "case_00588"
SELECTION_COUNT = 20
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

IMAGING_REPOSITORY = "neheller/KiTS-Challenge-Imaging"
IMAGING_REVISION = "65f1f295873a326230153c7e1de0c7dba10f0b29"
MANIFEST_COLUMNS = (
    "case_id",
    "selection_order",
    "selection_hash",
    "image_sha256",
    "image_bytes",
)
SELECTION_ALGORITHM = (
    "SHA-256(protocol_namespace + '|seed=' + decimal public_seed + '|' + "
    "case_id), sorted by ascending hexadecimal digest"
)
RESEARCH_DISCLAIMER = (
    "Research prototype only. Not a medical device. Not for diagnosis, treatment "
    "selection, surgical planning, margin selection, or patient care. Outputs may "
    "be incomplete or wrong."
)

_REFERENCE_NAME_PATTERN = re.compile(
    r"(?:^|[^a-z0-9])(?:"
    r"labels?(?:tr|ts)?|references?|referencedata|"
    r"segmentations?|segments?|segs?|masks?|"
    r"ground[-_ ]?truth|truth[-_ ]?masks?"
    r")(?:$|[^a-z0-9])",
    re.IGNORECASE,
)
_STRUCTURED_SUFFIXES = {".csv", ".json", ".jsonl", ".tsv", ".yaml", ".yml"}


class ReferenceContentError(RuntimeError):
    """Raised when annotation-like material is present in the inference tree."""


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def eligible_case_ids() -> tuple[str, ...]:
    return tuple(f"case_{case_number:05d}" for case_number in range(420, 589))


def eligible_list_bytes(case_ids: Sequence[str]) -> bytes:
    """Return the protocol's canonical LF-terminated eligible-list encoding."""

    return ("\n".join(case_ids) + "\n").encode("utf-8")


def selection_hash(case_id: str) -> str:
    material = f"{PROTOCOL_NAMESPACE}|seed={PUBLIC_SEED}|{case_id}".encode("utf-8")
    return sha256_bytes(material)


def selected_cases() -> tuple[tuple[str, str], ...]:
    eligible = eligible_case_ids()
    if not eligible or eligible[0] != ELIGIBLE_START or eligible[-1] != ELIGIBLE_END:
        raise RuntimeError("Eligible range constants do not match the generated case list")
    eligible_digest = sha256_bytes(eligible_list_bytes(eligible))
    if eligible_digest != ELIGIBLE_LIST_SHA256:
        raise RuntimeError(
            "Eligible-list identity changed: "
            f"expected {ELIGIBLE_LIST_SHA256}, got {eligible_digest}"
        )

    ranked = sorted((selection_hash(case_id), case_id) for case_id in eligible)
    selected = tuple((case_id, digest) for digest, case_id in ranked[:SELECTION_COUNT])
    if tuple(case_id for case_id, _ in selected) != EXPECTED_CASE_IDS:
        raise RuntimeError("Deterministic cohort fixture changed unexpectedly")
    return selected


def _name_is_reference_like(name: str) -> bool:
    return _REFERENCE_NAME_PATTERN.search(name) is not None


def _walk_json_keys(value: object, location: Path) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if _name_is_reference_like(str(key)):
                raise ReferenceContentError(
                    f"Annotation-like structured key {key!r} found in {location}"
                )
            _walk_json_keys(child, location)
    elif isinstance(value, list):
        for child in value:
            _walk_json_keys(child, location)


def _inspect_structured_file(path: Path) -> None:
    if path.stat().st_size > 2 * 1024 * 1024:
        return
    suffix = path.suffix.lower()
    try:
        if suffix in {".json", ".jsonl"}:
            text = path.read_text(encoding="utf-8")
            if suffix == ".json":
                _walk_json_keys(json.loads(text), path)
            else:
                for line_number, line in enumerate(text.splitlines(), start=1):
                    if not line.strip():
                        continue
                    try:
                        _walk_json_keys(json.loads(line), path)
                    except json.JSONDecodeError as error:
                        raise ReferenceContentError(
                            f"Cannot safely inspect JSONL at {path}:{line_number}"
                        ) from error
        elif suffix in {".csv", ".tsv"}:
            delimiter = "\t" if suffix == ".tsv" else ","
            with path.open("r", newline="", encoding="utf-8-sig") as handle:
                header = next(csv.reader(handle, delimiter=delimiter), [])
            for field in header:
                if _name_is_reference_like(field):
                    raise ReferenceContentError(
                        f"Annotation-like structured field {field!r} found in {path}"
                    )
        elif suffix in {".yaml", ".yml"}:
            key_pattern = re.compile(r"^\s*['\"]?([^:'\"]+)['\"]?\s*:")
            for line in path.read_text(encoding="utf-8").splitlines():
                match = key_pattern.match(line)
                if match and _name_is_reference_like(match.group(1)):
                    raise ReferenceContentError(
                        f"Annotation-like structured key found in {path}"
                    )
    except UnicodeDecodeError as error:
        raise ReferenceContentError(f"Cannot safely inspect structured file {path}") from error
    except json.JSONDecodeError as error:
        raise ReferenceContentError(f"Cannot safely inspect JSON file {path}") from error


def reject_reference_like_content(inference_root: Path) -> None:
    """Reject annotation-like paths or structured fields below ``inference_root``."""

    if not inference_root.exists():
        return
    for path in sorted(inference_root.rglob("*"), key=lambda item: str(item).lower()):
        relative = path.relative_to(inference_root)
        if any(_name_is_reference_like(part) for part in relative.parts):
            raise ReferenceContentError(
                f"Annotation-like path is forbidden below the inference root: {relative}"
            )
        if path.is_file() and path.suffix.lower() in _STRUCTURED_SUFFIXES:
            _inspect_structured_file(path)


def link_or_copy(source: Path, destination: Path) -> None:
    source = source.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if source.stat().st_size <= 0:
        raise ValueError(f"Image file is empty: {source}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if not destination.is_file():
            raise RuntimeError(f"Expected an image file, found another path type: {destination}")
        if (
            source.stat().st_size != destination.stat().st_size
            or sha256_file(source) != sha256_file(destination)
        ):
            raise RuntimeError(f"Existing image does not match its source: {destination}")
        return
    if source == destination.resolve(strict=False):
        return
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def _find_local_image(source_dir: Path, case_id: str) -> Path:
    candidates = (
        source_dir / f"{case_id}.nii.gz",
        source_dir / "images" / f"{case_id}.nii.gz",
    )
    matches = [candidate for candidate in candidates if candidate.is_file()]
    if not matches:
        raise FileNotFoundError(
            f"Image-only source is missing {case_id}.nii.gz below {source_dir}"
        )
    if len(matches) > 1 and matches[0].resolve() != matches[1].resolve():
        raise RuntimeError(f"Ambiguous image-only sources for {case_id}: {matches}")
    return matches[0]


def _download_image(case_id: str, cache_dir: Path) -> Path:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as error:
        raise RuntimeError(
            "huggingface_hub is required for network acquisition; alternatively pass "
            "--image-source-dir with an image-only local cache"
        ) from error

    downloaded = Path(
        hf_hub_download(
            repo_id=IMAGING_REPOSITORY,
            repo_type="dataset",
            filename=f"images/{case_id}.nii.gz",
            revision=IMAGING_REVISION,
            # Keep the Hub's metadata/cache outside the inference root.  The
            # verified image is copied into source/images below; no cache
            # bookkeeping is permitted inside the tree that will be locked.
            cache_dir=cache_dir,
        )
    ).resolve()
    if not downloaded.is_file():
        raise FileNotFoundError(downloaded)
    return downloaded


def _manifest_bytes(records: Sequence[dict[str, object]]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(
        buffer,
        fieldnames=list(MANIFEST_COLUMNS),
        extrasaction="raise",
        lineterminator="\n",
    )
    writer.writeheader()
    writer.writerows(records)
    return buffer.getvalue().encode("utf-8")


def _write_once_or_verify(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if not path.is_file() or path.read_bytes() != content:
            raise RuntimeError(f"Locked output already exists with different content: {path}")
        return

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temporary_path = Path(handle.name)
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def _created_utc(existing_lock: Path, supplied: str | None) -> str:
    if existing_lock.exists():
        try:
            value = json.loads(existing_lock.read_text(encoding="utf-8"))["created_utc"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise RuntimeError(f"Existing cohort lock is malformed: {existing_lock}") from error
        if not isinstance(value, str) or not value.endswith("Z"):
            raise RuntimeError(f"Existing cohort lock has an invalid created_utc: {existing_lock}")
        return value
    if supplied is not None:
        return supplied
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _require_exact_image_sets(run_root: Path, case_ids: Iterable[str]) -> None:
    case_ids = tuple(case_ids)
    expected_source = {f"{case_id}.nii.gz" for case_id in case_ids}
    expected_input = {f"{case_id}_0000.nii.gz" for case_id in case_ids}
    source_dir = run_root / "source" / "images"
    input_dir = run_root / "nnunet_input"
    actual_source = {path.name for path in source_dir.iterdir()}
    actual_input = {path.name for path in input_dir.iterdir()}
    if actual_source != expected_source:
        raise RuntimeError(
            "Image cache does not contain exactly the frozen cohort: "
            f"expected {len(expected_source)}, found {len(actual_source)}"
        )
    if actual_input != expected_input:
        raise RuntimeError(
            "Inference input does not contain exactly the frozen cohort: "
            f"expected {len(expected_input)}, found {len(actual_input)}"
        )


def prepare_cohort(
    run_root: Path,
    image_source_dir: Path | None = None,
    *,
    created_utc: str | None = None,
) -> dict[str, object]:
    run_root = run_root.resolve()
    image_source_dir = image_source_dir.resolve() if image_source_dir is not None else None

    reject_reference_like_content(run_root)
    if image_source_dir is not None:
        if not image_source_dir.is_dir():
            raise NotADirectoryError(image_source_dir)
        # Only inspect names relative to the supplied cache.  Absolute parent names
        # are irrelevant and may legitimately contain words such as "reference".
        reject_reference_like_content(image_source_dir)

    selection = selected_cases()
    source_root = run_root / "source"
    source_image_dir = source_root / "images"
    nnunet_input_dir = run_root / "nnunet_input"
    manifests_dir = run_root / "manifests"
    lock_path = manifests_dir / "cohort-lock.public.json"
    lock_created_utc = _created_utc(lock_path, created_utc)

    records: list[dict[str, object]] = []
    for order, (case_id, digest) in enumerate(selection, start=1):
        print(f"[{order:02d}/{SELECTION_COUNT}] acquiring image {case_id}", flush=True)
        acquired = (
            _find_local_image(image_source_dir, case_id)
            if image_source_dir is not None
            else _download_image(case_id, run_root.parent / "hf-cache")
        )
        source_path = source_image_dir / f"{case_id}.nii.gz"
        link_or_copy(acquired, source_path)
        input_path = nnunet_input_dir / f"{case_id}_0000.nii.gz"
        link_or_copy(source_path, input_path)
        records.append(
            {
                "case_id": case_id,
                "selection_order": order,
                "selection_hash": digest,
                "image_sha256": sha256_file(input_path),
                "image_bytes": input_path.stat().st_size,
            }
        )

    _require_exact_image_sets(run_root, (record["case_id"] for record in records))
    manifest_content = _manifest_bytes(records)
    manifest_path = manifests_dir / "manifest.csv"
    _write_once_or_verify(manifest_path, manifest_content)

    lock: dict[str, object] = {
        "schema_version": 1,
        "protocol_namespace": PROTOCOL_NAMESPACE,
        "public_seed": PUBLIC_SEED,
        "eligible_start": ELIGIBLE_START,
        "eligible_end": ELIGIBLE_END,
        "eligible_count": len(eligible_case_ids()),
        "eligible_list_sha256": ELIGIBLE_LIST_SHA256,
        "selection_count": SELECTION_COUNT,
        "selection_algorithm": SELECTION_ALGORITHM,
        "manifest_sha256": sha256_bytes(manifest_content),
        "manifest_columns": list(MANIFEST_COLUMNS),
        "case_ids": [record["case_id"] for record in records],
        "selection_hashes": [record["selection_hash"] for record in records],
        "imaging_repository": IMAGING_REPOSITORY,
        "imaging_revision": IMAGING_REVISION,
        "total_image_bytes": sum(int(record["image_bytes"]) for record in records),
        "created_utc": lock_created_utc,
        "research_only": True,
        "disclaimer": RESEARCH_DISCLAIMER,
    }
    lock_content = (json.dumps(lock, indent=2, sort_keys=True) + "\n").encode("utf-8")
    _write_once_or_verify(lock_path, lock_content)

    reject_reference_like_content(run_root)
    print(json.dumps(lock, indent=2, sort_keys=True), flush=True)
    return lock


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Freeze the deterministic 20-case KiTS23 cohort and acquire CT images only. "
            "This pre-reference command never accepts or reads annotation paths."
        )
    )
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument(
        "--image-source-dir",
        type=Path,
        help=(
            "Optional image-only local cache. It must contain case_XXXXX.nii.gz either "
            "directly or below images/. Omit to download from the pinned official store."
        ),
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    prepare_cohort(args.run_root, args.image_source_dir)


if __name__ == "__main__":
    main()
