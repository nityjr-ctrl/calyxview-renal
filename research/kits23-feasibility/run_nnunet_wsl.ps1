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

function Get-FileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-StringSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value
    )

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($bytes)
    ).ToLowerInvariant()
}

function Get-CompactJson {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    return ($Value | ConvertTo-Json -Depth 20 -Compress)
}

function Get-RequiredPropertyValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Context
    )

    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) {
        throw "$Context is missing required property '$Name'."
    }
    return $property.Value
}

function Assert-ExactPropertyNames {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value,

        [Parameter(Mandatory = $true)]
        [string[]]$ExpectedNames,

        [Parameter(Mandatory = $true)]
        [string]$Context
    )

    $actualNames = @($Value.PSObject.Properties.Name)
    if ($actualNames.Count -ne $ExpectedNames.Count) {
        throw "$Context must contain exactly these properties in order: $($ExpectedNames -join ', ')."
    }
    for ($index = 0; $index -lt $ExpectedNames.Count; $index++) {
        if ([string]$actualNames[$index] -cne [string]$ExpectedNames[$index]) {
            throw "$Context property order/schema differs at position $($index + 1); expected '$($ExpectedNames[$index])', found '$($actualNames[$index])'."
        }
    }
}

function Assert-ExactPropertySet {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value,

        [Parameter(Mandatory = $true)]
        [string[]]$ExpectedNames,

        [Parameter(Mandatory = $true)]
        [string]$Context
    )

    $actualNames = @($Value.PSObject.Properties.Name)
    $actualSet = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $expectedSet = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($name in $actualNames) {
        [void]$actualSet.Add([string]$name)
    }
    foreach ($name in $ExpectedNames) {
        [void]$expectedSet.Add([string]$name)
    }
    if ($actualNames.Count -ne $ExpectedNames.Count -or -not $actualSet.SetEquals($expectedSet)) {
        throw "$Context must contain exactly these properties: $($ExpectedNames -join ', ')."
    }
}

function Assert-PipelineSourceArtifactHashes {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value,

        [Parameter(Mandatory = $true)]
        [string]$PipelineRoot,

        [Parameter(Mandatory = $true)]
        [string]$RunnerPath
    )

    $expectedFiles = [ordered]@{
        runner_sha256                 = $RunnerPath
        validator_sha256              = Join-Path $PipelineRoot "validate_prediction.py"
        scratch_manager_sha256        = Join-Path $PipelineRoot "manage_native_scratch.py"
        cohort_preparer_sha256        = Join-Path $PipelineRoot "prepare_blinded_cohort.py"
        model_locker_sha256           = Join-Path $PipelineRoot "create_model_lock.py"
        prediction_locker_sha256      = Join-Path $PipelineRoot "lock_predictions.py"
        provenance_capturer_sha256    = Join-Path $PipelineRoot "capture_blinded_provenance.py"
        evaluator_sha256              = Join-Path $PipelineRoot "evaluate_and_report.py"
        reference_releaser_sha256     = Join-Path $PipelineRoot "release_references.py"
        public_summary_builder_sha256 = Join-Path $PipelineRoot "make_blinded_public_summary.py"
    }
    Assert-ExactPropertySet `
        -Value $Value `
        -ExpectedNames @($expectedFiles.Keys) `
        -Context "Model lock pipeline_source_artifact_hashes"
    foreach ($entry in $expectedFiles.GetEnumerator()) {
        $recorded = Get-RequiredPropertyValue `
            -Value $Value `
            -Name $entry.Key `
            -Context "Model lock pipeline_source_artifact_hashes"
        if ($recorded -isnot [string] -or $recorded -cnotmatch "^[0-9a-f]{64}$") {
            throw "Model lock pipeline source hash '$($entry.Key)' must be a lowercase SHA-256 digest."
        }
        if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) {
            throw "Frozen pipeline source is missing: $($entry.Value)"
        }
        $sourceItem = Get-Item -LiteralPath $entry.Value -Force
        if ($null -ne $sourceItem.LinkType) {
            throw "Frozen pipeline source must not be a symbolic link: $($entry.Value)"
        }
        if ((Get-FileSha256 -Path $entry.Value) -cne $recorded) {
            throw "Frozen pipeline source hash mismatch for '$($entry.Key)'."
        }
    }
}

