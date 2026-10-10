"""Publish cropped CT and unchanged mask boundaries from the verified TCIA CTU.

Raw volumes stay outside the repository. No gap filling or anatomical inference.
Requires the existing imaging environment: nibabel, scipy, skimage, trimesh, PIL.
"""
import hashlib
import json
from pathlib import Path
import nibabel as nib
import numpy as np
from scipy.ndimage import map_coordinates
from skimage.measure import marching_cubes, find_contours, approximate_polygon
import trimesh
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WORK = Path.home() / 'CalyxView-data/pcnl/a2el'
OUT = ROOT / 'public/urogram'


def digest(path, algorithm='sha256'):
    h = hashlib.new(algorithm)
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def main():
    prep = json.loads((WORK / 'prep.json').read_text())
    source = Path(prep['source_ct'])
    assert digest(source, 'sha1') == '3eb71dfbd0583f33e4cceb70a61b33cd9d422b4f'
    assert digest(WORK / 'ct_1mm.nii.gz') == '66de451b38d3233db4d011eac9ae117b3fe02da5c1cda0ce03da342e47211d76'
    ct = nib.load(WORK / 'ct_1mm.nii.gz')
    volume = np.asarray(ct.dataobj, dtype=np.float32)
    original = nib.load(source)
    points = np.array([[80, 75, 55], [120, 140, 90], [180, 160, 100], [130, 110, 75]])
    coords = nib.affines.apply_affine(np.linalg.inv(original.affine), nib.affines.apply_affine(ct.affine, points))
    raw = map_coordinates(np.asarray(original.dataobj, dtype=np.float32), coords.T, order=1, mode='constant', cval=-1024)
    error = float(np.max(np.abs(volume[tuple(points.T)] - np.clip(np.round(raw), -1024, 3071))))
    assert error <= 1
    masks = {}
    scene = trimesh.Scene()
    metrics = {}
    for key, filename, colour in [('kidney', 'kidney_left', [194, 154, 127, 255]), ('collecting', 'collecting_system', [90, 210, 226, 255])]:
        image = nib.load(WORK / 'masks' / f'{filename}.nii.gz')
        assert image.shape == ct.shape and np.allclose(image.affine, ct.affine)
        mask = np.asarray(image.dataobj) > 0
        masks[key] = mask
        v, faces, _, _ = marching_cubes(mask.astype(np.uint8), level=.5, allow_degenerate=False)
        v = nib.affines.apply_affine(ct.affine, v)
        mesh = trimesh.Trimesh(vertices=v, faces=faces, process=False)
        if mesh.volume < 0:
            mesh.invert()
        mesh.visual.vertex_colors = colour
        # Export vertex normals; the marching-cubes boundary is not smoothed.
        mesh.vertex_normals
        name = 'parenchyma' if key == 'kidney' else key
        scene.add_geometry(mesh, node_name=name, geom_name=name)
        metrics[key] = {'voxels': int(mask.sum()), 'vertices': len(v), 'triangles': len(faces), 'maskSha256': digest(WORK / 'masks' / f'{filename}.nii.gz'), 'meshVolumeMm3': abs(float(mesh.volume))}
    OUT.mkdir(exist_ok=True)
    (OUT / 'model.glb').write_bytes(scene.export(file_type='glb', include_normals=True))
    bounds = np.argwhere(masks['kidney'] | masks['collecting'])
    lo = np.maximum(bounds.min(axis=0) - 12, 0)
    hi = np.minimum(bounds.max(axis=0) + 13, volume.shape)
    x0,y0,z0 = lo
    x1,y1,z1 = hi
    folder = OUT / 'ct'
    folder.mkdir(exist_ok=True)
    slices = []
    for z in range(int(z0), int(z1), 2):
        plane = volume[x0:x1, y0:y1, z][::-1, ::-1].T
        pixels = np.clip((plane - (250 - 1000 / 2)) / 1000 * 255, 0, 255).astype(np.uint8)
        Image.fromarray(pixels).save(folder / f'{len(slices):03}.webp', quality=90)
        entry = {'z': float(nib.affines.apply_affine(ct.affine, [0,0,z])[2])}
        for key, mask in masks.items():
            contours = find_contours(mask[x0:x1,y0:y1,z][::-1,::-1].T, .5)
            entry[key] = [np.round(approximate_polygon(c, tolerance=.25)[:,::-1], 2).flatten().tolist() for c in contours if len(c) >= 4]
        slices.append(entry)
    focus = int(np.argmax([sum(len(c) for c in s['collecting']) for s in slices]))
    (folder / 'key.webp').write_bytes((folder / f'{focus:03}.webp').read_bytes())
    data = {'version':1, 'width':int(x1-x0), 'height':int(y1-y0), 'pixelMm':1, 'sliceMm':2, 'window':{'level':250,'width':1000}, 'xLeftMm':float(ct.affine[0,3]+x1-1), 'yTopMm':float(ct.affine[1,3]+y1-1), 'tumourSlice':focus, 'slices':slices}
    (folder / 'slices.json').write_text(json.dumps(data, separators=(',',':')))
    report = {'sourceComparisonMaxHu':error, 'workingSpacingMm':[float(v) for v in ct.header.get_zooms()[:3]], 'surfaceSmoothing':False, 'artificialBridging':False, 'expertReview':'pending', 'structures':metrics, 'ctSlices':len(slices)}
    (ROOT / 'docs/urogram-build-evidence.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
