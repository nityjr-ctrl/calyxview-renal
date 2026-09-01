#requires -Version 7.0

<#
.SYNOPSIS
Runs the official nnU-Net v1 Task135_KiTS2021 model against a frozen manifest.

.DESCRIPTION
Each manifest case is sent to a separate WSL process. A failed case receives one
identical retry. Strict continuation can preserve an exhausted two-attempt
failure without granting it another attempt. Source CT volumes stay in the run
directory; only public KiTS case identifiers are written to logs and timing
records.

.EXAMPLE
./run_nnunet_wsl.ps1 `
  -RunRoot C:\benchmarks\kits23-20 `
  -NnUNetSource C:\src\nnUNet `
  -ResultsFolder C:\models\nnunet-v1-results

.EXAMPLE
./run_nnunet_wsl.ps1 `
  -RunRoot C:\benchmarks\kits23-20 `
  -WslPython /opt/nnunet-v1/bin/python `
  -NnUNetSource /opt/nnUNet `
  -ResultsFolder /opt/nnunet-results `
  -Folds all -DisableTTA -SmokeCount 1

.NOTES
Research prototype only. Not a medical device and not for patient care.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RunRoot,

    [string]$WslPython = "python3",

    [Parameter(Mandatory = $true)]
    [string]$NnUNetSource,

    [Parameter(Mandatory = $true)]
    [string]$ResultsFolder,

    [string]$WslNativeScratchRoot = "/tmp/calyxview-renal-kits20",

    [ValidateNotNullOrEmpty()]
    [string[]]$Folds = @("0", "1", "2", "3", "4"),

    [switch]$DisableTTA,

    [ValidateRange(0, 10000)]
    [int]$SmokeCount = 0,

    [switch]$PreviewOnly,

    [switch]$OverwritePredictions,

    [switch]$ResumeValidatedPredictions,

    [switch]$SkipRecordedFailures
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-NativeProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $ArgumentList) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
        $startError = $null
    }
    catch {
        $stdout = ""
        $stderr = $_.Exception.Message
        $exitCode = $null
        $startError = $_.Exception.GetType().FullName
    }
    finally {
        $stopwatch.Stop()
        $process.Dispose()
    }

    [pscustomobject]@{
        ExitCode       = $exitCode
        Stdout         = $stdout
        Stderr         = $stderr
        RuntimeSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
        StartError     = $startError
    }
}

function Convert-ToWslPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [switch]$MustExist
    )

    $trimmed = $Path.Trim()
    if ($trimmed.StartsWith("/")) {
        if ($MustExist) {
            $probe = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList @(
                "--exec", "test", "-e", $trimmed
            )
            if ($probe.ExitCode -ne 0) {
                throw "WSL path does not exist: $trimmed"
            }
        }
        return $trimmed
    }

    $windowsPath = [System.IO.Path]::GetFullPath($trimmed)
    if ($MustExist -and -not (Test-Path -LiteralPath $windowsPath)) {
        throw "Windows path does not exist: $windowsPath"
    }
    $conversion = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList @(
        "--exec", "wslpath", "-a", "-u", $windowsPath
    )
    if ($conversion.ExitCode -ne 0) {
        throw "Could not convert Windows path to a WSL path: $windowsPath`n$($conversion.Stderr)"
    }
    $converted = $conversion.Stdout.Trim()
    if ([string]::IsNullOrWhiteSpace($converted)) {
        throw "WSL returned an empty path for: $windowsPath"
    }
    return $converted
}

function Assert-ManagedChildPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$AllowedParent
    )

    $candidate = [System.IO.Path]::GetFullPath($Path)
    $parent = [System.IO.Path]::GetFullPath($AllowedParent).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $requiredPrefix = $parent + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith(
        $requiredPrefix,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to reset a path outside the managed scratch directory: $candidate"
    }
}

function Reset-ManagedDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$AllowedParent
    )

    Assert-ManagedChildPath -Path $Path -AllowedParent $AllowedParent
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
    [void](New-Item -ItemType Directory -Path $Path -Force)
}

