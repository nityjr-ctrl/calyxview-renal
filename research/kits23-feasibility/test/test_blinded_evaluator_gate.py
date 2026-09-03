from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT))

# The lock-gate tests do not calculate surface metrics.  Stub only this optional
# report dependency so the gate can be tested with the lightweight host Python.
surface_stub = types.ModuleType("surface_distance")
surface_stub.compute_robust_hausdorff = lambda *_args, **_kwargs: 0.0
surface_stub.compute_surface_dice_at_tolerance = lambda *_args, **_kwargs: 0.0
surface_stub.compute_surface_distances = lambda *_args, **_kwargs: {}
sys.modules.setdefault("surface_distance", surface_stub)

import evaluate_and_report as evaluator  # noqa: E402


class BlindedEvaluatorGateTests(unittest.TestCase):
    def test_corrupt_lock_stops_before_any_reference_loader(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_root = root / "run"
            run_root.mkdir()
            lock_path = run_root / "prediction-lock.json"
            lock_path.write_text(json.dumps({"schema_version": 999}) + "\n", encoding="utf-8")
            release_root = root / "released-references"
            release_root.mkdir()
            arguments = [
                "evaluate_and_report.py",
                "--run-root",
                str(run_root),
                "--prediction-lock",
                str(lock_path),
                "--reference-release-root",
                str(release_root),
            ]
            with (
                mock.patch.object(sys, "argv", arguments),
                mock.patch.object(evaluator, "load_segmentation") as reference_loader,
            ):
                with self.assertRaises(ValueError):
                    evaluator.main()
            reference_loader.assert_not_called()

    def test_bound_file_detects_post_lock_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "timings" / "case_00420.json"
            artifact.parent.mkdir()
            artifact.write_bytes(b"locked")
            digest = evaluator.sha256_file(artifact)
            size = artifact.stat().st_size
            evaluator._bound_file(
                root,
                "timings/case_00420.json",
                digest,
                size,
                "timing",
            )
            artifact.write_bytes(b"mutated")
            with self.assertRaises(ValueError):
                evaluator._bound_file(
                    root,
                    "timings/case_00420.json",
                    digest,
                    size,
                    "timing",
                )


if __name__ == "__main__":
    unittest.main()
