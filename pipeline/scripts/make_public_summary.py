#!/usr/bin/env python3
"""Build the aggregate, identifier-free summary the website displays.

Reads pipeline/results/{nephrometry.csv, postprocess/, evaluation/, mesh/} and
writes pipeline/results/summary.public.json. Cases are re-labelled 1..N (the
deploy bundle scan forbids cohort identifiers such as case ids), no paths are
included, and nothing but derived numbers leaves this script.
"""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "results"


def load_csv(p: Path) -> list[dict]:
    with open(p, newline="") as f:
        return list(csv.DictReader(f))


def main() -> None:
    rows = [r for r in load_csv(ROOT / "nephrometry.csv") if r.get("status") == "ok"]
    rows.sort(key=lambda r: r["case_id"])
    cases = []
    for i, r in enumerate(rows, 1):
        cases.append({
            "case": i,
            "renal": r["renal"],
            "renalTotal": int(r["renal_total"]),
            "renalComplexity": r["renal_complexity"],
            "padua": int(r["padua_total"]),
            "paduaComplexity": r["padua_complexity"],
            "tumourMl": round(float(r["tumour_ml"]), 1),
            "diameterCm": round(float(r["R_cm"]), 1),
            "exophyticFraction": round(float(r["E_exophytic_frac"]), 2),
            "tumourToSinusMm": round(float(r["N_mm"]), 1),
            "ipsilateralKidneyMl": round(float(r["ipsi_kidney_ml"])),
            "preservedFraction": round(float(r["preserved_pct"]) / 100.0, 3),
            "runtimeSeconds": round(float(r["runtime_s"]), 1),
        })

    sweep = json.loads((ROOT / "postprocess" / "postprocess_sweep.json").read_text())
    by = {r["config"]: r for r in sweep["results"]}
    best = sweep["results"][0]

    def pp_row(label, r):
        return {"rules": label, "kidneyAndMassDice": round(r["kidney_and_mass_dice"], 3),
                "massDice": round(r["mass_dice"], 3), "tumourDice": round(r["tumour_dice"], 3),
                "tumourHd95Mm": round(r["tumour_hd95"], 1)}

    postprocess = {
        "casesEvaluated": len(sweep["cases"]),
        "configurationsTried": len(sweep["results"]) - 1,
        "inputNote": "Reference labels degraded with simulated errors (boundary noise, holes, one-voxel tumour erosion, three far spurious components per case). Not model output.",
        "rows": [
            pp_row("None (simulated input)", by["none"]),
            pp_row("Drop masses smaller than 0.05 ml", by["k2_kmin0_mmin0.05_att0_fill0_open0"]),
            pp_row("Keep masses within 5 mm of the kidney", by["k2_kmin0_mmin0_att5_fill0_open0"]),
        ],
        "best": {"name": best["config"], "params": best["params"], "meanDice": round(best["objective"], 4)},
        "baselineMeanDice": round(by["none"]["objective"], 4),
    }

    def region_summary(p: Path):
        d = json.loads(p.read_text())["regions"]
        return {k: {f: {"mean": round(v["mean"], 4), "ci95": [round(v["ci95"][0], 4), round(v["ci95"][1], 4)]}
                    for f, v in r.items()} for k, r in d.items()}

    evaluation = {
        "raw": region_summary(ROOT / "evaluation" / "simulated_raw" / "summary.json"),
        "postprocessed": region_summary(ROOT / "evaluation" / "simulated_postprocessed" / "summary.json"),
    }

    mesh_rec = json.loads((ROOT / "mesh" / "mesh_recommendation.json").read_text())
    mesh_rows = load_csv(ROOT / "mesh" / "mesh_sweep.csv")
    agg: dict[tuple, list] = {}
    for r in mesh_rows:
        agg.setdefault((r["structure"], int(r["taubin_iter"]), int(r["target_faces"])), []).append(r)
    mesh_table = []
    for (structure, it, tf), rs in sorted(agg.items()):
        mesh_table.append({
            "structure": structure, "taubinIterations": it, "targetFaces": tf,
            "dice": round(sum(float(x["dice"]) for x in rs) / len(rs), 4),
            "hd95Mm": round(sum(float(x["hd95_mm"]) for x in rs) / len(rs), 2),
            "absVolumeErrorPct": round(sum(abs(float(x["volume_error_pct"])) for x in rs) / len(rs), 2),
        })
    mesh = {"casesEvaluated": len({r["case_id"] for r in mesh_rows}), "criteria": mesh_rec["criteria"],
            "recommended": mesh_rec["recommended"], "table": mesh_table,
            "minDice": round(min(r["dice"] for r in mesh_table), 4),
            "maxAbsVolumeErrorPct": round(max(r["absVolumeErrorPct"] for r in mesh_table), 2)}

    out = {
        "schemaVersion": 1,
        "researchOnly": True,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "tool": "renalplan 0.1.0",
        "dataset": "KiTS23 reference segmentations (CC BY-NC-SA 4.0)",
        "note": "Aggregate, identifier-free summary. No CT voxels, label volumes, predictions or paths.",
        "nephrometry": {"cases": cases, "casesEvaluated": len(cases),
                        "medianRuntimeSeconds": sorted(c["runtimeSeconds"] for c in cases)[len(cases) // 2]},
        "postprocess": postprocess,
        "evaluation": evaluation,
        "mesh": mesh,
    }
    text = json.dumps(out, indent=2)
    assert "case_" not in text and "/home/" not in text
    (ROOT / "summary.public.json").write_text(text)
    print(f"wrote {ROOT / 'summary.public.json'} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