function New-CaseInputLink {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    try {
        [void](New-Item -ItemType HardLink -Path $Destination -Target $Source)
    }
    catch {
        # A copy is a portability fallback for filesystems that do not expose
        # NTFS hard links through PowerShell. The frozen source remains intact.
        Copy-Item -LiteralPath $Source -Destination $Destination
    }
}

function Write-JsonAtomically {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $temporaryPath = "$Path.tmp"
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporaryPath -Encoding utf8NoBOM
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

if ([string]::IsNullOrWhiteSpace($WslPython)) {
    throw "WslPython must not be empty."
}
if ($OverwritePredictions -and $ResumeValidatedPredictions) {
    throw "OverwritePredictions and ResumeValidatedPredictions are mutually exclusive."
}
if ($SkipRecordedFailures -and -not $ResumeValidatedPredictions) {
    throw "SkipRecordedFailures requires ResumeValidatedPredictions."
}
if (-not (Get-Command "wsl.exe" -ErrorAction SilentlyContinue)) {
    throw "wsl.exe is not available on this computer."
}

$foldValues = @($Folds | ForEach-Object { $_.Trim().ToLowerInvariant() })
if ($foldValues.Count -eq 0 -or $foldValues -contains "") {
    throw "Folds must contain at least one nnU-Net fold."
}
if ($foldValues -contains "all") {
    if ($foldValues.Count -ne 1) {
        throw "Use -Folds all by itself; it cannot be mixed with numbered folds."
    }
}
else {
    foreach ($fold in $foldValues) {
        if ($fold -notmatch "^\d+$") {
            throw "Invalid nnU-Net fold '$fold'. Use non-negative integers or 'all'."
        }
    }
    if (($foldValues | Select-Object -Unique).Count -ne $foldValues.Count) {
        throw "Folds must not contain duplicates."
    }
}

$resolvedRunRoot = (Resolve-Path -LiteralPath $RunRoot).Path
$manifestPath = Join-Path $resolvedRunRoot "manifests\manifest.csv"
$inputRoot = Join-Path $resolvedRunRoot "nnunet_input"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Frozen manifest not found: $manifestPath"
}
if (-not (Test-Path -LiteralPath $inputRoot -PathType Container)) {
    throw "nnU-Net input directory not found: $inputRoot"
}

$manifestRows = @(Import-Csv -LiteralPath $manifestPath)
if ($manifestRows.Count -eq 0) {
    throw "The frozen manifest is empty: $manifestPath"
}

$casePattern = "^case_\d{5}$"
$seenCaseIds = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
)
$orderedCases = [System.Collections.Generic.List[object]]::new()
for ($index = 0; $index -lt $manifestRows.Count; $index++) {
    $row = $manifestRows[$index]
    if (-not ($row.PSObject.Properties.Name -contains "case_id")) {
        throw "The frozen manifest must contain a case_id column."
    }
    $caseId = [string]$row.case_id
    if ($caseId -notmatch $casePattern) {
        throw "Invalid public KiTS case identifier at manifest row $($index + 2): '$caseId'"
    }
    if (-not $seenCaseIds.Add($caseId)) {
        throw "Duplicate case identifier in frozen manifest: $caseId"
    }
    if ($row.PSObject.Properties.Name -contains "selection_order") {
        $expectedOrder = $index + 1
        if ([string]$row.selection_order -ne [string]$expectedOrder) {
            throw "Manifest selection_order is not frozen row order at $caseId."
        }
    }
    $sourcePath = Join-Path $inputRoot "${caseId}_0000.nii.gz"
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Frozen manifest input is missing (no case substitution is allowed): $sourcePath"
    }
    $orderedCases.Add([pscustomobject]@{
        CaseId          = $caseId
        CohortPosition  = $index + 1
        SourcePath      = $sourcePath
    })
}

if ($SmokeCount -gt $orderedCases.Count) {
    throw "SmokeCount $SmokeCount exceeds the $($orderedCases.Count)-case frozen manifest."
}
$casesToRun = if ($SmokeCount -gt 0) {
    @($orderedCases | Select-Object -First $SmokeCount)
}
else {
    @($orderedCases)
}

