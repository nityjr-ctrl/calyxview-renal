# CalyxView Renal — frozen 20-case segmentation feasibility run

> **RESEARCH PROTOTYPE ONLY — NOT A MEDICAL DEVICE.** Do not use this pipeline or its outputs for diagnosis, treatment selection, surgical planning, margin selection, or patient care. Model outputs may be incomplete or wrong.

This folder reproduces one deliberately small **non-overlapping, within-KiTS feasibility check**. It applies the official KiTS21 nnU-Net v1 `Task135_KiTS2021` model, without retraining, to 20 later KiTS23 cases. It is a research benchmark for the CalyxView Renal prototype; it is not the website's future CT-processing service.

The important truth in plain language is:

- The 20 source images are public research **NIfTI volumes, not DICOM studies**.
- The model's documented training identifiers are `case_00000`–`case_00299`; this benchmark uses `case_00400`–`case_00419`, so the identifiers do not overlap.
- Both sets still belong to the KiTS programme. This is therefore **not** an independent external, prospective, multicentre, or clinical validation cohort.
- Raw images, labels, predictions, weights, detailed case rows, logs, and quality-control images stay local. Only reviewed aggregate statistics may be published.

## The five things an operator does

| Stage | What you do | The pass condition |
| --- | --- | --- |
| 1. Prepare | Keep website code and research data in separate folders. Qualify WSL2, memory, swap, and the GPU. | WSL shows about 25 GiB usable memory, 16 GiB swap, and the NVIDIA GPU. |
| 2. Freeze | Fetch exactly `case_00400`–`case_00419` and the exact model archive. | The cohort, revisions, byte counts, and checksums below all match. |
| 3. Prove | Capture provenance and smoke-load the checksum-verified fold-0 checkpoint in the isolated research environment. | The provenance and checkpoint smoke gates pass. |
| 4. Run | Smoke-test case 400, then strictly resume across the full 20-case manifest. | Every retained prediction passes the NIfTI and geometry validator. |
| 5. Review | Evaluate all 20 rows, including failures, then inspect the worst cases. | Counts are reconciled from disk and the report contains no source-image pixels. |

If a pass condition fails, stop at that stage. Do not swap in another case, model, fold, configuration, or less demanding metric just to obtain a result.

## Frozen data, model, and runtime contract

