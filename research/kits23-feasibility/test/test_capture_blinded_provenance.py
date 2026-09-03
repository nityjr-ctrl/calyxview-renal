from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest import mock


PIPELINE_ROOT = Path(__file__).resolve().parents[1]
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))

import capture_blinded_provenance as provenance  # noqa: E402


class OfflineRunFixture:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.run_root = root / "run"
        self.pipeline_root = root / "pipeline"
        self.results_folder = root / "results"
        self.nnunet_source = root / "nnunet-source"
        self.model_archive = root / "model.zip"
        self.model_commit = "a" * 40
        self.model_archive.write_bytes(b"small-frozen-model-archive")
        self.plans_bytes = b"small-plans"
        self.fold_bytes: dict[int, tuple[bytes, bytes]] = {}
        self.expected_checkpoints: dict[int, dict[str, object]] = {}
        self._make_pipeline_sources()
        self._make_model()
        self._make_run()

    @staticmethod
    def digest(content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()

    def _make_pipeline_sources(self) -> None:
        self.pipeline_root.mkdir(parents=True)
        for file_name in provenance.SOURCE_FILES.values():
            (self.pipeline_root / file_name).write_bytes(
                b"offline source fixture\0" + file_name.encode("ascii")
            )

    def _make_model(self) -> None:
        self.nnunet_source.mkdir()
        model_root = self.results_folder / provenance.MODEL_RELATIVE
        model_root.mkdir(parents=True)
        (model_root / "plans.pkl").write_bytes(self.plans_bytes)
        for fold in provenance.EXPECTED_FOLDS:
            checkpoint = f"checkpoint-{fold}".encode("ascii")
            metadata = f"metadata-{fold}".encode("ascii")
            self.fold_bytes[fold] = (checkpoint, metadata)
            self.expected_checkpoints[fold] = {
                "checkpoint_bytes": len(checkpoint),
                "checkpoint_sha256": self.digest(checkpoint),
                "metadata_bytes": len(metadata),
                "metadata_sha256": self.digest(metadata),
            }
            fold_root = model_root / f"fold_{fold}"
            fold_root.mkdir()
            (fold_root / "model_final_checkpoint.model").write_bytes(checkpoint)
            (fold_root / "model_final_checkpoint.model.pkl").write_bytes(metadata)

    def _make_run(self) -> None:
        manifests = self.run_root / "manifests"
        source = self.run_root / "source" / "images"
        inputs = self.run_root / "nnunet_input"
        timings = self.run_root / "timings"
        predictions = self.run_root / "predictions"
        logs = self.run_root / "logs"
        for directory in (manifests, source, inputs, timings, predictions, logs):
            directory.mkdir(parents=True, exist_ok=True)

        rows: list[dict[str, object]] = []
        for order, (case_id, selection_hash) in enumerate(
            provenance.expected_selection(), start=1
        ):
            image = b"synthetic CT file bytes\0" + case_id.encode("ascii")
            (source / f"{case_id}.nii.gz").write_bytes(image)
            (inputs / f"{case_id}_0000.nii.gz").write_bytes(image)
            rows.append(
                {
                    "case_id": case_id,
                    "selection_order": order,
                    "selection_hash": selection_hash,
                    "image_sha256": self.digest(image),
                    "image_bytes": len(image),
                }
            )
        self.rows = rows

        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(
            buffer, fieldnames=list(provenance.MANIFEST_COLUMNS), lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)
        manifest_bytes = buffer.getvalue().encode("utf-8")
        (manifests / "manifest.csv").write_bytes(manifest_bytes)

        cohort_lock = {
            "schema_version": 1,
            "protocol_namespace": provenance.PROTOCOL_NAMESPACE,
            "public_seed": provenance.PUBLIC_SEED,
            "eligible_start": f"case_{provenance.ELIGIBLE_START:05d}",
            "eligible_end": f"case_{provenance.ELIGIBLE_END:05d}",
            "eligible_count": provenance.ELIGIBLE_END - provenance.ELIGIBLE_START + 1,
            "eligible_list_sha256": provenance.ELIGIBLE_LIST_SHA256,
            "selection_count": provenance.SELECTION_COUNT,
            "selection_algorithm": provenance.SELECTION_ALGORITHM,
            "manifest_sha256": self.digest(manifest_bytes),
            "manifest_columns": list(provenance.MANIFEST_COLUMNS),
            "case_ids": [row["case_id"] for row in rows],
            "selection_hashes": [row["selection_hash"] for row in rows],
            "imaging_repository": provenance.IMAGING_REPOSITORY,
            "imaging_revision": provenance.IMAGING_REVISION,
            "total_image_bytes": sum(int(row["image_bytes"]) for row in rows),
            "created_utc": "2026-09-01T00:00:00Z",
            "research_only": True,
            "disclaimer": "Research only.",
        }
        (manifests / "cohort-lock.public.json").write_text(
            json.dumps(cohort_lock, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

        plans_identity = {
            "bytes": len(self.plans_bytes),
            "sha256": self.digest(self.plans_bytes),
        }
        installed_folds = []
        for fold in provenance.EXPECTED_FOLDS:
            spec = self.expected_checkpoints[fold]
            installed_folds.append(
                {
                    "fold": fold,
                    "checkpoint": {
                        "sha256": spec["checkpoint_sha256"],
                        "bytes": spec["checkpoint_bytes"],
                    },
                    "metadata": {
                        "sha256": spec["metadata_sha256"],
                        "bytes": spec["metadata_bytes"],
                    },
                }
            )
        model_lock = {
            "schema_version": 1,
            "research_only": True,
            "created_at_utc": "2026-09-01T00:00:00+00:00",
            "disclaimer": "Research only.",
            "model": "Published nnU-Net v1 KiTS21 ensemble",
            "task": "Task135_KiTS2021",
            "configuration": "3d_fullres",
            "folds": list(provenance.EXPECTED_FOLDS),
            "tta_enabled": False,
            "source_archive": {
                "sha256": self.digest(self.model_archive.read_bytes()),
                "bytes": self.model_archive.stat().st_size,
            },
            "nnunet_source_commit": self.model_commit,
            "installed_plans": plans_identity,
            "installed_folds": installed_folds,
            "pipeline_source_artifact_hashes": provenance.collect_source_artifacts(
                self.pipeline_root
            ),
            "provenance_note": "Frozen before inference.",
        }
        (manifests / "model-lock.json").write_text(
            json.dumps(model_lock, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

        self.bindings = {
            "manifest_sha256": self.digest(manifest_bytes),
            "cohort_lock_sha256": provenance.sha256_file(
                manifests / "cohort-lock.public.json"
            ),
            "model_lock_sha256": provenance.sha256_file(manifests / "model-lock.json"),
        }
        source_hashes = provenance.collect_source_artifacts(self.pipeline_root)
        timing_artifacts = {
            key: source_hashes[key] for key in sorted(provenance.TIMING_ARTIFACT_KEYS)
        }
        for row in rows:
            self._write_timing(row, timing_artifacts, failed=row is rows[-1])

    def _write_timing(
        self,
        row: dict[str, object],
        timing_artifacts: dict[str, str],
        *,
        failed: bool,
    ) -> None:
        case_id = str(row["case_id"])
        configuration = {
            "launcher": "wsl.exe",
            "python": "python3",
            "python_module": "nnunet.inference.predict_simple",
            "task": "Task135_KiTS2021",
            "model": "3d_fullres",
            "folds": [str(fold) for fold in provenance.EXPECTED_FOLDS],
            "tta_enabled": False,
            "results_folder_wsl": "/opt/results",
            "nnunet_source_wsl": "/opt/nnunet",
            "native_scratch_root_wsl": "/var/tmp/calyxview-run",
            "input_directory_wsl": f"/var/tmp/calyxview-run/case-inputs/{case_id}",
            "output_directory_wsl": f"/var/tmp/calyxview-run/case-outputs/{case_id}",
            "prediction_relative": f"predictions/{case_id}.nii.gz",
            "predict_arguments": ["-m", "nnunet.inference.predict_simple"],
            "validator_script_wsl": "/opt/pipeline/validate_prediction.py",
            "retry_policy": "one identical retry after failure",
            "environment": {"PYTHONNOUSERSITE": "1"},
            "protocol_mode": "script_blinded_full_denominator",
            "case_id": case_id,
            "cohort_position": row["selection_order"],
            "selection_order": row["selection_order"],
            "selection_hash": row["selection_hash"],
            "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
            "input_image_wsl": f"/mnt/run/nnunet_input/{case_id}_0000.nii.gz",
            "input_image_sha256": row["image_sha256"],
            "input_image_bytes": row["image_bytes"],
            "source_cache_relative": f"source/images/{case_id}.nii.gz",
            **self.bindings,
            "artifact_hashes": timing_artifacts,
        }
        configuration_sha = self.digest(provenance.compact_json(configuration).encode())
        attempt_count = 2 if failed else 1
        attempts = []
        for attempt_number in range(1, attempt_count + 1):
            succeeded = not failed and attempt_number == attempt_count
            for stream in ("stdout", "stderr"):
                (self.run_root / "logs" / f"{case_id}.attempt-{attempt_number}.{stream}.log").write_text(
                    f"{stream} fixture\n", encoding="utf-8"
                )
            if succeeded:
                for stream in ("stdout", "stderr"):
                    (
                        self.run_root
                        / "logs"
                        / f"{case_id}.attempt-{attempt_number}.validation.{stream}.log"
                    ).write_text(f"validation {stream}\n", encoding="utf-8")
            attempts.append(
                {
                    "case_id": case_id,
                    "cohort_position": row["selection_order"],
                    "selection_order": row["selection_order"],
                    "selection_hash": row["selection_hash"],
                    "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
                    "input_image_sha256": row["image_sha256"],
                    "input_image_bytes": row["image_bytes"],
                    "prediction_relative": f"predictions/{case_id}.nii.gz",
                    **self.bindings,
                    "command_configuration_sha256": configuration_sha,
                    "artifact_hashes": timing_artifacts,
                    "attempt": attempt_number,
                    "status": "succeeded" if succeeded else "failed",
                    "exit_code": 0 if succeeded else 1,
                    "runtime_seconds": 1.0,
                    "prediction_created": succeeded,
                    "prediction_validated": succeeded,
                    "validation_exit_code": 0 if succeeded else None,
                    "finalization_exit_code": 0 if succeeded else None,
                    "final_prediction_created": succeeded,
                    "process_start_error_type": None,
                    "stdout_log_relative": f"logs/{case_id}.attempt-{attempt_number}.stdout.log",
                    "stderr_log_relative": f"logs/{case_id}.attempt-{attempt_number}.stderr.log",
                    "validation_stdout_relative": (
                        f"logs/{case_id}.attempt-{attempt_number}.validation.stdout.log"
                        if succeeded
                        else None
                    ),
                    "validation_stderr_relative": (
                        f"logs/{case_id}.attempt-{attempt_number}.validation.stderr.log"
                        if succeeded
                        else None
                    ),
                }
            )
        timing = {
            "schema_version": 2,
            "run_mode": "research_feasibility_script_blinded",
            "disclaimer": "Research only.",
            "case_id": case_id,
            "cohort_position": row["selection_order"],
            "selection_order": row["selection_order"],
            "selection_hash": row["selection_hash"],
            "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
            "input_image_sha256": row["image_sha256"],
            "input_image_bytes": row["image_bytes"],
            "prediction_relative": f"predictions/{case_id}.nii.gz",
            **self.bindings,
            "command_configuration_sha256": configuration_sha,
            "artifact_hashes": timing_artifacts,
            "status": "failed" if failed else "succeeded",
            "attempts": attempt_count,
            "runtime_seconds": float(attempt_count),
            "started_utc": "2026-09-01T00:00:00Z",
            "finished_utc": "2026-09-01T00:01:00Z",
            "command_configuration": configuration,
            "attempt_records": attempts,
        }
        (self.run_root / "timings" / f"{case_id}.json").write_text(
            json.dumps(timing, indent=2) + "\n", encoding="utf-8"
        )
        if not failed:
            (self.run_root / "predictions" / f"{case_id}.nii.gz").write_bytes(
                b"synthetic prediction bytes\0" + case_id.encode("ascii")
            )

    @contextmanager
    def patched_model_contract(self):
        plans = {"bytes": len(self.plans_bytes), "sha256": self.digest(self.plans_bytes)}
        with ExitStack() as stack:
            stack.enter_context(
                mock.patch.object(provenance, "EXPECTED_MODEL_BYTES", self.model_archive.stat().st_size)
            )
            stack.enter_context(
                mock.patch.object(
                    provenance,
                    "EXPECTED_MODEL_SHA256",
                    self.digest(self.model_archive.read_bytes()),
                )
            )
            stack.enter_context(mock.patch.object(provenance, "EXPECTED_PLANS", plans))
            stack.enter_context(
                mock.patch.object(
                    provenance, "EXPECTED_CHECKPOINTS", self.expected_checkpoints
                )
            )
            stack.enter_context(
                mock.patch.object(provenance, "EXPECTED_NNUNET_COMMIT", self.model_commit)
            )
            stack.enter_context(
                mock.patch.object(
                    provenance,
                    "git_identity",
                    return_value={
                        "nnunet_source_commit": self.model_commit,
                        "tracked_source_clean": True,
                    },
                )
            )
            stack.enter_context(
                mock.patch.object(
                    provenance,
                    "runtime_evidence",
                    return_value={
                        "python": {"implementation": "CPython", "version": "test"},
                        "system": {"name": "test", "release": "test", "machine": "test"},
                        "packages": {},
                        "gpu": {"available": False},
                    },
                )
            )
            yield

    def capture(self) -> dict[str, object]:
        with self.patched_model_contract():
            return provenance.capture_provenance(
                run_root=self.run_root,
                nnunet_source=self.nnunet_source,
                results_folder=self.results_folder,
                model_archive=self.model_archive,
                pipeline_root=self.pipeline_root,
            )


class CaptureBlindedProvenanceTests(unittest.TestCase):
    def test_captures_complete_path_free_aggregate_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = OfflineRunFixture(Path(directory))
            result = fixture.capture()
            on_disk = json.loads(
                (fixture.run_root / "provenance.inference.json").read_text(encoding="utf-8")
            )

            self.assertEqual(result, on_disk)
            self.assertEqual(result["schema_version"], 1)
            self.assertTrue(result["research_only"])
            self.assertEqual(result["execution"]["attempted_cases"], 20)
            self.assertEqual(result["execution"]["succeeded_predictions"], 19)
            self.assertEqual(result["execution"]["exhausted_failures"], 1)
            self.assertTrue(result["execution"]["full_denominator_preserved"])
            self.assertEqual(result["cohort"]["ct_inputs_verified"], 20)
            self.assertEqual(result["manifest_sha256"], fixture.bindings["manifest_sha256"])
            serialized = json.dumps(result).lower()
            self.assertNotIn(str(fixture.root).lower(), serialized)
            self.assertNotIn("case_00", serialized)
            self.assertNotIn('"label', serialized)
            self.assertNotIn('"reference_data', serialized)

    def test_rejects_annotation_like_material_before_capture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = OfflineRunFixture(Path(directory))
            (fixture.run_root / "labels").mkdir()
            with self.assertRaisesRegex(RuntimeError, "Annotation-like material"):
                fixture.capture()
            self.assertFalse((fixture.run_root / "provenance.inference.json").exists())

    def test_rejects_tampered_timing_binding(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = OfflineRunFixture(Path(directory))
            case_id = str(fixture.rows[0]["case_id"])
            timing_path = fixture.run_root / "timings" / f"{case_id}.json"
            timing = json.loads(timing_path.read_text(encoding="utf-8"))
            timing["input_image_sha256"] = "0" * 64
            timing_path.write_text(json.dumps(timing) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "input_image_sha256 binding"):
                fixture.capture()

    def test_rejects_tampered_installed_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = OfflineRunFixture(Path(directory))
            checkpoint = (
                fixture.results_folder
                / provenance.MODEL_RELATIVE
                / "fold_3"
                / "model_final_checkpoint.model"
            )
            checkpoint.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "Installed fold 3 checkpoint"):
                fixture.capture()

    def test_rejects_post_lock_evaluator_source_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = OfflineRunFixture(Path(directory))
            (fixture.pipeline_root / "evaluate_and_report.py").write_text(
                "# changed after the pre-inference model lock\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(
                ValueError, "Live pipeline sources differ from the pre-inference model lock"
            ):
                fixture.capture()


if __name__ == "__main__":
    unittest.main()