$sourceWsl = Convert-ToWslPath -Path $NnUNetSource -MustExist
$resultsWsl = Convert-ToWslPath -Path $ResultsFolder -MustExist
$validatorScript = Join-Path $PSScriptRoot "validate_prediction.py"
if (-not (Test-Path -LiteralPath $validatorScript -PathType Leaf)) {
    throw "Prediction validator not found: $validatorScript"
}
$validatorWsl = Convert-ToWslPath -Path $validatorScript -MustExist
$scratchManagerScript = Join-Path $PSScriptRoot "manage_native_scratch.py"
if (-not (Test-Path -LiteralPath $scratchManagerScript -PathType Leaf)) {
    throw "Native scratch manager not found: $scratchManagerScript"
}
$scratchManagerWsl = Convert-ToWslPath -Path $scratchManagerScript -MustExist
if (-not $WslNativeScratchRoot.StartsWith("/") -or $WslNativeScratchRoot -in @("/", "/tmp", "/var/tmp")) {
    throw "WslNativeScratchRoot must be an explicit, non-broad absolute Linux path."
}
$nativeScratchWsl = $WslNativeScratchRoot.TrimEnd("/")
$predictionsRoot = Join-Path $resolvedRunRoot "predictions"
$timingsRoot = Join-Path $resolvedRunRoot "timings"
$logsRoot = Join-Path $resolvedRunRoot "logs"

if (-not $PreviewOnly -and -not $OverwritePredictions -and -not $ResumeValidatedPredictions) {
    $existingPredictions = @(
        $casesToRun |
            ForEach-Object {
                $candidate = Join-Path $predictionsRoot "$($_.CaseId).nii.gz"
                if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                    $candidate
                }
            }
    )
    if ($existingPredictions.Count -gt 0) {
        throw (
            "Refusing to start because {0} selected prediction(s) already exist. " +
            "Use -OverwritePredictions to replace the complete selected set. First collision: {1}" -f
            $existingPredictions.Count,
            $existingPredictions[0]
        )
    }
}

if (-not $PreviewOnly) {
    foreach ($directory in @(
        $predictionsRoot,
        $timingsRoot,
        $logsRoot
    )) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }
}

$rawScratchWsl = "$nativeScratchWsl/raw-data-base"
$preprocessedScratchWsl = "$nativeScratchWsl/preprocessed"
$matplotlibScratchWsl = "$nativeScratchWsl/matplotlib"
$environmentArguments = @(
    "RESULTS_FOLDER=$resultsWsl",
    "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1",
    "nnUNet_raw_data_base=$rawScratchWsl",
    "nnUNet_preprocessed=$preprocessedScratchWsl",
    "PYTHONPATH=$sourceWsl",
    "PYTHONNOUSERSITE=1",
    "OMP_NUM_THREADS=1",
    "MKL_NUM_THREADS=1",
    "ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS=1",
    "MPLCONFIGDIR=$matplotlibScratchWsl"
)

