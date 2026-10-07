#!/usr/bin/env python3
"""Build the aggregate, identifier-free summary the website displays.

Reads pipeline/results/{nephrometry.csv, cases/*/planning.json, postprocess/,
evaluation/, mesh/} and writes pipeline/results/summary.public.json. Cases are
re-labelled 1..N (the deploy bundle scan forbids cohort identifiers such as
case ids), no paths are included, and nothing but derived numbers and flags
leaves this script.
"""
from __future__ import annotations

import csv
import json
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "results"

# Mirrors the text rules in test/deploy-bundle-scan.mjs, so a leak fails here
# first rather than at the end of the Netlify build.
FORBIDDEN_TEXT = [
    re.compile(r"case_\d{5}", re.I),
    re.compile(r"(?:^|[\"'\s(])(?:[a-z]:[\\/])|file://|/(?:users|home|mnt|tmp|root|var|opt|srv)/", re.I),
    re.compile(r"(?:patientname|patientid|studyinstanceuid|seriesinstanceuid)", re.I),
]


def load_csv(p: Path) -> list[dict]:
    with open(p, newline="") as f:
        return list(csv.DictReader(f))


# Phrases in renalplan's notes (pipeline/renalplan/nephrometry.py, NOTE_*).
# The tests check the notes still contain them.
POLAR_LINES_ASSUMED = "polar lines assumed"
SINUS_TOO_LARGE = "sinus estimate implausibly large"


def planning(case_id: str) -> dict:
    return json.loads((ROOT / "cases" / case_id / "planning.json").read_text())


