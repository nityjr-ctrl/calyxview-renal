from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


PIPELINE_ROOT = Path(__file__).resolve().parents[1]
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))

import create_model_lock as model_lock


class ModelLockTests(unittest.TestCase):
    def _installed_folds(self) -> list[dict[str, object]]:
        return [
            {"fold": fold, **model_lock.EXPECTED_CHECKPOINTS[fold]}
            for fold in model_lock.EXPECTED_FOLDS
        ]

    def _pipeline_sources(self, root: Path) -> Path:
        pipeline = root / "pipeline"
        pipeline.mkdir()
        for key, file_name in model_lock.SOURCE_FILES.items():
            (pipeline / file_name).write_text(
                f"# frozen {key}\n", encoding="utf-8"
            )
        return pipeline

    def test_builds_path_free_frozen_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "model.zip"
            archive.write_bytes(b"frozen")
            pipeline = self._pipeline_sources(root)
            with (
                mock.patch.object(model_lock, "EXPECTED_MODEL_BYTES", len(b"frozen")),
                mock.patch.object(model_lock, "hash_file", return_value=model_lock.EXPECTED_MODEL_SHA256),
                mock.patch.object(model_lock, "git_commit", return_value=model_lock.EXPECTED_NNUNET_COMMIT),
                mock.patch.object(model_lock, "verify_model_install", return_value=self._installed_folds()),
            ):
                result = model_lock.build_model_lock(
                    results_folder=root / "results",
                    nnunet_source=root / "source",
                    model_archive=archive,
                    pipeline_root=pipeline,
                )

        self.assertEqual(result["schema_version"], 1)
        self.assertTrue(result["research_only"])
        self.assertEqual(result["folds"], [0, 1, 2, 3, 4])
        self.assertFalse(result["tta_enabled"])
        self.assertEqual(len(result["installed_folds"]), 5)
        self.assertEqual(
            set(result["pipeline_source_artifact_hashes"]), set(model_lock.SOURCE_FILES)
        )
        self.assertEqual(len(result["pipeline_source_artifact_hashes"]), 10)
        for key in (
            "evaluator_sha256",
            "reference_releaser_sha256",
            "public_summary_builder_sha256",
        ):
            self.assertRegex(result["pipeline_source_artifact_hashes"][key], r"^[0-9a-f]{64}$")
        serialized = json.dumps(result).lower()
        self.assertNotIn(str(root).lower(), serialized)
        self.assertNotIn("label", serialized)
        self.assertNotIn("reference_path", serialized)

    def test_build_refuses_missing_downstream_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "model.zip"
            archive.write_bytes(b"frozen")
            pipeline = self._pipeline_sources(root)
            (pipeline / "evaluate_and_report.py").unlink()
            with (
                mock.patch.object(model_lock, "EXPECTED_MODEL_BYTES", len(b"frozen")),
                mock.patch.object(
                    model_lock, "hash_file", return_value=model_lock.EXPECTED_MODEL_SHA256
                ),
                mock.patch.object(
                    model_lock, "git_commit", return_value=model_lock.EXPECTED_NNUNET_COMMIT
                ),
                mock.patch.object(
                    model_lock,
                    "verify_model_install",
                    return_value=self._installed_folds(),
                ),
            ):
                with self.assertRaisesRegex(FileNotFoundError, "evaluate_and_report.py"):
                    model_lock.build_model_lock(
                        results_folder=root / "results",
                        nnunet_source=root / "source",
                        model_archive=archive,
                        pipeline_root=pipeline,
                    )

    def test_write_once_refuses_changed_lock(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "model-lock.json"
            first = {"schema_version": 1, "research_only": True}
            model_lock.write_once(destination, first)
            model_lock.write_once(destination, first)
            with self.assertRaises(FileExistsError):
                model_lock.write_once(destination, {**first, "research_only": False})


if __name__ == "__main__":
    unittest.main()