function Assert-BlindedDataBoundary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,

        [Parameter(Mandatory = $true)]
        [string[]]$AllowedVolumeRelativePaths
    )

    $allowedVolumes = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($relativePath in $AllowedVolumeRelativePaths) {
        [void]$allowedVolumes.Add($relativePath.Replace("\", "/"))
    }

    $forbiddenNamePattern = (
        "(?i)(^labels?(tr|ts)?$|^references?$|^ground[-_ ]?truth$|" +
        "(^|[._ -])(labels?|references?|ground[-_ ]?truth|segmentations?|" +
        "annotations?|masks?)([._ -]|$))"
    )
    $medicalVolumePattern = "(?i)\.(nii(\.gz)?|nrrd|mha|mhd)$"
    foreach ($item in Get-ChildItem -LiteralPath $RootPath -Recurse -Force) {
        $relative = [System.IO.Path]::GetRelativePath($RootPath, $item.FullName).Replace("\", "/")
        if ($item.Name -match $forbiddenNamePattern) {
            throw "Blinded inference boundary contains forbidden label/reference material: $relative"
        }
        if (-not $item.PSIsContainer -and $item.Name -match $medicalVolumePattern) {
            if (-not $allowedVolumes.Contains($relative)) {
                throw "Blinded inference boundary contains an unexpected medical volume: $relative"
            }
        }
    }
}

function Assert-BlindedTimingBinding {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Timing,

        [Parameter(Mandatory = $true)]
        [object]$Case,

        [Parameter(Mandatory = $true)]
        [object]$ExpectedConfiguration,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedConfigurationSha256,

        [Parameter(Mandatory = $true)]
        [object]$ExpectedArtifactHashes,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedManifestSha256,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedCohortLockSha256,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedModelLockSha256,

        [Parameter(Mandatory = $true)]
        [string]$RootPath,

        [Parameter(Mandatory = $true)]
        [string]$LogsPath,

        [Parameter(Mandatory = $true)]
        [string]$PredictionPath
    )

    $context = "Timing record for $($Case.CaseId)"
    $expectedPredictionRelative = "predictions/$($Case.CaseId).nii.gz"
    $scalarExpectations = [ordered]@{
        schema_version               = 2
        run_mode                    = "research_feasibility_script_blinded"
        case_id                     = $Case.CaseId
        cohort_position             = [int]$Case.CohortPosition
        selection_order             = [int]$Case.CohortPosition
        selection_hash              = $Case.SelectionHash
        input_image_relative        = $Case.InputRelative
        input_image_sha256          = $Case.InputImageSha256
        input_image_bytes           = [long]$Case.InputImageBytes
        prediction_relative         = $expectedPredictionRelative
        manifest_sha256             = $ExpectedManifestSha256
        cohort_lock_sha256          = $ExpectedCohortLockSha256
        model_lock_sha256           = $ExpectedModelLockSha256
        command_configuration_sha256 = $ExpectedConfigurationSha256
    }
    foreach ($entry in $scalarExpectations.GetEnumerator()) {
        $actual = Get-RequiredPropertyValue -Value $Timing -Name $entry.Key -Context $context
        if ($entry.Value -is [int] -or $entry.Value -is [long]) {
            if ([long]$actual -ne [long]$entry.Value) {
                throw "$context has an invalid $($entry.Key) binding."
            }
        }
        elseif ([string]$actual -cne [string]$entry.Value) {
            throw "$context has an invalid $($entry.Key) binding."
        }
    }

    $recordedConfiguration = Get-RequiredPropertyValue -Value $Timing -Name "command_configuration" -Context $context
    $recordedConfigurationJson = Get-CompactJson -Value $recordedConfiguration
    $expectedConfigurationJson = Get-CompactJson -Value ([pscustomobject]$ExpectedConfiguration)
    if ($recordedConfigurationJson -cne $expectedConfigurationJson) {
        throw "$context does not match the current frozen command configuration."
    }
    if ((Get-StringSha256 -Value $recordedConfigurationJson) -cne $ExpectedConfigurationSha256) {
        throw "$context command configuration hash does not match its embedded configuration."
    }

    $recordedArtifactHashes = Get-RequiredPropertyValue -Value $Timing -Name "artifact_hashes" -Context $context
    if ((Get-CompactJson -Value $recordedArtifactHashes) -cne (Get-CompactJson -Value ([pscustomobject]$ExpectedArtifactHashes))) {
        throw "$context tool artifact hashes differ from the current frozen runner artifacts."
    }

    $status = [string](Get-RequiredPropertyValue -Value $Timing -Name "status" -Context $context)
    if ($status -notin @("succeeded", "failed")) {
        throw "$context has an invalid status '$status'."
    }
    $attempts = @(Get-RequiredPropertyValue -Value $Timing -Name "attempt_records" -Context $context)
    $recordedAttemptCount = [int](Get-RequiredPropertyValue -Value $Timing -Name "attempts" -Context $context)
    if ($attempts.Count -notin @(1, 2) -or $recordedAttemptCount -ne $attempts.Count) {
        throw "$context must contain exactly one or two sequential attempts."
    }
    if ($status -ceq "failed" -and $attempts.Count -ne 2) {
        throw "$context may preserve failure only after exactly two attempts."
    }

    $runtimeTotal = 0.0
    for ($attemptIndex = 0; $attemptIndex -lt $attempts.Count; $attemptIndex++) {
        $attemptRecord = $attempts[$attemptIndex]
        $attemptNumber = $attemptIndex + 1
        $attemptContext = "$context attempt $attemptNumber"
        $attemptExpectations = [ordered]@{
            case_id                      = $Case.CaseId
            cohort_position              = [int]$Case.CohortPosition
            selection_order              = [int]$Case.CohortPosition
            selection_hash               = $Case.SelectionHash
            input_image_relative         = $Case.InputRelative
            input_image_sha256           = $Case.InputImageSha256
            input_image_bytes            = [long]$Case.InputImageBytes
            prediction_relative          = $expectedPredictionRelative
            manifest_sha256              = $ExpectedManifestSha256
            cohort_lock_sha256            = $ExpectedCohortLockSha256
            model_lock_sha256             = $ExpectedModelLockSha256
            command_configuration_sha256  = $ExpectedConfigurationSha256
            attempt                       = $attemptNumber
            stdout_log_relative           = "logs/$($Case.CaseId).attempt-$attemptNumber.stdout.log"
            stderr_log_relative           = "logs/$($Case.CaseId).attempt-$attemptNumber.stderr.log"
        }
        foreach ($entry in $attemptExpectations.GetEnumerator()) {
            $actual = Get-RequiredPropertyValue -Value $attemptRecord -Name $entry.Key -Context $attemptContext
            if ($entry.Value -is [int] -or $entry.Value -is [long]) {
                if ([long]$actual -ne [long]$entry.Value) {
                    throw "$attemptContext has an invalid $($entry.Key) binding."
                }
            }
            elseif ([string]$actual -cne [string]$entry.Value) {
                throw "$attemptContext has an invalid $($entry.Key) binding."
            }
        }

        $attemptArtifactHashes = Get-RequiredPropertyValue -Value $attemptRecord -Name "artifact_hashes" -Context $attemptContext
        if ((Get-CompactJson -Value $attemptArtifactHashes) -cne (Get-CompactJson -Value ([pscustomobject]$ExpectedArtifactHashes))) {
            throw "$attemptContext tool artifact hashes differ from the current frozen runner artifacts."
        }

        foreach ($logKind in @("stdout", "stderr")) {
            $relativeLog = "logs/$($Case.CaseId).attempt-$attemptNumber.$logKind.log"
            $logPath = Join-Path $RootPath ($relativeLog -replace "/", [IO.Path]::DirectorySeparatorChar)
            Assert-ManagedChildPath -Path $logPath -AllowedParent $LogsPath
            if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
                throw "$attemptContext is missing its exact $logKind log."
            }
        }

        foreach ($validationKind in @("stdout", "stderr")) {
            $propertyName = "validation_${validationKind}_relative"
            $validationRelative = Get-RequiredPropertyValue -Value $attemptRecord -Name $propertyName -Context $attemptContext
            if ($null -ne $validationRelative) {
                $expectedValidationRelative = "logs/$($Case.CaseId).attempt-$attemptNumber.validation.$validationKind.log"
                if ([string]$validationRelative -cne $expectedValidationRelative) {
                    throw "$attemptContext has an invalid $propertyName binding."
                }
                $validationPath = Join-Path $RootPath ($expectedValidationRelative -replace "/", [IO.Path]::DirectorySeparatorChar)
                Assert-ManagedChildPath -Path $validationPath -AllowedParent $LogsPath
                if (-not (Test-Path -LiteralPath $validationPath -PathType Leaf)) {
                    throw "$attemptContext is missing its exact validation $validationKind log."
                }
            }
        }

        $attemptStatus = [string](Get-RequiredPropertyValue -Value $attemptRecord -Name "status" -Context $attemptContext)
        $expectedAttemptStatus = if ($attemptIndex -eq $attempts.Count - 1 -and $status -ceq "succeeded") {
            "succeeded"
        }
        else {
            "failed"
        }
        if ($attemptStatus -cne $expectedAttemptStatus) {
            throw "$attemptContext status is inconsistent with the case result."
        }
        $runtime = [double](Get-RequiredPropertyValue -Value $attemptRecord -Name "runtime_seconds" -Context $attemptContext)
        if (-not [double]::IsFinite($runtime) -or $runtime -lt 0) {
            throw "$attemptContext has invalid runtime evidence."
        }
        $runtimeTotal += $runtime

        foreach ($booleanName in @("prediction_created", "prediction_validated", "final_prediction_created")) {
            $booleanValue = Get-RequiredPropertyValue -Value $attemptRecord -Name $booleanName -Context $attemptContext
            if ($booleanValue -isnot [bool]) {
                throw "$attemptContext property '$booleanName' must be Boolean."
            }
        }
        if ($attemptStatus -ceq "succeeded") {
            $exitCode = Get-RequiredPropertyValue -Value $attemptRecord -Name "exit_code" -Context $attemptContext
            $validationExitCode = Get-RequiredPropertyValue -Value $attemptRecord -Name "validation_exit_code" -Context $attemptContext
            $finalizationExitCode = Get-RequiredPropertyValue -Value $attemptRecord -Name "finalization_exit_code" -Context $attemptContext
            if (
                (Get-RequiredPropertyValue -Value $attemptRecord -Name "prediction_created" -Context $attemptContext) -ne $true -or
                (Get-RequiredPropertyValue -Value $attemptRecord -Name "prediction_validated" -Context $attemptContext) -ne $true -or
                (Get-RequiredPropertyValue -Value $attemptRecord -Name "final_prediction_created" -Context $attemptContext) -ne $true -or
                $null -eq $exitCode -or [int]$exitCode -ne 0 -or
                $null -eq $validationExitCode -or [int]$validationExitCode -ne 0 -or
                $null -eq $finalizationExitCode -or [int]$finalizationExitCode -ne 0 -or
                $null -eq (Get-RequiredPropertyValue -Value $attemptRecord -Name "validation_stdout_relative" -Context $attemptContext) -or
                $null -eq (Get-RequiredPropertyValue -Value $attemptRecord -Name "validation_stderr_relative" -Context $attemptContext)
            ) {
                throw "$attemptContext lacks successful prediction, validation, or finalization evidence."
            }
        }
        elseif ((Get-RequiredPropertyValue -Value $attemptRecord -Name "final_prediction_created" -Context $attemptContext) -ne $false) {
            throw "$attemptContext records failure but claims a finalized canonical prediction."
        }
    }

    $recordedRuntime = [double](Get-RequiredPropertyValue -Value $Timing -Name "runtime_seconds" -Context $context)
    if (-not [double]::IsFinite($recordedRuntime) -or $recordedRuntime -lt 0 -or [math]::Abs($runtimeTotal - $recordedRuntime) -gt 0.001) {
        throw "$context runtime does not equal its bound attempt runtimes."
    }
    if ($status -ceq "succeeded") {
        if (-not (Test-Path -LiteralPath $PredictionPath -PathType Leaf) -or (Get-Item -LiteralPath $PredictionPath).Length -le 0) {
            throw "$context records success but its canonical prediction is missing or empty."
        }
    }
    elseif (Test-Path -LiteralPath $PredictionPath) {
        throw "$context records failure but a canonical prediction exists."
    }
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
$cohortLockPath = Join-Path $resolvedRunRoot "manifests\cohort-lock.public.json"
$modelLockPath = Join-Path $resolvedRunRoot "manifests\model-lock.json"
$predictionLockPath = Join-Path $resolvedRunRoot "prediction-lock.json"
$predictionLockDigestPath = Join-Path $resolvedRunRoot "prediction-lock.sha256"
$inputRoot = Join-Path $resolvedRunRoot "nnunet_input"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Frozen manifest not found: $manifestPath"
}
if (-not (Test-Path -LiteralPath $inputRoot -PathType Container)) {
    throw "nnU-Net input directory not found: $inputRoot"
}

