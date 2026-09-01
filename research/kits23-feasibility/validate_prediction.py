#!/usr/bin/env python3
"""Validate one nnU-Net prediction before it enters the benchmark results.

This gate reads only NIfTI geometry and voxel arrays. It does not emit CT pixels,
patient metadata, or a copy of either volume.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate one Task135 prediction.")
    parser.add_argument("--input", type=Path, required=True, help="Source CT NIfTI.")
    parser.add_argument(
        "--prediction", type=Path, required=True, help="Predicted segmentation NIfTI."
    )
    return parser.parse_args()


def require_3d_image(path: Path, label: str) -> nib.Nifti1Image:
    if not path.is_file() or path.stat().st_size <= 0:
        raise ValueError(f"{label} is missing or empty: {path}")
    image = nib.load(str(path))
    if len(image.shape) != 3:
        raise ValueError(f"{label} must be 3D; got shape {image.shape}")
    affine = np.asarray(image.affine, dtype=np.float64)
    if affine.shape != (4, 4) or not np.isfinite(affine).all():
        raise ValueError(f"{label} affine is missing or invalid")
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    if not np.isfinite(spacing).all() or np.any(spacing <= 0):
        raise ValueError(f"{label} voxel spacing is invalid: {spacing.tolist()}")
    return image


def main() -> None:
    args = parse_args()
    source = require_3d_image(args.input, "Input CT")
    prediction = require_3d_image(args.prediction, "Prediction")

    if source.shape != prediction.shape:
        raise ValueError(
            f"Prediction shape {prediction.shape} does not match input {source.shape}"
        )
    if not np.allclose(source.affine, prediction.affine, rtol=1e-5, atol=1e-4):
        delta = float(np.max(np.abs(source.affine - prediction.affine)))
        raise ValueError(f"Prediction affine does not match input; max delta={delta:.6g}")

    raw = np.asanyarray(prediction.dataobj)
    if not np.issubdtype(raw.dtype, np.number):
        raise ValueError(f"Prediction is not numeric: {raw.dtype}")
    if not np.isfinite(raw).all():
        raise ValueError("Prediction contains NaN or infinite values")
    rounded = np.rint(raw)
    if not np.array_equal(raw, rounded):
        raise ValueError("Prediction contains non-integer label values")
    labels = np.unique(rounded).astype(np.int64)
    invalid = labels[(labels < 0) | (labels > 3)]
    if invalid.size:
        raise ValueError(f"Prediction labels outside Task135 range 0..3: {invalid.tolist()}")

    print(
        json.dumps(
            {
                "status": "ok",
                "shape": list(prediction.shape),
                "labels": labels.tolist(),
                "affine_max_delta": float(
                    np.max(np.abs(source.affine - prediction.affine))
                ),
                "research_only": True,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
