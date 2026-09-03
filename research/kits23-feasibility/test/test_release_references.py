from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT))

import release_references as release  # noqa: E402


class ReleaseReferenceTests(unittest.TestCase):
    def make_prediction_lock(self, run_root: Path) -> tuple[Path, str, list[str]]:
        run_root.mkdir(parents=True)
        case_ids = [f"case_{number:05d}" for number in range(420, 440)]
        payload = {
            "schema_version": 1,
            "lock_type": "prediction_lock_before_reference_release",
            "research_only": True,
            "reference_state": {
                "reference_material_present": False,
                "reference_material_loaded": False,
                "custody_claim": "script_inference_blinded_not_independently_custodied",
            },
            "cohort": {
                "case_ids": case_ids,
                "cohort_lock_sha256": "1" * 64,
                "manifest_sha256": "2" * 64,
            },
        }
        path = run_root / "prediction-lock.json"
        path.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
        return path, release.sha256_file(path), case_ids

    @staticmethod
    def raw_url() -> str:
        return (
            "https://raw.githubusercontent.com/example/repository/"
            + "a" * 40
            + "/research/blinded/prediction-lock.sha256"
        )

    def test_releases_only_after_matching_public_digest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prediction_lock, digest, case_ids = self.make_prediction_lock(
                root / "inference"
            )
            kits = root / "kits23"
            for case_id in case_ids:
                reference = kits / "dataset" / case_id / "segmentation.nii.gz"
                reference.parent.mkdir(parents=True)
                reference.write_bytes(b"reference-fixture\0" + case_id.encode("ascii"))
            output = root / "evaluation" / "reference-release"
            opener = lambda _request, timeout: io.BytesIO((digest + "\n").encode("ascii"))
            with mock.patch.object(
                release, "git_commit", return_value=release.EXPECTED_KITS23_COMMIT
            ):
                record = release.release_references(
                    prediction_lock_path=prediction_lock,
                    published_digest_url=self.raw_url(),
                    kits23_repo=kits,
                    output_root=output,
                    custody_mode="same_operator_script_blinded",
                    opener=opener,
                )

            self.assertEqual(record["case_count"], 20)
            self.assertFalse(record["operator_blinded"])
            self.assertEqual(record["prediction_lock_sha256"], digest)
            self.assertEqual(
                sorted(path.name for path in (output / "references").iterdir()),
                sorted(f"{case_id}.nii.gz" for case_id in case_ids),
            )
            self.assertTrue((output / "reference-release.json").is_file())

    def test_bad_public_receipt_fails_before_repository_or_references(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prediction_lock, _digest, _case_ids = self.make_prediction_lock(
                root / "inference"
            )
            opener = lambda _request, timeout: io.BytesIO(("f" * 64 + "\n").encode("ascii"))
            with mock.patch.object(
                release,
                "git_commit",
                side_effect=AssertionError("reference repository must not be touched"),
            ) as git_probe:
                with self.assertRaises(release.ReleaseError):
                    release.release_references(
                        prediction_lock_path=prediction_lock,
                        published_digest_url=self.raw_url(),
                        kits23_repo=root / "missing-kits",
                        output_root=root / "evaluation",
                        custody_mode="same_operator_script_blinded",
                        opener=opener,
                    )
            git_probe.assert_not_called()

    def test_receipt_url_must_be_commit_pinned_raw_github(self) -> None:
        with self.assertRaises(release.ReleaseError):
            release.verify_published_digest(
                "https://github.com/example/repository/blob/main/prediction-lock.sha256",
                "a" * 64,
                opener=lambda *_args, **_kwargs: io.BytesIO(b""),
            )


if __name__ == "__main__":
    unittest.main()
