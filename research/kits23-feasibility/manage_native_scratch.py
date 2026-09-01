#!/usr/bin/env python3
"""Safely manage one case inside an explicit native-Linux scratch root."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from pathlib import Path


CASE_PATTERN = re.compile(r"^case_[0-9]{5}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage native WSL nnU-Net scratch.")
    parser.add_argument("action", choices=("prepare", "reset-output", "finalize", "cleanup"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--destination", type=Path)
    return parser.parse_args()


def validated_paths(root_value: Path, case_id: str) -> tuple[Path, Path, Path]:
    if not CASE_PATTERN.fullmatch(case_id):
        raise ValueError(f"Invalid public case identifier: {case_id!r}")
    if not root_value.is_absolute():
        raise ValueError("Scratch root must be an explicit absolute Linux path")
    root = root_value.resolve(strict=False)
    forbidden = {Path("/"), Path("/tmp"), Path("/var/tmp")}
    if root in forbidden or len(root.parts) < 3:
        raise ValueError(f"Scratch root is too broad: {root}")
    input_dir = root / "case-inputs" / case_id
    output_dir = root / "case-outputs" / case_id
    for candidate in (input_dir, output_dir):
        if not candidate.is_relative_to(root) or candidate == root:
            raise ValueError(f"Managed path escaped scratch root: {candidate}")
    return root, input_dir, output_dir


def reset_directory(path: Path, root: Path) -> None:
    if not path.is_relative_to(root) or path == root:
        raise ValueError(f"Refusing to reset unmanaged path: {path}")
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=False)


def main() -> None:
    args = parse_args()
    root, input_dir, output_dir = validated_paths(args.root, args.case_id)
    root.mkdir(parents=True, exist_ok=True)
    for shared in ("raw-data-base", "preprocessed", "matplotlib"):
        (root / shared).mkdir(parents=True, exist_ok=True)

    if args.action == "prepare":
        if args.source is None or not args.source.is_file():
            raise FileNotFoundError(f"Source NIfTI is missing: {args.source}")
        reset_directory(input_dir, root)
        reset_directory(output_dir, root)
        staged = input_dir / f"{args.case_id}_0000.nii.gz"
        shutil.copy2(args.source, staged)
        if staged.stat().st_size != args.source.stat().st_size:
            raise IOError("Staged source byte count does not match the frozen input")
        result = {"status": "prepared", "input": str(staged), "bytes": staged.stat().st_size}
    elif args.action == "reset-output":
        reset_directory(output_dir, root)
        result = {"status": "output-reset", "output_directory": str(output_dir)}
    elif args.action == "finalize":
        if args.destination is None:
            raise ValueError("--destination is required for finalize")
        source_prediction = output_dir / f"{args.case_id}.nii.gz"
        if not source_prediction.is_file() or source_prediction.stat().st_size <= 0:
            raise FileNotFoundError(f"Validated prediction is missing: {source_prediction}")
        destination = args.destination.resolve(strict=False)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".tmp")
        shutil.copy2(source_prediction, temporary)
        if temporary.stat().st_size != source_prediction.stat().st_size:
            raise IOError("Final prediction copy has an unexpected byte count")
        os.replace(temporary, destination)
        result = {"status": "finalized", "destination": str(destination), "bytes": destination.stat().st_size}
    else:
        for path in (input_dir, output_dir):
            if path.exists():
                shutil.rmtree(path)
        result = {"status": "cleaned", "case_id": args.case_id}

    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
