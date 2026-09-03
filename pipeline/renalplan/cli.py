"""renalplan command line.

  renalplan case      --labels seg.nii.gz [--ct ct.nii.gz | --dicom DIR] --out DIR
  renalplan batch     --kits DIR --out DIR            (every case_*/segmentation.nii.gz)
  renalplan evaluate  --pred DIR --ref DIR --out DIR  (KiTS regions, bootstrap CIs, plots)
  renalplan optimise-postprocess --pred DIR --ref DIR --out DIR
  renalplan optimise-mesh --kits DIR --out DIR
  renalplan phantom   --out DIR                       (synthetic kidney + tumour for tests)
"""
from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np

from . import DISCLAIMER, __version__
from .io import Volume, load_nifti, load_dicom_series, read_dicom_series, resample_labels_to
from .metrics import kits_region_metrics, overlap_metrics, bootstrap_mean_ci
from .mesh import MeshParams, mask_to_mesh, fidelity, scene_from
from .nephrometry import build_geometry, renal_score, padua_score
from .planning import plan
from .postprocess import PostprocessConfig, apply as postprocess_apply, grid as pp_grid, KIDNEY, TUMOUR, CYST
from .report import COLOURS, manifest_entry, write_planning_json, write_report_md, overview_png
from .segment import extract_vessels, body_outline, save_labels


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def crop_to(labels: Volume, others: list[Volume | None], margin_mm: float = 25.0):
    """Crop every volume to the bounding box of labels>0 plus a margin, so the
    distance transforms run on a few million voxels instead of 160 million."""
    idx = np.argwhere(labels.data > 0)
    if idx.size == 0:
        return labels, others
    sp = np.asarray(labels.spacing)
    pad = np.ceil(margin_mm / sp).astype(int)
    lo = np.maximum(idx.min(0) - pad, 0)
    hi = np.minimum(idx.max(0) + pad + 1, labels.data.shape)
    sl = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))
    aff = labels.affine.copy()
    aff[:3, 3] = (labels.affine @ np.array([*lo, 1.0]))[:3]

    def crop(v: Volume | None):
        if v is None:
            return None
        data = v.data if (v.data.shape == labels.data.shape and np.allclose(v.affine, labels.affine, atol=1e-3)) \
            else resample_labels_to(v, labels) if v.data.dtype.kind in "ui" else None
        if data is None:
            raise ValueError("volume grid differs from the label grid; resample first")
        return Volume(data[sl], aff, v.meta)

    return Volume(labels.data[sl], aff, labels.meta), [crop(o) for o in others]


def load_ct(args) -> Volume | None:
    if args.ct:
        return load_nifti(args.ct, dtype=np.int16)
    if args.dicom:
        series = read_dicom_series(args.dicom)
        if not series:
            raise FileNotFoundError(f"no CT series under {args.dicom}")
        pick = max(series.values(), key=lambda e: e["meta"]["slices"])
        if args.series:
            for e in series.values():
                if args.series.lower() in e["meta"]["description"].lower():
                    pick = e
        if pick["meta"]["compressed"]:
            raise RuntimeError("compressed DICOM; request an uncompressed export")
        return load_dicom_series(pick["files"])
    return None