$blindedManifestColumns = @(
    "case_id",
    "selection_order",
    "selection_hash",
    "image_sha256",
    "image_bytes"
)
$expectedBlindedManifestHeader = $blindedManifestColumns -join ","
$manifestFirstLine = Get-Content -LiteralPath $manifestPath -TotalCount 1
$cohortLockExists = Test-Path -LiteralPath $cohortLockPath -PathType Leaf
$hasBlindedManifestHeader = [string]$manifestFirstLine -ceq $expectedBlindedManifestHeader
$blindedMode = $cohortLockExists -or $hasBlindedManifestHeader
if ($blindedMode -and -not $cohortLockExists) {
    throw "A script-blinded manifest requires its immutable cohort lock: $cohortLockPath"
}
if ($blindedMode -and -not $hasBlindedManifestHeader) {
    throw "The script-blinded manifest must have exactly these ordered columns: $expectedBlindedManifestHeader"
}
if (
    $blindedMode -and
    ((Test-Path -LiteralPath $predictionLockPath) -or (Test-Path -LiteralPath $predictionLockDigestPath)) -and
    (-not $PreviewOnly -or $OverwritePredictions -or $ResumeValidatedPredictions)
) {
    throw "Prediction lock material already exists; inference, overwrite, and resume are immutable after prediction lock."
}
if ($blindedMode -and $SmokeCount -gt 0 -and $SkipRecordedFailures) {
    throw "SmokeCount cannot be combined with SkipRecordedFailures in the script-blinded full-denominator protocol."
}

