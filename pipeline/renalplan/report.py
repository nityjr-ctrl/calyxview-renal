"""Case bundle and reports.

A case bundle is a folder:
    <case_id>/
      <case_id>.glb          named meshes (parenchyma, tumour, cyst, contralateral,
                             margin_envelope, residual_parenchyma, vessels, ...)
      planning.json          nephrometry + planning metrics + provenance
      manifest_entry.json    a CalyxView-viewer manifest entry for the GLB
      report.md              human-readable summary
      overview.png           three-plane mask overlay (mask-only, no CT pixels
                             unless --render-ct is passed)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import DISCLAIMER, __version__

COLOURS = {
    "parenchyma": [196, 170, 140, 90],
    "contralateral": [196, 170, 140, 60],
    "tumour": [216, 92, 96, 255],
    "cyst": [96, 168, 214, 235],
    "margin_envelope": [255, 205, 40, 110],
    "residual_parenchyma": [120, 190, 140, 140],
    "sinus": [230, 200, 120, 90],
    "vessels": [200, 40, 40, 255],
    "collecting_system": [210, 60, 60, 255],
    "skin": [210, 180, 160, 35],
}
LABELS = {
    "parenchyma": "Kidney (tumour side)",
    "contralateral": "Contralateral kidney",
    "tumour": "Tumour",
    "cyst": "Cyst",
    "margin_envelope": "Resection margin envelope",
    "residual_parenchyma": "Residual parenchyma",
    "sinus": "Renal sinus (approx.)",
    "vessels": "Hilar vessels",
    "collecting_system": "Collecting system",
    "skin": "Body outline",
}
DEFAULT_VISIBLE = {"parenchyma", "contralateral", "tumour", "cyst", "vessels", "collecting_system"}


def _hex(rgba) -> str:
    return "#{:02x}{:02x}{:02x}".format(*[int(v) for v in rgba[:3]])


def manifest_entry(case_id: str, label: str, source: str, present: list[str],
                   extra: dict | None = None) -> dict:
    structures = []
    for name in present:
        rgba = COLOURS.get(name, [200, 200, 200, 255])
        structures.append({
            "name": name, "label": LABELS.get(name, name), "colour": _hex(rgba),
            "opacity": round(rgba[3] / 255.0, 2), "visible": name in DEFAULT_VISIBLE,
        })
    entry = {"id": case_id, "label": label, "source": source,
             "glb": f"models/{case_id}.glb", "axes": "RAS", "structures": structures}
    if extra:
        entry.update(extra)
    return entry


def write_planning_json(path: Path, case_id: str, renal, padua, planning, geometry_notes,
                        provenance: dict, metrics: dict | None = None) -> dict:
    doc = {
        "schemaVersion": 1,
        "tool": f"renalplan {__version__}",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
        "caseId": case_id,
        "provenance": provenance,
        "nephrometry": {
            "renal": renal.as_dict(), "renalLabel": renal.label(),
            "padua": padua.as_dict(),
            "assumptions": geometry_notes,
        },
        "planning": planning.as_dict(),
    }
    if metrics:
        doc["segmentationMetrics"] = metrics
    Path(path).write_text(json.dumps(doc, indent=2, default=_json_default))
    return doc


def _json_default(o):
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def write_report_md(path: Path, doc: dict) -> None:
    n = doc["nephrometry"]
    r, p = n["renal"], n["padua"]
    pl = doc["planning"]
    lines = [
        f"# {doc['caseId']}: CT-to-3D partial nephrectomy planning summary",
        "",
        f"> {doc['disclaimer']}",
        "",
        f"Generated {doc['generatedAtUtc']} by {doc['tool']}.",
        "",
        "## Nephrometry (computed from masks)",
        "",
        "| R.E.N.A.L. component | Value | Points |",
        "| --- | --- | --- |",
        f"| R: maximal diameter | {r['radius_cm']:.1f} cm | {r['radius_pts']} |",
        f"| E: exophytic fraction | {100 * r['exophytic_fraction']:.0f}% outside the parenchymal outline | {r['exophytic_pts']} |",
        f"| N: nearness to sinus / collecting system | {r['nearness_mm']:.1f} mm | {r['nearness_pts']} |",
        f"| A: anterior / posterior | {r['ap']} | - |",
        f"| L: polar location | {r['location_detail']} | {r['location_pts']} |",
        f"| Hilar | {'yes' if r['hilar'] else 'no / not assessed'} | - |",
        f"| **Total** | **{n['renalLabel']}** | {r['complexity']} complexity |",
        "",
        "| PADUA component | Value | Points |",
        "| --- | --- | --- |",
        f"| Polar location | {p['polar_location']} | {p['polar_pts']} |",
        f"| Exophytic rate | see above | {p['exophytic_pts']} |",
        f"| Renal rim | {p['rim']} | {p['rim_pts']} |",
        f"| Renal sinus involvement | {'yes' if p['sinus_involved'] else 'no'} | {p['sinus_pts']} |",
        f"| Collecting system involvement | {('yes' if p['collecting_involved'] else 'no') if p['collecting_involved'] is not None else 'not assessed (no excretory phase)'} | {p['collecting_pts']} |",
        f"| Tumour size | {r['radius_cm']:.1f} cm | {p['size_pts']} |",
        f"| **Total** | **{p['total']}** | {p['complexity']} |",
        "",
        "Assumptions: " + " ".join(n["assumptions"]),
        "",
        "## Resection geometry (illustrative)",
        "",
        "| Quantity | Value |",
        "| --- | --- |",
        f"| Tumour volume | {pl['tumour_ml']:.1f} ml |",
        f"| Ipsilateral kidney volume | {pl['ipsilateral_kidney_ml']:.0f} ml |",
        f"| Contralateral kidney volume | {pl['contralateral_kidney_ml']:.0f} ml |",
        f"| Ipsilateral share of total renal volume | {100 * pl['ipsilateral_share_of_total']:.0f}% |",
        f"| Margin modelled | {pl['margin_mm']:.0f} mm uniform |",
        f"| Resection volume (tumour + margin within kidney) | {pl['resection_ml']:.1f} ml |",
        f"| Parenchyma inside the margin | {pl['parenchyma_removed_ml']:.1f} ml |",
        f"| Residual ipsilateral parenchyma | {pl['residual_ipsilateral_ml']:.0f} ml ({100 * pl['preserved_fraction_ipsilateral']:.0f}% preserved) |",
        f"| Tumour-parenchyma contact surface | {pl['contact_surface_area_cm2']:.1f} cm2 |",
        f"| Tumour to sinus | {pl['tumour_to_sinus_mm']:.1f} mm |",
    ]
    if pl.get("tumour_to_vessels_mm") is not None:
        lines.append(f"| Tumour to hilar vessels | {pl['tumour_to_vessels_mm']:.1f} mm |")
    if pl.get("tumour_to_collecting_mm") is not None:
        lines.append(f"| Tumour to collecting system | {pl['tumour_to_collecting_mm']:.1f} mm |")
    lines += ["", "Notes: " + " ".join(pl["notes"]), ""]
    if doc.get("segmentationMetrics"):
        lines += ["## Segmentation vs reference", "", "| Region | Dice | Surface Dice | HD95 (mm) | Volume error (ml) |", "| --- | --- | --- | --- | --- |"]
        for k, m in doc["segmentationMetrics"].items():
            lines.append(f"| {k} | {m['dice']:.3f} | {m['surface_dice']:.3f} | {m['hd95_mm']:.1f} | {m['volume_error_ml']:+.1f} |")
        lines.append("")
    Path(path).write_text("\n".join(lines))


def overview_png(path: Path, labels: np.ndarray, spacing, ct: np.ndarray | None = None,
                 extra: dict[str, np.ndarray] | None = None, title: str = "") -> None:
    """Three orthogonal slices through the tumour centroid, masks as coloured
    overlays. CT pixels are drawn only when `ct` is given (research-only output)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    tum = labels == 2
    src = tum if tum.any() else labels > 0
    c = np.rint(np.argwhere(src).mean(0)).astype(int) if src.any() else np.array(labels.shape) // 2
    sp = np.asarray(spacing)
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.4), facecolor="#0b0b0d")
    planes = [("Axial", (slice(None), slice(None), c[2]), (sp[0], sp[1])),
              ("Coronal", (slice(None), c[1], slice(None)), (sp[0], sp[2])),
              ("Sagittal", (c[0], slice(None), slice(None)), (sp[1], sp[2]))]
    colours = {1: (0.77, 0.67, 0.55), 2: (0.85, 0.36, 0.38), 3: (0.38, 0.66, 0.84)}
    for ax, (name, sl, (dx, dy)) in zip(axes, planes):
        lab2 = labels[sl].T
        ax.set_facecolor("#0b0b0d")
        if ct is not None:
            img = np.clip((ct[sl].T + 160) / 560, 0, 1)
            ax.imshow(img, cmap="gray", origin="lower", aspect=dy / dx)
        rgba = np.zeros(lab2.shape + (4,), float)
        for v, col in colours.items():
            rgba[lab2 == v] = (*col, 0.75)
        if extra:
            for i, (k, m) in enumerate(extra.items()):
                m2 = m[sl].T
                rgba[m2 & (lab2 == 0)] = (1.0, 0.8, 0.16, 0.55) if "margin" in k else (0.78, 0.16, 0.16, 0.8)
        ax.imshow(rgba, origin="lower", aspect=dy / dx, interpolation="nearest")
        ax.set_title(name, color="#ddd", fontsize=10)
        ax.set_xticks([]), ax.set_yticks([])
        for s in ax.spines.values():
            s.set_edgecolor("#333")
    fig.suptitle(title or "Mask overview", color="#eee", fontsize=11)
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", color="#888", fontsize=7)
    fig.tight_layout(rect=(0, 0.04, 1, 0.96))
    fig.savefig(path, dpi=110, facecolor=fig.get_facecolor())
    plt.close(fig)