| Item | Frozen or measured value |
| --- | --- |
| Cohort | `case_00400` through `case_00419`, inclusive; fixed before inference |
| Cohort size | 20 contrast-enhanced CT NIfTI volumes with KiTS23 reference segmentations |
| KiTS23 repository | [`neheller/kits23`](https://github.com/neheller/kits23) at `c1088353084c17b8882a11db71429e7c022b7785` |
| Official imaging store | [`neheller/KiTS-Challenge-Imaging`](https://huggingface.co/datasets/neheller/KiTS-Challenge-Imaging) at `65f1f295873a326230153c7e1de0c7dba10f0b29` |
| Data licence | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| Canonical portable manifest SHA-256 | `bc529b7e5edfa9c5ac0979de1d38a027735b741760e3e82c14acc78ec900c561` |
| Source byte totals | Images `1,030,320,853`; labels `3,669,644` |
| Model | Official `Task135_KiTS2021`, `3d_fullres`, folds 0–4 |
| Model source | [Zenodo record 5126443](https://zenodo.org/records/5126443), DOI `10.5281/zenodo.5126443` |
| Model archive bytes | `3,505,803,654` |
| Model archive MD5 | `b27ab702742083080b95baac00ba186f` |
| Model archive SHA-256 | `a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3` |
| Installed `plans.pkl` | `143,080` bytes; SHA-256 `d15d46664240f0a9056ef1320e00df46fbd866ea94323a98e47b3e9eff1f4e39` |
| Postprocessing | No `postprocessing.json`; no model postprocessing is applied |
| Framework source | [`MIC-DKFZ/nnUNet`](https://github.com/MIC-DKFZ/nnUNet/tree/db16c6cef5fdd5a180159184e46b58bcca670446) v1 commit `db16c6cef5fdd5a180159184e46b58bcca670446`; tracked source is commit-equivalent and ignored runtime artefacts are inventoried separately |
| Inference | Five-fold ensemble; TTA disabled; one preprocessing thread; one save thread; one case per process |
| Bootstrap | 10,000 non-parametric case resamples, seed `20260901` |

The canonical portable manifest hash identifies the frozen cohort and its content without machine-specific absolute paths. It is the manifest identity used in reproducibility documentation and public metadata; it is not the hash of a local CSV serialization that contains workstation paths.

The archive checksum is the model-content identity gate. The installed checkpoint byte counts captured in the recorded provenance were:

| Fold | Checkpoint bytes | Metadata bytes |
| ---: | ---: | ---: |
| 0 | 249,826,698 | 143,564 |
| 1 | 249,826,570 | 143,564 |
| 2 | 249,826,762 | 143,564 |
| 3 | 249,826,570 | 143,564 |
| 4 | 249,826,826 | 143,564 |

### Recorded execution environment

The frozen run was qualified on WSL2 with Linux `6.6.87.2-microsoft-standard-WSL2`, Python `3.12.3`, nnU-Net `1.7.0`, PyTorch `2.7.1+cu128`, CUDA runtime `12.8`, NumPy `1.26.4`, NiBabel `5.4.2`, SimpleITK `2.5.6`, and `surface-distance==0.1`. The GPU was an NVIDIA GeForce RTX 5070 Ti with 17,094,475,776 bytes of reported VRAM.

The first environment gate, capped at 15 GiB WSL memory with 4 GiB swap, was insufficient and the Linux kernel terminated inference for memory pressure. Those attempts were quarantined as **environment-qualification failures**, not counted as model-performance attempts. The recorded workstation was then temporarily qualified with this `%UserProfile%\.wslconfig` capacity:

```ini
[wsl2]
memory=26GB
swap=16GB
```

After `wsl --shutdown`, `free -h` showed about 25 GiB usable memory and 16 GiB swap. This setting is an execution-capacity gate, not a claim that every case continuously consumes 26 GB. It was selected on a 32 GB host, leaving headroom for Windows. Do not apply it blindly to a smaller computer.

Key runtime versions are recorded in local provenance, but the complete transitive dependency graph is neither captured nor distributed as a fully hashed lock file. The model, data, tracked framework revision, and inference protocol are frozen. Git-ignored runtime artefacts are counted and content-inventoried at capture time, but they are not upstream commit content and the provenance does not claim a pure executable source tree. Rebuilds on a new machine should compare every captured package version and treat any unrecorded or changed dependency or ignored artefact as a reproducibility limitation.

## Storage and privacy layout

Keep three locations separate:

1. `PROJECT_ROOT`: the CalyxView Renal Git repository.
2. `WORK_ROOT`: a non-repository, non-synchronised research folder for source NIfTI, labels, archives, predictions, logs, and reports.
3. Native WSL storage under `/var/tmp`: rebuildable source/model caches and per-case scratch used during inference.

Recommended native Linux locations are:

```text
/var/tmp/calyxview-renal-runtime-v2   # exact nnU-Net source and installed model cache
/var/tmp/calyxview-renal-kits20       # disposable preprocessing and per-case scratch
```

Do not place inference scratch on `/mnt/c`, OneDrive, the Git repository, or the deployed site. Native Linux storage avoids the mounted-NTFS I/O and memory overhead seen during qualification. `/var/tmp` normally survives a WSL restart but remains rebuildable cache: verify it before every run and do not treat it as the only copy of the model archive or result evidence.

The `.gitignore` in this folder is a second line of defence, not permission to mix assets. Raw CTs, labels, predictions, model weights, archives, virtual environments, logs, and caches must stay outside the repository.

## Step-by-step reproduction

The setup commands run in **Ubuntu under WSL2**. Inference is launched from **PowerShell 7** because the runner supplies manifest ordering, measured timings, validation, bounded retries, and safe scratch handling.

### 1. Qualify WSL memory, swap, and the GPU

In PowerShell, inspect `%UserProfile%\.wslconfig` before changing anything. If it already exists, back it up and merge the two keys into its existing `[wsl2]` section; do not overwrite unrelated settings or create a duplicate section. For the recorded hardware qualification, use the exact block shown above, then run:

```powershell
wsl.exe --shutdown
wsl.exe --exec free -h
wsl.exe --exec nvidia-smi
```

Continue only when WSL reports approximately 25 GiB memory, 16 GiB swap, and a usable NVIDIA GPU. Close GPU-heavy programs. Keep the original `.wslconfig` backup so the machine can be restored after the benchmark.

### 2. Choose portable, separate paths

In WSL, replace the two example mounted paths with the real project and external research folders:

```bash
export PIPELINE_ROOT="/mnt/d/Projects/CalyxView Renal/research/kits23-feasibility"
export WORK_ROOT="/mnt/d/Research/calyxview-renal-kits20"
export RUN_ROOT="$WORK_ROOT/run-001"
export KITS23_REPO="$WORK_ROOT/official-kits23"
export MODEL_DIR="$WORK_ROOT/models"
export MODEL_ZIP="$MODEL_DIR/Task135_KiTS2021.zip"
export NATIVE_RUNTIME="/var/tmp/calyxview-renal-runtime-v2"
export NNUNET_SOURCE="$NATIVE_RUNTIME/nnUNet-v1"
export RESULTS_FOLDER="$NATIVE_RUNTIME/model-results"
export NATIVE_SCRATCH="/var/tmp/calyxview-renal-kits20"
mkdir -p "$WORK_ROOT" "$MODEL_DIR" "$NATIVE_RUNTIME" "$RESULTS_FOLDER" \
  "$NATIVE_SCRATCH/raw-data-base" "$NATIVE_SCRATCH/preprocessed"
cd "$PIPELINE_ROOT"
```

These variables last only in the current terminal. That is intentional; the recipe does not modify the user's shell profile.

### 3. Create the isolated research environment and exact source cache

```bash
python3.12 -m venv "$WORK_ROOT/wsl-env"
source "$WORK_ROOT/wsl-env/bin/activate"
python -m pip install --upgrade pip setuptools wheel
python -m pip install --index-url https://download.pytorch.org/whl/cu128 "torch==2.7.1"
python -m pip install -r "$PIPELINE_ROOT/requirements-nnunet.txt"
python -m pip install -r "$PIPELINE_ROOT/requirements-report.txt"

if [ ! -d "$NNUNET_SOURCE/.git" ]; then
  git clone https://github.com/MIC-DKFZ/nnUNet.git "$NNUNET_SOURCE"
fi
git -C "$NNUNET_SOURCE" checkout --detach db16c6cef5fdd5a180159184e46b58bcca670446
test "$(git -C "$NNUNET_SOURCE" rev-parse HEAD)" = "db16c6cef5fdd5a180159184e46b58bcca670446"
test -z "$(git -C "$NNUNET_SOURCE" status --porcelain --untracked-files=all)"
python -m pip install -e "$NNUNET_SOURCE"

python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

The final line must report PyTorch `2.7.1+cu128`, CUDA `12.8`, `True`, and the intended GPU. Run this environment without credentials or unrelated secrets. `requirements-nnunet.txt` deliberately does not fetch source code or select a PyTorch wheel.

### 4. Acquire exactly 20 official KiTS23 cases

```bash
if [ ! -d "$KITS23_REPO/.git" ]; then
  git clone https://github.com/neheller/kits23.git "$KITS23_REPO"
fi
git -C "$KITS23_REPO" checkout --detach c1088353084c17b8882a11db71429e7c022b7785
test "$(git -C "$KITS23_REPO" rev-parse HEAD)" = "c1088353084c17b8882a11db71429e7c022b7785"
python "$PIPELINE_ROOT/fetch_kits23_cases.py" --kits23-repo "$KITS23_REPO" --run-root "$RUN_ROOT"
python "$PIPELINE_ROOT/build_portable_manifest.py" \
  --manifest "$RUN_ROOT/manifests/manifest.csv" \
  --output "$RUN_ROOT/manifests/manifest.portable.json"
```

The script downloads only `case_00400`–`case_00419` from imaging revision `65f1f295873a326230153c7e1de0c7dba10f0b29`. It validates image/reference geometry and labels, writes per-file SHA-256 values, and creates nnU-Net input names ending in `_0000.nii.gz`.

Before continuing, confirm the manifest has exactly 20 ordered data rows and its metadata reports:

```text
canonical portable manifest SHA-256: bc529b7e5edfa9c5ac0979de1d38a027735b741760e3e82c14acc78ec900c561
total image bytes: 1030320853
total label bytes: 3669644
```

The official GitHub repository supplies code, labels, and provenance. The approximately 1.03 GB of image files are served from the KiTS project's separate official Hugging Face repository; do not claim that GitHub hosts the CT volumes.

### 5. Download, checksum, and install the official model

```bash
curl --fail --location --continue-at - \
  "https://zenodo.org/record/5126443/files/Task135_KiTS2021.zip?download=1" \
  --output "$MODEL_ZIP.partial"
test -s "$MODEL_ZIP.partial"
mv "$MODEL_ZIP.partial" "$MODEL_ZIP"
test "$(stat -c %s "$MODEL_ZIP")" = "3505803654"
printf '%s  %s\n' "b27ab702742083080b95baac00ba186f" "$MODEL_ZIP" | md5sum --check -
printf '%s  %s\n' "a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3" "$MODEL_ZIP" | sha256sum --check -

export RESULTS_FOLDER="$RESULTS_FOLDER"
export nnUNet_raw_data_base="$NATIVE_SCRATCH/raw-data-base"
export nnUNet_preprocessed="$NATIVE_SCRATCH/preprocessed"
nnUNet_install_pretrained_model_from_zip "$MODEL_ZIP"
nnUNet_print_pretrained_model_info Task135_KiTS2021
```

Do not install or load the archive unless **both** hashes and the byte count match. Confirm that `3d_fullres` contains folds `0`, `1`, `2`, `3`, and `4`; require the frozen `plans.pkl` identity above and require `postprocessing.json` to be absent. Do not substitute the stronger `3d_cascade_fullres` configuration or add postprocessing after seeing results.

#### Legacy checkpoint warning

The official nnU-Net v1 checkpoint uses Python pickle-compatible deserialisation. A correct hash confirms file identity; it does **not** make pickle intrinsically safe. The exact audited nnU-Net revision contains an explicit `weights_only=False` compatibility call, and the runner narrowly sets `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` only inside its inference subprocess.

Use that compatibility path only after the official URL, archive byte count, MD5, SHA-256, exact tracked-source revision, unignored-untracked-file gate, ignored-artifact inventory, and fold layout all pass. Load it in this dedicated, least-privilege research environment with no credentials or unrelated files. Never use the setting for an unknown, modified, or user-uploaded checkpoint.

### 6. Capture provenance and smoke-load fold 0

```bash
python "$PIPELINE_ROOT/capture_provenance.py" \
  --run-root "$RUN_ROOT" \
  --kits23-source "$KITS23_REPO" \
  --nnunet-source "$NNUNET_SOURCE" \
  --results-folder "$RESULTS_FOLDER" \
  --model-archive "$MODEL_ZIP"

python "$PIPELINE_ROOT/smoke_checkpoint.py" \
  --model-directory "$RESULTS_FOLDER/nnUNet/3d_fullres/Task135_KiTS2021/nnUNetTrainerV2__nnUNetPlansv2.1" \
  --fold 0
```

The smoke output must name `nnUNetTrainerV2`, fold `0`, and an explicitly trusted legacy load. Keep `provenance.json` local with the run evidence.

### 7. Smoke-test the first case from PowerShell 7

Set portable Windows paths in the current PowerShell window. The values below are examples; replace them with the real project and non-repository research folders:

```powershell
$env:CALYXVIEW_RENAL_PROJECT = 'D:\Projects\CalyxView Renal'
$env:CALYXVIEW_BENCHMARK_ROOT_WINDOWS = 'D:\Research\calyxview-renal-kits20'

$ProjectRoot = $env:CALYXVIEW_RENAL_PROJECT
$WorkRoot = $env:CALYXVIEW_BENCHMARK_ROOT_WINDOWS
if ([string]::IsNullOrWhiteSpace($ProjectRoot) -or [string]::IsNullOrWhiteSpace($WorkRoot)) {
  throw 'Set both portable project and benchmark root variables.'
}
$PipelineRoot = Join-Path $ProjectRoot 'research\kits23-feasibility'
$RunRoot = Join-Path $WorkRoot 'run-001'
$WslPythonWindows = Join-Path $WorkRoot 'wsl-env\bin\python'
$WslPython = (wsl.exe --exec wslpath -a -u $WslPythonWindows).Trim()
$NnUNetSource = '/var/tmp/calyxview-renal-runtime-v2/nnUNet-v1'
$ResultsFolder = '/var/tmp/calyxview-renal-runtime-v2/model-results'
$NativeScratch = '/var/tmp/calyxview-renal-kits20'

& (Join-Path $PipelineRoot 'run_nnunet_wsl.ps1') `
  -RunRoot $RunRoot `
  -WslPython $WslPython `
  -NnUNetSource $NnUNetSource `
  -ResultsFolder $ResultsFolder `
  -WslNativeScratchRoot $NativeScratch `
  -SmokeCount 1 `
  -DisableTTA `
  -ResumeValidatedPredictions
```

This executes `case_00400` with the exact full protocol. The runner validates the output's shape, affine, spacing, finiteness, integer values, and allowed labels before atomically copying it from native scratch to the external run folder.

### 8. Strictly resume through all 20 cases

Using the same PowerShell variables and **the same settings**, run:

```powershell
& (Join-Path $PipelineRoot 'run_nnunet_wsl.ps1') `
  -RunRoot $RunRoot `
  -WslPython $WslPython `
  -NnUNetSource $NnUNetSource `
  -ResultsFolder $ResultsFolder `
  -WslNativeScratchRoot $NativeScratch `
  -DisableTTA `
  -ResumeValidatedPredictions
```

Strict resume does not merely check that a filename exists. For every existing prediction it requires a successful timing record, an exact match for the recorded per-case command/configuration (including Python, source, model, scratch, arguments, validator, and environment), and a fresh geometry/label validation. A missing record, changed configuration, or invalid output is a hard stop. `-ResumeValidatedPredictions` and `-OverwritePredictions` are mutually exclusive.

The runner permits one identical retry within one case invocation. Do not relaunch a completed model failure to manufacture additional attempts. Resume is for validated successes after a safe interruption, or for a separately documented environment gate that failed before a qualified model attempt. Preserve and quarantine resource-gate evidence; never silently relabel it as an accuracy failure or success.

If an interrupted full run already contains a genuine exhausted two-attempt
failure, continue only with `-ResumeValidatedPredictions -SkipRecordedFailures`.
That switch never grants another model attempt: it
requires the exact frozen per-case command/configuration, matching case and
manifest position, attempts numbered 1 and 2, finite runtimes that reconcile to
the case total, exact case-bound logs, explicit absence of a final prediction,
and no canonical prediction file. The preserved case remains in the failed
denominator. The runner therefore exits `1` after processing the remaining
cases; do not use that expected terminal code as authority to retry the failed
case. Completion is decided by the 20-record
`capture_provenance.py --require-complete-run` gate and the failure-accounted
evaluator.

The exact Linux inference equivalent is:

```bash
export TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1
nnUNet_predict \
  -i <one-case-native-input> \
  -o <one-case-native-output> \
  -t Task135_KiTS2021 \
  -m 3d_fullres \
  -f 0 1 2 3 4 \
  --num_threads_preprocessing 1 \
  --num_threads_nifti_save 1 \
  --disable_tta
```

Use the PowerShell runner for the benchmark because it also records per-case configuration, timings, attempt logs, strict validation, atomic finalisation, and cleanup.

Plan for a multi-hour GPU run. Progress is case-by-case and long quiet periods during preprocessing/inference are normal; do not close WSL, change resource settings, or start another GPU-heavy task while it is running.

### 9. Evaluate every row and inspect the worst cases

Back in WSL with the research environment active:

```bash
python "$PIPELINE_ROOT/capture_provenance.py" \
  --run-root "$RUN_ROOT" \
  --kits23-source "$KITS23_REPO" \
  --nnunet-source "$NNUNET_SOURCE" \
  --results-folder "$RESULTS_FOLDER" \
  --model-archive "$MODEL_ZIP" \
  --folds 0 1 2 3 4 \
  --require-complete-run

python "$PIPELINE_ROOT/evaluate_and_report.py" --run-root "$RUN_ROOT"
```

The second provenance capture is the release gate: it independently re-hashes
all 20 source images, labels and nnU-Net inputs, checks every runtime source and
five-fold model location, validates every canonical timing record against the
frozen command, and re-validates every successful prediction. Do not generate a
public result if this complete-run capture fails.

A Git checkout or runtime copy materialised through Windows may contain CRLF
line endings even when its original checkout was clean. The gate does not call
such a copy clean: it records its **tracked source** as commit-equivalent only when there are no
unignored untracked or staged files and `git diff --ignore-cr-at-eol` is empty.
Any substantive tracked, permission/mode, staged, or unignored untracked change
remains a hard failure. Git-ignored artefacts—including generated Python
bytecode—are separately counted and hashed into a deterministic inventory. That
inventory describes what was present at final capture; it does not make those
artefacts upstream commit content or prove executable-source purity. The same
tracked-source scope applies to the KiTS23 checkout; all active source images,
labels, and nnU-Net inputs are separately re-hashed against the frozen manifest.

Open `report/report.html`, then review `report/worst-cases.html` before interpreting the averages. Recount the manifest rows, timing records, predictions, successes, and failures from disk. A status of `complete_with_failures` means only that all 20 rows were failure-accounted; it does not mean all inferences succeeded.

The local report is mask-only: it must contain no CT pixels, source NIfTI, prediction NIfTI, DICOM, DICOM metadata, or patient identifiers. The fixed public cohort identifiers `case_00400`–`case_00419` may appear publicly as protocol/method metadata. Any row, metric, status, failure reason, timing, log, path, image, or artefact linked to an individual case remains local.

### 10. Restore the temporary WSL setting

After inference and report generation are fully complete, close WSL sessions, restore the backed-up `%UserProfile%\.wslconfig` (or remove only the temporary file if none existed before), and run `wsl.exe --shutdown` once more. Do not commit `.wslconfig`; it is a temporary host setting, not a project dependency.

## Metric contract

Both model and references use `0=background`, `1=kidney`, `2=tumour`, and `3=cyst`. Evaluation follows the KiTS23 hierarchical regions:

| Region | Included labels | Surface Dice tolerance |
| --- | --- | ---: |
| Kidney + mass | 1, 2, 3 | 1.0330772532390826 mm |
| Mass (tumour + cyst) | 2, 3 | 1.1328796488598762 mm |
| Tumour | 2 | 1.1498198361434828 mm |

For each region, the local report records Dice, symmetric Surface Dice, symmetric HD95 in millimetres, reference/predicted volumes, and signed, absolute, and relative volume error. Aggregate arithmetic case means include every frozen case and use a 10,000-sample percentile bootstrap with seed `20260901`.

## Local outputs

```text
run-001/
├── manifests/
│   ├── manifest.csv                 # 20 source/reference hashes and geometry
│   └── manifest.metadata.json       # frozen revisions, selection, licence
├── source/images/                   # official CT NIfTI; never commit
├── labels/                          # KiTS23 references; never commit
├── nnunet_input/                    # CT copies named *_0000.nii.gz; never commit
├── predictions/                     # model NIfTI; never commit
├── timings/                         # per-case configuration, runtime, and status
├── logs/                            # per-attempt and validation evidence
├── provenance.json                  # model/framework/GPU gates; local evidence
└── report/
    ├── report.html                  # local human-readable report
    ├── case-results.csv             # one auditable row per frozen case
    ├── summary.json                 # detailed local aggregates and provenance
    ├── output-hashes.json           # SHA-256 list for derived report files
    ├── worst-cases.html
    ├── worst-cases.png
    └── qc/case_XXXXX.png            # mask-only reference/prediction/disagreement
```

## Failure accounting

- **Hard stop before inference:** stop on any revision, cohort, hash, geometry, label, model-installation, tracked-source identity or unignored-change, CUDA, memory, swap, or checkpoint-smoke mismatch. Do not substitute assets.
- **Per-case failure after the frozen run starts:** keep the row in the denominator. An invalid or missing prediction receives Dice `0`, Surface Dice `0`, predicted volume `0 mL` where reference geometry is valid, and an HD95 penalty equal to the image physical diagonal (or `1000 mm` when reference geometry cannot be validated).
- **Environment qualification failure:** preserve it separately when evidence shows the process was killed before a qualified attempt, correct the environment without changing model/data/protocol, and document why it does not count as a model attempt.

A successful inference claim requires 20 valid predictions and `20/20` successful evaluations. Strong averages do not make any individual prediction safe.

## Aggregate-only publication policy

The complete run folder is local evidence and must not be copied into the website repository. In particular, do **not** publish:

- source CTs, labels, prediction volumes, archives, weights, caches, or DICOM;
- `manifest.csv`, `case-results.csv`, timing/log files, absolute paths, or any case-linked result/status/failure detail;
- case-level HTML, worst-case pages, screenshots, QC images, or other mask-derived study assets;
- unreviewed `summary.json` or `output-hashes.json` files that may expose local structure.

Generate the candidate aggregate payload outside the repository, then review it before copying it into the site:

```bash
mkdir -p "$WORK_ROOT/publication-review"
python "$PIPELINE_ROOT/make_public_summary.py" \
  --summary "$RUN_ROOT/report/summary.json" \
  --output "$WORK_ROOT/publication-review/summary.public.json"
```

The public site may contain that reviewed, aggregate-only `summary.public.json`: cohort size, success/failure counts, per-region aggregate metrics and confidence intervals, aggregate runtime, and frozen revision/hash identifiers. The fixed cohort range or its 20 public KiTS case IDs may appear only as protocol/method metadata, never joined to a case-level result. The payload must contain no per-case metric, status, failure reason, runtime, log reference, local path, file name, medical-volume reference, image, or downloadable model artefact. The surrounding public page—not hidden metadata—must display the method, limitations, licence notice, and research disclaimer.

Run the repository's aggregate-publication test before every build. Inspect the built site (`netlify-dist` or equivalent), not just the source tree, for forbidden medical and model files. The public summary must say **non-overlapping, within-KiTS feasibility**, never “external validation”.

See `ATTRIBUTION_AND_RESEARCH_NOTICE.md` for source attribution, licence boundaries, and the exact public-facing notice.

## What remains for a real CT-to-segmentation service

This benchmark proves only that one frozen research model can be executed and scored on a small, related public NIfTI cohort. A true partial-nephrectomy planning platform still needs:

1. standards-aware DICOM series selection, de-identification, burned-in-annotation detection, private-tag/UID/date policies, and geometry-preserving conversion;
2. a secure, authenticated, encrypted GPU service with regional storage, retention/deletion controls, job isolation, audit logs, timeouts, and recovery—outside the static Netlify frontend;
3. representative multicentre training covering scanners, protocols, contrast phases, populations, vascular and collecting-system anatomy, plus uncertainty and out-of-distribution controls;
4. clinician correction tools and planning-grade, provenance-bearing DICOM SEG/mesh/measurement exports with orientation and spacing fidelity;
5. locked internal validation followed by genuinely independent external, prospective, subgroup, robustness, repeatability, human-factors, and failure-mode studies;
6. privacy/security assessment, quality management, clinical risk management, cybersecurity monitoring, model-change control, incident response, accountable clinical oversight, and jurisdiction-specific regulatory review.

Until those controls and evidence exist, the website upload and 3D experience must remain a simulated/pluggable research prototype and must never present its output as a patient-specific segmentation or surgical plan.

## Files in this folder

- `fetch_kits23_cases.py`: acquires and validates the frozen cohort and writes its manifest.
- `build_portable_manifest.py`: derives the deterministic path-free cohort identity and updates manifest metadata.
- `run_nnunet_wsl.ps1`: performs manifest-ordered WSL inference with strict resume, timing, one identical retry, and safe scratch boundaries.
- `manage_native_scratch.py`: stages one case in explicit native WSL storage and copies only a validated prediction back.
- `validate_prediction.py`: rejects malformed, geometry-mismatched, non-finite, or out-of-range outputs.
- `capture_provenance.py`: independently verifies data, sources, checkpoints, packages, GPU, and actual per-case execution gates.
- `smoke_checkpoint.py`: verifies the explicit trusted legacy checkpoint compatibility path on fold 0.
- `evaluate_and_report.py`: evaluates all manifest rows and produces local mask-only reports.
- `make_public_summary.py`: rejects partial/non-frozen local summaries and emits the aggregate-only public payload.
- `BENCHMARK_PROMPT.md`: reusable frozen experiment instructions for a research operator or coding agent.
- `ATTRIBUTION_AND_RESEARCH_NOTICE.md`: public attribution, licence, research-use, and publication boundaries.
- `requirements-nnunet.txt` and `requirements-report.txt`: separate the legacy inference stack from acquisition/reporting dependencies.

## Stronger script-blinded successor protocol

The original `case_00400`–`case_00419` experiment above is retained as historical
feasibility evidence. It used CT-only model inference, but references existed
locally and were inspected before inference for integrity and geometry. Do not
retroactively describe it as operationally blinded.

The successor workflow is defined in
[`BLINDED_EVALUATION_PROTOCOL.md`](BLINDED_EVALUATION_PROTOCOL.md). Its essential
order is:

1. complete the independent protocol review;
2. create the pre-inference model lock;
3. acquire the deterministic random CT cohort with no reference path or field;
4. run CT-only inference and preserve all successes/failures;
5. capture reference-free provenance and lock every result;
6. publish the digest-only prediction receipt;
7. release KiTS references into a separate evaluation root;
8. score only after all lock and hash checks pass;
9. publish aggregate evidence only.

On this workstation the correct claim is **script/inference-blinded, not
independently operator-blinded**. A future independently blinded study requires a
separate reference custodian or host.

Additional files for that workflow:

- `create_model_lock.py`: verifies and freezes the published model before inference.
- `prepare_blinded_cohort.py`: deterministic image-only sampling and acquisition.
- `capture_blinded_provenance.py`: reference-free runtime/model/source verification.
- `lock_predictions.py`: immutable private prediction lock plus digest-only public receipt.
- `release_references.py`: commit-pinned post-lock reference release into a separate root.
- `BLINDED_EVALUATION_PROTOCOL.md`: plain-language sequence, gates, metrics and custody limits.
- `BLINDED_BENCHMARK_PROMPT.md`: reusable execution prompt for the complete successor run.
- `test/`: mutation, substitution, boundary, lock-order and no-reference-before-scoring tests.