$manifestSha256 = $null
$cohortLockSha256 = $null
$modelLockSha256 = $null
$cohortLock = $null
if ($blindedMode) {
    $manifestBytes = [System.IO.File]::ReadAllBytes($manifestPath)
    if (
        $manifestBytes.Length -ge 3 -and
        $manifestBytes[0] -eq 0xEF -and
        $manifestBytes[1] -eq 0xBB -and
        $manifestBytes[2] -eq 0xBF
    ) {
        throw "The script-blinded manifest must be UTF-8 without a byte-order mark."
    }
    if ($manifestBytes -contains 0x0D) {
        throw "The script-blinded manifest must use LF line endings only."
    }
    try {
        $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
        $manifestText = $strictUtf8.GetString($manifestBytes)
    }
    catch {
        throw "The script-blinded manifest is not valid UTF-8: $($_.Exception.Message)"
    }
    if (-not $manifestText.EndsWith("`n")) {
        throw "The script-blinded manifest must end with an LF newline."
    }
    if (($manifestText -split "`n", 2)[0] -cne $expectedBlindedManifestHeader) {
        throw "The script-blinded manifest header bytes differ from the frozen five-column schema."
    }
    $manifestSha256 = Get-FileSha256 -Path $manifestPath

    $cohortLockPropertyNames = @(
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
        "disclaimer"
    )
    try {
        $cohortLock = Get-Content -LiteralPath $cohortLockPath -Raw | ConvertFrom-Json
    }
    catch {
        throw "Could not parse the immutable cohort lock: $($_.Exception.Message)"
    }
    Assert-ExactPropertySet -Value $cohortLock -ExpectedNames $cohortLockPropertyNames -Context "Cohort lock"
    $cohortSchemaVersion = Get-RequiredPropertyValue -Value $cohortLock -Name "schema_version" -Context "Cohort lock"
    if ($cohortSchemaVersion -isnot [long] -or $cohortSchemaVersion -ne 1) {
        throw "Cohort lock schema_version must be 1."
    }
    foreach ($requiredTextName in @(
        "protocol_namespace",
        "eligible_start",
        "eligible_end",
        "selection_algorithm",
        "imaging_repository",
        "imaging_revision",
        "created_utc",
        "disclaimer"
    )) {
        $requiredText = Get-RequiredPropertyValue -Value $cohortLock -Name $requiredTextName -Context "Cohort lock"
        if ($requiredText -isnot [string] -or [string]::IsNullOrWhiteSpace($requiredText)) {
            throw "Cohort lock property '$requiredTextName' must not be empty."
        }
    }
    $eligibleListSha256 = Get-RequiredPropertyValue -Value $cohortLock -Name "eligible_list_sha256" -Context "Cohort lock"
    if ($eligibleListSha256 -isnot [string] -or $eligibleListSha256 -cnotmatch "^[0-9a-f]{64}$") {
        throw "Cohort lock eligible_list_sha256 must be a lowercase SHA-256 digest."
    }
    $recordedManifestSha256 = Get-RequiredPropertyValue -Value $cohortLock -Name "manifest_sha256" -Context "Cohort lock"
    if ($recordedManifestSha256 -isnot [string] -or $recordedManifestSha256 -cne $manifestSha256) {
        throw "Cohort lock manifest_sha256 does not match the exact manifest bytes."
    }
    $recordedManifestColumnsValue = Get-RequiredPropertyValue -Value $cohortLock -Name "manifest_columns" -Context "Cohort lock"
    $recordedManifestColumns = @($recordedManifestColumnsValue)
    if ($recordedManifestColumnsValue -isnot [array] -or $recordedManifestColumns.Count -ne $blindedManifestColumns.Count) {
        throw "Cohort lock manifest_columns does not match the frozen five-column schema."
    }
    for ($columnIndex = 0; $columnIndex -lt $blindedManifestColumns.Count; $columnIndex++) {
        if ($recordedManifestColumns[$columnIndex] -isnot [string] -or [string]$recordedManifestColumns[$columnIndex] -cne $blindedManifestColumns[$columnIndex]) {
            throw "Cohort lock manifest_columns differs at position $($columnIndex + 1)."
        }
    }
    $researchOnly = Get-RequiredPropertyValue -Value $cohortLock -Name "research_only" -Context "Cohort lock"
    if ($researchOnly -isnot [bool] -or $researchOnly -ne $true) {
        throw "Cohort lock research_only must be Boolean true."
    }
    $eligibleStart = Get-RequiredPropertyValue -Value $cohortLock -Name "eligible_start" -Context "Cohort lock"
    $eligibleEnd = Get-RequiredPropertyValue -Value $cohortLock -Name "eligible_end" -Context "Cohort lock"
    if ($eligibleStart -notmatch "^case_\d{5}$" -or $eligibleEnd -notmatch "^case_\d{5}$" -or $eligibleStart -cgt $eligibleEnd) {
        throw "Cohort lock eligible_start/eligible_end must be an ordered KiTS case range."
    }
    $eligibleCount = Get-RequiredPropertyValue -Value $cohortLock -Name "eligible_count" -Context "Cohort lock"
    $selectionCount = Get-RequiredPropertyValue -Value $cohortLock -Name "selection_count" -Context "Cohort lock"
    $publicSeed = Get-RequiredPropertyValue -Value $cohortLock -Name "public_seed" -Context "Cohort lock"
    $totalImageBytes = Get-RequiredPropertyValue -Value $cohortLock -Name "total_image_bytes" -Context "Cohort lock"
    if (
        $eligibleCount -isnot [long] -or
        $selectionCount -isnot [long] -or
        $publicSeed -isnot [long] -or
        $totalImageBytes -isnot [long] -or
        $eligibleCount -le 0 -or
        $selectionCount -le 0 -or
        $selectionCount -gt $eligibleCount -or
        $publicSeed -lt 0 -or
        $totalImageBytes -le 0
    ) {
        throw "Cohort lock eligible/selection counts are invalid."
    }
    try {
        [void][DateTimeOffset]::Parse(
            [string](Get-RequiredPropertyValue -Value $cohortLock -Name "created_utc" -Context "Cohort lock"),
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::RoundtripKind
        )
    }
    catch {
        throw "Cohort lock created_utc is not a valid ISO-8601 timestamp."
    }
    $cohortLockSha256 = Get-FileSha256 -Path $cohortLockPath

    if (-not (Test-Path -LiteralPath $modelLockPath -PathType Leaf)) {
        throw "The script-blinded run requires its immutable model lock: $modelLockPath"
    }
    try {
        $modelLock = Get-Content -LiteralPath $modelLockPath -Raw | ConvertFrom-Json
    }
    catch {
        throw "Could not parse the immutable model lock: $($_.Exception.Message)"
    }
    $modelLockPropertyNames = @(
        "schema_version",
        "research_only",
        "created_at_utc",
        "disclaimer",
        "model",
        "task",
        "configuration",
        "folds",
        "tta_enabled",
        "source_archive",
        "nnunet_source_commit",
        "installed_plans",
        "installed_folds",
        "pipeline_source_artifact_hashes",
        "provenance_note"
    )
    Assert-ExactPropertySet -Value $modelLock -ExpectedNames $modelLockPropertyNames -Context "Model lock"
    $modelSchemaVersion = Get-RequiredPropertyValue -Value $modelLock -Name "schema_version" -Context "Model lock"
    if ($modelSchemaVersion -isnot [long] -or $modelSchemaVersion -ne 1) {
        throw "Model lock schema_version must be 1."
    }
    if ($modelLock.research_only -isnot [bool] -or $modelLock.research_only -ne $true) {
        throw "Model lock research_only must be Boolean true."
    }
    if ($modelLock.task -cne "Task135_KiTS2021" -or $modelLock.configuration -cne "3d_fullres") {
        throw "Model lock task/configuration does not match the frozen inference command."
    }
    if ($modelLock.folds -isnot [array] -or $modelLock.folds.Count -eq 0) {
        throw "Model lock folds must be a non-empty JSON array."
    }
    $modelFoldValues = @(
        foreach ($modelFold in $modelLock.folds) {
            if ($modelFold -isnot [long] -or $modelFold -lt 0) {
                throw "Model lock folds must contain non-negative integers."
            }
            [string]$modelFold
        }
    )
    if (
        $modelFoldValues.Count -ne $foldValues.Count -or
        (Get-CompactJson -Value $modelFoldValues) -cne (Get-CompactJson -Value $foldValues)
    ) {
        throw "Requested folds do not exactly match the frozen model lock."
    }
    if ($modelLock.tta_enabled -isnot [bool] -or $modelLock.tta_enabled -ne (-not [bool]$DisableTTA)) {
        throw "Requested test-time augmentation setting does not match the frozen model lock."
    }
    foreach ($modelTextName in @("created_at_utc", "disclaimer", "model", "nnunet_source_commit", "provenance_note")) {
        $modelText = Get-RequiredPropertyValue -Value $modelLock -Name $modelTextName -Context "Model lock"
        if ($modelText -isnot [string] -or [string]::IsNullOrWhiteSpace($modelText)) {
            throw "Model lock property '$modelTextName' must be a non-empty string."
        }
    }
    if ([string]::IsNullOrWhiteSpace($PSCommandPath) -or -not (Test-Path -LiteralPath $PSCommandPath -PathType Leaf)) {
        throw "Cannot bind the pre-inference model lock to the runner source file."
    }
    $pipelineSourceArtifactHashes = Get-RequiredPropertyValue `
        -Value $modelLock `
        -Name "pipeline_source_artifact_hashes" `
        -Context "Model lock"
    Assert-PipelineSourceArtifactHashes `
        -Value $pipelineSourceArtifactHashes `
        -PipelineRoot $PSScriptRoot `
        -RunnerPath $PSCommandPath
    $modelLockSha256 = Get-FileSha256 -Path $modelLockPath
}

