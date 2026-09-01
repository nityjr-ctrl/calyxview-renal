#!/usr/bin/env python3
"""Evaluate a frozen KiTS23 cohort and build a local research-only report.

The evaluator intentionally reads segmentation masks only.  It never reads DICOM
headers or embeds source CT voxels, reference NIfTI files, or prediction NIfTI
files in the report.  The generated QC images are mask-only comparisons labelled
with the public KiTS case identifier.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import importlib.metadata
import json
import math
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import nibabel as nib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from surface_distance import (
    compute_robust_hausdorff,
    compute_surface_dice_at_tolerance,
    compute_surface_distances,
)


DISCLAIMER = (
    "RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE. NOT FOR DIAGNOSIS, "
    "TREATMENT SELECTION, SURGICAL PLANNING, MARGIN SELECTION, OR PATIENT CARE. "
    "MODEL OUTPUTS MAY BE INCOMPLETE OR WRONG."
)
DISCLAIMER_LINE_1 = "RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE."
DISCLAIMER_LINE_2 = (
    "NOT FOR DIAGNOSIS, TREATMENT SELECTION, SURGICAL PLANNING, MARGIN "
    "SELECTION, OR PATIENT CARE. OUTPUTS MAY BE WRONG."
)
BOOTSTRAP_SEED = 20260901
BOOTSTRAP_SAMPLES = 10_000
CASE_ID_PATTERN = re.compile(r"^case_[0-9]{5}$")
FAILURE_HD95_PENALTY_MM = 1_000.0

# KiTS23 hierarchical evaluation classes (HECs) and official tolerances.
REGIONS: dict[str, dict[str, Any]] = {
    "kidney_and_mass": {
        "display_name": "Kidney + mass",
        "labels": (1, 2, 3),
        "tolerance_mm": 1.0330772532390826,
    },
    "mass": {
        "display_name": "Mass (tumour + cyst)",
        "labels": (2, 3),
        "tolerance_mm": 1.1328796488598762,
    },
    "tumour": {
        "display_name": "Tumour",
        "labels": (2,),
        "tolerance_mm": 1.1498198361434828,
    },
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
for _region_name in REGIONS:
    CSV_FIELDS.extend(
        [
            f"{_region_name}_dice",
            f"{_region_name}_surface_dice",
            f"{_region_name}_surface_tolerance_mm",
            f"{_region_name}_hd95_mm",
            f"{_region_name}_reference_volume_ml",
            f"{_region_name}_prediction_volume_ml",
            f"{_region_name}_volume_error_ml",
            f"{_region_name}_absolute_volume_error_ml",
            f"{_region_name}_relative_volume_error_pct",
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate KiTS23 segmentations and generate a local report."
    )
    parser.add_argument(
        "--run-root",
        type=Path,
        required=True,
        help="Run directory containing manifests/, labels/, and predictions/.",
    )
    return parser.parse_args()


def package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_manifest(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise FileNotFoundError(f"Manifest not found: {path}")
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or "case_id" not in reader.fieldnames:
            raise ValueError("Manifest must contain a case_id column")
        records = list(reader)
    if not records:
        raise ValueError("Manifest contains no cases")

    case_ids = [str(record.get("case_id", "")).strip() for record in records]
    invalid = [case_id for case_id in case_ids if not CASE_ID_PATTERN.fullmatch(case_id)]
    if invalid:
        raise ValueError(f"Invalid public case identifiers in manifest: {invalid}")
    duplicates = sorted({case_id for case_id in case_ids if case_ids.count(case_id) > 1})
    if duplicates:
        raise ValueError(f"Duplicate case identifiers in manifest: {duplicates}")
    for record, case_id in zip(records, case_ids):
        record["case_id"] = case_id
    return records


def _runtime_value(record: Mapping[str, Any]) -> float | None:
    keys = (
        "runtime_seconds",
        "elapsed_seconds",
        "duration_seconds",
        "runtime_s",
        "elapsed_s",
        "seconds",
    )
    for key in keys:
        value = record.get(key)
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            return max(0.0, float(value))
        if isinstance(value, str):
            try:
                parsed = float(value)
            except ValueError:
                continue
            if math.isfinite(parsed):
                return max(0.0, parsed)
    return None


def _case_id_value(record: Mapping[str, Any], hint: str | None) -> str | None:
    for key in ("case_id", "case", "caseID", "id"):
        value = record.get(key)
        if isinstance(value, str) and CASE_ID_PATTERN.fullmatch(value.strip()):
            return value.strip()
    if hint and CASE_ID_PATTERN.fullmatch(hint):
        return hint
    return None


def discover_timings(
    run_root: Path, allowed_case_ids: set[str]
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Read only canonical per-case runner records from run_root/timings/."""

    timings: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    timings_root = run_root / "timings"
    if not timings_root.is_dir():
        return timings, ["Canonical timings/ directory is missing"]

    for path in sorted(timings_root.glob("case_*.json")):
        case_hint = path.stem
        if case_hint not in allowed_case_ids:
            warnings.append(f"Ignored timing outside frozen cohort: {path.name}")
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            warnings.append(f"Ignored unreadable timing record {path.name}: {exc}")
            continue
        if not isinstance(payload, Mapping):
            warnings.append(f"Ignored non-object timing record: {path.name}")
            continue
        case_id = _case_id_value(payload, case_hint)
        if case_id != case_hint:
            warnings.append(f"Timing case mismatch in {path.name}: {case_id!r}")
            continue
        runtime = _runtime_value(payload)
        status_value = payload.get("status", payload.get("inference_status"))
        status = str(status_value).strip() if status_value is not None else ""
        if runtime is None:
            warnings.append(f"Timing record has no finite runtime: {path.name}")
            continue
        if not status:
            warnings.append(f"Timing record has no status: {path.name}")
            continue
        timings[case_id] = {
            "runtime_seconds": runtime,
            "status": status,
            "source": str(path.relative_to(run_root)).replace("\\", "/"),
        }
    return timings, warnings


