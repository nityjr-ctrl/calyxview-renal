"""Offline source overlays and a small local 3D review page."""
from __future__ import annotations
import html
import json
import shutil
from pathlib import Path

import numpy as np
from scipy import ndimage

from .ai import COLOURS, NOTICE


def export_review(output, ct, masks, record, collecting_ct, three_dir):
    from PIL import Image
    extent = np.zeros(ct.data.shape, bool)
    for mask in masks.values():
        extent |= mask
    indices = np.argwhere(extent)
    lo = np.maximum(indices.min(axis=0) - 8, 0)
    hi = np.minimum(indices.max(axis=0) + 9, ct.data.shape)
    slices = {name: [] for name in ["axial", "coronal", "sagittal"]}
    images = output / "images"; images.mkdir(exist_ok=True)
    for name, axis in [("axial", 2), ("coronal", 1), ("sagittal", 0)]:
        for number, index in enumerate(range(int(lo[axis]), int(hi[axis]))):
            selection = [slice(int(a), int(b)) for a, b in zip(lo, hi)]
            selection[axis] = index
            selection = tuple(selection)
            def display(data):
                plane = data[selection].T
                return plane[::-1, :] if axis == 0 else plane[::-1, ::-1]
            source = display(ct.data)
            grey = np.clip((source + 120.) / 400., 0, 1)
            rgb = np.repeat(grey[..., None], 3, axis=2)
            for structure, mask in masks.items():
                plane = display(mask)
                border = plane & ~ndimage.binary_erosion(plane)
                rgb[border] = np.array(COLOURS[structure][:3]) / 255.
            filename = f"images/{name}-{number:04}.png"
            # Preserve physical pixel aspect ratio when source voxels differ.
            spacing_axes = [a for a in range(3) if a != axis]
            pixel = min(ct.spacing[a] for a in spacing_axes)
            shape = (max(1, round(rgb.shape[1] * ct.spacing[spacing_axes[0]] / pixel)),
                     max(1, round(rgb.shape[0] * ct.spacing[spacing_axes[1]] / pixel)))
            image = Image.fromarray(np.round(rgb * 255).astype(np.uint8))
            if image.size != shape:
                image = image.resize(shape, Image.Resampling.NEAREST)
            image.save(output / filename)
            coordinate = float((ct.affine @ np.r_[np.array([index if a == axis else 0 for a in range(3)]), 1])[axis])
            entry = {"image": filename, "coordinateMm": round(coordinate, 2)}
            if collecting_ct is not None:
                delayed = display(collecting_ct.data)
                grey = np.clip((delayed + 200.) / 1000., 0, 1)
                rgb = np.repeat(grey[..., None], 3, axis=2)
                plane = display(masks["collecting_system"])
                border = plane & ~ndimage.binary_erosion(plane)
                rgb[border] = np.array(COLOURS["collecting_system"][:3]) / 255.
                delayed_file = f"images/excretory-{name}-{number:04}.png"
                image = Image.fromarray(np.round(rgb * 255).astype(np.uint8)).resize(shape, Image.Resampling.NEAREST)
                image.save(output / delayed_file)
                entry["excretoryImage"] = delayed_file
            slices[name].append(entry)
    (output / "slices.json").write_text(json.dumps(slices), encoding="utf-8")
    assets = Path(__file__).parent / "review_assets"
    shutil.copyfile(assets / "viewer.js", output / "viewer.js")
    vendor = False
    if three_dir is not None:
        three_dir = Path(three_dir)
        files = ["LICENSE", "build/three.module.js", "build/three.core.js", "examples/jsm/controls/OrbitControls.js",
                 "examples/jsm/loaders/GLTFLoader.js", "examples/jsm/utils/BufferGeometryUtils.js", "examples/jsm/utils/SkeletonUtils.js"]
        for name in files:
            source = three_dir / name
            if not source.is_file():
                raise ValueError("Incomplete local three package; no CDN fallback is used")
            target = output / "vendor" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        vendor = True
    rows = "".join(f'<tr><th scope="row"><a href="{html.escape(s["mask"])}" download>{html.escape(s["name"].replace("_", " "))}</a></th>'
                   f'<td data-label="Result">{html.escape(s["status"].replace("_", " "))}</td><td data-label="Mask volume">{s["volumeMl"]:.2f} ml</td>'
                   f'<td data-label="Review">{html.escape(s["expertReview"].replace("_", " "))}</td></tr>' for s in record["structures"])
    layers = "".join(f'<label><input type="checkbox" data-layer="{name}" checked disabled> '
                     f'<span aria-hidden="true" style="display:inline-block;width:12px;height:12px;background:rgb({",".join(str(c) for c in COLOURS[name][:3])})"></span> '
                     f'{html.escape(name.replace("_", " "))}</label>' for name, mask in masks.items() if mask.sum() >= 10)
    template = (assets / "index.html").read_text(encoding="utf-8")
    for token, value in {"CASE": html.escape(record["caseCode"]), "NOTICE": NOTICE,
                         "ROWS": rows, "LAYERS": layers,
                         "MODEL_STATE": "Loading local model…" if vendor else "3D preview unavailable: supply --three-dir. The GLB download remains available."}.items():
        template = template.replace("{{" + token + "}}", value)
    (output / "index.html").write_text(template, encoding="utf-8")
