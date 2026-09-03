from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import nibabel as nib
import numpy as np


PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT))

import lock_predictions as locker  # noqa: E402


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8", newline="\n")


class PredictionLockFixture:
    def __init__(self, root: Path, *, failed_position: int | None = 20) -> None:
        self.root = root
        self.failed_position = failed_position
        for relative in (
            "manifests",
            "nnunet_input",
            "predictions",
            "source/images",
            "timings",
            "logs",
        ):
            (root / relative).mkdir(parents=True, exist_ok=True)
        self.rows = self._write_images_and_manifest()
        self.manifest_sha256 = file_sha256(root / "manifests/manifest.csv")
        self.cohort = self._write_cohort_lock()
        self.cohort_lock_sha256 = file_sha256(root / "manifests/cohort-lock.public.json")
        self.model_lock = self._write_model_lock()
        self.model_lock_sha256 = file_sha256(root / "manifests/model-lock.json")
        self.artifact_hashes = {
            key: file_sha256(PIPELINE_ROOT / filename)
            for key, filename in locker.PIPELINE_ARTIFACTS.items()
        }
        self.source_artifact_hashes = {
            key: file_sha256(PIPELINE_ROOT / filename)
            for key, filename in locker.PROVENANCE_SOURCE_ARTIFACTS.items()
        }
        self._write_timings()
        self._write_provenance()

    def _write_images_and_manifest(self) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for position, case_id in enumerate(locker.EXPECTED_CASE_IDS, start=1):
            input_path = self.root / "nnunet_input" / f"{case_id}_0000.nii.gz"
            image = nib.Nifti1Image(
                np.full((2, 3, 4), position, dtype=np.int16), np.eye(4, dtype=np.float64)
            )
            nib.save(image, str(input_path))
            cache_path = self.root / "source" / "images" / f"{case_id}.nii.gz"
            shutil.copyfile(input_path, cache_path)
            rows.append(
                {
                    "case_id": case_id,
                    "selection_order": position,
                    "selection_hash": hashlib.sha256(
                        f"{locker.PROTOCOL_NAMESPACE}|seed={locker.PUBLIC_SEED}|{case_id}".encode()
                    ).hexdigest(),
                    "image_sha256": file_sha256(input_path),
                    "image_bytes": input_path.stat().st_size,
                }
            )
        manifest = self.root / "manifests" / "manifest.csv"
        with manifest.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(
                stream,
                fieldnames=locker.EXPECTED_MANIFEST_COLUMNS,
                lineterminator="\n",
            )
            writer.writeheader()
            writer.writerows(rows)
        return rows

    def _write_cohort_lock(self) -> dict[str, object]:
        cohort = {
            "schema_version": 1,
            "protocol_namespace": locker.PROTOCOL_NAMESPACE,
            "public_seed": locker.PUBLIC_SEED,
            "eligible_start": locker.ELIGIBLE_START,
            "eligible_end": locker.ELIGIBLE_END,
            "eligible_count": 169,
            "eligible_list_sha256": locker.ELIGIBLE_LIST_SHA256,
            "selection_count": locker.EXPECTED_CASE_COUNT,
            "selection_algorithm": locker.SELECTION_ALGORITHM,
            "manifest_sha256": self.manifest_sha256,
            "manifest_columns": locker.EXPECTED_MANIFEST_COLUMNS,
            "case_ids": [row["case_id"] for row in self.rows],
            "selection_hashes": [row["selection_hash"] for row in self.rows],
            "imaging_repository": locker.IMAGING_REPOSITORY,
            "imaging_revision": locker.IMAGING_REVISION,
            "total_image_bytes": sum(int(row["image_bytes"]) for row in self.rows),
            "created_utc": "2026-09-01T10:00:00Z",
            "research_only": True,
            "disclaimer": "Test fixture; research only.",
        }
        write_json(self.root / "manifests/cohort-lock.public.json", cohort)
        return cohort

    def _write_model_lock(self) -> dict[str, object]:
        folds = [0, 1, 2, 3, 4]
        model_lock = {
            "schema_version": 1,
            "research_only": True,
            "created_at_utc": "2026-09-01T10:05:00Z",
            "disclaimer": "Test fixture; research only.",
            "model": "official-nnunet-v1-task135",
            "task": "Task135_KiTS2021",
            "configuration": "3d_fullres",
            "folds": folds,
            "tta_enabled": True,
            "source_archive": {"sha256": "1" * 64, "bytes": 1000},
            "nnunet_source_commit": "2" * 40,
            "installed_plans": {"sha256": "3" * 64, "bytes": 2000},
            "installed_folds": [
                {
                    "fold": fold,
                    "checkpoint": {"sha256": f"{fold + 4:x}" * 64, "bytes": 3000 + fold},
                    "metadata": {"sha256": f"{fold + 9:x}" * 64, "bytes": 4000 + fold},
                }
                for fold in folds
            ],
            "pipeline_source_artifact_hashes": {
                key: file_sha256(PIPELINE_ROOT / filename)
                for key, filename in locker.PROVENANCE_SOURCE_ARTIFACTS.items()
            },
            "provenance_note": "Verified before inference; test fixture.",
        }
        write_json(self.root / "manifests/model-lock.json", model_lock)
        return model_lock

    def _configuration(self, row: dict[str, object]) -> dict[str, object]:
        case_id = str(row["case_id"])
        position = int(row["selection_order"])
        return {
            "launcher": "wsl.exe",
            "python": "/opt/nnunet/bin/python",
            "python_module": "nnunet.inference.predict_simple",
            "task": self.model_lock["task"],
            "model": self.model_lock["configuration"],
            "folds": ["0", "1", "2", "3", "4"],
            "tta_enabled": self.model_lock["tta_enabled"],
            "results_folder_wsl": "/model",
            "nnunet_source_wsl": "/source",
            "native_scratch_root_wsl": "/scratch",
            "input_directory_wsl": f"/scratch/case-inputs/{case_id}",
            "output_directory_wsl": f"/scratch/case-outputs/{case_id}",
            "prediction_relative": f"predictions/{case_id}.nii.gz",
            "predict_arguments": ["-m", "nnunet.inference.predict_simple"],
            "validator_script_wsl": "/pipeline/validate_prediction.py",
            "retry_policy": "one identical retry after failure",
            "environment": {"PYTHONNOUSERSITE": "1"},
            "protocol_mode": "script_blinded_full_denominator",
            "case_id": case_id,
            "cohort_position": position,
            "selection_order": position,
            "selection_hash": row["selection_hash"],
            "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
            "input_image_wsl": f"/run/nnunet_input/{case_id}_0000.nii.gz",
            "input_image_sha256": row["image_sha256"],
            "input_image_bytes": row["image_bytes"],
            "source_cache_relative": f"source/images/{case_id}.nii.gz",
            "manifest_sha256": self.manifest_sha256,
            "cohort_lock_sha256": self.cohort_lock_sha256,
            "model_lock_sha256": self.model_lock_sha256,
            "artifact_hashes": self.artifact_hashes,
        }

    def _binding(
        self, row: dict[str, object], configuration_sha256: str
    ) -> dict[str, object]:
        case_id = str(row["case_id"])
        position = int(row["selection_order"])
        return {
            "case_id": case_id,
            "cohort_position": position,
            "selection_order": position,
            "selection_hash": row["selection_hash"],
            "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
            "input_image_sha256": row["image_sha256"],
            "input_image_bytes": row["image_bytes"],
            "prediction_relative": f"predictions/{case_id}.nii.gz",
            "manifest_sha256": self.manifest_sha256,
            "cohort_lock_sha256": self.cohort_lock_sha256,
            "model_lock_sha256": self.model_lock_sha256,
            "command_configuration_sha256": configuration_sha256,
        }

    def _attempt(
        self,
        row: dict[str, object],
        configuration_sha256: str,
        attempt_number: int,
        *,
        succeeded: bool,
    ) -> dict[str, object]:
        case_id = str(row["case_id"])
        binding = self._binding(row, configuration_sha256)
        stdout_relative = f"logs/{case_id}.attempt-{attempt_number}.stdout.log"
        stderr_relative = f"logs/{case_id}.attempt-{attempt_number}.stderr.log"
        (self.root / stdout_relative).write_text("model output\n", encoding="utf-8")
        (self.root / stderr_relative).write_text("", encoding="utf-8")
        validation_stdout: str | None = None
        validation_stderr: str | None = None
        if succeeded:
            validation_stdout = (
                f"logs/{case_id}.attempt-{attempt_number}.validation.stdout.log"
            )
            validation_stderr = (
                f"logs/{case_id}.attempt-{attempt_number}.validation.stderr.log"
            )
            (self.root / validation_stdout).write_text(
                json.dumps(
                    {
                        "status": "ok",
                        "shape": [2, 3, 4],
                        "labels": [0, 1],
                        "affine_max_delta": 0.0,
                        "research_only": True,
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            (self.root / validation_stderr).write_text("", encoding="utf-8")
        return {
            **binding,
            "artifact_hashes": self.artifact_hashes,
            "attempt": attempt_number,
            "status": "succeeded" if succeeded else "failed",
            "exit_code": 0 if succeeded else 1,
            "runtime_seconds": float(attempt_number),
            "prediction_created": succeeded,
            "prediction_validated": succeeded,
            "validation_exit_code": 0 if succeeded else None,
            "finalization_exit_code": 0 if succeeded else None,
            "final_prediction_created": succeeded,
            "process_start_error_type": None,
            "stdout_log_relative": stdout_relative,
            "stderr_log_relative": stderr_relative,
            "validation_stdout_relative": validation_stdout,
            "validation_stderr_relative": validation_stderr,
        }

    def _write_timings(self) -> None:
        for row in self.rows:
            case_id = str(row["case_id"])
            position = int(row["selection_order"])
            configuration = self._configuration(row)
            configuration_sha256 = locker.compact_json_sha256(configuration)
            failed = position == self.failed_position
            if failed:
                attempts = [
                    self._attempt(row, configuration_sha256, 1, succeeded=False),
                    self._attempt(row, configuration_sha256, 2, succeeded=False),
                ]
            else:
                attempts = [self._attempt(row, configuration_sha256, 1, succeeded=True)]
                prediction_path = self.root / "predictions" / f"{case_id}.nii.gz"
                prediction = nib.Nifti1Image(
                    np.ones((2, 3, 4), dtype=np.uint8), np.eye(4, dtype=np.float64)
                )
                nib.save(prediction, str(prediction_path))
            binding = self._binding(row, configuration_sha256)
            timing = {
                "schema_version": 2,
                "run_mode": "research_feasibility_script_blinded",
                "disclaimer": "Research prototype only.",
                **binding,
                "artifact_hashes": self.artifact_hashes,
                "status": "failed" if failed else "succeeded",
                "attempts": len(attempts),
                "runtime_seconds": sum(float(attempt["runtime_seconds"]) for attempt in attempts),
                "started_utc": "2026-09-01T11:00:00Z",
                "finished_utc": "2026-09-01T11:01:00Z",
                "command_configuration": configuration,
                "attempt_records": attempts,
            }
            write_json(self.root / "timings" / f"{case_id}.json", timing)

    def _write_provenance(self) -> None:
        write_json(
            self.root / "provenance.inference.json",
            {
                "schema_version": 1,
                "research_only": True,
                "manifest_sha256": self.manifest_sha256,
                "cohort_lock_sha256": self.cohort_lock_sha256,
                "model_lock_sha256": self.model_lock_sha256,
                "source_artifacts": self.source_artifact_hashes,
                "case_count": locker.EXPECTED_CASE_COUNT,
            },
        )

    def timing_path(self, position: int) -> Path:
        return self.root / "timings" / f"{self.rows[position - 1]['case_id']}.json"


class PredictionLockStrictTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "run"
        self.root.mkdir()
        self.fixture = PredictionLockFixture(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_valid_run_writes_private_lock_and_digest_only_public_file(self) -> None:
        result = locker.create_prediction_lock(
            self.root, created_at_utc="2026-09-01T12:00:00Z"
        )
        self.assertEqual(result["evaluated_cases"], 20)
        self.assertEqual(result["successful_predictions"], 19)
        self.assertEqual(result["failed_predictions"], 1)
        private_payload = (self.root / locker.PRIVATE_LOCK_NAME).read_bytes()
        public_text = (self.root / locker.PUBLIC_LOCK_NAME).read_text(encoding="ascii")
        self.assertRegex(public_text, r"^[0-9a-f]{64}\n$")
        self.assertEqual(public_text.strip(), hashlib.sha256(private_payload).hexdigest())
        self.assertNotIn("case_", public_text)
        private = json.loads(private_payload)
        self.assertFalse(private["reference_state"]["reference_material_loaded"])
        self.assertEqual(private["inference"]["evaluated_cases"], 20)
        first_log = private["inference"]["cases"][0]["attempts"][0]["logs"][0]
        self.assertEqual(
            first_log["sha256"], file_sha256(self.root / first_log["relative"])
        )

    def test_existing_lock_is_immutable_and_neither_file_changes(self) -> None:
        locker.create_prediction_lock(self.root, created_at_utc="2026-09-01T12:00:00Z")
        before_private = (self.root / locker.PRIVATE_LOCK_NAME).read_bytes()
        before_public = (self.root / locker.PUBLIC_LOCK_NAME).read_bytes()
        with self.assertRaisesRegex(locker.LockError, "immutable"):
            locker.create_prediction_lock(self.root)
        self.assertEqual((self.root / locker.PRIVATE_LOCK_NAME).read_bytes(), before_private)
        self.assertEqual((self.root / locker.PUBLIC_LOCK_NAME).read_bytes(), before_public)

    def test_cross_case_timing_substitution_fails_attempt_path_binding(self) -> None:
        target_path = self.fixture.timing_path(2)
        target = json.loads(target_path.read_text(encoding="utf-8"))
        source = json.loads(self.fixture.timing_path(1).read_text(encoding="utf-8"))
        # A careless repair changes only top-level identity, leaving the copied
        # attempt/config/log evidence bound to a different case.
        target["attempt_records"] = source["attempt_records"]
        write_json(target_path, target)
        with self.assertRaisesRegex(locker.LockError, "cross-case substitution|cross-bound"):
            locker.create_prediction_lock(self.root)

    def test_rehashed_configuration_still_cannot_point_at_another_case(self) -> None:
        timing_path = self.fixture.timing_path(2)
        timing = json.loads(timing_path.read_text(encoding="utf-8"))
        first_case_id = str(self.fixture.rows[0]["case_id"])
        timing["command_configuration"]["output_directory_wsl"] = (
            f"/scratch/case-outputs/{first_case_id}"
        )
        changed_hash = locker.compact_json_sha256(timing["command_configuration"])
        timing["command_configuration_sha256"] = changed_hash
        for attempt in timing["attempt_records"]:
            attempt["command_configuration_sha256"] = changed_hash
        write_json(timing_path, timing)
        with self.assertRaisesRegex(locker.LockError, "output_directory_wsl"):
            locker.create_prediction_lock(self.root)

    def test_failed_case_requires_two_attempts_and_no_prediction(self) -> None:
        timing_path = self.fixture.timing_path(20)
        timing = json.loads(timing_path.read_text(encoding="utf-8"))
        timing["attempt_records"] = timing["attempt_records"][:1]
        timing["attempts"] = 1
        timing["runtime_seconds"] = timing["attempt_records"][0]["runtime_seconds"]
        extra_logs = [
            self.root / "logs" / f"{self.fixture.rows[19]['case_id']}.attempt-2.stdout.log",
            self.root / "logs" / f"{self.fixture.rows[19]['case_id']}.attempt-2.stderr.log",
        ]
        for path in extra_logs:
            path.unlink()
        write_json(timing_path, timing)
        with self.assertRaisesRegex(locker.LockError, "exactly two failed attempts"):
            locker.create_prediction_lock(self.root)

    def test_prediction_geometry_mismatch_is_rejected(self) -> None:
        case_id = str(self.fixture.rows[0]["case_id"])
        prediction_path = self.root / "predictions" / f"{case_id}.nii.gz"
        nib.save(
            nib.Nifti1Image(np.ones((3, 3, 4), dtype=np.uint8), np.eye(4)),
            str(prediction_path),
        )
        with self.assertRaisesRegex(locker.LockError, "shape does not match"):
            locker.create_prediction_lock(self.root)

    def test_extra_timing_record_is_rejected(self) -> None:
        write_json(self.root / "timings/case_99999.json", {"schema_version": 2})
        with self.assertRaisesRegex(locker.LockError, "Timing record set"):
            locker.create_prediction_lock(self.root)

    def test_reference_material_is_rejected_before_any_nifti_load(self) -> None:
        reference_dir = self.root / "labels"
        reference_dir.mkdir()
        (reference_dir / "case_00501.nii.gz").write_bytes(b"not-opened")
        with mock.patch.object(locker.nib, "load") as mocked_load:
            with self.assertRaisesRegex(locker.LockError, "Reference/label-like material"):
                locker.create_prediction_lock(self.root)
        mocked_load.assert_not_called()

    def test_provenance_must_bind_exact_model_lock(self) -> None:
        provenance_path = self.root / "provenance.inference.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        provenance["model_lock_sha256"] = "f" * 64
        write_json(provenance_path, provenance)
        with self.assertRaisesRegex(locker.LockError, "exact model_lock_sha256"):
            locker.create_prediction_lock(self.root)

    def test_model_lock_requires_exact_expanded_source_hash_set(self) -> None:
        model_lock = dict(self.fixture.model_lock)
        source_hashes = dict(model_lock["pipeline_source_artifact_hashes"])
        del source_hashes["evaluator_sha256"]
        model_lock["pipeline_source_artifact_hashes"] = source_hashes
        with self.assertRaisesRegex(locker.LockError, "source hash set"):
            locker.validate_model_lock(model_lock)

    def test_provenance_sources_must_equal_preinference_model_lock(self) -> None:
        provenance_path = self.root / "provenance.inference.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        provenance["source_artifacts"]["evaluator_sha256"] = "0" * 64
        write_json(provenance_path, provenance)
        with self.assertRaisesRegex(locker.LockError, "pre-inference model lock"):
            locker.create_prediction_lock(self.root)

    def test_preinference_source_hash_must_match_live_evaluator(self) -> None:
        model_path = self.root / "manifests/model-lock.json"
        model_lock = json.loads(model_path.read_text(encoding="utf-8"))
        model_lock["pipeline_source_artifact_hashes"]["evaluator_sha256"] = "0" * 64
        write_json(model_path, model_lock)
        model_sha256 = file_sha256(model_path)
        provenance_path = self.root / "provenance.inference.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        provenance["model_lock_sha256"] = model_sha256
        provenance["source_artifacts"]["evaluator_sha256"] = "0" * 64
        write_json(provenance_path, provenance)
        with self.assertRaisesRegex(locker.LockError, "evaluator_sha256 does not match"):
            locker.create_prediction_lock(self.root)

    def test_cohort_identity_is_preregistered_not_merely_self_consistent(self) -> None:
        cohort_path = self.root / "manifests/cohort-lock.public.json"
        cohort = json.loads(cohort_path.read_text(encoding="utf-8"))
        cohort["public_seed"] += 1
        write_json(cohort_path, cohort)
        with self.assertRaisesRegex(locker.LockError, "preregistered protocol"):
            locker.create_prediction_lock(self.root)

    def test_attempt_artifact_hashes_cannot_differ(self) -> None:
        timing_path = self.fixture.timing_path(1)
        timing = json.loads(timing_path.read_text(encoding="utf-8"))
        timing["attempt_records"][0]["artifact_hashes"]["runner_sha256"] = "0" * 64
        write_json(timing_path, timing)
        with self.assertRaisesRegex(locker.LockError, "artifact_hashes"):
            locker.create_prediction_lock(self.root)


if __name__ == "__main__":
    unittest.main()