def run_case(labels: Volume, ct: Volume | None, out_dir: Path, case_id: str, *,
             margin_mm: float = 5.0, mesh_params: MeshParams = MeshParams(),
             postprocess: PostprocessConfig | None = None, reference: Volume | None = None,
             collecting: Volume | None = None, vessels_auto: bool = False, render_ct: bool = False,
             label: str | None = None, source: str = "Segmentation labels", write_glb: bool = True) -> dict:
    t0 = time.time()
    out_dir = Path(out_dir) / case_id
    out_dir.mkdir(parents=True, exist_ok=True)
    labels, (ct_c, ref_c, cs_c) = crop_to(labels, [ct, reference, collecting])
    lab = labels.data.astype(np.uint8)
    if postprocess is not None:
        lab = postprocess_apply(lab, labels.spacing, postprocess)
    sp, aff = labels.spacing, labels.affine
    cs = (cs_c.data > 0) if cs_c is not None else None
    vessels = None
    if vessels_auto and ct_c is not None:
        vessels = extract_vessels(ct_c, lab == KIDNEY)

    g = build_geometry(lab, aff, sp, collecting=cs)
    renal = renal_score(g, collecting=cs, vessels=vessels)
    padua = padua_score(g, renal, collecting=cs)
    planning, pmasks = plan(lab, g, margin_mm=margin_mm, collecting=cs, vessels=vessels)

    metrics = None
    if ref_c is not None:
        metrics = {k: m.as_dict() for k, m in kits_region_metrics(lab, ref_c.data.astype(np.uint8), sp).items()}

    named = {
        "parenchyma": g.kidney, "contralateral": (lab == KIDNEY) & ~g.kidney, "tumour": g.tumour,
        "cyst": lab == CYST, "sinus": g.sinus, "margin_envelope": pmasks["margin_envelope"],
        "residual_parenchyma": pmasks["residual_parenchyma"],
    }
    if vessels is not None and vessels.any():
        named["vessels"] = vessels
    if cs is not None and cs.any():
        named["collecting_system"] = cs
    if ct_c is not None:
        named["skin"] = body_outline(ct_c)
    present = []
    if write_glb:
        meshes = {}
        for name, m in named.items():
            if not m.any():
                continue
            tf = {"tumour": 8000, "cyst": 6000, "vessels": 15000, "skin": 12000}.get(name, mesh_params.target_faces)
            mp = MeshParams(**{**mesh_params.as_dict(), "target_faces": tf,
                               "keep_largest": name not in ("vessels", "cyst", "contralateral")})
            meshes[name] = mask_to_mesh(m, aff, mp)
            if meshes[name] is not None:
                present.append(name)
        scene = scene_from(meshes, COLOURS)
        scene.export(str(out_dir / f"{case_id}.glb"))
    provenance = {"labels": labels.meta.get("source", ""), "ct": (ct.meta.get("source") if ct else None),
                  "postprocess": postprocess.as_dict() if postprocess else None,
                  "mesh": mesh_params.as_dict(), "spacingMm": [round(s, 3) for s in sp],
                  "runtimeSeconds": None}
    doc = write_planning_json(out_dir / "planning.json", case_id, renal, padua, planning, g.notes, provenance, metrics)
    write_report_md(out_dir / "report.md", doc)
    (out_dir / "manifest_entry.json").write_text(json.dumps(manifest_entry(
        case_id, label or case_id, source, present,
        {"planning": {"renal": renal.label(), "padua": padua.total, "marginMm": margin_mm}}), indent=2))
    overview_png(out_dir / "overview.png", lab, sp, ct=(ct_c.data if (render_ct and ct_c is not None) else None),
                 extra={"margin_envelope": pmasks["margin_envelope"]}, title=f"{case_id}: RENAL {renal.label()}, PADUA {padua.total}")
    doc["provenance"]["runtimeSeconds"] = round(time.time() - t0, 1)
    (out_dir / "planning.json").write_text(json.dumps(doc, indent=2, default=str))
    print(f"[case] {case_id}: RENAL {renal.label()} ({renal.complexity}), PADUA {padua.total} ({padua.complexity}); "
          f"tumour {planning.tumour_ml:.1f} ml; residual {100 * planning.preserved_fraction_ipsilateral:.0f}% "
          f"at {margin_mm:.0f} mm margin; {doc['provenance']['runtimeSeconds']} s")
    return doc


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------
def cmd_case(a):
    labels = load_nifti(a.labels, dtype=np.uint8)
    ct = load_ct(a)
    ref = load_nifti(a.reference, dtype=np.uint8) if a.reference else None
    cs = load_nifti(a.collecting, dtype=np.uint8) if a.collecting else None
    pp = PostprocessConfig(**json.loads(Path(a.postprocess).read_text())) if a.postprocess else (PostprocessConfig() if a.default_postprocess else None)
    run_case(labels, ct, a.out, a.case_id or Path(a.labels).parent.name, margin_mm=a.margin, postprocess=pp,
             reference=ref, collecting=cs, vessels_auto=a.vessels, render_ct=a.render_ct,
             label=a.label, source=a.source, write_glb=not a.no_glb)