def load_segmentation(path: Path) -> tuple[nib.Nifti1Image, np.ndarray, np.ndarray, float]:
    if not path.is_file():
        raise FileNotFoundError(path)
    image = nib.load(str(path))
    if len(image.shape) != 3:
        raise ValueError(f"Expected a 3D segmentation; got shape {image.shape}")
    raw = np.asanyarray(image.dataobj)
    if not np.issubdtype(raw.dtype, np.number):
        raise ValueError(f"Segmentation is not numeric: {raw.dtype}")
    if not np.isfinite(raw).all():
        raise ValueError("Segmentation contains NaN or infinite values")
    rounded = np.rint(raw)
    if not np.array_equal(raw, rounded):
        raise ValueError("Segmentation contains non-integer label values")
    values = np.unique(rounded).astype(np.int64)
    unexpected = values[(values < 0) | (values > 3)]
    if unexpected.size:
        raise ValueError(f"Labels outside KiTS23 range 0..3: {unexpected.tolist()}")

    affine = np.asarray(image.affine, dtype=np.float64)
    if affine.shape != (4, 4) or not np.isfinite(affine).all():
        raise ValueError("NIfTI affine is missing or invalid")
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    if not np.isfinite(spacing).all() or np.any(spacing <= 0):
        raise ValueError(f"Invalid voxel spacing: {spacing.tolist()}")
    direction = affine[:3, :3] / spacing
    if not np.allclose(direction.T @ direction, np.eye(3), atol=1e-3):
        raise ValueError("Sheared voxel geometry is unsupported for physical-distance metrics")

    voxel_volume_ml = float(abs(np.linalg.det(affine[:3, :3])) / 1000.0)
    if not math.isfinite(voxel_volume_ml) or voxel_volume_ml <= 0:
        raise ValueError("Invalid physical voxel volume")
    return image, rounded.astype(np.uint8, copy=False), spacing, voxel_volume_ml


def validate_geometry(reference: nib.Nifti1Image, prediction: nib.Nifti1Image) -> None:
    if reference.shape != prediction.shape:
        raise ValueError(
            f"Geometry mismatch: reference shape {reference.shape}, "
            f"prediction shape {prediction.shape}"
        )
    if not np.allclose(reference.affine, prediction.affine, rtol=1e-5, atol=1e-4):
        maximum_delta = float(np.max(np.abs(reference.affine - prediction.affine)))
        raise ValueError(f"Geometry mismatch: affine delta {maximum_delta:.6g}")


def dice_score(reference: np.ndarray, prediction: np.ndarray) -> float:
    reference_count = int(np.count_nonzero(reference))
    prediction_count = int(np.count_nonzero(prediction))
    if reference_count == 0 and prediction_count == 0:
        return 1.0
    if reference_count == 0 or prediction_count == 0:
        return 0.0
    intersection = int(np.count_nonzero(reference & prediction))
    return float(2.0 * intersection / (reference_count + prediction_count))