$manifestRows = @(Import-Csv -LiteralPath $manifestPath)
if ($manifestRows.Count -eq 0) {
    throw "The frozen manifest is empty: $manifestPath"
}
if ($blindedMode) {
    Assert-ExactPropertyNames -Value $manifestRows[0] -ExpectedNames $blindedManifestColumns -Context "Script-blinded manifest row"
    if ($manifestRows.Count -ne [int]$cohortLock.selection_count) {
        throw "Manifest row count does not match cohort lock selection_count."
    }
}

if (-not (Get-Command "wsl.exe" -ErrorAction SilentlyContinue)) {
    throw "wsl.exe is not available on this computer."
}

$casePattern = "^case_\d{5}$"
$seenCaseIds = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
)
$orderedCases = [System.Collections.Generic.List[object]]::new()
$lockedCaseIds = if ($blindedMode) { @($cohortLock.case_ids) } else { @() }
$lockedSelectionHashes = if ($blindedMode) { @($cohortLock.selection_hashes) } else { @() }
$blindedTotalImageBytes = [long]0
$previousSelectionHash = $null
if ($blindedMode) {
    if ($cohortLock.case_ids -isnot [array] -or $cohortLock.selection_hashes -isnot [array]) {
        throw "Cohort lock case_ids and selection_hashes must be JSON arrays."
    }
    if ([int]$cohortLock.selection_count -ne 20) {
        throw "The script-blinded full-denominator cohort must contain exactly 20 cases."
    }
    if ($lockedCaseIds.Count -ne $manifestRows.Count -or $lockedSelectionHashes.Count -ne $manifestRows.Count) {
        throw "Cohort lock case_ids and selection_hashes must be parallel arrays matching the manifest."
    }
    for ($lockIndex = 0; $lockIndex -lt $lockedCaseIds.Count; $lockIndex++) {
        if ($lockedCaseIds[$lockIndex] -isnot [string] -or $lockedSelectionHashes[$lockIndex] -isnot [string]) {
            throw "Cohort lock case_ids and selection_hashes entries must all be strings."
        }
    }
    $publicSeedText = [string]$cohortLock.public_seed
    if ($publicSeedText -notmatch "^\d+$") {
        throw "Cohort lock public_seed must be a non-negative integer."
    }
    $eligibleStartNumber = [int]$cohortLock.eligible_start.Substring(5)
    $eligibleEndNumber = [int]$cohortLock.eligible_end.Substring(5)
    if ([int]$cohortLock.eligible_count -ne ($eligibleEndNumber - $eligibleStartNumber + 1)) {
        throw "Cohort lock eligible_count does not match its inclusive eligible range."
    }
}
for ($index = 0; $index -lt $manifestRows.Count; $index++) {
    $row = $manifestRows[$index]
    if ($blindedMode) {
        Assert-ExactPropertyNames -Value $row -ExpectedNames $blindedManifestColumns -Context "Script-blinded manifest row $($index + 2)"
    }
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
    $selectionHash = $null
    $inputImageSha256 = $null
    $inputImageBytes = $null
    $inputRelative = "nnunet_input/${caseId}_0000.nii.gz"
    $sourceCacheRelative = "source/images/${caseId}.nii.gz"
    if ($blindedMode) {
        if ($caseId -clt [string]$cohortLock.eligible_start -or $caseId -cgt [string]$cohortLock.eligible_end) {
            throw "Manifest case $caseId falls outside the locked eligible range."
        }
        if ([string]$lockedCaseIds[$index] -cne $caseId) {
            throw "Cohort lock case_ids differs from the manifest at selection order $($index + 1)."
        }
        $selectionHash = [string]$row.selection_hash
        if ($selectionHash -cnotmatch "^[0-9a-f]{64}$") {
            throw "Manifest selection_hash must be a lowercase SHA-256 digest at $caseId."
        }
        if ([string]$lockedSelectionHashes[$index] -cne $selectionHash) {
            throw "Cohort lock selection_hashes differs from the manifest at $caseId."
        }
        $expectedSelectionHash = Get-StringSha256 -Value (
            "$($cohortLock.protocol_namespace)|seed=$publicSeedText|$caseId"
        )
        if ($selectionHash -cne $expectedSelectionHash) {
            throw "Manifest selection_hash does not match the locked namespace/seed/case formula at $caseId."
        }
        if ($null -ne $previousSelectionHash -and $selectionHash -cle $previousSelectionHash) {
            throw "Manifest selection_hash values must be in strict ascending selection order."
        }
        $previousSelectionHash = $selectionHash

        $inputImageSha256 = [string]$row.image_sha256
        if ($inputImageSha256 -cnotmatch "^[0-9a-f]{64}$") {
            throw "Manifest image_sha256 must be a lowercase SHA-256 digest at $caseId."
        }
        $inputBytesText = [string]$row.image_bytes
        if ($inputBytesText -notmatch "^[1-9]\d*$") {
            throw "Manifest image_bytes must be a positive base-10 integer at $caseId."
        }
        $inputImageBytes = [long]$inputBytesText
        if ([string]$inputImageBytes -cne $inputBytesText) {
            throw "Manifest image_bytes must use its canonical base-10 representation at $caseId."
        }
    }
    $sourcePath = Join-Path $inputRoot "${caseId}_0000.nii.gz"
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Frozen manifest input is missing (no case substitution is allowed): $sourcePath"
    }
    $sourceCachePath = Join-Path $resolvedRunRoot "source\images\${caseId}.nii.gz"
    if ($blindedMode) {
        $actualInputBytes = (Get-Item -LiteralPath $sourcePath).Length
        if ($actualInputBytes -ne $inputImageBytes) {
            throw "Frozen input byte count differs from the manifest at $caseId."
        }
        if ((Get-FileSha256 -Path $sourcePath) -cne $inputImageSha256) {
            throw "Frozen input SHA-256 differs from the manifest at $caseId."
        }
        if (-not (Test-Path -LiteralPath $sourceCachePath -PathType Leaf)) {
            throw "Frozen source cache image is missing at ${caseId}: $sourceCachePath"
        }
        if ((Get-Item -LiteralPath $sourceCachePath).Length -ne $inputImageBytes) {
            throw "Frozen source cache byte count differs from the manifest at $caseId."
        }
        if ((Get-FileSha256 -Path $sourceCachePath) -cne $inputImageSha256) {
            throw "Frozen source cache SHA-256 differs from the manifest at $caseId."
        }
        $blindedTotalImageBytes += $inputImageBytes
    }
    $orderedCases.Add([pscustomobject]@{
        CaseId           = $caseId
        CohortPosition   = $index + 1
        SelectionHash    = $selectionHash
        SourcePath       = $sourcePath
        SourceCachePath  = $sourceCachePath
        InputRelative    = $inputRelative
        SourceRelative   = $sourceCacheRelative
        InputImageSha256 = $inputImageSha256
        InputImageBytes  = $inputImageBytes
    })
}