def case_flags(case_id: str) -> dict:
    """Flags the site's table notes are built from, read from the case's
    planning.json notes, so a rerun can't leave a hard-coded case number
    pointing at the wrong row."""
    notes = planning(case_id)["nephrometry"]["renal"]["notes"]
    extra = 0
    for note in notes:
        m = re.match(r"(\d+) additional tumour component", note)
        if m:
            extra = int(m.group(1))
    return {
        "extraTumourPieces": extra,
        "polarLinesAssumed": any(POLAR_LINES_ASSUMED in note.lower() for note in notes),
        "sinusEstimateTooLarge": any(SINUS_TOO_LARGE in note.lower() for note in notes),
    }


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
            # 3 dp, as in the CSV, so 0.025 isn't rounded again to 0.03.
            "exophyticFraction": round(float(r["E_exophytic_frac"]), 3),
            "tumourToSinusMm": round(float(r["N_mm"]), 1),
            "ipsilateralKidneyMl": round(float(r["ipsi_kidney_ml"])),
            "otherKidneyMl": round(float(r["contra_kidney_ml"])),
            "preservedFraction": round(float(r["preserved_pct"]) / 100.0, 3),
            "runtimeSeconds": round(float(r["runtime_s"]), 1),
            **case_flags(r["case_id"]),
        })

    sweep = json.loads((ROOT / "postprocess" / "postprocess_sweep.json").read_text())
    by = {r["config"]: r for r in sweep["results"]}
    best = sweep["results"][0]
    # Every configuration in the grid keeps the two largest kidney pieces
    # (kidney_max_components = 2), so the row labels name that rule too.
    always_on = [r for r in sweep["results"] if r["config"] != "none"]
    assert all(r["params"].get("kidney_max_components") == 2 for r in always_on)

    def pp_row(label, r):
        return {"rules": label, "kidneyAndMassDice": round(r["kidney_and_mass_dice"], 3),
                "massDice": round(r["mass_dice"], 3), "tumourDice": round(r["tumour_dice"], 3),
                "tumourHd95Mm": round(r["tumour_hd95"], 1)}

    postprocess = {
        "casesEvaluated": len(sweep["cases"]),
        "configurationsTried": len(sweep["results"]) - 1,
        # Only two of the four perturb steps changed anything: the boundary-noise
        # and hole thresholds are never reached by the smoothed noise field
        # (SIMULATED.json records 0 hole voxels in every case).
        "inputNote": "Reference labels with two simulated errors: the tumour eroded by one voxel, and three speckled blobs placed away from the kidney in each case (about 70% labelled kidney, 30% tumour). Not model output.",
        "rows": [
            pp_row("No clean-up (simulated input)", by["none"]),
            pp_row("Keep the two largest kidney pieces", by["k2_kmin0_mmin0_att0_fill0_open0"]),
            pp_row("Keep the two largest kidney pieces + drop tumour or cyst pieces under 0.05 ml", by["k2_kmin0_mmin0.05_att0_fill0_open0"]),
            pp_row("Keep the two largest kidney pieces + tumour or cyst only within 5 mm of the kidney", by["k2_kmin0_mmin0_att5_fill0_open0"]),
        ],
        "best": {"name": best["config"], "params": best["params"], "meanDice": round(best["objective"], 4)},
        "tiedForBest": sum(1 for r in sweep["results"] if abs(r["objective"] - best["objective"]) < 1e-12),
        "baselineMeanDice": round(by["none"]["objective"], 4),
    }

    # 5 dp so the site's 3 dp display rounds once, not twice (0.99448 -> 0.994,
    # where a 4 dp 0.9945 would show as 0.995).
    def region_summary(p: Path):
        d = json.loads(p.read_text())["regions"]
        return {k: {f: {"mean": round(v["mean"], 5), "ci95": [round(v["ci95"][0], 5), round(v["ci95"][1], 5)]}
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
    # minDice / maxAbsVolumeErrorPct are the extremes of the per-setting means
    # (averaged over the sweep cases); the caseMin / caseMax pair are the
    # extremes of single cases, so the site can say both.
    mesh = {"casesEvaluated": len({r["case_id"] for r in mesh_rows}), "criteria": mesh_rec["criteria"],
            "recommended": mesh_rec["recommended"], "table": mesh_table,
            "minDice": round(min(r["dice"] for r in mesh_table), 4),
            "maxAbsVolumeErrorPct": round(max(r["absVolumeErrorPct"] for r in mesh_table), 2),
            "caseMinDice": round(min(float(r["dice"]) for r in mesh_rows), 4),
            "caseMaxAbsVolumeErrorPct": round(max(abs(float(r["volume_error_pct"])) for r in mesh_rows), 2)}

    # The version that produced the case files, so the summary can't claim a
    # different rule set from the one that made the scores.
    tools = {planning(r["case_id"])["tool"] for r in rows}
    assert len(tools) == 1, f"case files come from more than one renalplan version: {sorted(tools)}"

    out = {
        "schemaVersion": 1,
        "researchOnly": True,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "tool": tools.pop(),
        "dataset": "KiTS23 reference segmentations (CC BY-NC-SA 4.0)",
        "note": "Aggregate, identifier-free summary. No CT voxels, label volumes, predictions or paths.",
        "nephrometry": {"cases": cases, "casesEvaluated": len(cases),
                        "medianRuntimeSeconds": round(statistics.median(c["runtimeSeconds"] for c in cases), 1)},
        "postprocess": postprocess,
        "evaluation": evaluation,
        "mesh": mesh,
    }
    # NaN (for example N when no sinus was found) isn't valid JSON and would
    # break the site's import, so stop here with a clear message instead.
    try:
        text = json.dumps(out, indent=2, allow_nan=False)
    except ValueError as e:
        raise SystemExit(f"summary has a NaN or infinite value, which the site can't read: {e}")
    assert "case_" not in text and "/home/" not in text
    for pattern in FORBIDDEN_TEXT:
        assert not pattern.search(text), f"public summary would leak text matching {pattern.pattern}"
    (ROOT / "summary.public.json").write_text(text)
    print(f"wrote {ROOT / 'summary.public.json'} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
