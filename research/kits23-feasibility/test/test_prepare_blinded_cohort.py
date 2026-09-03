from __future__ import annotations

import csv
import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path


PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT))

import prepare_blinded_cohort as cohort  # noqa: E402


EXPECTED_CASE_IDS = (
    "case_00474",
    "case_00537",
    "case_00572",
    "case_00501",
    "case_00465",
    "case_00546",
    "case_00585",
    "case_00468",
    "case_00584",
    "case_00459",
    "case_00503",
    "case_00504",
    "case_00542",
    "case_00505",
    "case_00523",
    "case_00583",
    "case_00462",
    "case_00498",
    "case_00502",
    "case_00510",
)
LOCK_FIELDS = {
    "schema_version",
    "protocol_namespace",
    "public_seed",
    "eligible_start",
    "eligible_end",
    "eligible_count",
    "eligible_list_sha256",
    "selection_count",
    "selection_algorithm",
    "manifest_sha256",
    "manifest_columns",
    "case_ids",
    "selection_hashes",
    "imaging_repository",
    "imaging_revision",
    "total_image_bytes",
    "created_utc",
    "research_only",
    "disclaimer",
}


class PrepareBlindedCohortTests(unittest.TestCase):
    def make_image_cache(self, root: Path) -> Path:
        cache = root / "image-cache"
        cache.mkdir()
        for index, case_id in enumerate(EXPECTED_CASE_IDS, start=1):
            (cache / f"{case_id}.nii.gz").write_bytes(
                b"offline-image-fixture\0" + case_id.encode("ascii") + bytes([index])
            )
        return cache

    def prepare(self, *args: object, **kwargs: object) -> dict[str, object]:
        with contextlib.redirect_stdout(io.StringIO()):
            return cohort.prepare_cohort(*args, **kwargs)

    def test_protocol_fixture_and_eligible_list_identity(self) -> None:
        eligible = cohort.eligible_case_ids()
        self.assertEqual(len(eligible), 169)
        self.assertEqual(eligible[0], "case_00420")
        self.assertEqual(eligible[-1], "case_00588")
        self.assertEqual(
            hashlib.sha256(cohort.eligible_list_bytes(eligible)).hexdigest(),
            "201fe1201cb06b666b1a497ddb0fd44edfe07fd8d9ed078d3db2bd82657acdea",
        )
        selected = cohort.selected_cases()
        self.assertEqual(tuple(case_id for case_id, _ in selected), EXPECTED_CASE_IDS)
        for case_id, digest in selected:
            expected_material = (
                f"calyxview-renal-kits23-blinded-v1|seed=20260901|{case_id}"
            ).encode("utf-8")
            self.assertEqual(digest, hashlib.sha256(expected_material).hexdigest())

    def test_prepares_only_images_exact_manifest_and_public_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = self.make_image_cache(root)
            run_root = root / "run"
            lock = self.prepare(
                run_root, cache, created_utc="2026-09-01T00:00:00Z"
            )

            manifest_path = run_root / "manifests" / "manifest.csv"
            with manifest_path.open("r", newline="", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                rows = list(reader)
                self.assertEqual(tuple(reader.fieldnames or ()), cohort.MANIFEST_COLUMNS)
            self.assertEqual(len(rows), 20)
            self.assertEqual(tuple(row["case_id"] for row in rows), EXPECTED_CASE_IDS)
            self.assertEqual([int(row["selection_order"]) for row in rows], list(range(1, 21)))
            self.assertTrue(all(set(row) == set(cohort.MANIFEST_COLUMNS) for row in rows))

            lock_path = run_root / "manifests" / "cohort-lock.public.json"
            on_disk_lock = json.loads(lock_path.read_text(encoding="utf-8"))
            self.assertEqual(lock, on_disk_lock)
            self.assertEqual(set(lock), LOCK_FIELDS)
            self.assertEqual(lock["schema_version"], 1)
            self.assertEqual(lock["case_ids"], list(EXPECTED_CASE_IDS))
            self.assertEqual(lock["manifest_columns"], list(cohort.MANIFEST_COLUMNS))
            self.assertEqual(
                lock["manifest_sha256"], hashlib.sha256(manifest_path.read_bytes()).hexdigest()
            )
            self.assertTrue(lock["research_only"])

            source_names = sorted(path.name for path in (run_root / "source" / "images").iterdir())
            input_names = sorted(path.name for path in (run_root / "nnunet_input").iterdir())
            self.assertEqual(source_names, sorted(f"{case_id}.nii.gz" for case_id in EXPECTED_CASE_IDS))
            self.assertEqual(
                input_names,
                sorted(f"{case_id}_0000.nii.gz" for case_id in EXPECTED_CASE_IDS),
            )

            manifest_before = manifest_path.read_bytes()
            lock_before = lock_path.read_bytes()
            self.prepare(run_root, cache)
            self.assertEqual(manifest_path.read_bytes(), manifest_before)
            self.assertEqual(lock_path.read_bytes(), lock_before)

    def test_rejects_annotation_like_path_before_acquisition(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = self.make_image_cache(root)
            run_root = root / "run"
            (run_root / "labels").mkdir(parents=True)
            (run_root / "labels" / "case_00474.nii.gz").write_bytes(b"not-allowed")
            with self.assertRaises(cohort.ReferenceContentError):
                self.prepare(run_root, cache)
            self.assertFalse((run_root / "manifests" / "manifest.csv").exists())

    def test_rejects_common_nnunet_annotation_folder_name(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = self.make_image_cache(root)
            run_root = root / "run"
            (run_root / "labelsTr").mkdir(parents=True)
            with self.assertRaises(cohort.ReferenceContentError):
                self.prepare(run_root, cache)

    def test_rejects_annotation_like_structured_key(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = self.make_image_cache(root)
            run_root = root / "run"
            run_root.mkdir()
            (run_root / "unexpected.json").write_text(
                json.dumps({"label_sha256": "forbidden"}), encoding="utf-8"
            )
            with self.assertRaises(cohort.ReferenceContentError):
                self.prepare(run_root, cache)

    def test_locked_manifest_cannot_be_changed_by_rerun(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = self.make_image_cache(root)
            run_root = root / "run"
            self.prepare(run_root, cache, created_utc="2026-09-01T00:00:00Z")
            manifest = run_root / "manifests" / "manifest.csv"
            manifest.write_bytes(manifest.read_bytes() + b"tampered\n")
            with self.assertRaises(RuntimeError):
                self.prepare(run_root, cache)

    def test_rejects_extra_inference_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = self.make_image_cache(root)
            run_root = root / "run"
            (run_root / "nnunet_input").mkdir(parents=True)
            (run_root / "nnunet_input" / "unexpected.txt").write_text(
                "not part of the frozen cohort", encoding="utf-8"
            )
            with self.assertRaises(RuntimeError):
                self.prepare(run_root, cache)

    def test_cli_has_no_annotation_path_option(self) -> None:
        option_strings = {
            option
            for action in cohort.build_parser()._actions
            for option in action.option_strings
        }
        self.assertEqual(
            option_strings,
            {"-h", "--help", "--run-root", "--image-source-dir"},
        )


if __name__ == "__main__":
    unittest.main()
