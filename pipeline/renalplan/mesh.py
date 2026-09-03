"""Mask -> surface mesh, and the fidelity back-check.

Marching cubes on the voxel mask, Taubin smoothing (shrink-free), quadric
decimation, vertices in RAS millimetres via the volume affine. The
`fidelity` function voxelises the mesh back onto the source grid and scores
it against the mask, which is how `optimise-mesh` chooses smoothing and
decimation settings that stay faithful to the segmentation.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure

from .metrics import overlap_metrics, OverlapMetrics


@dataclass
class MeshParams:
    taubin_iter: int = 15
    taubin_lambda: float = 0.5
    taubin_nu: float = 0.53
    target_faces: int = 20000
    keep_largest: bool = True
    closing_iter: int = 1

    def as_dict(self) -> dict:
        return asdict(self)


def mask_to_mesh(mask: np.ndarray, affine: np.ndarray, params: MeshParams = MeshParams()) -> trimesh.Trimesh | None:
    m = mask.astype(bool)
    if params.closing_iter > 0:
        m = ndimage.binary_closing(m, iterations=params.closing_iter)
    if m.sum() < 10:
        return None
    # pad so surfaces touching the volume edge close properly
    p = np.pad(m, 1)
    verts, faces, normals, _ = measure.marching_cubes(p.astype(np.float32), level=0.5, spacing=(1, 1, 1))
    verts = verts - 1.0  # undo the pad, still in voxel index units
    hom = np.c_[verts, np.ones(len(verts))]
    verts_mm = (affine @ hom.T).T[:, :3]
    mesh = trimesh.Trimesh(vertices=verts_mm, faces=faces, process=True)
    if params.keep_largest:
        comps = mesh.split(only_watertight=False)
        if len(comps) > 1:
            mesh = max(comps, key=lambda c: c.area)
    if params.taubin_iter > 0:
        trimesh.smoothing.filter_taubin(mesh, lamb=params.taubin_lambda, nu=params.taubin_nu,
                                        iterations=params.taubin_iter)
    if params.target_faces and len(mesh.faces) > params.target_faces:
        try:
            mesh = mesh.simplify_quadric_decimation(face_count=params.target_faces)
        except TypeError:
            mesh = mesh.simplify_quadric_decimation(params.target_faces)
    mesh.fix_normals()
    return mesh


def voxelise(mesh: trimesh.Trimesh, affine: np.ndarray, shape, chunk: int = 400_000) -> np.ndarray:
    """Rasterise a closed mesh back onto the voxel grid. Only voxels inside the
    mesh bounding box are tested, in chunks, so memory stays flat on large CTs."""
    inv = np.linalg.inv(affine)
    corners = np.array([[x, y, z] for x in mesh.bounds[:, 0] for y in mesh.bounds[:, 1] for z in mesh.bounds[:, 2]])
    vc = (inv @ np.c_[corners, np.ones(8)].T).T[:, :3]
    lo = np.maximum(np.floor(vc.min(0)).astype(int) - 1, 0)
    hi = np.minimum(np.ceil(vc.max(0)).astype(int) + 2, np.asarray(shape))
    out = np.zeros(shape, bool)
    if np.any(hi <= lo):
        return out
    sub_shape = tuple(int(h - l) for l, h in zip(lo, hi))
    idx = np.indices(sub_shape).reshape(3, -1).T + lo
    inside = np.zeros(len(idx), bool)
    for start in range(0, len(idx), chunk):
        block = idx[start:start + chunk]
        pts = (affine @ np.c_[block, np.ones(len(block))].T).T[:, :3]
        inside[start:start + chunk] = mesh.contains(pts)
    out[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = inside.reshape(sub_shape)
    return out


def fidelity(mesh: trimesh.Trimesh, mask: np.ndarray, affine: np.ndarray, spacing) -> OverlapMetrics:
    vox = voxelise(mesh, affine, mask.shape)
    return overlap_metrics(vox, mask, spacing, tolerance_mm=max(spacing))


def scene_from(named: dict[str, trimesh.Trimesh | None], colours: dict[str, list[int]]) -> trimesh.Scene:
    scene = trimesh.Scene()
    for name, mesh in named.items():
        if mesh is None:
            continue
        mesh = mesh.copy()
        mesh.visual.vertex_colors = colours.get(name, [200, 200, 200, 255])
        scene.add_geometry(mesh, geom_name=name)
    return scene
