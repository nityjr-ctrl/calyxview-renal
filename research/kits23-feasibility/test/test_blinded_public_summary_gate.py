from __future__ import annotations

import hashlib
import csv
import json
import math
import stat
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT))

import make_blinded_public_summary as public_gate  # noqa: E402


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class BlindedPublicFixture:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.run_root = root / "run"
        self.release_root = root / "release"
        self.report_root = self.release_root / "report"
        self.output = root / "public" / "summary.public.json"
        self.cohort_path = self.run_root / "manifests" / "cohort-lock.public.json"
        self.model_path = self.run_root / "manifests" / "model-lock.json"
        self.prediction_path = self.run_root / "prediction-lock.json"
        self.release_path = self.release_root / "reference-release.json"
        self.summary_path = self.report_root / "summary.json"
        self.run_root.mkdir(parents=True)
        self.report_root.mkdir(parents=True)
        self.cohort = self._write_cohort()
        self.cohort_sha256 = sha256_file(self.cohort_path)
        self.model = self._write_model()
        self.model_sha256 = sha256_file(self.model_path)
        self.provenance = self._provenance()
        self.prediction_lock = self._write_prediction_lock()
        self.prediction_sha256 = sha256_file(self.prediction_path)
        (self.run_root / "prediction-lock.sha256").write_text(
            self.prediction_sha256 + "\n", encoding="ascii", newline="\n"
        )
        self.rows = self._write_case_results()
        self.release = self._write_release()
        self.release_sha256 = sha256_file(self.release_path)
        self.summary = self._write_summary()
        self.refresh_evaluator_receipt()

    def _write_cohort(self) -> dict[str, object]:
        cohort = {
            "schema_version": 1,
            "protocol_namespace": public_gate.PROTOCOL_NAMESPACE,
            "public_seed": public_gate.PUBLIC_SEED,
            "eligible_start": public_gate.ELIGIBLE_START,
            "eligible_end": public_gate.ELIGIBLE_END,
            "eligible_count": public_gate.ELIGIBLE_COUNT,
            "eligible_list_sha256": public_gate.ELIGIBLE_LIST_SHA256,
            "selection_count": public_gate.EXPECTED_CASES,
            "selection_algorithm": public_gate.SELECTION_ALGORITHM,
            "manifest_sha256": "a" * 64,
            "manifest_columns": [
                "case_id",
                "selection_order",
                "selection_hash",
                "image_sha256",
                "image_bytes",
            ],
            "case_ids": list(public_gate.EXPECTED_CASE_IDS),
            "selection_hashes": public_gate._expected_selection_hashes(),
            "imaging_repository": public_gate.IMAGING_REPOSITORY,
            "imaging_revision": public_gate.IMAGING_REVISION,
            "total_image_bytes": 123_456_789,
            "created_utc": "2026-09-01T10:00:00Z",
            "research_only": True,
            "disclaimer": "Research prototype only. Not for patient care.",
        }
        write_json(self.cohort_path, cohort)
        return cohort

    def _write_model(self) -> dict[str, object]:
        model = {
            "schema_version": 1,
            "research_only": True,
            "created_at_utc": "2026-09-01T10:05:00Z",
            "disclaimer": "Research prototype only. Not for patient care.",
            "model": "Published nnU-Net v1 KiTS21 ensemble",
            "task": "Task135_KiTS2021",
            "configuration": "3d_fullres",
            "folds": [0, 1, 2, 3, 4],
            "tta_enabled": False,
            "source_archive": {
                "sha256": public_gate.MODEL_ARCHIVE_SHA256,
                "bytes": public_gate.MODEL_ARCHIVE_BYTES,
            },
            "nnunet_source_commit": public_gate.NNUNET_COMMIT,
            "installed_plans": public_gate.EXPECTED_PLANS,
            "installed_folds": public_gate.EXPECTED_FOLDS,
            "pipeline_source_artifact_hashes": {
                key: sha256_file(PIPELINE_ROOT / filename)
                for key, filename in public_gate.PROVENANCE_SOURCE_FILES.items()
            },
            "provenance_note": "Verified before inference.",
        }
        write_json(self.model_path, model)
        return model

    def _provenance(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "research_only": True,
            "created_utc": "2026-09-01T15:00:00Z",
            "disclaimer": "Research prototype only.",
            "protocol_mode": "script_blinded_full_denominator",
            "manifest_sha256": self.cohort["manifest_sha256"],
            "cohort_lock_sha256": self.cohort_sha256,
            "model_lock_sha256": self.model_sha256,
            "cohort": {
                "ct_inputs_verified": public_gate.EXPECTED_CASES,
                "ct_input_bytes": 123_456_789,
                "ct_input_set_sha256": "b" * 64,
                "source_copies_verified": public_gate.EXPECTED_CASES,
            },
            "model": {
                "nnunet_source_commit": public_gate.NNUNET_COMMIT,
                "tracked_source_clean": True,
                "source_archive": {
                    "bytes": public_gate.MODEL_ARCHIVE_BYTES,
                    "sha256": public_gate.MODEL_ARCHIVE_SHA256,
                },
                "installed_plans": public_gate.EXPECTED_PLANS,
                "installed_folds": public_gate.EXPECTED_FOLDS,
                "folds": [0, 1, 2, 3, 4],
                "tta_enabled": False,
            },
            "source_artifacts": self.model["pipeline_source_artifact_hashes"],
            "execution": {
                "attempted_cases": public_gate.EXPECTED_CASES,
                "timing_records_verified": public_gate.EXPECTED_CASES,
                "timing_set_sha256": "e" * 64,
                "attempts_verified": 21,
                "succeeded_predictions": 19,
                "exhausted_failures": 1,
                "prediction_bytes": 987_654,
                "prediction_set_sha256": "f" * 64,
                "bound_logs_verified": 44,
                "bound_log_set_sha256": "1" * 64,
                "runtime_seconds": 200.0,
                "full_denominator_preserved": True,
            },
            "runtime": {"python": "3.14"},
            "data_access": {
                "annotation_data_accessed": False,
                "ct_voxel_arrays_loaded": False,
                "case_level_metrics_emitted": False,
                "absolute_or_relative_paths_emitted": False,
            },
        }

    def _write_prediction_lock(self) -> dict[str, object]:
        cases = []
        image_copies = []
        for position, case_id in enumerate(public_gate.EXPECTED_CASE_IDS, start=1):
            failed = position == public_gate.EXPECTED_CASES
            image_sha256 = hashlib.sha256(f"image-{position}".encode()).hexdigest()
            image_bytes = 10_000 + position
            configuration_sha256 = hashlib.sha256(
                f"configuration-{position}".encode()
            ).hexdigest()
            image_copies.append(
                {
                    "case_id": case_id,
                    "selection_order": position,
                    "selection_hash": public_gate._expected_selection_hashes()[position - 1],
                    "image_sha256": image_sha256,
                    "image_bytes": image_bytes,
                    "input_relative": f"nnunet_input/{case_id}_0000.nii.gz",
                    "source_cache_relative": f"source/images/{case_id}.nii.gz",
                }
            )
            attempt_statuses = ["failed", "failed"] if failed else ["succeeded"]
            attempts = []
            for attempt_number, attempt_status in enumerate(attempt_statuses, start=1):
                log_names = [
                    f"logs/{case_id}.attempt-{attempt_number}.stdout.log",
                    f"logs/{case_id}.attempt-{attempt_number}.stderr.log",
                ]
                if attempt_status == "succeeded":
                    log_names.extend(
                        [
                            f"logs/{case_id}.attempt-{attempt_number}.validation.stdout.log",
                            f"logs/{case_id}.attempt-{attempt_number}.validation.stderr.log",
                        ]
                    )
                attempts.append(
                    {
                        "attempt": attempt_number,
                        "status": attempt_status,
                        "runtime_seconds": 5.0 if failed else 10.0,
                        "configuration_sha256": configuration_sha256,
                        "logs": [
                            {
                                "relative": relative,
                                "sha256": hashlib.sha256(relative.encode()).hexdigest(),
                                "bytes": 0,
                            }
                            for relative in log_names
                        ],
                    }
                )
            cases.append(
                {
                    "case_id": case_id,
                    "selection_order": position,
                    "status": "failed" if failed else "succeeded",
                    "input_image_relative": f"nnunet_input/{case_id}_0000.nii.gz",
                    "input_image_sha256": image_sha256,
                    "input_image_bytes": image_bytes,
                    "timing_relative": f"timings/{case_id}.json",
                    "timing_sha256": hashlib.sha256(f"timing-{position}".encode()).hexdigest(),
                    "timing_bytes": 1_000 + position,
                    "configuration_sha256": configuration_sha256,
                    "attempts": attempts,
                    "prediction": (
                        None
                        if failed
                        else {
                            "relative": f"predictions/{case_id}.nii.gz",
                            "sha256": hashlib.sha256(
                                f"prediction-{position}".encode()
                            ).hexdigest(),
                            "bytes": 2_000 + position,
                            "geometry_validated_against_ct": True,
                            "shape": [2, 3, 4],
                        }
                    ),
                }
            )
        lock = {
            "schema_version": 1,
            "lock_type": "prediction_lock_before_reference_release",
            "created_at_utc": "2026-09-01T15:05:00Z",
            "research_only": True,
            "disclaimer": "Research prototype only.",
            "reference_state": {
                "reference_material_present": False,
                "reference_material_loaded": False,
                "custody_claim": "script_inference_blinded_not_independently_custodied",
            },
            "cohort": {
                "case_count": public_gate.EXPECTED_CASES,
                "manifest_relative": "manifests/manifest.csv",
                "manifest_sha256": self.cohort["manifest_sha256"],
                "manifest_bytes": 5000,
                "cohort_lock_relative": "manifests/cohort-lock.public.json",
                "cohort_lock_sha256": self.cohort_sha256,
                "cohort_lock_bytes": self.cohort_path.stat().st_size,
                "protocol_namespace": public_gate.PROTOCOL_NAMESPACE,
                "public_seed": public_gate.PUBLIC_SEED,
                "case_ids": list(public_gate.EXPECTED_CASE_IDS),
                "selection_hashes": public_gate._expected_selection_hashes(),
            },
            "model": {
                "model_lock_relative": "manifests/model-lock.json",
                "model_lock_sha256": self.model_sha256,
                "model_lock_bytes": self.model_path.stat().st_size,
                "frozen_model_lock": self.model,
            },
            "pipeline_artifact_hashes": {
                key: self.provenance["source_artifacts"][key]
                for key in public_gate.PIPELINE_ARTIFACT_KEYS
            },
            "pipeline_source_artifact_hashes": self.provenance["source_artifacts"],
            "locking_tool": {
                "name": "lock_predictions.py",
                "sha256": self.provenance["source_artifacts"][
                    "prediction_locker_sha256"
                ],
            },
            "inference_provenance": {
                "relative": "provenance.inference.json",
                "sha256": "4" * 64,
                "bytes": 8000,
                "frozen_provenance": self.provenance,
            },
            "inference": {
                "status": "complete_with_failures",
                "evaluated_cases": public_gate.EXPECTED_CASES,
                "successful_predictions": 19,
                "failed_predictions": 1,
                "all_timing_records_verified": True,
                "all_successes_geometry_validated_against_ct": True,
                "all_failures_exhausted_two_attempts": True,
                "image_copies": image_copies,
                "cases": cases,
            },
        }
        write_json(self.prediction_path, lock)
        return lock

    def _write_release(self) -> dict[str, object]:
        release = {
            "schema_version": 1,
            "release_type": "reference_release_after_prediction_lock",
            "released_at_utc": "2026-09-01T15:10:00Z",
            "research_only": True,
            "disclaimer": "Research prototype only.",
            "custody_mode": "same_operator_script_blinded",
            "operator_blinded": False,
            "custody_limitation": (
                "Same operator/account could access KiTS references; this run is "
                "script/inference-blinded, not independently operator-blinded."
            ),
            "prediction_lock_sha256": self.prediction_sha256,
            "cohort_lock_sha256": self.cohort_sha256,
            "manifest_sha256": self.cohort["manifest_sha256"],
            "public_prediction_lock_receipt": {
                "url": (
                    "https://raw.githubusercontent.com/example/project/"
                    + "5" * 40
                    + "/research/kits23-feasibility/prediction-lock.sha256"
                ),
                "repository": "https://github.com/example/project",
                "commit": "5" * 40,
                "verified_at_utc": "2026-09-01T15:09:00Z",
            },
            "kits23_repository": public_gate.KITS23_REPOSITORY,
            "kits23_commit": public_gate.KITS23_COMMIT,
            "case_count": public_gate.EXPECTED_CASES,
            "case_ids": list(public_gate.EXPECTED_CASE_IDS),
            "cases": [
                {
                    "case_id": case_id,
                    "relative": f"references/{case_id}.nii.gz",
                    "sha256": f"{(position + 5) % 16:x}" * 64,
                    "bytes": 1000 + position,
                }
                for position, case_id in enumerate(public_gate.EXPECTED_CASE_IDS)
            ],
        }
        write_json(self.release_path, release)
        return release

    def _write_case_results(self) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for position, case_id in enumerate(public_gate.EXPECTED_CASE_IDS, start=1):
            failed = position == public_gate.EXPECTED_CASES
            row: dict[str, object] = {field: "" for field in public_gate.CSV_FIELDS}
            row.update(
                {
                    "case_id": case_id,
                    "status": "failed" if failed else "ok",
                    "failure_reason": "Qualified attempts exhausted." if failed else "",
                    "inference_status": "failed" if failed else "succeeded",
                    "runtime_seconds": 10.0,
                    "shape": "2x3x4",
                    "spacing_mm": "1x1x1",
                    "reference_label_values": "0;1;2;3",
                    "prediction_label_values": "" if failed else "0;1;2;3",
                }
            )
            dice_values: list[float] = []
            surface_values: list[float] = []
            hd95_values: list[float] = []
            for region_index, region in enumerate(public_gate.REGION_MAP.values()):
                dice = 0.0 if failed else 0.70 + 0.03 * region_index + 0.002 * position
                surface = (
                    0.0 if failed else 0.65 + 0.025 * region_index + 0.002 * position
                )
                hd95 = math.sqrt(14.0) if failed else 3.0 + region_index + 0.05 * position
                absolute_error = 20.0 + region_index if failed else 1.0
                row.update(
                    {
                        f"{region}_dice": dice,
                        f"{region}_surface_dice": surface,
                        f"{region}_surface_tolerance_mm": public_gate.REGION_TOLERANCES_MM[
                            region
                        ],
                        f"{region}_hd95_mm": hd95,
                        f"{region}_reference_volume_ml": 20.0 + region_index,
                        f"{region}_prediction_volume_ml": (
                            0.0 if failed else 19.0 + region_index
                        ),
                        f"{region}_volume_error_ml": (
                            -(20.0 + region_index) if failed else -1.0
                        ),
                        f"{region}_absolute_volume_error_ml": absolute_error,
                        f"{region}_relative_volume_error_pct": -5.0,
                    }
                )
                dice_values.append(dice)
                surface_values.append(surface)
                hd95_values.append(hd95)
            row["mean_dice"] = sum(dice_values) / 3
            row["mean_surface_dice"] = sum(surface_values) / 3
            row["mean_hd95_mm"] = sum(hd95_values) / 3
            rows.append(row)

        results_path = self.report_root / "case-results.csv"
        with results_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=public_gate.CSV_FIELDS)
            writer.writeheader()
            for row in rows:
                writer.writerow(
                    {
                        key: f"{value:.10g}" if isinstance(value, float) else value
                        for key, value in row.items()
                    }
                )
        return rows

    def _write_summary(self) -> dict[str, object]:
        recomputed = public_gate.verify_and_recompute_case_results(
            self.summary_path, self.prediction_lock
        )
        summary = {
            "title": "CalyxView Renal — 20-case KiTS23 script-blinded evaluation",
            "generated_at_utc": "2026-09-01T15:20:00Z",
            "disclaimer": (
                "RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE. NOT FOR DIAGNOSIS, "
                "TREATMENT SELECTION, SURGICAL PLANNING, OR PATIENT CARE."
            ),
            "research_only": True,
            "manifest": {
                "path": "manifests/manifest.csv",
                "sha256": self.cohort["manifest_sha256"],
                "path_free": True,
                "image_only_five_column_contract": True,
                "case_count": public_gate.EXPECTED_CASES,
            },
            "completion": {
                "manifest_cases": public_gate.EXPECTED_CASES,
                "evaluated_successfully": 19,
                "failed": 1,
                "success_rate": 19 / 20,
                "failed_cases_in_metric_denominator": True,
                "failure_rule": "Failures receive conservative full-denominator penalties.",
                "failures": [
                    {
                        "case_id": public_gate.EXPECTED_CASE_IDS[-1],
                        "reason": "Qualified attempts were exhausted.",
                    }
                ],
            },
            "bootstrap": {
                "method": "non-parametric case bootstrap of the arithmetic mean",
                "samples": 10_000,
                "seed": public_gate.PUBLIC_SEED,
                "confidence_interval": "percentile 2.5% to 97.5%",
            },
            "regions": recomputed["regions"],
            "overall": {
                "mean_dice_across_regions_per_case": recomputed["overall"]["mean_dice"],
                "mean_surface_dice_across_regions_per_case": recomputed["overall"][
                    "mean_surface_dice"
                ],
                "mean_hd95_mm_across_regions_per_case": recomputed["overall"][
                    "mean_hd95_mm"
                ],
            },
            "runtime_seconds": recomputed["runtime_seconds"],
            "timing_warnings": [],
            "privacy": {
                "patient_metadata_in_report": False,
                "source_ct_in_report": False,
                "source_nifti_or_predictions_in_report": False,
                "qc_content": "Private report content only.",
            },
            "blinding_and_custody": {
                "mode": "script_inference_blinded",
                "operator_blinded": self.release["operator_blinded"],
                "custody_mode": self.release["custody_mode"],
                "custody_limitation": self.release["custody_limitation"],
                "prediction_lock_sha256": self.prediction_sha256,
                "cohort_lock_sha256": self.cohort_sha256,
                "manifest_sha256": self.cohort["manifest_sha256"],
                "reference_release_sha256": self.release_sha256,
                "public_prediction_lock_receipt": self.release[
                    "public_prediction_lock_receipt"
                ],
            },
            "execution_provenance": self.provenance,
            "metric_specification": {"private": True},
            "software": {"private": True},
            "worst_case_gallery": {
                "case_ids": list(public_gate.EXPECTED_CASE_IDS[:3]),
                "html": "worst-cases.html",
            },
            "artifacts": {"case_results_csv": "case-results.csv"},
        }
        write_json(self.summary_path, summary)
        return summary

    def refresh_evaluator_receipt(self) -> None:
        fixed_files = {
            "report.html": b"fixture report\n",
            "worst-cases.html": b"fixture gallery\n",
            "worst-cases.png": b"fixture png\n",
            **{
                f"qc/{case_id}.png": f"fixture {case_id}\n".encode()
                for case_id in public_gate.EXPECTED_CASE_IDS
            },
        }
        for relative, payload in fixed_files.items():
            destination = self.report_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                destination.write_bytes(payload)
        report_files = sorted(
            path
            for path in self.report_root.rglob("*")
            if path.is_file() and path.name != "output-hashes.json"
        )
        write_json(
            self.report_root / "output-hashes.json",
            {
                "schema_version": 1,
                "research_only": True,
                "generated_at_utc": "2026-09-01T15:21:00Z",
                "files": [
                    {
                        "path": path.relative_to(self.report_root).as_posix(),
                        "bytes": path.stat().st_size,
                        "sha256": sha256_file(path),
                    }
                    for path in report_files
                ],
            },
        )

    def build(self) -> dict[str, object]:
        return public_gate.build_public_summary(
            summary_path=self.summary_path,
            cohort_lock_path=self.cohort_path,
            model_lock_path=self.model_path,
            prediction_lock_path=self.prediction_path,
            reference_release_path=self.release_path,
        )


class BlindedPublicSummaryGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.fixture = BlindedPublicFixture(Path(self.temporary.name))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_valid_evidence_emits_only_aggregate_privacy_safe_schema(self) -> None:
        public = self.fixture.build()
        digest = public_gate.write_public_summary(self.fixture.output, public)
        self.assertEqual(public["schemaVersion"], 3)
        self.assertEqual(public["completion"]["evaluatedCases"], 20)
        self.assertEqual(public["completion"]["failedCases"], 1)
        public_gate.assert_public_privacy(public)
        serialized = self.fixture.output.read_text(encoding="utf-8")
        self.assertEqual(digest, sha256_file(self.fixture.output))
        self.assertIsNone(public_gate.CASE_ID_ANYWHERE_RE.search(serialized))
        self.assertNotIn("failure_reason", serialized.lower())
        self.assertNotIn(".nii", serialized.lower())
        self.assertNotIn(":\\", serialized)
        self.assertNotIn("https://", serialized.lower())
        for region in public["metrics"].values():
            for metric in region.values():
                self.assertEqual(metric["n"], 20)
        for metric in public["overall"].values():
            self.assertEqual(metric["n"], 20)
        self.assertEqual(public["runtime"]["n"], 20)

    def test_incomplete_denominator_is_rejected_even_with_fresh_receipt(self) -> None:
        self.fixture.summary["completion"]["manifest_cases"] = 19
        write_json(self.fixture.summary_path, self.fixture.summary)
        self.fixture.refresh_evaluator_receipt()
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "denominator"):
            self.fixture.build()

    def test_every_published_metric_requires_n_twenty(self) -> None:
        self.fixture.summary["regions"]["tumour"]["dice"]["n"] = 19
        write_json(self.fixture.summary_path, self.fixture.summary)
        self.fixture.refresh_evaluator_receipt()
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "must equal 20"):
            self.fixture.build()

    def test_summary_tampering_after_hash_manifest_is_rejected(self) -> None:
        self.fixture.summary["regions"]["tumour"]["dice"]["mean"] = 0.99
        write_json(self.fixture.summary_path, self.fixture.summary)
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "modified"):
            self.fixture.build()

    def test_fresh_receipt_cannot_legitimize_fabricated_metric(self) -> None:
        self.fixture.summary["regions"]["tumour"]["dice"]["mean"] = 0.50
        write_json(self.fixture.summary_path, self.fixture.summary)
        self.fixture.refresh_evaluator_receipt()
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "recomputed case results"):
            self.fixture.build()

    def test_locked_failure_cannot_be_rewarded_in_case_results(self) -> None:
        results_path = self.fixture.report_root / "case-results.csv"
        with results_path.open("r", newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        for region in public_gate.REGION_MAP.values():
            rows[-1][f"{region}_dice"] = "1"
            rows[-1][f"{region}_surface_dice"] = "1"
        rows[-1]["mean_dice"] = "1"
        rows[-1]["mean_surface_dice"] = "1"
        with results_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=public_gate.CSV_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        self.fixture.refresh_evaluator_receipt()
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "preregistered metric penalty"):
            self.fixture.build()

    def test_prediction_lock_receipt_tampering_is_rejected(self) -> None:
        (self.fixture.run_root / "prediction-lock.sha256").write_text(
            "0" * 64 + "\n", encoding="ascii"
        )
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "does not match"):
            self.fixture.build()

    def test_truncated_self_consistent_prediction_lock_is_rejected(self) -> None:
        del self.fixture.prediction_lock["pipeline_artifact_hashes"]["validator_sha256"]
        write_json(self.fixture.prediction_path, self.fixture.prediction_lock)
        changed_sha256 = sha256_file(self.fixture.prediction_path)
        (self.fixture.run_root / "prediction-lock.sha256").write_text(
            changed_sha256 + "\n", encoding="ascii", newline="\n"
        )
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "key set is not exact"):
            self.fixture.build()

    def test_release_cannot_be_rebound_to_another_lock(self) -> None:
        self.fixture.release["prediction_lock_sha256"] = "9" * 64
        write_json(self.fixture.release_path, self.fixture.release)
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "does not bind"):
            self.fixture.build()

    def test_release_receipt_requires_exact_commit_pinned_structure(self) -> None:
        receipt = self.fixture.release["public_prediction_lock_receipt"]
        self.assertIsInstance(receipt, dict)
        receipt["repository"] = "https://github.com/example/another-project"
        write_json(self.fixture.release_path, self.fixture.release)
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "repository"):
            self.fixture.build()

    def test_reversed_evidence_chronology_is_rejected(self) -> None:
        self.fixture.release["released_at_utc"] = "2026-09-01T09:00:00Z"
        write_json(self.fixture.release_path, self.fixture.release)
        changed_release_sha256 = sha256_file(self.fixture.release_path)
        self.fixture.summary["blinding_and_custody"][
            "reference_release_sha256"
        ] = changed_release_sha256
        write_json(self.fixture.summary_path, self.fixture.summary)
        self.fixture.refresh_evaluator_receipt()
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "chronology"):
            self.fixture.build()

    def test_any_hashed_report_artifact_tampering_is_rejected(self) -> None:
        (self.fixture.report_root / "report.html").write_text(
            "tampered report\n", encoding="utf-8"
        )
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "report.html was modified"):
            self.fixture.build()

    def test_cohort_and_model_lock_tampering_are_rejected(self) -> None:
        tamper_cases = (
            (self.fixture.cohort_path, self.fixture.cohort, "public_seed", 7, "Cohort"),
            (self.fixture.model_path, self.fixture.model, "tta_enabled", True, "Model"),
        )
        for path, original, key, value, expected_message in tamper_cases:
            with self.subTest(key=key):
                changed = dict(original)
                changed[key] = value
                write_json(path, changed)
                with self.assertRaisesRegex(public_gate.PublicSummaryError, expected_message):
                    self.fixture.build()
                write_json(path, original)

    def test_model_lock_requires_exact_ten_source_hashes(self) -> None:
        del self.fixture.model["pipeline_source_artifact_hashes"]["evaluator_sha256"]
        write_json(self.fixture.model_path, self.fixture.model)
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "key set is not exact"):
            self.fixture.build()

    def test_prediction_sources_must_equal_preinference_model_lock(self) -> None:
        prediction_lock = json.loads(
            self.fixture.prediction_path.read_text(encoding="utf-8")
        )
        prediction_lock["pipeline_source_artifact_hashes"]["evaluator_sha256"] = "0" * 64
        prediction_lock["inference_provenance"]["frozen_provenance"][
            "source_artifacts"
        ]["evaluator_sha256"] = "0" * 64
        write_json(self.fixture.prediction_path, prediction_lock)
        changed_sha256 = sha256_file(self.fixture.prediction_path)
        (self.fixture.run_root / "prediction-lock.sha256").write_text(
            changed_sha256 + "\n", encoding="ascii", newline="\n"
        )
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "pre-inference model lock"):
            self.fixture.build()

    def test_live_evaluator_must_match_preinference_source_hash(self) -> None:
        self.fixture.model["pipeline_source_artifact_hashes"]["evaluator_sha256"] = "0" * 64
        write_json(self.fixture.model_path, self.fixture.model)
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "evaluate_and_report.py differs"):
            self.fixture.build()

    def test_private_case_details_are_allowlisted_out_of_public_output(self) -> None:
        self.fixture.summary["private_extra"] = {
            "case_id": public_gate.EXPECTED_CASE_IDS[0],
            "failure_reason": "private-only detail",
            "path": "C:\\private\\study.nii.gz",
        }
        write_json(self.fixture.summary_path, self.fixture.summary)
        self.fixture.refresh_evaluator_receipt()
        public = self.fixture.build()
        serialized = json.dumps(public)
        self.assertNotIn("private_extra", serialized)
        self.assertNotIn(public_gate.EXPECTED_CASE_IDS[0], serialized)
        public_gate.assert_public_privacy(public)

    def test_privacy_guard_rejects_paths_urls_case_ids_and_per_case_arrays(self) -> None:
        unsafe_values = (
            {"localPath": "C:\\private\\value"},
            {"safe": "https://example.invalid/value"},
            {"safe": public_gate.EXPECTED_CASE_IDS[0]},
            {"safe": [{"value": 1}]},
        )
        for unsafe in unsafe_values:
            with self.subTest(unsafe=unsafe):
                with self.assertRaises(public_gate.PublicSummaryError):
                    public_gate.assert_public_privacy(unsafe)

    def test_different_existing_public_summary_is_never_overwritten(self) -> None:
        public = self.fixture.build()
        self.fixture.output.parent.mkdir(parents=True)
        self.fixture.output.write_text("different\n", encoding="utf-8")
        with self.assertRaisesRegex(public_gate.PublicSummaryError, "replace"):
            public_gate.write_public_summary(self.fixture.output, public)
        self.assertEqual(self.fixture.output.read_text(encoding="utf-8"), "different\n")

    def test_input_symlink_is_rejected_before_resolution(self) -> None:
        link = self.fixture.root / "linked" / "cohort-lock.public.json"
        link.parent.mkdir(parents=True)
        real_lstat = Path.lstat

        def link_aware_lstat(candidate: Path):
            if candidate == link:
                return mock.Mock(st_mode=stat.S_IFLNK)
            return real_lstat(candidate)

        with mock.patch.object(Path, "lstat", link_aware_lstat):
            with self.assertRaisesRegex(public_gate.PublicSummaryError, "symlink or junction"):
                public_gate.build_public_summary(
                    summary_path=self.fixture.summary_path,
                    cohort_lock_path=link,
                    model_lock_path=self.fixture.model_path,
                    prediction_lock_path=self.fixture.prediction_path,
                    reference_release_path=self.fixture.release_path,
                )

    def test_output_symlink_cannot_redirect_publication(self) -> None:
        public = self.fixture.build()
        target = self.fixture.root / "redirect-target.json"
        target.write_text("protected\n", encoding="utf-8")
        link = self.fixture.root / "redirect" / "summary.public.json"
        link.parent.mkdir(parents=True)
        real_lstat = Path.lstat

        def link_aware_lstat(candidate: Path):
            if candidate == link:
                return mock.Mock(st_mode=stat.S_IFLNK)
            return real_lstat(candidate)

        with mock.patch.object(Path, "lstat", link_aware_lstat):
            with self.assertRaisesRegex(public_gate.PublicSummaryError, "replace"):
                public_gate.write_public_summary(link, public)
        self.assertEqual(target.read_text(encoding="utf-8"), "protected\n")


if __name__ == "__main__":
    unittest.main()