$failedCases = [System.Collections.Generic.List[string]]::new()
foreach ($case in $casesToRun) {
    $caseId = $case.CaseId
    $finalPrediction = Join-Path $predictionsRoot "${caseId}.nii.gz"
    $caseInputWsl = "$nativeScratchWsl/case-inputs/$caseId"
    $caseOutputWsl = "$nativeScratchWsl/case-outputs/$caseId"
    $scratchPredictionWsl = "$caseOutputWsl/${caseId}.nii.gz"
    $caseSourceWsl = Convert-ToWslPath -Path $case.SourcePath -MustExist
    $finalPredictionWsl = Convert-ToWslPath -Path $finalPrediction
    $predictArguments = @(
        "-m", "nnunet.inference.predict_simple",
        "-i", $caseInputWsl,
        "-o", $caseOutputWsl,
        "-t", "Task135_KiTS2021",
        "-m", "3d_fullres",
        "--num_threads_preprocessing", "1",
        "--num_threads_nifti_save", "1",
        "-f"
    ) + $foldValues
    if ($DisableTTA) {
        $predictArguments += "--disable_tta"
    }
    $wslArguments = @("--exec", "env") + $environmentArguments + @($WslPython) + $predictArguments

    $commandConfiguration = [ordered]@{
        launcher                    = "wsl.exe"
        python                      = $WslPython
        python_module               = "nnunet.inference.predict_simple"
        task                        = "Task135_KiTS2021"
        model                       = "3d_fullres"
        folds                       = $foldValues
        tta_enabled                 = -not [bool]$DisableTTA
        results_folder_wsl          = $resultsWsl
        nnunet_source_wsl           = $sourceWsl
        native_scratch_root_wsl     = $nativeScratchWsl
        input_directory_wsl         = $caseInputWsl
        output_directory_wsl        = $caseOutputWsl
        prediction_relative         = "predictions/$caseId.nii.gz"
        predict_arguments           = $predictArguments
        validator_script_wsl        = $validatorWsl
        retry_policy                = "one identical retry after failure"
        environment                 = [ordered]@{
            RESULTS_FOLDER                    = $resultsWsl
            TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD = "1"
            nnUNet_raw_data_base              = $rawScratchWsl
            nnUNet_preprocessed               = $preprocessedScratchWsl
            PYTHONPATH                        = $sourceWsl
            PYTHONNOUSERSITE                  = "1"
            OMP_NUM_THREADS                   = "1"
            MKL_NUM_THREADS                   = "1"
            ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS = "1"
            MPLCONFIGDIR                      = $matplotlibScratchWsl
        }
    }

    if ($PreviewOnly) {
        [pscustomobject]@{
            case_id               = $caseId
            cohort_position       = $case.CohortPosition
            command_configuration = $commandConfiguration
            wsl_argv              = $wslArguments
        } | ConvertTo-Json -Depth 10
        continue
    }

    if ($ResumeValidatedPredictions -and (Test-Path -LiteralPath $finalPrediction -PathType Leaf)) {
        $timingPath = Join-Path $timingsRoot "${caseId}.json"
        if (-not (Test-Path -LiteralPath $timingPath -PathType Leaf)) {
            throw "Cannot resume $caseId because its timing/configuration record is missing."
        }
        $previousTiming = Get-Content -LiteralPath $timingPath -Raw | ConvertFrom-Json
        $expectedConfigurationJson = (
            [pscustomobject]$commandConfiguration |
                ConvertTo-Json -Depth 20 -Compress
        )
        $previousConfigurationJson = (
            $previousTiming.command_configuration |
                ConvertTo-Json -Depth 20 -Compress
        )
        $configurationMatches = (
            [string]$previousTiming.case_id -ceq $caseId -and
            [int]$previousTiming.cohort_position -eq [int]$case.CohortPosition -and
            [string]$previousTiming.status -eq "succeeded" -and
            $previousConfigurationJson -ceq $expectedConfigurationJson
        )
        if (-not $configurationMatches) {
            throw "Cannot resume $caseId because its recorded frozen inference configuration differs."
        }
        $resumeValidation = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList @(
            "--exec", "env", "PYTHONNOUSERSITE=1", $WslPython,
            $validatorWsl,
            "--input", $caseSourceWsl,
            "--prediction", $finalPredictionWsl
        )
        Set-Content -LiteralPath (Join-Path $logsRoot "${caseId}.resume.validation.stdout.log") -Value $resumeValidation.Stdout -Encoding utf8NoBOM
        Set-Content -LiteralPath (Join-Path $logsRoot "${caseId}.resume.validation.stderr.log") -Value $resumeValidation.Stderr -Encoding utf8NoBOM
        if ($resumeValidation.ExitCode -ne 0) {
            throw "Cannot resume $caseId because its existing prediction failed validation."
        }
        Write-Host ("[{0:D2}/{1:D2}] {2} (validated existing result)" -f $case.CohortPosition, $manifestRows.Count, $caseId)
        continue
    }

    if ($ResumeValidatedPredictions -and $SkipRecordedFailures) {
        $timingPath = Join-Path $timingsRoot "${caseId}.json"
        if (Test-Path -LiteralPath $timingPath -PathType Leaf) {
            $previousTiming = Get-Content -LiteralPath $timingPath -Raw | ConvertFrom-Json
            $expectedConfigurationJson = (
                [pscustomobject]$commandConfiguration |
                    ConvertTo-Json -Depth 20 -Compress
            )
            $previousConfigurationJson = (
                $previousTiming.command_configuration |
                    ConvertTo-Json -Depth 20 -Compress
            )
            $configurationMatches = $previousConfigurationJson -ceq $expectedConfigurationJson
            $previousAttempts = @($previousTiming.attempt_records)
            $attemptRuntimeTotal = 0.0
            $attemptEvidenceValid = $previousAttempts.Count -eq 2
            for ($attemptIndex = 0; $attemptIndex -lt $previousAttempts.Count; $attemptIndex++) {
                $attemptRecord = $previousAttempts[$attemptIndex]
                $attemptNumber = $attemptIndex + 1
                $propertyNames = @($attemptRecord.PSObject.Properties.Name)
                $runtimeValue = [double]$attemptRecord.runtime_seconds
                $attemptRuntimeTotal += $runtimeValue
                $attemptEvidenceValid = (
                    $attemptEvidenceValid -and
                    [int]$attemptRecord.attempt -eq $attemptNumber -and
                    [string]$attemptRecord.status -ceq "failed" -and
                    [double]::IsFinite($runtimeValue) -and
                    $runtimeValue -ge 0 -and
                    $propertyNames -contains "final_prediction_created" -and
                    $attemptRecord.final_prediction_created -is [bool] -and
                    $attemptRecord.final_prediction_created -eq $false
                )
                foreach ($logKind in @("stdout", "stderr")) {
                    $logProperty = "${logKind}_log_relative"
                    $expectedRelativeLog = "logs/$caseId.attempt-$attemptNumber.$logKind.log"
                    if ([string]$attemptRecord.$logProperty -cne $expectedRelativeLog) {
                        $attemptEvidenceValid = $false
                        continue
                    }
                    $logPath = Join-Path $resolvedRunRoot ($expectedRelativeLog -replace "/", [IO.Path]::DirectorySeparatorChar)
                    Assert-ManagedChildPath -Path $logPath -AllowedParent $logsRoot
                    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
                        $attemptEvidenceValid = $false
                    }
                }
                foreach ($validationKind in @("stdout", "stderr")) {
                    $validationProperty = "validation_${validationKind}_relative"
                    $validationValue = $attemptRecord.$validationProperty
                    if ($null -ne $validationValue) {
                        if ([string]::IsNullOrWhiteSpace([string]$validationValue)) {
                            $attemptEvidenceValid = $false
                            continue
                        }
                        $expectedValidationLog = "logs/$caseId.attempt-$attemptNumber.validation.$validationKind.log"
                        if ([string]$validationValue -cne $expectedValidationLog) {
                            $attemptEvidenceValid = $false
                            continue
                        }
                        $validationPath = Join-Path $resolvedRunRoot ($expectedValidationLog -replace "/", [IO.Path]::DirectorySeparatorChar)
                        Assert-ManagedChildPath -Path $validationPath -AllowedParent $logsRoot
                        if (-not (Test-Path -LiteralPath $validationPath -PathType Leaf)) {
                            $attemptEvidenceValid = $false
                        }
                    }
                }
            }
            $recordedRuntime = [double]$previousTiming.runtime_seconds
            $attemptEvidenceValid = (
                $attemptEvidenceValid -and
                [double]::IsFinite($recordedRuntime) -and
                $recordedRuntime -ge 0 -and
                [math]::Abs($attemptRuntimeTotal - $recordedRuntime) -le 0.001
            )
            $isExhaustedFailure = (
                [string]$previousTiming.case_id -ceq $caseId -and
                [int]$previousTiming.cohort_position -eq [int]$case.CohortPosition -and
                [string]$previousTiming.status -eq "failed" -and
                [int]$previousTiming.attempts -eq 2 -and
                $attemptEvidenceValid
            )
            if (-not $configurationMatches) {
                throw "Cannot preserve $caseId because its recorded frozen inference configuration differs."
            }
            if (-not $isExhaustedFailure) {
                throw "Cannot preserve $caseId because its timing is neither a validated success nor an exhausted two-attempt failure."
            }
            if (Test-Path -LiteralPath $finalPrediction) {
                throw "Cannot preserve failed $caseId because an unexpected canonical prediction exists."
            }
            $failedCases.Add($caseId)
            Write-Host ("[{0:D2}/{1:D2}] {2} (preserved exhausted two-attempt failure)" -f $case.CohortPosition, $manifestRows.Count, $caseId)
            continue
        }
    }

    $prepareArguments = @(
        "--exec", "env", "PYTHONNOUSERSITE=1", $WslPython,
        $scratchManagerWsl, "prepare",
        "--root", $nativeScratchWsl,
        "--case-id", $caseId,
        "--source", $caseSourceWsl
    )
    $prepareResult = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList $prepareArguments
    if ($prepareResult.ExitCode -ne 0) {
        throw "Could not stage $caseId in native WSL scratch: $($prepareResult.Stderr)"
    }

    if (Test-Path -LiteralPath $finalPrediction) {
        Remove-Item -LiteralPath $finalPrediction -Force
    }

    Write-Host ("[{0:D2}/{1:D2}] {2}" -f $case.CohortPosition, $manifestRows.Count, $caseId)
    $startedUtc = [DateTime]::UtcNow
    $attemptRecords = [System.Collections.Generic.List[object]]::new()
    $caseSucceeded = $false
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        # The output directory is reset, but wslArguments is intentionally not
        # rebuilt: attempt two is byte-for-byte the same inference command.
        $resetArguments = @(
            "--exec", "env", "PYTHONNOUSERSITE=1", $WslPython,
            $scratchManagerWsl, "reset-output",
            "--root", $nativeScratchWsl,
            "--case-id", $caseId
        )
        $resetResult = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList $resetArguments
        if ($resetResult.ExitCode -ne 0) {
            throw "Could not reset native WSL output for ${caseId}: $($resetResult.Stderr)"
        }
        $stdoutPath = Join-Path $logsRoot "${caseId}.attempt-${attempt}.stdout.log"
        $stderrPath = Join-Path $logsRoot "${caseId}.attempt-${attempt}.stderr.log"
        $result = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList $wslArguments
        Set-Content -LiteralPath $stdoutPath -Value $result.Stdout -Encoding utf8NoBOM
        Set-Content -LiteralPath $stderrPath -Value $result.Stderr -Encoding utf8NoBOM

        $predictionProbe = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList @(
            "--exec", "test", "-s", $scratchPredictionWsl
        )
        $predictionPresent = ($predictionProbe.ExitCode -eq 0)
        $validationResult = $null
        $validationSucceeded = $false
        $validationStdoutPath = Join-Path $logsRoot "${caseId}.attempt-${attempt}.validation.stdout.log"
        $validationStderrPath = Join-Path $logsRoot "${caseId}.attempt-${attempt}.validation.stderr.log"
        if ($result.ExitCode -eq 0 -and $predictionPresent) {
            $validationArguments = @(
                "--exec", "env",
                "PYTHONNOUSERSITE=1",
                $WslPython,
                $validatorWsl,
                "--input", $caseSourceWsl,
                "--prediction", $scratchPredictionWsl
            )
            $validationResult = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList $validationArguments
            Set-Content -LiteralPath $validationStdoutPath -Value $validationResult.Stdout -Encoding utf8NoBOM
            Set-Content -LiteralPath $validationStderrPath -Value $validationResult.Stderr -Encoding utf8NoBOM
            $validationSucceeded = ($validationResult.ExitCode -eq 0)
        }
        $finalizeResult = $null
        if ($result.ExitCode -eq 0 -and $predictionPresent -and $validationSucceeded) {
            $finalizeArguments = @(
                "--exec", "env", "PYTHONNOUSERSITE=1", $WslPython,
                $scratchManagerWsl, "finalize",
                "--root", $nativeScratchWsl,
                "--case-id", $caseId,
                "--destination", $finalPredictionWsl
            )
            $finalizeResult = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList $finalizeArguments
        }
        $finalizedPredictionPresent = (
            $null -ne $finalizeResult -and
            $finalizeResult.ExitCode -eq 0 -and
            (Test-Path -LiteralPath $finalPrediction -PathType Leaf) -and
            ((Get-Item -LiteralPath $finalPrediction).Length -gt 0)
        )
        $attemptSucceeded = (
            $result.ExitCode -eq 0 -and
            $predictionPresent -and
            $validationSucceeded -and
            $finalizedPredictionPresent
        )
        $attemptRecords.Add([pscustomobject][ordered]@{
            attempt                     = $attempt
            status                      = if ($attemptSucceeded) { "succeeded" } else { "failed" }
            exit_code                   = $result.ExitCode
            runtime_seconds             = $result.RuntimeSeconds
            prediction_created          = $predictionPresent
            prediction_validated        = $validationSucceeded
            validation_exit_code        = if ($null -ne $validationResult) { $validationResult.ExitCode } else { $null }
            finalization_exit_code      = if ($null -ne $finalizeResult) { $finalizeResult.ExitCode } else { $null }
            final_prediction_created    = $finalizedPredictionPresent
            process_start_error_type    = $result.StartError
            stdout_log_relative         = "logs/$caseId.attempt-$attempt.stdout.log"
            stderr_log_relative         = "logs/$caseId.attempt-$attempt.stderr.log"
            validation_stdout_relative  = if ($null -ne $validationResult) { "logs/$caseId.attempt-$attempt.validation.stdout.log" } else { $null }
            validation_stderr_relative  = if ($null -ne $validationResult) { "logs/$caseId.attempt-$attempt.validation.stderr.log" } else { $null }
        })

        if ($attemptSucceeded) {
            $caseSucceeded = $true
            break
        }
    }

    $finishedUtc = [DateTime]::UtcNow
    $totalRuntime = (
        $attemptRecords |
            ForEach-Object { [double]$_.runtime_seconds } |
            Measure-Object -Sum
    ).Sum
    $timingRecord = [ordered]@{
        schema_version         = 1
        run_mode               = "research_feasibility_only"
        disclaimer             = "Research prototype only. Not a medical device. Not for patient care."
        case_id                = $caseId
        cohort_position        = $case.CohortPosition
        status                 = if ($caseSucceeded) { "succeeded" } else { "failed" }
        attempts               = $attemptRecords.Count
        runtime_seconds        = [math]::Round([double]$totalRuntime, 3)
        started_utc            = $startedUtc.ToString("o")
        finished_utc           = $finishedUtc.ToString("o")
        command_configuration  = $commandConfiguration
        attempt_records        = $attemptRecords
    }
    Write-JsonAtomically -Value $timingRecord -Path (Join-Path $timingsRoot "${caseId}.json")

    $cleanupArguments = @(
        "--exec", "env", "PYTHONNOUSERSITE=1", $WslPython,
        $scratchManagerWsl, "cleanup",
        "--root", $nativeScratchWsl,
        "--case-id", $caseId
    )
    $cleanupResult = Invoke-NativeProcess -FilePath "wsl.exe" -ArgumentList $cleanupArguments
    if ($cleanupResult.ExitCode -ne 0) {
        Write-Warning "Could not clean native WSL scratch for ${caseId}: $($cleanupResult.Stderr)"
    }

    if (-not $caseSucceeded) {
        $failedCases.Add($caseId)
    }
}

if ($PreviewOnly) {
    Write-Host "Preview complete: $($casesToRun.Count) manifest-ordered case command(s); no inference was run."
    exit 0
}

if ($failedCases.Count -gt 0) {
    Write-Error (
        "Inference failed after one retry for {0} case(s): {1}" -f
        $failedCases.Count,
        ($failedCases -join ", ")
    ) -ErrorAction Continue
    exit 1
}

Write-Host "Inference complete: $($casesToRun.Count) manifest-ordered case(s) succeeded or were strictly revalidated."
exit 0