if ($blindedMode) {
    if ($blindedTotalImageBytes -ne [long]$cohortLock.total_image_bytes) {
        throw "Cohort lock total_image_bytes does not equal the exact frozen CT inputs."
    }
    $allowedVolumeRelativePaths = [System.Collections.Generic.List[string]]::new()
    foreach ($case in $orderedCases) {
        $allowedVolumeRelativePaths.Add($case.InputRelative)
        $allowedVolumeRelativePaths.Add($case.SourceRelative)
        $allowedVolumeRelativePaths.Add("predictions/$($case.CaseId).nii.gz")
    }
    Assert-BlindedDataBoundary -RootPath $resolvedRunRoot -AllowedVolumeRelativePaths $allowedVolumeRelativePaths
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
$artifactHashes = $null
if ($blindedMode) {
    if ([string]::IsNullOrWhiteSpace($PSCommandPath) -or -not (Test-Path -LiteralPath $PSCommandPath -PathType Leaf)) {
        throw "Cannot bind the script-blinded timing records to the runner source file."
    }
    $artifactHashes = [ordered]@{
        runner_sha256          = Get-FileSha256 -Path $PSCommandPath
        validator_sha256       = Get-FileSha256 -Path $validatorScript
        scratch_manager_sha256 = Get-FileSha256 -Path $scratchManagerScript
    }
}
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
    if ($blindedMode) {
        $commandConfiguration.Add("protocol_mode", "script_blinded_full_denominator")
        $commandConfiguration.Add("case_id", $caseId)
        $commandConfiguration.Add("cohort_position", [int]$case.CohortPosition)
        $commandConfiguration.Add("selection_order", [int]$case.CohortPosition)
        $commandConfiguration.Add("selection_hash", $case.SelectionHash)
        $commandConfiguration.Add("input_image_relative", $case.InputRelative)
        $commandConfiguration.Add("input_image_wsl", $caseSourceWsl)
        $commandConfiguration.Add("input_image_sha256", $case.InputImageSha256)
        $commandConfiguration.Add("input_image_bytes", [long]$case.InputImageBytes)
        $commandConfiguration.Add("source_cache_relative", $case.SourceRelative)
        $commandConfiguration.Add("manifest_sha256", $manifestSha256)
        $commandConfiguration.Add("cohort_lock_sha256", $cohortLockSha256)
        $commandConfiguration.Add("model_lock_sha256", $modelLockSha256)
        $commandConfiguration.Add("artifact_hashes", [pscustomobject]$artifactHashes)
    }
    $commandConfigurationSha256 = if ($blindedMode) {
        Get-StringSha256 -Value (Get-CompactJson -Value ([pscustomobject]$commandConfiguration))
    }
    else {
        $null
    }

    if ($PreviewOnly) {
        $previewRecord = [ordered]@{
            case_id               = $caseId
            cohort_position       = $case.CohortPosition
            command_configuration = $commandConfiguration
            wsl_argv              = $wslArguments
        }
        if ($blindedMode) {
            $previewRecord.Insert(2, "command_configuration_sha256", $commandConfigurationSha256)
        }
        [pscustomobject]$previewRecord | ConvertTo-Json -Depth 10
        continue
    }

    if ($blindedMode) {
        if ((Test-Path -LiteralPath $predictionLockPath) -or (Test-Path -LiteralPath $predictionLockDigestPath)) {
            throw "Prediction lock material appeared during inference; refusing to modify the locked run."
        }
        if ((Get-FileSha256 -Path $manifestPath) -cne $manifestSha256) {
            throw "Frozen manifest changed after blinded preflight."
        }
        if ((Get-FileSha256 -Path $cohortLockPath) -cne $cohortLockSha256) {
            throw "Cohort lock changed after blinded preflight."
        }
        if ((Get-FileSha256 -Path $modelLockPath) -cne $modelLockSha256) {
            throw "Model lock changed after blinded preflight."
        }
        if ((Get-Item -LiteralPath $case.SourcePath).Length -ne [long]$case.InputImageBytes -or (Get-FileSha256 -Path $case.SourcePath) -cne $case.InputImageSha256) {
            throw "Frozen inference CT changed after blinded preflight at $caseId."
        }
        if ((Get-Item -LiteralPath $case.SourceCachePath).Length -ne [long]$case.InputImageBytes -or (Get-FileSha256 -Path $case.SourceCachePath) -cne $case.InputImageSha256) {
            throw "Frozen source-cache CT changed after blinded preflight at $caseId."
        }
        if (
            (Get-FileSha256 -Path $PSCommandPath) -cne $artifactHashes.runner_sha256 -or
            (Get-FileSha256 -Path $validatorScript) -cne $artifactHashes.validator_sha256 -or
            (Get-FileSha256 -Path $scratchManagerScript) -cne $artifactHashes.scratch_manager_sha256
        ) {
            throw "A frozen runner artifact changed after blinded preflight."
        }

        if ($ResumeValidatedPredictions) {
            $boundTimingPath = Join-Path $timingsRoot "${caseId}.json"
            if (Test-Path -LiteralPath $boundTimingPath -PathType Leaf) {
                try {
                    $boundTiming = Get-Content -LiteralPath $boundTimingPath -Raw | ConvertFrom-Json
                }
                catch {
                    throw "Cannot resume $caseId because its timing record is invalid JSON: $($_.Exception.Message)"
                }
                Assert-BlindedTimingBinding `
                    -Timing $boundTiming `
                    -Case $case `
                    -ExpectedConfiguration $commandConfiguration `
                    -ExpectedConfigurationSha256 $commandConfigurationSha256 `
                    -ExpectedArtifactHashes $artifactHashes `
                    -ExpectedManifestSha256 $manifestSha256 `
                    -ExpectedCohortLockSha256 $cohortLockSha256 `
                    -ExpectedModelLockSha256 $modelLockSha256 `
                    -RootPath $resolvedRunRoot `
                    -LogsPath $logsRoot `
                    -PredictionPath $finalPrediction
            }
        }
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
        if (-not $blindedMode) {
            # Preserve the historical runner's resume logs. The blinded v2
            # contract intentionally creates no unbound log artifacts; the
            # canonical attempt logs remain immutable and the prediction lock
            # independently revalidates every prediction.
            Set-Content -LiteralPath (Join-Path $logsRoot "${caseId}.resume.validation.stdout.log") -Value $resumeValidation.Stdout -Encoding utf8NoBOM
            Set-Content -LiteralPath (Join-Path $logsRoot "${caseId}.resume.validation.stderr.log") -Value $resumeValidation.Stderr -Encoding utf8NoBOM
        }
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
        $attemptRecord = if ($blindedMode) {
            [pscustomobject][ordered]@{
                case_id                      = $caseId
                cohort_position              = [int]$case.CohortPosition
                selection_order              = [int]$case.CohortPosition
                selection_hash               = $case.SelectionHash
                input_image_relative         = $case.InputRelative
                input_image_sha256           = $case.InputImageSha256
                input_image_bytes            = [long]$case.InputImageBytes
                prediction_relative          = "predictions/$caseId.nii.gz"
                manifest_sha256              = $manifestSha256
                cohort_lock_sha256           = $cohortLockSha256
                model_lock_sha256            = $modelLockSha256
                command_configuration_sha256 = $commandConfigurationSha256
                artifact_hashes               = [pscustomobject]$artifactHashes
                attempt                       = $attempt
                status                        = if ($attemptSucceeded) { "succeeded" } else { "failed" }
                exit_code                     = $result.ExitCode
                runtime_seconds               = $result.RuntimeSeconds
                prediction_created            = $predictionPresent
                prediction_validated          = $validationSucceeded
                validation_exit_code          = if ($null -ne $validationResult) { $validationResult.ExitCode } else { $null }
                finalization_exit_code        = if ($null -ne $finalizeResult) { $finalizeResult.ExitCode } else { $null }
                final_prediction_created      = $finalizedPredictionPresent
                process_start_error_type      = $result.StartError
                stdout_log_relative           = "logs/$caseId.attempt-$attempt.stdout.log"
                stderr_log_relative           = "logs/$caseId.attempt-$attempt.stderr.log"
                validation_stdout_relative    = if ($null -ne $validationResult) { "logs/$caseId.attempt-$attempt.validation.stdout.log" } else { $null }
                validation_stderr_relative    = if ($null -ne $validationResult) { "logs/$caseId.attempt-$attempt.validation.stderr.log" } else { $null }
            }
        }
        else {
            [pscustomobject][ordered]@{
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
            }
        }
        $attemptRecords.Add($attemptRecord)

        if ($attemptSucceeded) {
            $caseSucceeded = $true
            break
        }
    }

    if ($blindedMode) {
        if ((Test-Path -LiteralPath $predictionLockPath) -or (Test-Path -LiteralPath $predictionLockDigestPath)) {
            throw "Prediction lock material appeared during inference; refusing to write post-lock timing evidence."
        }
        if (
            (Get-FileSha256 -Path $manifestPath) -cne $manifestSha256 -or
            (Get-FileSha256 -Path $cohortLockPath) -cne $cohortLockSha256 -or
            (Get-FileSha256 -Path $modelLockPath) -cne $modelLockSha256
        ) {
            throw "A blinded manifest/cohort/model lock changed during case inference."
        }
        if ((Get-Item -LiteralPath $case.SourcePath).Length -ne [long]$case.InputImageBytes -or (Get-FileSha256 -Path $case.SourcePath) -cne $case.InputImageSha256) {
            throw "Frozen inference CT changed during case inference at $caseId."
        }
        if (
            (Get-FileSha256 -Path $PSCommandPath) -cne $artifactHashes.runner_sha256 -or
            (Get-FileSha256 -Path $validatorScript) -cne $artifactHashes.validator_sha256 -or
            (Get-FileSha256 -Path $scratchManagerScript) -cne $artifactHashes.scratch_manager_sha256
        ) {
            throw "A frozen runner artifact changed during case inference."
        }
    }

    $finishedUtc = [DateTime]::UtcNow
    $totalRuntime = (
        $attemptRecords |
            ForEach-Object { [double]$_.runtime_seconds } |
            Measure-Object -Sum
    ).Sum
    $timingRecord = if ($blindedMode) {
        [ordered]@{
            schema_version                = 2
            run_mode                     = "research_feasibility_script_blinded"
            disclaimer                   = "Research prototype only. Not a medical device. Not for patient care."
            case_id                      = $caseId
            cohort_position              = [int]$case.CohortPosition
            selection_order              = [int]$case.CohortPosition
            selection_hash               = $case.SelectionHash
            input_image_relative         = $case.InputRelative
            input_image_sha256           = $case.InputImageSha256
            input_image_bytes            = [long]$case.InputImageBytes
            prediction_relative          = "predictions/$caseId.nii.gz"
            manifest_sha256              = $manifestSha256
            cohort_lock_sha256           = $cohortLockSha256
            model_lock_sha256            = $modelLockSha256
            command_configuration_sha256 = $commandConfigurationSha256
            artifact_hashes               = [pscustomobject]$artifactHashes
            status                        = if ($caseSucceeded) { "succeeded" } else { "failed" }
            attempts                      = $attemptRecords.Count
            runtime_seconds               = [math]::Round([double]$totalRuntime, 3)
            started_utc                   = $startedUtc.ToString("o")
            finished_utc                  = $finishedUtc.ToString("o")
            command_configuration         = $commandConfiguration
            attempt_records               = $attemptRecords
        }
    }
    else {
        [ordered]@{
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
    }
    $timingPath = Join-Path $timingsRoot "${caseId}.json"
    Write-JsonAtomically -Value $timingRecord -Path $timingPath
    if ($blindedMode) {
        $writtenTiming = Get-Content -LiteralPath $timingPath -Raw | ConvertFrom-Json
        Assert-BlindedTimingBinding `
            -Timing $writtenTiming `
            -Case $case `
            -ExpectedConfiguration $commandConfiguration `
            -ExpectedConfigurationSha256 $commandConfigurationSha256 `
            -ExpectedArtifactHashes $artifactHashes `
            -ExpectedManifestSha256 $manifestSha256 `
            -ExpectedCohortLockSha256 $cohortLockSha256 `
            -ExpectedModelLockSha256 $modelLockSha256 `
            -RootPath $resolvedRunRoot `
            -LogsPath $logsRoot `
            -PredictionPath $finalPrediction
    }

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
