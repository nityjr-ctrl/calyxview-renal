# Reusable prompt — CalyxView Renal script-blinded benchmark

Complete the CalyxView Renal KiTS23 script-blinded benchmark exactly as specified in `BLINDED_EVALUATION_PROTOCOL.md`.

Work in phases and stop immediately when a gate fails. Do not open, inspect, copy, enumerate or derive metadata from any KiTS segmentation before the immutable prediction lock exists and its digest has been pushed to a commit-pinned public GitHub URL. Never send scans, masks, predictions, patient information, local paths, or case-linked results to an AI service.

Required order:

1. Review and freeze the protocol before cohort lock. Record any later methodological suggestion as protocol v2 rather than changing this run.
2. Verify the published nnU-Net v1 Task135 model, source commit, plans and five fold checkpoints with `create_model_lock.py`. At the same pre-inference gate, freeze the exact ten-program pipeline, including the evaluator, reference releaser and aggregate-publication builder. Use `3d_fullres`, folds 0–4 and disabled TTA.
3. Use `prepare_blinded_cohort.py` to create the deterministic 20-case image-only cohort. Confirm the exact five-column manifest and prove there are no labels or references in the inference root.
4. Run `run_nnunet_wsl.ps1`. Preserve every selected case as either a validated success or an exhausted two-attempt failure. Do not silently omit or replace a case.
5. Run `capture_blinded_provenance.py`. It must independently verify all CT, model, source, timing, log, prediction and failure evidence without loading a reference.
6. Run `lock_predictions.py`. Confirm that the private lock and digest-only public receipt are immutable.
7. Commit and push only the digest receipt. Verify it at its commit-pinned raw GitHub URL.
8. Run `release_references.py` into a separate evaluation root. Use custody mode `same_operator_script_blinded` unless a separate custodian/host genuinely performed the release.
9. Run the blinded mode of `evaluate_and_report.py`. It must verify every lock and hash before its first reference load. Keep failures in all aggregate denominators under the fixed penalty policy.
10. Generate an aggregate-only public summary. Scan the repository and production bundle for CT/reference/prediction files, case-linked outcomes, local paths and patient information before publishing.
11. Run all Python tests, the PowerShell contract tests, the website tests, lint/typecheck, production build and deployed-site checks.

Report exact evidence at each gate. Describe the local evaluation as **script/inference-blinded, not independently operator-blinded**. Describe all resulting scores as within-KiTS reference agreement, not clinical accuracy, generalisation, safety or efficacy.
