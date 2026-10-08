#requires -Version 7.2

param(
    [switch]$CheckOnly,
    [string]$SourceRepoRoot,
    [string]$ReleaseTag,
    [string]$ReleaseBranch,
    [string]$Profile = 'production',
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($ReleaseTag -and $ReleaseBranch) {
    throw 'Specify only one of -ReleaseTag or -ReleaseBranch.'
}

$engine = Join-Path $PSScriptRoot 'deploy-worker.ps1'
$invoke = @{
    Profile = $Profile
}

if ($CheckOnly) { $invoke.CheckOnly = $true }
if ($SourceRepoRoot) { $invoke.SourceRepoRoot = $SourceRepoRoot }
if ($ConfigPath) { $invoke.ConfigPath = $ConfigPath }

if ($ReleaseBranch) {
    $invoke.SourceType = 'branch'
    $invoke.SourceRemote = 'upstream'
    $invoke.SourceName = $ReleaseBranch
}
elseif ($ReleaseTag) {
    $invoke.SourceType = 'tag'
    $invoke.SourceRemote = 'upstream'
    $invoke.SourceName = $ReleaseTag
}

& $engine @invoke
exit $LASTEXITCODE
