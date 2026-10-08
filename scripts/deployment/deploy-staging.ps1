#requires -Version 7.2

param(
    [switch]$CheckOnly,
    [switch]$AllowOauthFallback,
    [string]$Profile = 'master-staging',
    [string]$SourceRepoRoot,
    [string]$SourceBranch,
    [string]$SourceSha,
    [string]$SourceTag,
    [string]$SourceRemote,
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($SourceBranch -and $SourceTag) {
    throw 'Specify only one of -SourceBranch or -SourceTag.'
}
if ($SourceSha -and -not $SourceBranch) {
    throw '-SourceSha requires -SourceBranch to validate the remote candidate.'
}

$engine = Join-Path $PSScriptRoot 'deploy-worker.ps1'
$invoke = @{
    Profile = $Profile
}

if ($CheckOnly) { $invoke.CheckOnly = $true }
if ($AllowOauthFallback) { $invoke.UseOauth = $true }
if ($SourceRepoRoot) { $invoke.SourceRepoRoot = $SourceRepoRoot }
if ($ConfigPath) { $invoke.ConfigPath = $ConfigPath }
if ($SourceSha) { $invoke.SourceSha = $SourceSha }

if ($SourceBranch) {
    $invoke.SourceType = 'branch'
    $invoke.SourceName = $SourceBranch
    if ($SourceRemote) { $invoke.SourceRemote = $SourceRemote }
}
elseif ($SourceTag) {
    $invoke.SourceType = 'tag'
    $invoke.SourceName = $SourceTag
    if ($SourceRemote) { $invoke.SourceRemote = $SourceRemote }
}
elseif ($SourceRemote) {
    throw '-SourceRemote only makes sense together with -SourceBranch or -SourceTag.'
}

& $engine @invoke
exit $LASTEXITCODE
