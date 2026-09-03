#requires -Version 7.0

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-ThrowsLike {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action,

        [Parameter(Mandatory = $true)]
        [string]$Pattern,

        [Parameter(Mandatory = $true)]
        [string]$Context
    )

    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notlike $Pattern) {
            throw "$Context threw an unexpected message: $($_.Exception.Message)"
        }
        return
    }
    throw "$Context did not fail closed."
}

$runnerPath = (Resolve-Path -LiteralPath (
    Join-Path $PSScriptRoot "..\run_nnunet_wsl.ps1"
)).Path
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $runnerPath,
    [ref]$tokens,
    [ref]$parseErrors
)
Assert-True ($parseErrors.Count -eq 0) "Runner has PowerShell parser errors."

$source = Get-Content -LiteralPath $runnerPath -Raw
foreach ($requiredSourceFragment in @(
    '$expectedBlindedManifestHeader = $blindedManifestColumns -join ","',
    '"case_id"',
    '"selection_order"',
    '"selection_hash"',
    '"image_sha256"',
    '"image_bytes"',
    'cohort-lock.public.json',
    'model-lock.json',
    'pipeline_source_artifact_hashes',
    'evaluator_sha256',
    'reference_releaser_sha256',
    'public_summary_builder_sha256',
    'prediction-lock.json',
    'prediction-lock.sha256',
    'research_feasibility_script_blinded',
    'command_configuration_sha256',
    'input_image_relative',
    'input_image_sha256',
    'input_image_bytes',
    'schema_version                = 2',
    'schema_version         = 1'
)) {
    Assert-True ($source.Contains($requiredSourceFragment)) "Runner is missing contract fragment: $requiredSourceFragment"
}
Assert-True (-not $source.Contains('source_image_sha256')) "Runner contains the rejected source_image_* timing vocabulary."