def _crop_to_union(
    reference: np.ndarray, prediction: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    union = reference | prediction
    positions = np.nonzero(union)
    if not positions[0].size:
        return reference, prediction
    lower = [max(0, int(axis.min()) - 1) for axis in positions]
    upper = [min(reference.shape[index], int(axis.max()) + 2) for index, axis in enumerate(positions)]
    crop = tuple(slice(start, stop) for start, stop in zip(lower, upper))
    return reference[crop], prediction[crop]


def surface_metrics(
    reference: np.ndarray,
    prediction: np.ndarray,
    spacing_mm: np.ndarray,
    tolerance_mm: float,
    failure_diagonal_mm: float,
) -> tuple[float, float]:
    """Compute official-style KiTS23 Surface Dice and symmetric HD95."""

    reference_count = int(np.count_nonzero(reference))
    prediction_count = int(np.count_nonzero(prediction))
    if reference_count == 0 and prediction_count == 0:
        return 1.0, 0.0
    if reference_count == 0 or prediction_count == 0:
        return 0.0, float(failure_diagonal_mm)

    reference, prediction = _crop_to_union(reference, prediction)
    distances = compute_surface_distances(
        reference.astype(bool, copy=False),
        prediction.astype(bool, copy=False),
        spacing_mm=tuple(float(value) for value in spacing_mm),
    )
    surface_dice = compute_surface_dice_at_tolerance(
        distances, tolerance_mm=float(tolerance_mm)
    )
    hd95_mm = compute_robust_hausdorff(distances, percent=95.0)
    return float(surface_dice), float(hd95_mm)


def physical_diagonal_mm(shape: Sequence[int], spacing_mm: np.ndarray) -> float:
    extent = np.maximum(np.asarray(shape, dtype=np.float64) - 1.0, 0.0) * spacing_mm
    value = float(np.linalg.norm(extent))
    return value if math.isfinite(value) and value > 0 else FAILURE_HD95_PENALTY_MM


def _labels_as_text(data: np.ndarray) -> str:
    return ";".join(str(int(value)) for value in np.unique(data))


def _base_row(case_id: str, timing: Mapping[str, Any] | None) -> dict[str, Any]:
    timing = timing or {}
    return {
        "case_id": case_id,
        "status": "failed",
        "failure_reason": "",
        "inference_status": str(timing.get("status", "not_recorded")),
        "runtime_seconds": timing.get("runtime_seconds"),
        "shape": "",
        "spacing_mm": "",
        "reference_label_values": "",
        "prediction_label_values": "",
        "mean_dice": 0.0,
        "mean_surface_dice": 0.0,
        "mean_hd95_mm": FAILURE_HD95_PENALTY_MM,
    }


def _failure_region_values(
    row: dict[str, Any],
    reference_data: np.ndarray | None,
    voxel_volume_ml: float | None,
    diagonal_mm: float,
) -> None:
    for region_name, region in REGIONS.items():
        if reference_data is not None and voxel_volume_ml is not None:
            reference_mask = np.isin(reference_data, region["labels"])
            reference_volume = float(np.count_nonzero(reference_mask) * voxel_volume_ml)
        else:
            reference_volume = None
        prediction_volume = 0.0 if reference_volume is not None else None
        volume_error = -reference_volume if reference_volume is not None else None
        absolute_error = reference_volume
        relative_error = (
            -100.0 if reference_volume is not None and reference_volume > 0 else None
        )
        row.update(
            {
                f"{region_name}_dice": 0.0,
                f"{region_name}_surface_dice": 0.0,
                f"{region_name}_surface_tolerance_mm": region["tolerance_mm"],
                f"{region_name}_hd95_mm": diagonal_mm,
                f"{region_name}_reference_volume_ml": reference_volume,
                f"{region_name}_prediction_volume_ml": prediction_volume,
                f"{region_name}_volume_error_ml": volume_error,
                f"{region_name}_absolute_volume_error_ml": absolute_error,
                f"{region_name}_relative_volume_error_pct": relative_error,
            }
        )


def evaluate_case(
    case_id: str,
    reference_path: Path,
    prediction_path: Path,
    timing: Mapping[str, Any] | None,
) -> tuple[dict[str, Any], np.ndarray | None, np.ndarray | None]:
    row = _base_row(case_id, timing)
    reference_data: np.ndarray | None = None
    spacing: np.ndarray | None = None
    voxel_volume_ml: float | None = None
    diagonal_mm = FAILURE_HD95_PENALTY_MM
    try:
        reference_image, reference_data, spacing, voxel_volume_ml = load_segmentation(
            reference_path
        )
        row["shape"] = "x".join(str(value) for value in reference_image.shape)
        row["spacing_mm"] = "x".join(f"{value:.6g}" for value in spacing)
        row["reference_label_values"] = _labels_as_text(reference_data)
        diagonal_mm = physical_diagonal_mm(reference_image.shape, spacing)
    except Exception as exc:  # a malformed reference must not erase the case from results
        row["failure_reason"] = f"Reference validation failed: {exc}"
        _failure_region_values(row, None, None, diagonal_mm)
        row["mean_hd95_mm"] = diagonal_mm
        return row, None, None

    try:
        prediction_image, prediction_data, prediction_spacing, _ = load_segmentation(
            prediction_path
        )
        validate_geometry(reference_image, prediction_image)
        if not np.allclose(spacing, prediction_spacing, rtol=1e-5, atol=1e-5):
            raise ValueError(
                f"Geometry mismatch: spacing {spacing.tolist()} vs "
                f"{prediction_spacing.tolist()}"
            )
        row["prediction_label_values"] = _labels_as_text(prediction_data)
    except Exception as exc:
        row["failure_reason"] = f"Prediction validation failed: {exc}"
        _failure_region_values(row, reference_data, voxel_volume_ml, diagonal_mm)
        row["mean_hd95_mm"] = diagonal_mm
        empty_prediction = np.zeros(reference_data.shape, dtype=np.uint8)
        return row, reference_data, empty_prediction

    dice_values: list[float] = []
    surface_dice_values: list[float] = []
    hd95_values: list[float] = []
    for region_name, region in REGIONS.items():
        reference_mask = np.isin(reference_data, region["labels"])
        prediction_mask = np.isin(prediction_data, region["labels"])
        dice = dice_score(reference_mask, prediction_mask)
        surface_dice, hd95_mm = surface_metrics(
            reference_mask,
            prediction_mask,
            spacing,
            float(region["tolerance_mm"]),
            diagonal_mm,
        )
        reference_volume = float(np.count_nonzero(reference_mask) * voxel_volume_ml)
        prediction_volume = float(np.count_nonzero(prediction_mask) * voxel_volume_ml)
        volume_error = prediction_volume - reference_volume
        relative_error = (
            float(100.0 * volume_error / reference_volume)
            if reference_volume > 0
            else None
        )
        row.update(
            {
                f"{region_name}_dice": dice,
                f"{region_name}_surface_dice": surface_dice,
                f"{region_name}_surface_tolerance_mm": region["tolerance_mm"],
                f"{region_name}_hd95_mm": hd95_mm,
                f"{region_name}_reference_volume_ml": reference_volume,
                f"{region_name}_prediction_volume_ml": prediction_volume,
                f"{region_name}_volume_error_ml": volume_error,
                f"{region_name}_absolute_volume_error_ml": abs(volume_error),
                f"{region_name}_relative_volume_error_pct": relative_error,
            }
        )
        dice_values.append(dice)
        surface_dice_values.append(surface_dice)
        hd95_values.append(hd95_mm)

    row["mean_dice"] = float(np.mean(dice_values))
    row["mean_surface_dice"] = float(np.mean(surface_dice_values))
    row["mean_hd95_mm"] = float(np.mean(hd95_values))
    row["status"] = "ok"
    return row, reference_data, prediction_data


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = (
        ("arialbd.ttf", "DejaVuSans-Bold.ttf")
        if bold
        else ("arial.ttf", "DejaVuSans.ttf")
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _select_qc_slice(reference: np.ndarray, prediction: np.ndarray) -> int:
    for labels in ((2,), (2, 3), (1, 2, 3)):
        mask = np.isin(reference, labels) | np.isin(prediction, labels)
        counts = np.count_nonzero(mask, axis=(0, 1))
        if counts.max(initial=0) > 0:
            return int(np.argmax(counts))
    return reference.shape[2] // 2


def _crop_2d(reference_slice: np.ndarray, prediction_slice: np.ndarray) -> tuple[slice, slice]:
    union = (reference_slice > 0) | (prediction_slice > 0)
    locations = np.nonzero(union)
    if not locations[0].size:
        return slice(0, union.shape[0]), slice(0, union.shape[1])
    pad = 16
    row_start = max(0, int(locations[0].min()) - pad)
    row_end = min(union.shape[0], int(locations[0].max()) + pad + 1)
    column_start = max(0, int(locations[1].min()) - pad)
    column_end = min(union.shape[1], int(locations[1].max()) + pad + 1)
    return slice(row_start, row_end), slice(column_start, column_end)


def _label_rgb(label_slice: np.ndarray) -> np.ndarray:
    palette = np.asarray(
        [
            (15, 22, 30),
            (56, 189, 166),
            (255, 91, 92),
            (244, 191, 84),
        ],
        dtype=np.uint8,
    )
    return palette[label_slice]


def _agreement_rgb(reference_slice: np.ndarray, prediction_slice: np.ndarray) -> np.ndarray:
    rgb = np.full(reference_slice.shape + (3,), (15, 22, 30), dtype=np.uint8)
    same = (reference_slice == prediction_slice) & (reference_slice > 0)
    reference_only = (reference_slice > 0) & ~same
    prediction_only = (prediction_slice > 0) & ~same
    rgb[same] = (92, 214, 144)
    rgb[reference_only] = (255, 161, 69)
    rgb[prediction_only] = (207, 111, 255)
    return rgb


def _fit_panel(rgb: np.ndarray, width: int, height: int) -> Image.Image:
    # Rotate a NIfTI x/y slice into the familiar image row/column presentation.
    image = Image.fromarray(np.rot90(rgb), mode="RGB")
    scale = min(width / max(image.width, 1), height / max(image.height, 1))
    fitted_size = (
        max(1, int(round(image.width * scale))),
        max(1, int(round(image.height * scale))),
    )
    image = image.resize(fitted_size, Image.Resampling.NEAREST)
    panel = Image.new("RGB", (width, height), (9, 14, 20))
    panel.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    return panel


def write_qc_image(
    output_path: Path,
    case_id: str,
    reference: np.ndarray | None,
    prediction: np.ndarray | None,
    status: str,
    failure_reason: str,
) -> None:
    width, height = 1200, 500
    canvas = Image.new("RGB", (width, height), (9, 14, 20))
    draw = ImageDraw.Draw(canvas)
    title_font = _font(25, bold=True)
    body_font = _font(17)
    small_font = _font(14)
    draw.rectangle((0, 0, width, 62), fill=(103, 25, 31))
    draw.text((22, 7), DISCLAIMER_LINE_1, font=_font(13, bold=True), fill=(255, 244, 244))
    draw.text((22, 32), DISCLAIMER_LINE_2, font=_font(11), fill=(255, 244, 244))
    draw.text((22, 78), f"{case_id} · segmentation-mask QC", font=title_font, fill=(245, 249, 252))

    if reference is None or prediction is None:
        draw.rounded_rectangle((22, 132, width - 22, 410), radius=16, fill=(25, 34, 45))
        draw.text((48, 166), "QC image unavailable", font=title_font, fill=(255, 174, 75))
        wrapped = failure_reason[:340] or "Segmentation validation failed."
        draw.multiline_text((48, 220), wrapped, font=body_font, fill=(224, 231, 238), spacing=8)
    else:
        z_index = _select_qc_slice(reference, prediction)
        ref_slice = reference[:, :, z_index]
        pred_slice = prediction[:, :, z_index]
        crop = _crop_2d(ref_slice, pred_slice)
        ref_slice = ref_slice[crop]
        pred_slice = pred_slice[crop]
        panels = (
            ("Reference", _label_rgb(ref_slice)),
            ("Prediction", _label_rgb(pred_slice)),
            ("Agreement / error", _agreement_rgb(ref_slice, pred_slice)),
        )
        panel_width, panel_height = 360, 300
        for index, (title, rgb) in enumerate(panels):
            x = 22 + index * 392
            draw.text((x, 118), title, font=body_font, fill=(229, 236, 242))
            canvas.paste(_fit_panel(rgb, panel_width, panel_height), (x, 148))
        draw.text((1000, 91), f"axial index {z_index}", font=small_font, fill=(167, 181, 194))

    legend = (
        "Labels: kidney  ■ teal    tumour  ■ red    cyst  ■ amber    "
        "agreement  ■ green    reference-only/mismatch  ■ orange    prediction-only/mismatch  ■ violet"
    )
    draw.text((22, 468), legend, font=small_font, fill=(183, 196, 207))
    if status != "ok":
        draw.text((980, 468), "CASE FAILED", font=_font(14, bold=True), fill=(255, 118, 118))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", optimize=True)


def _csv_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, float):
        if not math.isfinite(value):
            return ""
        return f"{value:.10g}"
    return value


def write_case_results(path: Path, rows: Sequence[Mapping[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: _csv_value(row.get(field)) for field in CSV_FIELDS})


def bootstrap_mean_summary(
    values: Iterable[float], rng: np.random.Generator
) -> dict[str, Any]:
    array = np.asarray(list(values), dtype=np.float64)
    if not array.size:
        return {
            "n": 0,
            "mean": None,
            "median": None,
            "standard_deviation": None,
            "minimum": None,
            "maximum": None,
            "bootstrap_95_ci_of_mean": [None, None],
        }
    indices = rng.integers(0, array.size, size=(BOOTSTRAP_SAMPLES, array.size))
    bootstrap_means = array[indices].mean(axis=1)
    return {
        "n": int(array.size),
        "mean": float(array.mean()),
        "median": float(np.median(array)),
        "standard_deviation": float(array.std(ddof=1)) if array.size > 1 else 0.0,
        "minimum": float(array.min()),
        "maximum": float(array.max()),
        "bootstrap_95_ci_of_mean": [
            float(np.quantile(bootstrap_means, 0.025)),
            float(np.quantile(bootstrap_means, 0.975)),
        ],
    }


def build_summary(
    run_root: Path,
    manifest_path: Path,
    rows: Sequence[Mapping[str, Any]],
    timing_warnings: Sequence[str],
) -> dict[str, Any]:
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    portable_manifest_path = run_root / "manifests" / "manifest.portable.json"
    if not portable_manifest_path.is_file():
        raise FileNotFoundError(
            "Canonical path-free manifest is required: manifests/manifest.portable.json"
        )
    successful = [row for row in rows if row["status"] == "ok"]
    failures = [row for row in rows if row["status"] != "ok"]
    summary: dict[str, Any] = {
        "title": "CalyxView Renal — 20-case KiTS23 feasibility evaluation",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
        "research_only": True,
        "manifest": {
            "path": str(portable_manifest_path.relative_to(run_root)).replace("\\", "/"),
            "sha256": sha256_file(portable_manifest_path),
            "path_free": True,
            "local_csv_sha256": sha256_file(manifest_path),
            "case_count": len(rows),
        },
        "completion": {
            "manifest_cases": len(rows),
            "evaluated_successfully": len(successful),
            "failed": len(failures),
            "success_rate": len(successful) / len(rows),
            "failed_cases_in_metric_denominator": True,
            "failure_rule": (
                "Evaluation failures receive Dice=0 and Surface Dice=0. HD95 receives "
                "the reference image physical diagonal, or 1000 mm if reference geometry "
                "cannot be validated. Missing/invalid predictions are treated as empty for "
                "volume error."
            ),
            "failures": [
                {"case_id": row["case_id"], "reason": row["failure_reason"]}
                for row in failures
            ],
        },
        "metric_specification": {
            "label_values": {"0": "background", "1": "kidney", "2": "tumour", "3": "cyst"},
            "regions": REGIONS,
            "dice": "2|A∩B|/(|A|+|B|), with both-empty=1 and one-empty=0",
            "surface_dice": (
                "Symmetric physical-mm boundary agreement computed by the same "
                "surface-distance library and exact HEC tolerances used by the "
                "official KiTS23 evaluator."
            ),
            "hd95": (
                "Symmetric robust 95th-percentile Hausdorff distance in millimetres, "
                "computed from the same physical surface distances."
            ),
            "volume": "Physical volume from |det(affine[:3,:3])|, reported in mL.",
        },
        "bootstrap": {
            "method": "non-parametric case bootstrap of the arithmetic mean",
            "samples": BOOTSTRAP_SAMPLES,
            "seed": BOOTSTRAP_SEED,
            "confidence_interval": "percentile 2.5% to 97.5%",
        },
        "regions": {},
        "overall": {},
        "runtime_seconds": None,
        "timing_warnings": list(timing_warnings),
        "software": {
            "python": platform.python_version(),
            "numpy": package_version("numpy"),
            "nibabel": package_version("nibabel"),
            "scipy": package_version("scipy"),
            "surface-distance": package_version("surface-distance"),
            "pillow": package_version("Pillow"),
            "platform": platform.platform(),
        },
        "privacy": {
            "patient_metadata_in_report": False,
            "source_ct_in_report": False,
            "source_nifti_or_predictions_in_report": False,
            "qc_content": "public case identifier and derived segmentation masks only",
        },
    }
    for region_name in REGIONS:
        summary["regions"][region_name] = {
            "dice": bootstrap_mean_summary(
                (float(row[f"{region_name}_dice"]) for row in rows), rng
            ),
            "surface_dice": bootstrap_mean_summary(
                (float(row[f"{region_name}_surface_dice"]) for row in rows), rng
            ),
            "hd95_mm": bootstrap_mean_summary(
                (float(row[f"{region_name}_hd95_mm"]) for row in rows), rng
            ),
            "absolute_volume_error_ml": bootstrap_mean_summary(
                (
                    float(row[f"{region_name}_absolute_volume_error_ml"])
                    for row in rows
                    if row.get(f"{region_name}_absolute_volume_error_ml") is not None
                ),
                rng,
            ),
        }
    summary["overall"] = {
        "mean_dice_across_regions_per_case": bootstrap_mean_summary(
            (float(row["mean_dice"]) for row in rows), rng
        ),
        "mean_surface_dice_across_regions_per_case": bootstrap_mean_summary(
            (float(row["mean_surface_dice"]) for row in rows), rng
        ),
        "mean_hd95_mm_across_regions_per_case": bootstrap_mean_summary(
            (float(row["mean_hd95_mm"]) for row in rows), rng
        ),
    }
    runtime_values = [
        float(row["runtime_seconds"])
        for row in rows
        if row.get("runtime_seconds") is not None
        and math.isfinite(float(row["runtime_seconds"]))
    ]
    if runtime_values:
        summary["runtime_seconds"] = {
            **bootstrap_mean_summary(runtime_values, rng),
            "total": float(sum(runtime_values)),
            "cases_with_timing": len(runtime_values),
            "cases_without_timing": len(rows) - len(runtime_values),
        }
    provenance_path = run_root / "provenance.json"
    if provenance_path.is_file():
        try:
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            summary["execution_provenance"] = {
                "captured_at_utc": provenance.get("captured_at_utc"),
                "cohort": provenance.get("cohort"),
                "model": provenance.get("model"),
                "framework": provenance.get("framework"),
                "hardware": provenance.get("hardware"),
                "inference_contract": provenance.get("inference_contract"),
                "privacy": provenance.get("privacy"),
            }
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            summary["timing_warnings"].append(
                f"Could not include provenance.json: {exc}"
            )
    return summary


def _json_safe(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    return value


def _format_number(value: Any, digits: int = 3) -> str:
    if value is None:
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return html.escape(str(value))
    if not math.isfinite(number):
        return "—"
    return f"{number:.{digits}f}"


def _metric_with_ci(metric: Mapping[str, Any], digits: int = 3) -> str:
    interval = metric["bootstrap_95_ci_of_mean"]
    return (
        f"{_format_number(metric['mean'], digits)} "
        f"({_format_number(interval[0], digits)}–{_format_number(interval[1], digits)})"
    )


def write_report_html(
    path: Path, rows: Sequence[Mapping[str, Any]], summary: Mapping[str, Any]
) -> None:
    region_cards = []
    for region_name, definition in REGIONS.items():
        region_summary = summary["regions"][region_name]
        region_cards.append(
            "<article class='card'>"
            f"<h3>{html.escape(definition['display_name'])}</h3>"
            f"<p><b>Dice</b> {_metric_with_ci(region_summary['dice'])}</p>"
            f"<p><b>Surface Dice</b> {_metric_with_ci(region_summary['surface_dice'])}</p>"
            f"<p><b>HD95</b> {_metric_with_ci(region_summary['hd95_mm'])} mm</p>"
            f"<p><b>Volume MAE</b> {_metric_with_ci(region_summary['absolute_volume_error_ml'])} mL</p>"
            "</article>"
        )

    table_rows = []
    for row in rows:
        status_class = "ok" if row["status"] == "ok" else "failed"
        table_rows.append(
            "<tr>"
            f"<td><a href='qc/{row['case_id']}.png'>{html.escape(str(row['case_id']))}</a></td>"
            f"<td><span class='status {status_class}'>{html.escape(str(row['status']))}</span></td>"
            f"<td>{_format_number(row.get('runtime_seconds'), 1)}</td>"
            f"<td>{_format_number(row['kidney_and_mass_dice'])}</td>"
            f"<td>{_format_number(row['mass_dice'])}</td>"
            f"<td>{_format_number(row['tumour_dice'])}</td>"
            f"<td>{_format_number(row['kidney_and_mass_surface_dice'])}</td>"
            f"<td>{_format_number(row['mass_surface_dice'])}</td>"
            f"<td>{_format_number(row['tumour_surface_dice'])}</td>"
            f"<td>{_format_number(row['tumour_hd95_mm'], 2)}</td>"
            f"<td title='{html.escape(str(row.get('failure_reason', '')))}'>"
            f"{html.escape(str(row.get('failure_reason', '')))}</td>"
            "</tr>"
        )

    completed = summary["completion"]
    generated = html.escape(str(summary["generated_at_utc"]))
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CalyxView Renal · KiTS23 feasibility report</title>
  <style>
    :root {{ color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #091018; color: #edf4f7; line-height: 1.5; }}
    .warning {{ background: #681d26; color: #fff5f5; padding: 16px 5vw; font-weight: 800; letter-spacing: .02em; }}
    main {{ width: min(1440px, 92vw); margin: 36px auto 64px; }}
    h1 {{ font-size: clamp(2rem, 4vw, 3.8rem); margin: 0 0 8px; }}
    h2 {{ margin-top: 44px; }}
    .muted {{ color: #aebec9; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }}
    .card {{ background: #111d28; border: 1px solid #263848; border-radius: 14px; padding: 20px; }}
    .card h3 {{ margin-top: 0; color: #6edbc5; }}
    .card p {{ margin: 8px 0; }}
    .table-wrap {{ overflow-x: auto; border: 1px solid #263848; border-radius: 14px; }}
    table {{ width: 100%; border-collapse: collapse; background: #0f1923; font-variant-numeric: tabular-nums; }}
    th, td {{ padding: 10px 12px; border-bottom: 1px solid #21313e; text-align: right; white-space: nowrap; }}
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2), th:last-child, td:last-child {{ text-align: left; }}
    th {{ color: #b8cad4; font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; }}
    td:last-child {{ max-width: 280px; overflow: hidden; text-overflow: ellipsis; }}
    a {{ color: #72dcc8; }}
    .status {{ border-radius: 999px; padding: 3px 9px; font-size: .78rem; font-weight: 800; }}
    .status.ok {{ background: #173d34; color: #86ead2; }}
    .status.failed {{ background: #4d2027; color: #ff9ea8; }}
    code {{ color: #cfe4ec; }}
    footer {{ border-top: 1px solid #263848; padding: 24px 5vw 40px; color: #b7c5cd; }}
  </style>
</head>
<body>
  <div class="warning">{html.escape(DISCLAIMER)}</div>
  <main>
    <p class="muted">CalyxView Renal · frozen 20-case feasibility run</p>
    <h1>KiTS23 segmentation evaluation</h1>
    <p class="muted">Generated {generated}. Public KiTS case identifiers only; no patient metadata or CT pixels are shown.</p>
    <section class="grid">
      <article class="card"><h3>Completion</h3><p><b>{completed['evaluated_successfully']}/{completed['manifest_cases']}</b> cases evaluated</p><p>{completed['failed']} failed · failures remain in the denominator</p></article>
      <article class="card"><h3>Mean Dice across 3 regions</h3><p>{_metric_with_ci(summary['overall']['mean_dice_across_regions_per_case'])}</p><p class="muted">unweighted per-case mean across the 3 HECs (bootstrap 95% CI)</p></article>
      <article class="card"><h3>Mean Surface Dice across 3 regions</h3><p>{_metric_with_ci(summary['overall']['mean_surface_dice_across_regions_per_case'])}</p><p class="muted">unweighted per-case mean across the 3 HECs (bootstrap 95% CI)</p></article>
      <article class="card"><h3>Review first</h3><p><a href="worst-cases.html">Open the worst-case gallery</a></p><p><a href="case-results.csv">Download case-level CSV</a></p></article>
    </section>
    <h2>Results by KiTS23 evaluation region</h2>
    <div class="grid">{''.join(region_cards)}</div>
    <h2>Case-level audit trail</h2>
    <p class="muted">Click a case identifier for a mask-only reference/prediction/disagreement overlay.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Case</th><th>Status</th><th>Runtime s</th><th>Kidney + mass Dice</th><th>Mass Dice</th><th>Tumour Dice</th><th>Kidney + mass SD</th><th>Mass SD</th><th>Tumour SD</th><th>Tumour HD95 mm</th><th>Failure reason</th></tr></thead>
      <tbody>{''.join(table_rows)}</tbody>
    </table></div>
    <h2>Method and boundaries</h2>
    <div class="card">
      <p>Labels are validated as integer values 0–3. Prediction shape and affine must match the reference. Dice is computed for kidney + mass (1/2/3), mass (2/3), and tumour (2).</p>
      <p>Surface Dice uses the same surface-distance library, physical voxel spacing, and exact tolerances as the official KiTS23 evaluator: 1.0330772532390826 mm, 1.1328796488598762 mm, and 1.1498198361434828 mm. HD95 is the symmetric robust 95th-percentile distance from those physical surface distances.</p>
      <p>Confidence intervals are non-parametric case-bootstrap percentile intervals ({BOOTSTRAP_SAMPLES:,} samples, seed {BOOTSTRAP_SEED}). This small public cohort is a feasibility check, not a clinical validation, regulatory study, or evidence of generalisability.</p>
    </div>
  </main>
  <footer><b>{html.escape(DISCLAIMER)}</b><br>Derived mask QC only. No source CT, DICOM metadata, or NIfTI volumes are embedded in this report.</footer>
</body>
</html>
"""
    path.write_text(document, encoding="utf-8")


def write_worst_case_gallery(
    report_dir: Path, rows: Sequence[Mapping[str, Any]], count: int = 6
) -> list[str]:
    ranked = sorted(
        rows,
        key=lambda row: (
            0 if row["status"] != "ok" else 1,
            float(row["mean_surface_dice"]),
            float(row["mean_dice"]),
            str(row["case_id"]),
        ),
    )[: min(count, len(rows))]
    case_ids = [str(row["case_id"]) for row in ranked]

    cards: list[str] = []
    for row in ranked:
        case_id = str(row["case_id"])
        cards.append(
            "<article>"
            f"<h2>{html.escape(case_id)}</h2>"
            f"<p>Mean Surface Dice {_format_number(row['mean_surface_dice'])} · "
            f"Mean Dice {_format_number(row['mean_dice'])}</p>"
            f"<a href='qc/{case_id}.png'><img src='qc/{case_id}.png' "
            f"alt='Mask-only QC for {html.escape(case_id)}'></a>"
            "</article>"
        )
    gallery_html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worst-case gallery · CalyxView Renal</title><style>
body {{ margin:0; background:#091018; color:#edf4f7; font-family:Inter,system-ui,sans-serif; }}
.warning {{ background:#681d26; padding:16px 5vw; font-weight:800; }} main {{ width:min(1280px,92vw); margin:32px auto 60px; }}
a {{ color:#72dcc8; }} article {{ margin:30px 0; padding:20px; background:#111d28; border:1px solid #263848; border-radius:14px; }}
img {{ width:100%; height:auto; border-radius:8px; }} footer {{ border-top:1px solid #263848; padding:24px 5vw 40px; }}
</style></head><body><div class="warning">{html.escape(DISCLAIMER)}</div><main>
<p><a href="report.html">← Full report</a></p><h1>Worst-case mask QC gallery</h1>
<p>Ranked by evaluation failure first, then lowest mean Surface Dice. Public case identifiers only.</p>
{''.join(cards)}</main><footer><b>{html.escape(DISCLAIMER)}</b></footer></body></html>"""
    (report_dir / "worst-cases.html").write_text(gallery_html, encoding="utf-8")

    thumb_width, thumb_height = 560, 233
    margin, header = 24, 96
    columns = 2
    rows_count = math.ceil(len(ranked) / columns) if ranked else 1
    canvas = Image.new(
        "RGB",
        (columns * thumb_width + (columns + 1) * margin, header + rows_count * (thumb_height + 54) + margin),
        (9, 14, 20),
    )
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, canvas.width, 62), fill=(103, 25, 31))
    draw.text((18, 7), DISCLAIMER_LINE_1, font=_font(12, bold=True), fill=(255, 244, 244))
    draw.text((18, 32), DISCLAIMER_LINE_2, font=_font(10), fill=(255, 244, 244))
    draw.text((24, 66), "Worst-case mask QC gallery", font=_font(24, bold=True), fill=(242, 248, 251))
    for index, row in enumerate(ranked):
        column = index % columns
        grid_row = index // columns
        x = margin + column * (thumb_width + margin)
        y = header + grid_row * (thumb_height + 54)
        image_path = report_dir / "qc" / f"{row['case_id']}.png"
        with Image.open(image_path) as source:
            thumbnail = source.convert("RGB")
            thumbnail.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
            canvas.paste(thumbnail, (x, y))
        caption = (
            f"{row['case_id']} · mean SD {_format_number(row['mean_surface_dice'])} · "
            f"{row['status']}"
        )
        draw.text((x, y + thumb_height + 10), caption, font=_font(14), fill=(214, 225, 232))
    canvas.save(report_dir / "worst-cases.png", format="PNG", optimize=True)
    return case_ids


def assert_report_contains_no_medical_volumes(report_dir: Path) -> None:
    forbidden_suffixes = (".nii", ".nii.gz", ".dcm", ".dicom")
    violations = [
        path
        for path in report_dir.rglob("*")
        if path.is_file() and any(path.name.lower().endswith(suffix) for suffix in forbidden_suffixes)
    ]
    if violations:
        raise RuntimeError(f"Medical source files must not be copied into report/: {violations}")


def assert_fresh_report_directory(report_dir: Path) -> None:
    """Refuse to mix a new evaluation with artefacts from an earlier run."""

    if not report_dir.exists():
        return
    if not report_dir.is_dir():
        raise RuntimeError(f"Report path exists but is not a directory: {report_dir}")
    existing = sorted(path for path in report_dir.rglob("*") if path.is_file())
    if existing:
        preview = [str(path.relative_to(report_dir)) for path in existing[:8]]
        raise RuntimeError(
            "Refusing to evaluate into a non-empty report directory. "
            f"Archive or remove the prior report first. Existing files: {preview}"
        )


def assert_expected_report_files(report_dir: Path, case_ids: Sequence[str]) -> None:
    """Fail closed if the local report contains anything outside its fixed schema."""

    expected = {
        "case-results.csv",
        "summary.json",
        "report.html",
        "worst-cases.html",
        "worst-cases.png",
        *(f"qc/{case_id}.png" for case_id in case_ids),
    }
    actual = {
        str(path.relative_to(report_dir)).replace("\\", "/")
        for path in report_dir.rglob("*")
        if path.is_file()
    }
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise RuntimeError(
            "Report file schema mismatch before hashing: "
            f"missing={missing}, unexpected={unexpected}"
        )


def write_output_hashes(report_dir: Path) -> Path:
    """Hash every report artefact except the hash manifest itself."""

    output_path = report_dir / "output-hashes.json"
    records = []
    for path in sorted(report_dir.rglob("*")):
        if not path.is_file() or path == output_path:
            continue
        records.append(
            {
                "path": str(path.relative_to(report_dir)).replace("\\", "/"),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    output_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "research_only": True,
                "generated_at_utc": datetime.now(timezone.utc).isoformat(),
                "files": records,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return output_path


def main() -> None:
    args = parse_args()
    run_root = args.run_root.resolve()
    manifest_path = run_root / "manifests" / "manifest.csv"
    labels_dir = run_root / "labels"
    predictions_dir = run_root / "predictions"
    report_dir = run_root / "report"
    qc_dir = report_dir / "qc"

    records = require_manifest(manifest_path)
    case_ids = {record["case_id"] for record in records}
    timings, timing_warnings = discover_timings(run_root, case_ids)
    assert_fresh_report_directory(report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    qc_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        case_id = record["case_id"]
        print(f"[{index:02d}/{len(records)}] evaluating {case_id}", flush=True)
        row, reference, prediction = evaluate_case(
            case_id,
            labels_dir / f"{case_id}.nii.gz",
            predictions_dir / f"{case_id}.nii.gz",
            timings.get(case_id),
        )
        write_qc_image(
            qc_dir / f"{case_id}.png",
            case_id,
            reference,
            prediction,
            str(row["status"]),
            str(row["failure_reason"]),
        )
        rows.append(row)

    results_path = report_dir / "case-results.csv"
    summary_path = report_dir / "summary.json"
    report_path = report_dir / "report.html"
    write_case_results(results_path, rows)
    summary = build_summary(run_root, manifest_path, rows, timing_warnings)
    worst_cases = write_worst_case_gallery(report_dir, rows)
    summary["worst_case_gallery"] = {
        "ranking": "failures first, then ascending mean Surface Dice and mean Dice",
        "case_ids": worst_cases,
        "html": "worst-cases.html",
        "png": "worst-cases.png",
    }
    summary["artifacts"] = {
        "case_results_csv": "case-results.csv",
        "report_html": "report.html",
        "qc_directory": "qc",
        "output_hashes_json": "output-hashes.json",
    }
    summary_path.write_text(
        json.dumps(_json_safe(summary), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_report_html(report_path, rows, summary)
    assert_report_contains_no_medical_volumes(report_dir)
    assert_expected_report_files(report_dir, [record["case_id"] for record in records])
    output_hashes_path = write_output_hashes(report_dir)

    result = {
        "status": "complete" if all(row["status"] == "ok" for row in rows) else "complete_with_failures",
        "cases": len(rows),
        "successful": sum(row["status"] == "ok" for row in rows),
        "failed": sum(row["status"] != "ok" for row in rows),
        "report": str(report_path),
        "summary": str(summary_path),
        "case_results": str(results_path),
        "output_hashes": str(output_hashes_path),
        "disclaimer": DISCLAIMER,
    }
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
