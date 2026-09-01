#!/usr/bin/env python3
"""Fetch and validate the locked KiTS23 case_00400..case_00419 cohort."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import nibabel as nib
import numpy as np
from huggingface_hub import hf_hub_download


CASE_IDS = tuple(f"case_{case_number:05d}" for case_number in range(400, 420))
IMAGING_REPO = "neheller/KiTS-Challenge-Imaging"
IMAGING_REVISION = "65f1f295873a326230153c7e1de0c7dba10f0b29"
KITS23_REPOSITORY = "https://github.com/neheller/kits23"
KITS23_REVISION = "c1088353084c17b8882a11db71429e7c022b7785"
DATA_LICENSE = "CC BY-NC-SA 4.0"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def link_or_copy(source: Path, destination: Path) -> None:
    if destination.exists():
        if (
            source.stat().st_size != destination.stat().st_size
            or sha256_file(source) != sha256_file(destination)
        ):
            raise RuntimeError(f"Existing file does not match its source: {destination}")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def inspect_pair(image_path: Path, label_path: Path) -> dict[str, object]:
    image = nib.load(image_path)
    label = nib.load(label_path)
    if image.shape != label.shape:
        raise ValueError(
            f"Shape mismatch: image={image.shape}, label={label.shape}, case={image_path.name}"
        )
    if not np.allclose(image.affine, label.affine, atol=1e-4):
        raise ValueError(f"Affine mismatch for {image_path.name}")

    label_data = np.asanyarray(label.dataobj)
    label_values = sorted(int(value) for value in np.unique(label_data))
    if not set(label_values).issubset({0, 1, 2, 3}):
        raise ValueError(f"Unexpected labels {label_values} in {label_path}")

    image_proxy = np.asanyarray(image.dataobj)
    if not np.isfinite(image_proxy).all():
        raise ValueError(f"Non-finite CT values in {image_path}")

    voxel_ml = float(abs(np.linalg.det(image.affine[:3, :3])) / 1000.0)
    return {
        "shape": "x".join(str(value) for value in image.shape),
        "spacing_mm": "x".join(f"{value:.6g}" for value in image.header.get_zooms()[:3]),
        "label_values": ";".join(str(value) for value in label_values),
        "reference_kidney_and_mass_ml": float(np.count_nonzero(label_data > 0) * voxel_ml),
        "reference_mass_ml": float(np.count_nonzero(np.isin(label_data, (2, 3))) * voxel_ml),
        "reference_tumour_ml": float(np.count_nonzero(label_data == 2) * voxel_ml),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kits23-repo", type=Path, required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    args = parser.parse_args()

    kits23_repo = args.kits23_repo.resolve()
    source_revision = subprocess.run(
        ["git", "-C", str(kits23_repo), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if source_revision != KITS23_REVISION:
        raise ValueError(
            f"KiTS23 revision mismatch: expected {KITS23_REVISION}, got {source_revision}"
        )
    source_status = subprocess.run(
        ["git", "-C", str(kits23_repo), "status", "--porcelain"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if source_status:
        raise ValueError("KiTS23 checkout must be clean before cohort acquisition")
    run_root = args.run_root.resolve()
    source_dir = run_root / "source"
    label_dir = run_root / "labels"
    nnunet_input_dir = run_root / "nnunet_input"
    manifests_dir = run_root / "manifests"
    for path in (source_dir, label_dir, nnunet_input_dir, manifests_dir):
        path.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, object]] = []
    for index, case_id in enumerate(CASE_IDS, start=1):
        print(f"[{index:02d}/{len(CASE_IDS)}] acquiring {case_id}", flush=True)
        downloaded = Path(
            hf_hub_download(
                repo_id=IMAGING_REPO,
                repo_type="dataset",
                filename=f"images/{case_id}.nii.gz",
                revision=IMAGING_REVISION,
                local_dir=source_dir,
            )
        ).resolve()
        official_label = (
            kits23_repo / "dataset" / case_id / "segmentation.nii.gz"
        ).resolve()
        if not official_label.is_file():
            raise FileNotFoundError(official_label)

        label_path = label_dir / f"{case_id}.nii.gz"
        nnunet_path = nnunet_input_dir / f"{case_id}_0000.nii.gz"
        link_or_copy(official_label, label_path)
        link_or_copy(downloaded, nnunet_path)

        details = inspect_pair(downloaded, official_label)
        records.append(
            {
                "case_id": case_id,
                "selection_order": index,
                "selection_rule": "fixed contiguous non-overlapping, within-KiTS feasibility cohort case_00400..case_00419",
                "image_sha256": sha256_file(downloaded),
                "label_sha256": sha256_file(official_label),
                "image_bytes": downloaded.stat().st_size,
                "label_bytes": official_label.stat().st_size,
                "image_path": str(downloaded),
                "label_path": str(label_path.resolve()),
                "nnunet_input_path": str(nnunet_path.resolve()),
                **details,
            }
        )

    if tuple(record["case_id"] for record in records) != CASE_IDS:
        raise RuntimeError("The frozen cohort changed unexpectedly")

    manifest_path = manifests_dir / "manifest.csv"
    with manifest_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)

    manifest_sha256 = sha256_file(manifest_path)
    metadata = {
        "title": (
            "CalyxView Renal — 20-case KiTS23 non-overlapping, "
            "within-KiTS feasibility cohort"
        ),
        "run_mode": "research_feasibility_only",
        "case_ids": list(CASE_IDS),
        "case_count": len(CASE_IDS),
        "selection_rule": "case_00400 through case_00419 inclusive, frozen before inference",
        "independence_basis": "Task135_KiTS2021 documentation identifies case_00000..case_00299 as its training cohort",
        "kits23_repository": KITS23_REPOSITORY,
        "kits23_revision": KITS23_REVISION,
        "imaging_repository": f"https://huggingface.co/datasets/{IMAGING_REPO}",
        "imaging_revision": IMAGING_REVISION,
        "data_license": DATA_LICENSE,
        "local_manifest_sha256": manifest_sha256,
        "local_manifest_path_dependent": True,
        "total_image_bytes": sum(int(record["image_bytes"]) for record in records),
        "total_label_bytes": sum(int(record["label_bytes"]) for record in records),
        "disclaimer": (
            "Research prototype only. Not a medical device. Not for diagnosis, "
            "treatment selection, surgical planning, margin selection, or patient care. "
            "Outputs may be incomplete or wrong."
        ),
    }
    metadata_path = manifests_dir / "manifest.metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2), flush=True)


if __name__ == "__main__":
    main()