$neededFunctions = @(
    "Assert-ManagedChildPath",
    "Get-StringSha256",
    "Get-CompactJson",
    "Get-RequiredPropertyValue",
    "Assert-ExactPropertySet",
    "Get-FileSha256",
    "Assert-PipelineSourceArtifactHashes",
    "Assert-BlindedTimingBinding"
)
$functionAsts = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $neededFunctions -contains $node.Name
}, $true))
Assert-True ($functionAsts.Count -eq $neededFunctions.Count) "Could not isolate all runner contract functions."
foreach ($functionName in $neededFunctions) {
    $functionAst = $functionAsts | Where-Object Name -CEQ $functionName
    Invoke-Expression $functionAst.Extent.Text
}
$outOfOrderLock = [pscustomobject][ordered]@{ z = 1; a = 2 }
Assert-ExactPropertySet -Value $outOfOrderLock -ExpectedNames @("a", "z") -Context "Order-independent test lock"
Assert-ThrowsLike {
    Assert-ExactPropertySet -Value $outOfOrderLock -ExpectedNames @("a", "missing") -Context "Test lock"
} "*must contain exactly these properties*" "Exact lock key set"

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("calyxview-runner-contract-" + [guid]::NewGuid().ToString("N"))
$resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
try {
    $pipelineFixtureRoot = Join-Path $testRoot "pipeline-sources"
    [void](New-Item -ItemType Directory -Path $pipelineFixtureRoot -Force)
    $pipelineFileMap = [ordered]@{
        runner_sha256                 = $runnerPath
        validator_sha256              = Join-Path $pipelineFixtureRoot "validate_prediction.py"
        scratch_manager_sha256        = Join-Path $pipelineFixtureRoot "manage_native_scratch.py"
        cohort_preparer_sha256        = Join-Path $pipelineFixtureRoot "prepare_blinded_cohort.py"
        model_locker_sha256           = Join-Path $pipelineFixtureRoot "create_model_lock.py"
        prediction_locker_sha256      = Join-Path $pipelineFixtureRoot "lock_predictions.py"
        provenance_capturer_sha256    = Join-Path $pipelineFixtureRoot "capture_blinded_provenance.py"
        evaluator_sha256              = Join-Path $pipelineFixtureRoot "evaluate_and_report.py"
        reference_releaser_sha256     = Join-Path $pipelineFixtureRoot "release_references.py"
        public_summary_builder_sha256 = Join-Path $pipelineFixtureRoot "make_blinded_public_summary.py"
    }
    foreach ($entry in $pipelineFileMap.GetEnumerator()) {
        if ($entry.Key -cne "runner_sha256") {
            Set-Content -LiteralPath $entry.Value -Value "frozen $($entry.Key)" -Encoding utf8NoBOM
        }
    }
    $pipelineHashMap = [ordered]@{}
    foreach ($entry in $pipelineFileMap.GetEnumerator()) {
        $pipelineHashMap[$entry.Key] = Get-FileSha256 -Path $entry.Value
    }
    $pipelineHashObject = [pscustomobject]$pipelineHashMap
    Assert-PipelineSourceArtifactHashes `
        -Value $pipelineHashObject `
        -PipelineRoot $pipelineFixtureRoot `
        -RunnerPath $runnerPath

    $originalEvaluatorHash = $pipelineHashObject.evaluator_sha256
    $pipelineHashObject.evaluator_sha256 = "0" * 64
    Assert-ThrowsLike {
        Assert-PipelineSourceArtifactHashes `
            -Value $pipelineHashObject `
            -PipelineRoot $pipelineFixtureRoot `
            -RunnerPath $runnerPath
    } "*hash mismatch for 'evaluator_sha256'*" "Changed evaluator source"
    $pipelineHashObject.evaluator_sha256 = $originalEvaluatorHash

    $pipelineHashObject | Add-Member -NotePropertyName unexpected_sha256 -NotePropertyValue ("f" * 64)
    Assert-ThrowsLike {
        Assert-PipelineSourceArtifactHashes `
            -Value $pipelineHashObject `
            -PipelineRoot $pipelineFixtureRoot `
            -RunnerPath $runnerPath
    } "*must contain exactly these properties*" "Extra pipeline source hash"
    $pipelineHashObject.PSObject.Properties.Remove("unexpected_sha256")

    $preflightRoot = Join-Path $testRoot "preflight"
    $preflightManifestRoot = Join-Path $preflightRoot "manifests"
    [void](New-Item -ItemType Directory -Path $preflightManifestRoot, (Join-Path $preflightRoot "nnunet_input") -Force)
    $preflightManifest = Join-Path $preflightManifestRoot "manifest.csv"
    $fiveColumnHeader = "case_id,selection_order,selection_hash,image_sha256,image_bytes"
    Set-Content -LiteralPath $preflightManifest -Value $fiveColumnHeader -Encoding utf8NoBOM
    $baseRunnerArguments = @{
        RunRoot       = $preflightRoot
        NnUNetSource = $testRoot
        ResultsFolder = $testRoot
    }
    Assert-ThrowsLike {
        & $runnerPath @baseRunnerArguments
    } "*requires its immutable cohort lock*" "Blinded manifest without cohort lock"

    Set-Content -LiteralPath (Join-Path $preflightManifestRoot "cohort-lock.public.json") -Value "{}" -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $preflightRoot "prediction-lock.sha256") -Value ("a" * 64) -Encoding utf8NoBOM
    Assert-ThrowsLike {
        & $runnerPath @baseRunnerArguments
    } "*Prediction lock material already exists*" "Post-lock inference"
    Remove-Item -LiteralPath (Join-Path $preflightRoot "prediction-lock.sha256") -Force

    Assert-ThrowsLike {
        & $runnerPath @baseRunnerArguments -ResumeValidatedPredictions -SkipRecordedFailures -SmokeCount 1
    } "*SmokeCount cannot be combined with SkipRecordedFailures*" "Smoke/recovery denominator conflict"

    Set-Content -LiteralPath $preflightManifest -Value "$fiveColumnHeader,unexpected" -Encoding utf8NoBOM
    Assert-ThrowsLike {
        & $runnerPath @baseRunnerArguments
    } "*must have exactly these ordered columns*" "Extra manifest column"

    $logsRoot = Join-Path $testRoot "logs"
    $predictionsRoot = Join-Path $testRoot "predictions"
    [void](New-Item -ItemType Directory -Path $logsRoot, $predictionsRoot -Force)

    $caseId = "case_00474"
    foreach ($relativeLog in @(
        "${caseId}.attempt-1.stdout.log",
        "${caseId}.attempt-1.stderr.log",
        "${caseId}.attempt-1.validation.stdout.log",
        "${caseId}.attempt-1.validation.stderr.log"
    )) {
        Set-Content -LiteralPath (Join-Path $logsRoot $relativeLog) -Value "test" -Encoding utf8NoBOM
    }
    $predictionPath = Join-Path $predictionsRoot "${caseId}.nii.gz"
    Set-Content -LiteralPath $predictionPath -Value "test-prediction" -Encoding utf8NoBOM

    $case = [pscustomobject]@{
        CaseId           = $caseId
        CohortPosition   = 1
        SelectionHash    = ("1" * 64)
        InputRelative    = "nnunet_input/${caseId}_0000.nii.gz"
        InputImageSha256 = ("2" * 64)
        InputImageBytes  = [long]123
    }
    $artifactHashes = [ordered]@{
        runner_sha256          = ("3" * 64)
        validator_sha256       = ("4" * 64)
        scratch_manager_sha256 = ("5" * 64)
    }
    $configuration = [ordered]@{
        launcher = "wsl.exe"
        task     = "Task135_KiTS2021"
        folds    = @("0", "1", "2", "3", "4")
    }
    $configurationSha256 = Get-StringSha256 -Value (
        Get-CompactJson -Value ([pscustomobject]$configuration)
    )
    $manifestSha256 = "6" * 64
    $cohortLockSha256 = "7" * 64
    $modelLockSha256 = "8" * 64
    $attempt = [pscustomobject][ordered]@{
        case_id                      = $caseId
        cohort_position              = 1
        selection_order              = 1
        selection_hash               = $case.SelectionHash
        input_image_relative         = $case.InputRelative
        input_image_sha256           = $case.InputImageSha256
        input_image_bytes            = [long]$case.InputImageBytes
        prediction_relative          = "predictions/$caseId.nii.gz"
        manifest_sha256              = $manifestSha256
        cohort_lock_sha256           = $cohortLockSha256
        model_lock_sha256            = $modelLockSha256
        command_configuration_sha256 = $configurationSha256
        artifact_hashes               = [pscustomobject]$artifactHashes
        attempt                       = 1
        status                        = "succeeded"
        exit_code                     = 0
        runtime_seconds               = 1.25
        prediction_created            = $true
        prediction_validated          = $true
        validation_exit_code          = 0
        finalization_exit_code        = 0
        final_prediction_created      = $true
        process_start_error_type      = $null
        stdout_log_relative           = "logs/$caseId.attempt-1.stdout.log"
        stderr_log_relative           = "logs/$caseId.attempt-1.stderr.log"
        validation_stdout_relative    = "logs/$caseId.attempt-1.validation.stdout.log"
        validation_stderr_relative    = "logs/$caseId.attempt-1.validation.stderr.log"
    }
    $timing = [pscustomobject][ordered]@{
        schema_version                = 2
        run_mode                     = "research_feasibility_script_blinded"
        case_id                      = $caseId
        cohort_position              = 1
        selection_order              = 1
        selection_hash               = $case.SelectionHash
        input_image_relative         = $case.InputRelative
        input_image_sha256           = $case.InputImageSha256
        input_image_bytes            = [long]$case.InputImageBytes
        prediction_relative          = "predictions/$caseId.nii.gz"
        manifest_sha256              = $manifestSha256
        cohort_lock_sha256           = $cohortLockSha256
        model_lock_sha256            = $modelLockSha256
        command_configuration_sha256 = $configurationSha256
        artifact_hashes               = [pscustomobject]$artifactHashes
        status                        = "succeeded"
        attempts                      = 1
        runtime_seconds               = 1.25
        command_configuration         = [pscustomobject]$configuration
        attempt_records               = @($attempt)
    }

    $assertArguments = @{
        Timing                       = $timing
        Case                         = $case
        ExpectedConfiguration        = $configuration
        ExpectedConfigurationSha256  = $configurationSha256
        ExpectedArtifactHashes       = $artifactHashes
        ExpectedManifestSha256       = $manifestSha256
        ExpectedCohortLockSha256     = $cohortLockSha256
        ExpectedModelLockSha256      = $modelLockSha256
        RootPath                     = $testRoot
        LogsPath                     = $logsRoot
        PredictionPath               = $predictionPath
    }
    Assert-BlindedTimingBinding @assertArguments

    $timing.case_id = "case_00537"
    Assert-ThrowsLike { Assert-BlindedTimingBinding @assertArguments } "*invalid case_id binding*" "Cross-case top-level substitution"
    $timing.case_id = $caseId

    $attempt.case_id = "case_00537"
    Assert-ThrowsLike { Assert-BlindedTimingBinding @assertArguments } "*attempt 1 has an invalid case_id binding*" "Cross-case attempt substitution"
    $attempt.case_id = $caseId

    $attempt.stdout_log_relative = "logs/case_00537.attempt-1.stdout.log"
    Assert-ThrowsLike { Assert-BlindedTimingBinding @assertArguments } "*invalid stdout_log_relative binding*" "Cross-case log substitution"
    $attempt.stdout_log_relative = "logs/$caseId.attempt-1.stdout.log"

    $timing.command_configuration.task = "mutated-task"
    Assert-ThrowsLike { Assert-BlindedTimingBinding @assertArguments } "*does not match the current frozen command configuration*" "Configuration substitution"
    $timing.command_configuration.task = "Task135_KiTS2021"

    $attempt.attempt = 2
    Assert-ThrowsLike { Assert-BlindedTimingBinding @assertArguments } "*invalid attempt binding*" "Attempt-number substitution"
    $attempt.attempt = 1

    foreach ($attemptNumber in 1..2) {
        foreach ($logKind in @("stdout", "stderr")) {
            Set-Content -LiteralPath (Join-Path $logsRoot "${caseId}.attempt-$attemptNumber.$logKind.log") -Value "failed" -Encoding utf8NoBOM
        }
    }
    $failedAttempts = @(
        foreach ($attemptNumber in 1..2) {
            [pscustomobject][ordered]@{
                case_id                      = $caseId
                cohort_position              = 1
                selection_order              = 1
                selection_hash               = $case.SelectionHash
                input_image_relative         = $case.InputRelative
                input_image_sha256           = $case.InputImageSha256
                input_image_bytes            = [long]$case.InputImageBytes
                prediction_relative          = "predictions/$caseId.nii.gz"
                manifest_sha256              = $manifestSha256
                cohort_lock_sha256           = $cohortLockSha256
                model_lock_sha256            = $modelLockSha256
                command_configuration_sha256 = $configurationSha256
                artifact_hashes               = [pscustomobject]$artifactHashes
                attempt                       = $attemptNumber
                status                        = "failed"
                exit_code                     = 1
                runtime_seconds               = 1.0
                prediction_created            = $false
                prediction_validated          = $false
                validation_exit_code          = $null
                finalization_exit_code        = $null
                final_prediction_created      = $false
                process_start_error_type      = $null
                stdout_log_relative           = "logs/$caseId.attempt-$attemptNumber.stdout.log"
                stderr_log_relative           = "logs/$caseId.attempt-$attemptNumber.stderr.log"
                validation_stdout_relative    = $null
                validation_stderr_relative    = $null
            }
        }
    )
    $failedTiming = [pscustomobject][ordered]@{
        schema_version                = 2
        run_mode                     = "research_feasibility_script_blinded"
        case_id                      = $caseId
        cohort_position              = 1
        selection_order              = 1
        selection_hash               = $case.SelectionHash
        input_image_relative         = $case.InputRelative
        input_image_sha256           = $case.InputImageSha256
        input_image_bytes            = [long]$case.InputImageBytes
        prediction_relative          = "predictions/$caseId.nii.gz"
        manifest_sha256              = $manifestSha256
        cohort_lock_sha256           = $cohortLockSha256
        model_lock_sha256            = $modelLockSha256
        command_configuration_sha256 = $configurationSha256
        artifact_hashes               = [pscustomobject]$artifactHashes
        status                        = "failed"
        attempts                      = 2
        runtime_seconds               = 2.0
        command_configuration         = [pscustomobject]$configuration
        attempt_records               = $failedAttempts
    }
    $failureArguments = $assertArguments.Clone()
    $failureArguments.Timing = $failedTiming
    $failureArguments.PredictionPath = Join-Path $predictionsRoot "missing-${caseId}.nii.gz"
    Assert-BlindedTimingBinding @failureArguments

    $failedAttempts[1].attempt = 1
    Assert-ThrowsLike { Assert-BlindedTimingBinding @failureArguments } "*attempt 2 has an invalid attempt binding*" "Failure attempt replay"
    $failedAttempts[1].attempt = 2

    $failedAttempts[1].stderr_log_relative = "logs/$caseId.attempt-1.stderr.log"
    Assert-ThrowsLike { Assert-BlindedTimingBinding @failureArguments } "*attempt 2 has an invalid stderr_log_relative binding*" "Failure log replay"
    $failedAttempts[1].stderr_log_relative = "logs/$caseId.attempt-2.stderr.log"

    "runner_hardening_contract: PASS"
}
finally {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if (
        $resolvedTestRoot.StartsWith(
            $resolvedTempRoot + [System.IO.Path]::DirectorySeparatorChar,
            [System.StringComparison]::OrdinalIgnoreCase
        ) -and
        (Split-Path -Leaf $resolvedTestRoot).StartsWith("calyxview-runner-contract-", [System.StringComparison]::Ordinal)
    ) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