def cmd_batch(a):
    rows = []
    for c in sorted(Path(a.kits).glob("case_*")):
        seg = c / "segmentation.nii.gz"
        if not seg.exists():
            continue
        if a.limit and len(rows) >= a.limit:
            break
        img = c / "imaging.nii.gz"
        ct = load_nifti(img, dtype=np.int16) if (img.exists() and not a.no_ct) else None
        try:
            doc = run_case(load_nifti(seg, dtype=np.uint8), ct, a.out, c.name, margin_mm=a.margin,
                           vessels_auto=(ct is not None and a.vessels), render_ct=a.render_ct,
                           label=f"KiTS23 {c.name}", source="KiTS23 reference labels", write_glb=not a.no_glb)
        except Exception as e:  # keep going; record the failure
            print(f"[batch] {c.name} FAILED: {e}")
            rows.append({"case_id": c.name, "status": f"failed: {e}"})
            continue
        r, p, pl = doc["nephrometry"]["renal"], doc["nephrometry"]["padua"], doc["planning"]
        rows.append({
            "case_id": c.name, "status": "ok", "renal": doc["nephrometry"]["renalLabel"], "renal_total": r["total"],
            "renal_complexity": r["complexity"], "R_cm": r["radius_cm"], "E_exophytic_frac": r["exophytic_fraction"],
            "N_mm": r["nearness_mm"], "A": r["ap"], "L_pts": r["location_pts"], "padua_total": p["total"],
            "padua_complexity": p["complexity"], "tumour_ml": round(pl["tumour_ml"], 1),
            "ipsi_kidney_ml": round(pl["ipsilateral_kidney_ml"], 1), "contra_kidney_ml": round(pl["contralateral_kidney_ml"], 1),
            "resection_ml": round(pl["resection_ml"], 1), "preserved_pct": round(100 * pl["preserved_fraction_ipsilateral"], 1),
            "contact_cm2": round(pl["contact_surface_area_cm2"], 1), "tumour_to_sinus_mm": pl["tumour_to_sinus_mm"],
            "runtime_s": doc["provenance"]["runtimeSeconds"],
        })
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    keys = sorted({k for r in rows for k in r}, key=lambda k: (k != "case_id", k))
    with open(out / "nephrometry.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)
    print(f"[batch] wrote {out / 'nephrometry.csv'} ({len(rows)} cases)")


def _pairs(pred_dir: Path, ref_dir: Path, cases: list[str] | None = None):
    """Match prediction and reference NIfTIs by case id (case_XXXXX)."""
    import re
    pat = re.compile(r"case_\d{5}")
    refs = {}
    for p in Path(ref_dir).rglob("*.nii.gz"):
        m = pat.search(str(p))
        if m and ("segmentation" in p.name or p.parent.name == m.group(0) or p.name.startswith("case_")):
            refs[m.group(0)] = p
    pairs = []
    for p in sorted(Path(pred_dir).rglob("*.nii.gz")):
        m = pat.search(str(p))
        if m and m.group(0) in refs and (not cases or m.group(0) in cases):
            pairs.append((m.group(0), p, refs[m.group(0)]))
    return pairs


def _eval_one(pred: Volume, ref: Volume, pp: PostprocessConfig | None):
    ref_c, (pred_c,) = crop_to(ref, [pred], margin_mm=40.0)
    # union crop: extend to prediction extent too (false positives far away count)
    pl = pred_c.data.astype(np.uint8)
    if pp is not None:
        pl = postprocess_apply(pl, ref_c.spacing, pp)
    return kits_region_metrics(pl, ref_c.data.astype(np.uint8), ref_c.spacing)


def cmd_evaluate(a):
    pairs = _pairs(a.pred, a.ref, a.cases)
    if not pairs:
        raise SystemExit("no matching prediction/reference pairs")
    pp = PostprocessConfig(**json.loads(Path(a.postprocess).read_text())) if a.postprocess else None
    rows = []
    for cid, pp_path, ref_path in pairs:
        pred, ref = load_nifti(pp_path, dtype=np.uint8), load_nifti(ref_path, dtype=np.uint8)
        if pred.data.shape != ref.data.shape:
            pred = Volume(resample_labels_to(pred, ref), ref.affine, pred.meta)
        m = _eval_one(pred, ref, pp)
        row = {"case_id": cid}
        for k, v in m.items():
            for f in ("dice", "surface_dice", "hd95_mm", "volume_error_ml"):
                row[f"{k}_{f}"] = round(getattr(v, f), 4)
        rows.append(row)
        print(f"[eval] {cid}: " + ", ".join(f"{k} dice={v.dice:.3f} hd95={v.hd95_mm:.1f}" for k, v in m.items()))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "per_case.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    summary = {"cases": len(rows), "postprocess": pp.as_dict() if pp else None, "regions": {}}
    for k in ("kidney_and_mass", "mass", "tumour"):
        summary["regions"][k] = {}
        for f in ("dice", "surface_dice", "hd95_mm", "volume_error_ml"):
            vals = [r[f"{k}_{f}"] for r in rows]
            mean, lo, hi = bootstrap_mean_ci([abs(v) if f == "volume_error_ml" else v for v in vals])
            summary["regions"][k][f] = {"mean": mean, "ci95": [lo, hi]}
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    _plot_eval(rows, out / "dice_per_case.png")
    print(f"[eval] summary -> {out / 'summary.json'}")


def _plot_eval(rows, path: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    regions = ["kidney_and_mass", "mass", "tumour"]
    x = np.arange(len(rows))
    fig, ax = plt.subplots(figsize=(max(6, 0.5 * len(rows) + 3), 3.8))
    for i, k in enumerate(regions):
        ax.bar(x + (i - 1) * 0.27, [r[f"{k}_dice"] for r in rows], width=0.27, label=k.replace("_", " "))
    ax.set_xticks(x, [r["case_id"] for r in rows], rotation=45, ha="right", fontsize=8)
    ax.set_ylim(0, 1), ax.set_ylabel("Dice"), ax.legend(fontsize=8, frameon=False)
    ax.set_title("Dice per case (KiTS23 regions)", fontsize=10)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def cmd_optimise_postprocess(a):
    pairs = _pairs(a.pred, a.ref, a.cases)
    if not pairs:
        raise SystemExit("no matching prediction/reference pairs")
    loaded = []
    for cid, pp_path, ref_path in pairs[: a.limit or None]:
        pred, ref = load_nifti(pp_path, dtype=np.uint8), load_nifti(ref_path, dtype=np.uint8)
        if pred.data.shape != ref.data.shape:
            pred = Volume(resample_labels_to(pred, ref), ref.affine, pred.meta)
        ref_c, (pred_c,) = crop_to(ref, [pred], margin_mm=40.0)
        loaded.append((cid, pred_c, ref_c))
    configs = [None] + pp_grid()
    results = []
    for cfg in configs:
        per = {k: [] for k in ("kidney_and_mass", "mass", "tumour")}
        for cid, pred_c, ref_c in loaded:
            pl = pred_c.data.astype(np.uint8)
            if cfg is not None:
                pl = postprocess_apply(pl, ref_c.spacing, cfg)
            m = kits_region_metrics(pl, ref_c.data.astype(np.uint8), ref_c.spacing)
            for k, v in m.items():
                per[k].append((v.dice, v.hd95_mm, v.surface_dice))
        row = {"config": cfg.name() if cfg else "none", "params": cfg.as_dict() if cfg else None}
        for k, vals in per.items():
            arr = np.array(vals, float)
            row[f"{k}_dice"] = float(np.nanmean(arr[:, 0]))
            row[f"{k}_hd95"] = float(np.nanmean(arr[:, 1]))
            row[f"{k}_sdice"] = float(np.nanmean(arr[:, 2]))
        row["objective"] = float(np.mean([row[f"{k}_dice"] for k in per]))
        results.append(row)
        print(f"[opt] {row['config']:48s} dice(k+m/m/t)={row['kidney_and_mass_dice']:.3f}/{row['mass_dice']:.3f}/{row['tumour_dice']:.3f} "
              f"hd95(t)={row['tumour_hd95']:.1f}")
    results.sort(key=lambda r: -r["objective"])
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "postprocess_sweep.json").write_text(json.dumps({"cases": [c for c, _, _ in loaded], "results": results}, indent=2))
    best = results[0]
    (out / "best_postprocess.json").write_text(json.dumps(best["params"] or PostprocessConfig().as_dict(), indent=2))
    print(f"[opt] best: {best['config']} (mean Dice {best['objective']:.4f}); baseline none = "
          f"{next(r['objective'] for r in results if r['config'] == 'none'):.4f}")


def cmd_optimise_mesh(a):
    """Sweep smoothing and decimation; score each mesh against its own mask."""
    cases = sorted(Path(a.kits).glob("case_*/segmentation.nii.gz"))
    if a.cases:
        cases = [c for c in cases if c.parent.name in a.cases]
    cases = cases[: a.limit or None]
    sweep = []
    iters = [0, 10, 25]
    faces = [4000, 10000, 20000, 40000]
    for seg in cases:
        labels = load_nifti(seg, dtype=np.uint8)
        labels, _ = crop_to(labels, [], margin_mm=10.0)
        for structure, lab in (("kidney", KIDNEY), ("tumour", TUMOUR)):
            mask = labels.data == lab
            if mask.sum() < 50:
                continue
            for it in iters:
                for tf in faces:
                    # keep every component so a two-kidney label is scored fairly
                    p = MeshParams(taubin_iter=it, target_faces=tf, keep_largest=False)
                    t0 = time.time()
                    mesh = mask_to_mesh(mask, labels.affine, p)
                    if mesh is None:
                        continue
                    fm = fidelity(mesh, mask, labels.affine, labels.spacing)
                    sweep.append({"case_id": seg.parent.name, "structure": structure, "taubin_iter": it, "target_faces": tf,
                                  "faces": int(len(mesh.faces)), "dice": round(fm.dice, 4), "hd95_mm": round(fm.hd95_mm, 3),
                                  "assd_mm": round(fm.assd_mm, 3), "volume_error_pct": round(fm.volume_error_pct, 2),
                                  "seconds": round(time.time() - t0, 2)})
                    print(f"[mesh] {seg.parent.name} {structure:7s} taubin={it:2d} faces={tf:6d}->{len(mesh.faces):6d} "
                          f"dice={fm.dice:.4f} hd95={fm.hd95_mm:.2f} vol={fm.volume_error_pct:+.1f}%")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "mesh_sweep.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(sweep[0]))
        w.writeheader()
        w.writerows(sweep)
    # recommendation: smallest face budget whose mean Dice >= 0.97 and |vol err| <= 3% at the smoothing that minimises HD95
    rec = {}
    for structure in ("kidney", "tumour"):
        rows = [r for r in sweep if r["structure"] == structure]
        best = None
        for it in iters:
            for tf in faces:
                sel = [r for r in rows if r["taubin_iter"] == it and r["target_faces"] == tf]
                if not sel:
                    continue
                d, v, h = np.mean([r["dice"] for r in sel]), np.mean([abs(r["volume_error_pct"]) for r in sel]), np.mean([r["hd95_mm"] for r in sel])
                ok = d >= a.min_dice and v <= a.max_vol_err
                cand = (tf, h, it)
                if ok and (best is None or cand < best[0]):
                    best = (cand, {"taubin_iter": it, "target_faces": tf, "mean_dice": round(float(d), 4),
                                   "mean_hd95_mm": round(float(h), 3), "mean_abs_volume_error_pct": round(float(v), 2)})
        rec[structure] = best[1] if best else None
    (out / "mesh_recommendation.json").write_text(json.dumps({"criteria": {"min_dice": a.min_dice, "max_abs_volume_error_pct": a.max_vol_err},
                                                             "recommended": rec}, indent=2))
    _plot_mesh(sweep, out / "mesh_sweep.png")
    print(f"[mesh] recommendation -> {rec}")


def _plot_mesh(sweep, path: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8))
    for ax, structure in zip(axes, ("kidney", "tumour")):
        rows = [r for r in sweep if r["structure"] == structure]
        for it in sorted({r["taubin_iter"] for r in rows}):
            sel = sorted([r for r in rows if r["taubin_iter"] == it], key=lambda r: r["faces"])
            xs = sorted({r["target_faces"] for r in sel})
            ys = [np.mean([r["dice"] for r in sel if r["target_faces"] == x]) for x in xs]
            ax.plot(xs, ys, marker="o", ms=3, label=f"Taubin {it}")
        ax.set_xscale("log"), ax.set_xlabel("target faces"), ax.set_ylabel("Dice vs mask")
        ax.set_title(f"{structure}: mesh fidelity", fontsize=10)
        ax.legend(fontsize=7, frameon=False)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def cmd_perturb(a):
    """Simulate model-like errors on reference labels so the evaluation and
    post-processing tools can be exercised without a GPU. Output is labelled
    SIMULATED; it is not a model prediction and must never be reported as one."""
    from scipy import ndimage
    rng = np.random.default_rng(a.seed)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cases = sorted(Path(a.kits).glob("case_*/segmentation.nii.gz"))[: a.limit or None]
    log = []
    for seg in cases:
        ref = load_nifti(seg, dtype=np.uint8)
        lab = ref.data.copy()
        sp = ref.spacing
        # 1. boundary noise: random dilation/erosion of the kidney by 1 voxel in patches
        kidney = lab == KIDNEY
        noise = ndimage.gaussian_filter(rng.normal(size=lab.shape).astype(np.float32), sigma=6)
        grow = (noise > 0.6) & ndimage.binary_dilation(kidney, iterations=1) & ~kidney
        shrink = (noise < -0.6) & kidney & ~ndimage.binary_erosion(kidney, iterations=1)
        kidney = (kidney | grow) & ~shrink
        # 2. tumour under-segmentation: erode the tumour by one voxel
        tumour = ndimage.binary_erosion(lab == TUMOUR, iterations=1) if a.tumour_erode else (lab == TUMOUR)
        # 3. spurious far components (liver/spleen-like false positives), the error that inflates HD95
        far = np.zeros_like(kidney)
        idx = np.argwhere(lab > 0)
        lo, hi = idx.min(0), idx.max(0)
        for _ in range(a.spurious):
            c = np.array([rng.integers(max(0, lo[i] - 80), min(lab.shape[i] - 1, hi[i] + 80)) for i in range(3)])
            r = rng.integers(3, 9)
            sl = tuple(slice(max(0, c[i] - r), min(lab.shape[i], c[i] + r)) for i in range(3))
            far[sl] = True
        far &= ~ndimage.binary_dilation(kidney, iterations=8)
        spurious_mass = far & (rng.random(lab.shape) < 0.3)
        # 4. holes inside the kidney
        holes = (ndimage.gaussian_filter(rng.normal(size=lab.shape).astype(np.float32), sigma=3) > 1.6) & ndimage.binary_erosion(kidney, iterations=3)
        kidney &= ~holes
        pred = np.zeros_like(lab)
        pred[kidney | (far & ~spurious_mass)] = KIDNEY
        pred[lab == CYST] = CYST
        pred[tumour | spurious_mass] = TUMOUR
        cdir = out / seg.parent.name
        cdir.mkdir(parents=True, exist_ok=True)
        save_labels(Volume(pred, ref.affine), cdir / "prediction.nii.gz")
        log.append({"case_id": seg.parent.name, "spurious_components": int(a.spurious), "holes_voxels": int(holes.sum())})
        print(f"[perturb] {seg.parent.name}: SIMULATED errors written -> {cdir / 'prediction.nii.gz'}")
    (out / "SIMULATED.json").write_text(json.dumps({
        "warning": "These label maps are reference labels with SIMULATED errors (boundary noise, holes, "
                   "tumour erosion, spurious far components). They are not model predictions.",
        "seed": a.seed, "cases": log}, indent=2))


