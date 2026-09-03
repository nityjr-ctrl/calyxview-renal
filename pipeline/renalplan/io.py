"""Loading CT and label volumes into a canonical RAS frame.

A `Volume` is a numpy array `data[i, j, k]` with `affine` mapping voxel
indices to RAS millimetres and `spacing` in mm. Everything downstream works in
this frame so that DICOM exports, NIfTI files and reference labels line up.

DICOM handling fails closed on identified data: populated identifier headers
without PatientIdentityRemoved=YES are refused. Identifier values are never
printed or stored.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage

DICOM_IDENTIFIER_TAGS = [
    "PatientName", "PatientID", "OtherPatientIDs", "PatientBirthDate",
    "PatientAddress", "PatientTelephoneNumbers", "AccessionNumber",
    "ReferringPhysicianName", "PerformingPhysicianName", "OperatorsName",
    "InstitutionName", "InstitutionAddress", "StationName",
]

UNCOMPRESSED_SYNTAXES = {
    "1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2", "1.2.840.10008.1.2.1.99",
}


@dataclass
class Volume:
    data: np.ndarray
    affine: np.ndarray
    meta: dict = field(default_factory=dict)

    @property
    def spacing(self) -> tuple[float, float, float]:
        return tuple(float(np.linalg.norm(self.affine[:3, i])) for i in range(3))

    @property
    def voxel_ml(self) -> float:
        return float(np.prod(self.spacing)) / 1000.0

    def to_nifti(self, path: Path) -> Path:
        img = nib.Nifti1Image(self.data, self.affine)
        img.header.set_xyzt_units("mm")
        nib.save(img, str(path))
        return Path(path)


def load_nifti(path: Path, dtype=None) -> Volume:
    """Load a NIfTI and reorient to canonical RAS (+X right, +Y anterior, +Z superior)."""
    img = nib.as_closest_canonical(nib.load(str(path)))
    arr = np.asarray(img.dataobj)
    if dtype is not None:
        arr = np.rint(arr).astype(dtype) if np.issubdtype(dtype, np.integer) else arr.astype(dtype)
    return Volume(arr, np.asarray(img.affine, float), {"source": str(path)})


def resample_labels_to(src: Volume, dst: Volume) -> np.ndarray:
    """Nearest-neighbour resample of a label volume onto another grid (same frame of reference)."""
    if src.data.shape == dst.data.shape and np.allclose(src.affine, dst.affine, atol=1e-3):
        return src.data
    m = np.linalg.inv(src.affine) @ dst.affine
    return ndimage.affine_transform(src.data, m[:3, :3], offset=m[:3, 3],
                                    output_shape=dst.data.shape, order=0, mode="constant", cval=0)


# ---------------------------------------------------------------------------
# DICOM
# ---------------------------------------------------------------------------
def identity_audit(ds) -> dict:
    present = [t for t in DICOM_IDENTIFIER_TAGS if str(ds.get(t, "")).strip()]
    removed = str(ds.get("PatientIdentityRemoved", "")).strip().upper() == "YES"
    return {"identifiersPresent": present, "identityRemoved": removed,
            "deidentificationMethod": str(ds.get("DeidentificationMethod", "")),
            "ok": removed or not present}


def read_dicom_series(dicom_dir: Path) -> dict[str, dict]:
    """Group CT slices under a folder by SeriesInstanceUID (headers only)."""
    import pydicom
    series: dict[str, dict] = {}
    for p in sorted(Path(dicom_dir).rglob("*")):
        if not p.is_file() or p.suffix.lower() in (".json", ".md", ".txt", ".nii", ".gz", ".png", ".csv"):
            continue
        try:
            ds = pydicom.dcmread(str(p), stop_before_pixels=True)
        except Exception:
            continue
        if str(ds.get("Modality", "")) != "CT" or "ImagePositionPatient" not in ds:
            continue
        iop = np.asarray([float(v) for v in ds.ImageOrientationPatient])
        normal = np.cross(iop[:3], iop[3:])
        pos = float(np.dot([float(v) for v in ds.ImagePositionPatient], normal))
        e = series.setdefault(str(ds.SeriesInstanceUID), {"slices": [], "ds": ds})
        e["slices"].append((pos, str(p)))
    for uid, e in series.items():
        e["slices"].sort()
        ds = e["ds"]
        ts = str(ds.file_meta.get("TransferSyntaxUID", "")) if hasattr(ds, "file_meta") else ""
        e["files"] = [s[1] for s in e["slices"]]
        e["meta"] = {
            "seriesUid": uid,
            "seriesNumber": str(ds.get("SeriesNumber", "")),
            "description": str(ds.get("SeriesDescription", "")),
            "protocol": str(ds.get("ProtocolName", "")),
            "contrastAgent": str(ds.get("ContrastBolusAgent", "")),
            "slices": len(e["files"]),
            "compressed": ts not in UNCOMPRESSED_SYNTAXES,
            "transferSyntax": ts,
            "identity": identity_audit(ds),
        }
        del e["slices"], e["ds"]
    return series


def lps_grid_to_ras_affine(ipp0, iop, pixel_spacing, dz) -> np.ndarray:
    iop = np.asarray(iop, float)
    xdir, ydir = iop[:3], iop[3:]
    normal = np.cross(xdir, ydir)
    lps = np.eye(4)
    lps[:3, 0] = xdir * float(pixel_spacing[1])
    lps[:3, 1] = ydir * float(pixel_spacing[0])
    lps[:3, 2] = normal * float(dz)
    lps[:3, 3] = np.asarray(ipp0, float)
    return np.diag([-1.0, -1.0, 1.0, 1.0]) @ lps


def load_dicom_series(files: list[str]) -> Volume:
    """Stack one series into a Hounsfield-unit Volume with a patient-space affine.
    Refuses identified data."""
    import pydicom
    slices = [pydicom.dcmread(f) for f in files]
    first = slices[0]
    audit = identity_audit(first)
    if not audit["ok"]:
        raise PermissionError(
            "DICOM headers still carry identifiers (" + ", ".join(audit["identifiersPresent"]) +
            ") and PatientIdentityRemoved is not YES. Refusing to process.")
    iop = np.asarray([float(v) for v in first.ImageOrientationPatient])
    normal = np.cross(iop[:3], iop[3:])
    ipps = np.array([[float(v) for v in s.ImagePositionPatient] for s in slices])
    order = np.argsort(ipps @ normal)
    slices = [slices[i] for i in order]
    ipps = ipps[order]
    pos = ipps @ normal
    dz = float(np.median(np.diff(pos))) if len(pos) > 1 else float(first.get("SliceThickness", 1.0))
    ps = [float(v) for v in first.PixelSpacing]
    vol = np.zeros((int(first.Columns), int(first.Rows), len(slices)), np.int16)
    for k, s in enumerate(slices):
        hu = s.pixel_array.astype(np.float32) * float(s.get("RescaleSlope", 1) or 1) + float(s.get("RescaleIntercept", 0) or 0)
        vol[:, :, k] = np.clip(np.rint(hu), -32768, 32767).astype(np.int16).T
    affine = lps_grid_to_ras_affine(ipps[0], iop, ps, dz)
    v = Volume(vol, affine, {"description": str(first.get("SeriesDescription", "")),
                              "slices": len(slices), "identity": audit})
    # canonicalise like load_nifti so all volumes share one convention
    img = nib.as_closest_canonical(nib.Nifti1Image(v.data, v.affine))
    return Volume(np.asarray(img.dataobj), np.asarray(img.affine, float), v.meta)
