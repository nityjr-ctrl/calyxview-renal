"""Publish cropped, windowed axial CT slices and their outlines for Kidneys A to E.

What it makes, for each kidney (A to E are KiTS23 cases 0 to 4, see
docs/REFERENCE-CASES.md):

    public/ct/reference-<letter>/000.webp ...  one image per axial slice
    public/ct/reference-<letter>/slices.json   geometry and outlines
    public/ct/reference-<letter>/key.webp      the slice through the tumour's
                                               centre, outlined, 640 px wide

How:

  * The volumes are reoriented to canonical RAS, as renalplan does. The
    tumour-bearing kidney is found the way renalplan does it: the largest
    tumour piece is the index lesion; of the substantial kidney pieces (at
    least 10% of the largest, or 20 ml) the one nearest that lesion is the
    tumour-bearing kidney, plus any small fragments within 5 mm of it.
  * The crop is the box round that kidney and the index lesion, padded by
    25 mm on every side (clipped to the scan).
  * Every axial slice through the box is kept. Thin-slice scans are averaged
    into slabs of about 3 mm (6 slices of 0.5 mm make one slab), so nothing is
    skipped and each kidney stays at roughly 30 to 60 images.
  * Soft-tissue window (level 40 HU, width 400 HU), 8 bit. Radiological
    orientation: anterior up, the patient's left on the viewer's right.
    In-plane pixels are square, about 384 px on the long edge. WebP, quality 80.
  * Outlines (kidney, tumour, cyst) are traced on the same resampled grid
    with skimage.measure.find_contours at 0.5 on each label's slab fraction,
    simplified with approximate_polygon (0.7 px), and stored as flat
    [x0, y0, x1, y1, ...] polylines in image pixels, 1 decimal place.
  * Millimetre positions are in the frame of the 3D models
    (public/models/reference-<letter>.glb): RAS axes, with the origin at the
    corner voxel of the canonical volume, so model mm = voxel index x spacing.
    If the GLB is present the script checks that the tumour box agrees with
    the GLB's tumour mesh to within 3 mm.

Nothing in the output names a case, a file path or a date: the deploy bundle
scan (test/deploy-bundle-scan.mjs) forbids cohort identifiers in text files.
The CT volumes and label maps are never copied into the repository.

Usage, from the repository root:

    python scripts/make-ct-slices.py --data C:\\Users\\nityj\\CalyxView-data\\kits23-renal

The data folder holds case_0000N-imaging.nii.gz and
case_0000N-segmentation.nii.gz for N = 0 to 4. Re-running overwrites the
output folders. KiTS23 imaging and labels are CC BY-NC-SA 4.0, and so are
these slices.
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from nibabel.orientations import apply_orientation, axcodes2ornt, io_orientation, ornt_transform
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.measure import approximate_polygon, find_contours

KIDNEY, TUMOUR, CYST = 1, 2, 3
CASES = [("a", 0), ("b", 1), ("c", 2), ("d", 3), ("e", 4)]

PAD_MM = 25.0
SLAB_TARGET_MM = 3.0
LONG_EDGE_PX = 384
KEY_WIDTH_PX = 640
WINDOW_LEVEL = 40.0
WINDOW_WIDTH = 400.0
WEBP_QUALITY = 80
SIMPLIFY_PX = 0.7
MIN_CONTOUR_POINTS = 3

KIDNEY_RGBA = (196, 170, 140, int(0.7 * 255))
TUMOUR_RGBA = (216, 92, 96, 255)
CYST_RGBA = (143, 184, 216, int(0.85 * 255))


def components(mask: np.ndarray):
    lab, n = ndimage.label(mask)
    sizes = ndimage.sum_labels(mask, lab, index=np.arange(1, n + 1)) if n else np.zeros(0)
    return lab, np.asarray(sizes)


def surface_points_mm(mask: np.ndarray, spacing: np.ndarray, offset: np.ndarray) -> np.ndarray:
    surf = mask & ~ndimage.binary_erosion(mask)
    return (np.argwhere(surf) + offset) * spacing


def index_lesion(tumour: np.ndarray) -> np.ndarray:
    lab, sizes = components(tumour)
    if sizes.size <= 1:
        return tumour
    return lab == (int(np.argmax(sizes)) + 1)


def tumour_bearing_kidney(kidney: np.ndarray, lesion: np.ndarray, spacing: np.ndarray) -> np.ndarray:
    """renalplan's rule (nephrometry.tumour_bearing_kidney), with nearest
    distances from KD-trees of surface voxels instead of a full-volume distance
    transform, which needs several GB on a 0.5 mm scan."""
    lab, sizes = components(kidney)
    if sizes.size <= 1 or not lesion.any():
        return kidney
    vox_ml = float(np.prod(spacing)) / 1000.0
    floor = min(0.1 * sizes.max(), 20.0 / vox_ml)
    tumour_tree = cKDTree(surface_points_mm(lesion, spacing, np.zeros(3)))
    objects = ndimage.find_objects(lab)
    best, best_d = None, np.inf
    for i, box in enumerate(objects):
        if box is None or sizes[i] < floor:
            continue
        comp = lab[box] == (i + 1)
        offset = np.array([s.start for s in box])
        d, _ = tumour_tree.query(surface_points_mm(comp, spacing, offset), k=1)
        if d.min() < best_d:
            best, best_d = i + 1, float(d.min())
    if best is None:
        best = int(np.argmax(sizes)) + 1
    chosen = lab == best
    chosen_tree = cKDTree(surface_points_mm(chosen, spacing, np.zeros(3)))
    for i, box in enumerate(objects):
        if box is None or sizes[i] >= floor:
            continue
        comp = lab[box] == (i + 1)
        offset = np.array([s.start for s in box])
        d, _ = chosen_tree.query(surface_points_mm(comp, spacing, offset), k=1)
        if d.min() <= 5.0:
            chosen |= lab == (i + 1)
    return chosen


def glb_tumour_box(path: Path):
    if not path.exists():
        return None
    data = path.read_bytes()
    (length,) = struct.unpack_from("<I", data, 12)
    gltf = json.loads(data[20 : 20 + length])
    for mesh in gltf.get("meshes", []):
        if mesh.get("name") == "tumour":
            accessor = gltf["accessors"][mesh["primitives"][0]["attributes"]["POSITION"]]
            return np.array(accessor["min"]), np.array(accessor["max"])
    return None


def window(hu: np.ndarray) -> np.ndarray:
    low = WINDOW_LEVEL - WINDOW_WIDTH / 2
    return np.clip((hu - low) / WINDOW_WIDTH * 255.0, 0, 255)


def polylines(fraction: np.ndarray) -> list[list[float]]:
    out = []
    if fraction.max() < 0.5:
        return out
    padded = np.pad(fraction, 1)  # closes contours that touch the crop edge
    for contour in find_contours(padded, 0.5):
        simple = approximate_polygon(contour - 1, tolerance=SIMPLIFY_PX)
        if len(simple) < MIN_CONTOUR_POINTS:
            continue
        h, w = fraction.shape
        rows = np.clip(simple[:, 0], 0, h - 1)
        cols = np.clip(simple[:, 1], 0, w - 1)
        # Pixel centres sit at +0.5 in image (SVG) coordinates.
        flat = np.column_stack([cols + 0.5, rows + 0.5]).round(1).ravel()
        out.append([float(v) for v in flat])
    return out


def draw_outlines(image: Image.Image, outlines: dict, scale: float, width: float) -> Image.Image:
    """Antialiased outlines: draw at 3x on a transparent layer, then shrink."""
    ss = 3
    base = image.convert("RGBA")
    layer = Image.new("RGBA", (base.width * ss, base.height * ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for name, colour in (("kidney", KIDNEY_RGBA), ("cyst", CYST_RGBA), ("tumour", TUMOUR_RGBA)):
        for line in outlines.get(name, []):
            pts = [(line[i] * scale * ss, line[i + 1] * scale * ss) for i in range(0, len(line), 2)]
            if len(pts) >= 2:
                draw.line(pts + [pts[0]], fill=colour, width=max(1, round(width * ss)), joint="curve")
    layer = layer.resize(base.size, Image.LANCZOS)
    return Image.alpha_composite(base, layer).convert("RGB")


def process(letter: str, index: int, data_dir: Path, repo: Path) -> dict:
    imaging = data_dir / f"case_{index:05d}-imaging.nii.gz"
    segmentation = data_dir / f"case_{index:05d}-segmentation.nii.gz"
    for path in (imaging, segmentation):
        if not path.exists() or path.stat().st_size == 0:
            raise SystemExit(f"Kidney {letter.upper()}: missing or empty input {path.name}")

    seg_img = nib.load(str(segmentation))
    ct_img = nib.load(str(imaging))
    if seg_img.shape != ct_img.shape or not np.allclose(seg_img.affine, ct_img.affine, atol=1e-3):
        raise SystemExit(f"Kidney {letter.upper()}: CT and labels are on different grids")

    # Canonical RAS, as renalplan's io.load_nifti does (nib.as_closest_canonical).
    ornt = ornt_transform(io_orientation(seg_img.affine), axcodes2ornt(("R", "A", "S")))
    labels = apply_orientation(np.asarray(seg_img.dataobj).astype(np.uint8), ornt)
    # Canonical axis c comes from source axis argsort(ornt[:, 0])[c].
    spacing = np.abs(np.array(nib.affines.voxel_sizes(seg_img.affine))[np.argsort(ornt[:, 0])])

    lesion = index_lesion(labels == TUMOUR)
    if not lesion.any():
        raise SystemExit(f"Kidney {letter.upper()}: no tumour label")
    kidney = tumour_bearing_kidney(labels == KIDNEY, lesion, spacing)

    idx = np.argwhere(kidney | lesion)
    pad_vox = np.ceil(PAD_MM / spacing).astype(int)
    lo = np.maximum(idx.min(0) - pad_vox, 0)
    hi = np.minimum(idx.max(0) + pad_vox, np.array(labels.shape) - 1)

    # Check the model frame against the GLB: model mm = canonical index x spacing.
    lesion_idx = np.argwhere(lesion)
    lesion_lo, lesion_hi = lesion_idx.min(0) * spacing, lesion_idx.max(0) * spacing
    glb = glb_tumour_box(repo / "public" / "models" / f"reference-{letter}.glb")
    if glb is not None:
        error = max(np.abs(glb[0] - lesion_lo).max(), np.abs(glb[1] - lesion_hi).max())
        if error > 3.0:
            raise SystemExit(f"Kidney {letter.upper()}: tumour box is {error:.1f} mm off the GLB's, frames differ")
        print(f"  Kidney {letter.upper()}: GLB tumour box agrees within {error:.1f} mm")

    # Read only the cropped block of the CT. Canonical axis c comes from source
    # axis a where ornt maps a -> c, flipped if ornt[a, 1] == -1.
    src_shape = ct_img.shape
    src_slices = [None] * 3
    for a in range(3):
        c, flip = int(ornt[a, 0]), int(ornt[a, 1])
        if flip == 1:
            src_slices[a] = slice(int(lo[c]), int(hi[c]) + 1)
        else:
            src_slices[a] = slice(int(src_shape[a] - 1 - hi[c]), int(src_shape[a] - lo[c]))
    ct_block = np.asarray(ct_img.dataobj[tuple(src_slices)], dtype=np.float32)
    ct = apply_orientation(ct_block, ornt)
    box = tuple(slice(int(lo[c]), int(hi[c]) + 1) for c in range(3))
    lab = labels[box]
    if ct.shape != lab.shape:
        raise SystemExit(f"Kidney {letter.upper()}: crop mismatch {ct.shape} vs {lab.shape}")

    # Model-frame extents of the crop (voxel centres), in mm.
    x_min, x_max = lo[0] * spacing[0], hi[0] * spacing[0]
    y_min, y_max = lo[1] * spacing[1], hi[1] * spacing[1]
    long_mm = max(x_max - x_min, y_max - y_min)
    pixel = long_mm / LONG_EDGE_PX
    width = int(round((x_max - x_min) / pixel))
    height = int(round((y_max - y_min) / pixel))
    # Centre the grid on the crop, so the plane in 3D matches the image exactly.
    x_mid, y_mid = (x_min + x_max) / 2, (y_min + y_max) / 2
    x_left = x_mid + width * pixel / 2  # image column 0 is the patient's right (+x)
    y_top = y_mid + height * pixel / 2  # image row 0 is anterior (+y)

    def grid(w: int, h: int, px: float):
        cols = np.arange(w) + 0.5
        rows = np.arange(h) + 0.5
        xs = x_mid + w * px / 2 - cols * px
        ys = y_mid + h * px / 2 - rows * px
        ii = xs / spacing[0] - lo[0]
        jj = ys / spacing[1] - lo[1]
        return np.meshgrid(jj, ii, indexing="ij")  # (row, col) -> (j, i)

    jj, ii = grid(width, height, pixel)

    # Slabs: groups of n native slices, about 3 mm thick.
    n_avg = max(1, int(round(SLAB_TARGET_MM / spacing[2])))
    depth = ct.shape[2]
    groups = [list(range(s, min(s + n_avg, depth))) for s in range(0, depth, n_avg)]
    if len(groups) > 1 and len(groups[-1]) < max(1, n_avg // 2):
        groups[-2].extend(groups.pop())

    out_dir = repo / "public" / "ct" / f"reference-{letter}"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    lesion_box = lesion[box]
    centroid_k = float(np.argwhere(lesion_box)[:, 2].mean())
    slices = []
    tumour_slice, tumour_gap = 0, np.inf
    for n, group in enumerate(groups):
        hu = ct[:, :, group].mean(axis=2)
        plane = ndimage.map_coordinates(hu, [ii, jj], order=1, mode="nearest")
        Image.fromarray(window(plane).astype(np.uint8)).save(
            out_dir / f"{n:03d}.webp", "WEBP", quality=WEBP_QUALITY, method=6
        )
        entry = {"z": round(float((lo[2] + np.mean(group)) * spacing[2]), 1)}
        for name, value in (("kidney", KIDNEY), ("tumour", TUMOUR), ("cyst", CYST)):
            fraction = (lab[:, :, group] == value).mean(axis=2).astype(np.float32)
            if fraction.max() == 0:
                continue
            resampled = ndimage.map_coordinates(fraction, [ii, jj], order=1, mode="constant", cval=0.0)
            lines = polylines(resampled)
            if lines:
                entry[name] = lines
        gap = abs(np.mean(group) - centroid_k)
        if gap < tumour_gap:
            tumour_slice, tumour_gap = n, gap
        slices.append(entry)

    # The key still: the tumour-centre slab at 640 px wide, outlined.
    key_px = (width * pixel) / KEY_WIDTH_PX
    key_w = KEY_WIDTH_PX
    key_h = int(round(height * pixel / key_px))
    kj, ki = grid(key_w, key_h, key_px)
    hu = ct[:, :, groups[tumour_slice]].mean(axis=2)
    key_plane = ndimage.map_coordinates(hu, [ki, kj], order=3, mode="nearest")
    key = Image.fromarray(window(key_plane).astype(np.uint8))
    key = draw_outlines(key, slices[tumour_slice], scale=key_w / width, width=2.4)
    key.save(out_dir / "key.webp", "WEBP", quality=84, method=6)

    meta = {
        "version": 1,
        "width": width,
        "height": height,
        "pixelMm": round(float(pixel), 3),
        "sliceMm": round(float(n_avg * spacing[2]), 2),
        "window": {"level": WINDOW_LEVEL, "width": WINDOW_WIDTH},
        "orientation": "Axial, seen from the feet: anterior up, the patient's left on the right.",
        "frame": "3D model millimetres: RAS axes, origin at the scan's corner voxel. Column 0 is at xLeftMm and x falls to the right; row 0 is at yTopMm and y falls downwards.",
        "xLeftMm": round(float(x_left), 1),
        "yTopMm": round(float(y_top), 1),
        "cropOriginMm": [round(float(x_left - width * pixel), 1), round(float(y_top - height * pixel), 1), slices[0]["z"]],
        "tumourSlice": tumour_slice,
        "licence": "KiTS23, CC BY-NC-SA 4.0",
        "slices": slices,
    }
    (out_dir / "slices.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")

    total = sum(p.stat().st_size for p in out_dir.iterdir())
    return {
        "letter": letter.upper(),
        "slices": len(slices),
        "size": f"{width}x{height}",
        "pixelMm": round(float(pixel), 3),
        "sliceMm": round(float(n_avg * spacing[2]), 2),
        "nativeMm": round(float(spacing[2]), 2),
        "bytes": total,
        "jsonBytes": (out_dir / "slices.json").stat().st_size,
        "cyst": any("cyst" in s for s in slices),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--data", required=True, type=Path, help="folder with the KiTS23 NIfTI files")
    parser.add_argument("--only", default="", help="letters to make, e.g. 'ac' (default: all five)")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    wanted = [c for c in CASES if not args.only or c[0] in args.only.lower()]
    results = []
    for letter, index in wanted:
        print(f"Kidney {letter.upper()} ...", flush=True)
        results.append(process(letter, index, args.data, repo))
    for r in results:
        print(
            f"Kidney {r['letter']}: {r['slices']} slices of {r['sliceMm']} mm (native {r['nativeMm']} mm), "
            f"{r['size']} px at {r['pixelMm']} mm, {r['bytes'] / 1024:.0f} KB "
            f"(json {r['jsonBytes'] / 1024:.0f} KB){', cyst outlined' if r['cyst'] else ''}"
        )


if __name__ == "__main__":
    sys.exit(main())