def cmd_phantom(a):
    from .phantom import write_phantom
    write_phantom(Path(a.out), seed=a.seed)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="renalplan", description=f"renalplan {__version__}. {DISCLAIMER}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("case", help="one case: labels (+CT) -> nephrometry, planning, meshes")
    c.add_argument("--labels", type=Path, required=True, help="KiTS-style label NIfTI (1 kidney, 2 tumour, 3 cyst)")
    c.add_argument("--ct", type=Path, help="CT NIfTI (optional; enables vessels and body outline)")
    c.add_argument("--dicom", type=Path, help="DICOM folder instead of --ct (de-identified only)")
    c.add_argument("--series", help="substring of the DICOM series description to use")
    c.add_argument("--reference", type=Path, help="reference labels to score the input labels against")
    c.add_argument("--collecting", type=Path, help="collecting-system mask (excretory phase), optional")
    c.add_argument("--postprocess", type=Path, help="PostprocessConfig JSON to apply to the labels")
    c.add_argument("--default-postprocess", action="store_true", help="apply the default clean-up rules")
    c.add_argument("--vessels", action="store_true", help="extract hilar vessels from the CT by threshold")
    c.add_argument("--margin", type=float, default=5.0, help="illustrative resection margin (mm)")
    c.add_argument("--render-ct", action="store_true", help="draw CT pixels in overview.png (research only)")
    c.add_argument("--no-glb", action="store_true")
    c.add_argument("--case-id"), c.add_argument("--label"), c.add_argument("--source", default="Segmentation labels")
    c.add_argument("--out", type=Path, required=True)
    c.set_defaults(fn=cmd_case)

    b = sub.add_parser("batch", help="every case_*/segmentation.nii.gz under a KiTS folder")
    b.add_argument("--kits", type=Path, required=True), b.add_argument("--out", type=Path, required=True)
    b.add_argument("--margin", type=float, default=5.0), b.add_argument("--limit", type=int)
    b.add_argument("--vessels", action="store_true"), b.add_argument("--no-ct", action="store_true")
    b.add_argument("--render-ct", action="store_true"), b.add_argument("--no-glb", action="store_true")
    b.set_defaults(fn=cmd_batch)

    e = sub.add_parser("evaluate", help="score predictions against references (KiTS regions)")
    e.add_argument("--pred", type=Path, required=True), e.add_argument("--ref", type=Path, required=True)
    e.add_argument("--postprocess", type=Path), e.add_argument("--out", type=Path, required=True)
    e.add_argument("--cases", nargs="*", help="restrict to these case ids")
    e.set_defaults(fn=cmd_evaluate)

    o = sub.add_parser("optimise-postprocess", help="grid-search clean-up rules for mean Dice")
    o.add_argument("--pred", type=Path, required=True), o.add_argument("--ref", type=Path, required=True)
    o.add_argument("--out", type=Path, required=True), o.add_argument("--limit", type=int)
    o.add_argument("--cases", nargs="*", help="restrict to these case ids")
    o.set_defaults(fn=cmd_optimise_postprocess)

    m = sub.add_parser("optimise-mesh", help="sweep smoothing/decimation against mask fidelity")
    m.add_argument("--kits", type=Path, required=True), m.add_argument("--out", type=Path, required=True)
    m.add_argument("--limit", type=int), m.add_argument("--min-dice", type=float, default=0.97)
    m.add_argument("--max-vol-err", type=float, default=3.0)
    m.add_argument("--cases", nargs="*", help="restrict to these case ids")
    m.set_defaults(fn=cmd_optimise_mesh)

    q = sub.add_parser("perturb", help="SIMULATED model errors on reference labels (tooling test only)")
    q.add_argument("--kits", type=Path, required=True), q.add_argument("--out", type=Path, required=True)
    q.add_argument("--limit", type=int), q.add_argument("--seed", type=int, default=1)
    q.add_argument("--spurious", type=int, default=3), q.add_argument("--tumour-erode", action="store_true")
    q.set_defaults(fn=cmd_perturb)

    p = sub.add_parser("phantom", help="synthetic kidney+tumour case for tests and demos")
    p.add_argument("--out", type=Path, required=True), p.add_argument("--seed", type=int, default=0)
    p.set_defaults(fn=cmd_phantom)

    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
