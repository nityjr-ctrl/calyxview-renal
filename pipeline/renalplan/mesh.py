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


def voxelise(mesh: trimesh.Trimesh, affine: np.ndarray, shape) -> np.ndarray:
    """Rasterise a closed mesh back onto the voxel grid, slice by slice: the
    mesh is moved into voxel-index space, cut at every integer z, and the
    resulting polygons are tested against the slice's grid points. Exact for
    voxel centres and memory-light on large CTs."""
    import shapely

    m = mesh.copy()
    m.apply_transform(np.linalg.inv(affine))
    out = np.zeros(shape, bool)
    lo, hi = m.bounds
    z0, z1 = max(0, int(np.ceil(lo[2]))), min(shape[2] - 1, int(np.floor(hi[2])))
    x0, x1 = max(0, int(np.floor(lo[0]))), min(shape[0] - 1, int(np.ceil(hi[0])))
    y0, y1 = max(0, int(np.floor(lo[1]))), min(shape[1] - 1, int(np.ceil(hi[1])))
    if z1 < z0 or x1 < x0 or y1 < y0:
        return out
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1), indexing="ij")
    gx, gy = gx.ravel().astype(float), gy.ravel().astype(float)
    for k in range(z0, z1 + 1):
        sec = m.section(plane_origin=[0, 0, float(k)], plane_normal=[0, 0, 1])
        if sec is None:
            continue
        to_2d = np.eye(4)
        to_2d[2, 3] = -float(k)
        planar, _ = sec.to_2D(to_2D=to_2d)
        polys = planar.polygons_full
        if not len(polys):
            continue
        inside = np.zeros(gx.shape, bool)
        for poly in polys:
            inside |= shapely.contains_xy(poly, gx, gy)
        sl = out[x0:x1 + 1, y0:y1 + 1, k]
        sl |= inside.reshape(sl.shape)
        out[x0:x1 + 1, y0:y1 + 1, k] = sl
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
