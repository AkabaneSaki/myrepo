#requires -Version 7.2

param(
    [Parameter(Mandatory = $true)]
    [string]$Profile,
    [switch]$CheckOnly,
    [string]$SourceRepoRoot,
    [ValidateSet('branch', 'tag')]
    [string]$SourceType,
    [string]$SourceRemote,
    [string]$SourceName,
    [string]$SourceSha,
    [string]$ConfigPath,
    [switch]$UseOauth
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Native command failures are handled explicitly through $LASTEXITCODE.
$PSNativeCommandUseErrorActionPreference = $false

$Utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8

$EngineDir = $PSScriptRoot
$ProfilesDir = Join-Path $EngineDir 'profiles'
$DefaultRepoRoot = (Resolve-Path (Join-Path $EngineDir '..\..\..')).Path
$RepoRoot = if ($SourceRepoRoot) { (Resolve-Path $SourceRepoRoot).Path } else { $DefaultRepoRoot }
$LogDir = Join-Path $EngineDir 'logs'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'

$OriginalCloudflareApiToken = $env:CLOUDFLARE_API_TOKEN
$OriginalCloudflareAccountId = $env:CLOUDFLARE_ACCOUNT_ID
$OriginalBranch = $null
$OriginalHead = $null
$SwitchedForDeploy = $false
$DeploymentStarted = $false
$DatabaseChangesStarted = $false
$TemporaryConfigPath = $null
$WranglerAuthArgs = @()
$Git = $null
$LogPath = $null
$ExitCode = 0
$DeploymentLock = $null
$SourceLock = $null
$ConfigHash = $null
$OriginalCI = $env:CI
$OriginalGitTerminalPrompt = $env:GIT_TERMINAL_PROMPT
$OriginalGcmInteractive = $env:GCM_INTERACTIVE

function Get-Prop($Object, [string]$Name, $Default = $null) {
    if ($null -eq $Object) { return $Default }
    $prop = $Object.PSObject.Properties | Where-Object { $_.Name -ceq $Name } | Select-Object -First 1
    if ($null -eq $prop) { return $Default }
    return $prop.Value
}

function Write-DeployMessage([string]$Message, [System.ConsoleColor]$ForegroundColor = [System.ConsoleColor]::Gray) {
    Write-Host $Message -ForegroundColor $ForegroundColor
    if ($script:LogPath) { Add-Content -LiteralPath $script:LogPath -Value $Message -Encoding utf8 }
}

function Step([string]$Message) {
    Write-DeployMessage "`n==> $Message" -ForegroundColor Cyan
}

function Pass([string]$Message) {
    Write-DeployMessage "[PASS] $Message" -ForegroundColor Green
}

function Stop-Deploy([string]$Message, [int]$Code = 1) {
    Write-DeployMessage "`n[STOP] $Message" -ForegroundColor Red
    if (-not $script:DeploymentStarted) {
        Write-DeployMessage 'No Worker deployment was started.' -ForegroundColor Yellow
    }
    if ($script:DatabaseChangesStarted) {
        Write-DeployMessage '[WARNING] 数据库更新已开始；请检查更新结果，不要把这次停止当成完全没有线上变化。' -ForegroundColor Yellow
    }
    if ($script:LogPath) {
        Write-DeployMessage "Log: $script:LogPath" -ForegroundColor DarkGray
    }
    throw [System.Exception]::new("__DEPLOY_STOP__${Code}__${Message}")
}

function Enter-DeploymentLock($Target) {
    $accountId = [string](Get-Prop $Target 'accountId' '')
    $worker = [string](Get-Prop $Target 'worker' '')
    if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($worker)) {
        Stop-Deploy 'Deployment profile must identify a Cloudflare account and Worker.'
    }
    $lockDir = Join-Path $EngineDir 'locks'
    New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
    $lockName = ($accountId + '-' + $worker) -replace '[^A-Za-z0-9._-]', '_'
    $lockPath = Join-Path $lockDir ($lockName + '.lock')
    try {
        $script:DeploymentLock = [System.IO.File]::Open(
            $lockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    }
    catch [System.IO.IOException] {
        Stop-Deploy "Another check or deploy is still running for Worker '$worker'. Wait for its result or inspect the latest log in $LogDir before retrying."
    }
    Pass "Exclusive deployment lock acquired for Worker '$worker'."
}

function Enter-SourceLock {
    $sourceKey = $RepoRoot.TrimEnd('\', '/').ToLowerInvariant()
    $sourceHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($Utf8.GetBytes($sourceKey)))
    $lockPath = Join-Path (Join-Path $EngineDir 'locks') ("source-$sourceHash.lock")
    try {
        $script:SourceLock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    }
    catch [System.IO.IOException] {
        Stop-Deploy "代码目录 $RepoRoot 正被另一个检查或部署流程使用。请等它结束后重试。"
    }
    Pass "Exclusive source lock acquired: $RepoRoot"
}

function Invoke-Captured([string]$File, [string[]]$Arguments, [string]$FailureMessage) {
    $output = & $File @Arguments 2>&1
    $code = $LASTEXITCODE
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    if ($text -and $script:LogPath) { Add-Content -Path $script:LogPath -Value $text -Encoding utf8 }
    if ($code -ne 0) { Stop-Deploy "$FailureMessage (exit $code)" $code }
    return $text.Trim()
}

function Invoke-Streaming([string]$File, [string[]]$Arguments, [string]$FailureMessage) {
    & $File @Arguments 2>&1 | Tee-Object -FilePath $script:LogPath -Append -Encoding utf8
    $code = $LASTEXITCODE
    if ($code -ne 0) { Stop-Deploy "$FailureMessage (exit $code)" $code }
}

function Ensure-CloudflareEnvironment {
    # This machine-owned deployment engine uses Cotel's existing package runner.
    # Source worktrees cannot override the executable or bootstrap arguments.
    $cotelCli = 'C:\Project\cotel\scripts\cli\workspace-cli.mjs'
    if (-not (Test-Path -LiteralPath $cotelCli -PathType Leaf)) {
        Stop-Deploy "Cotel workspace CLI is unavailable: $cotelCli"
    }
    Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
    Invoke-Streaming $Node.Source @($cotelCli, 'bootstrap', '--root', $RepoRoot, '--package-root', 'cloudflare', '--package-manager', 'npm') "依赖准备失败。EBUSY 表示文件被占用，请先停止使用 $RepoRoot 的本地开发服务；EPERM 还可能是权限问题，请检查报错路径的访问权限。不要删除正在使用的依赖目录。"
}

function Resolve-ProfilePath([string]$Value) {
    if (Test-Path -LiteralPath $Value) {
        return (Resolve-Path -LiteralPath $Value).Path
    }

    $candidate = Join-Path $ProfilesDir ($Value + '.json')
    if (Test-Path -LiteralPath $candidate) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    Stop-Deploy "Deployment profile not found: $Value"
}

function Resolve-LocalPath([string]$Value, [string]$BasePath) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    if ($Value.StartsWith('~\') -or $Value.StartsWith('~/')) {
        return Join-Path $HOME $Value.Substring(2)
    }
    if ([System.IO.Path]::IsPathRooted($Value)) { return $Value }
    return Join-Path $BasePath $Value
}

function Assert-ConfigValue($Object, [string]$Key, [string]$Value, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Value) -or [string](Get-Prop $Object $Key '') -cne $Value) {
        Stop-Deploy "Wrangler config target mismatch for $Label. Expected $Key=$Value"
    }
}

function Assert-SourceUnchanged {
    $currentHead = Invoke-Captured $Git.Source @('rev-parse', 'HEAD') 'Could not verify deployment source.'
    if ($currentHead -ne $deployHead) { Stop-Deploy '待部署代码的提交已变化。请停止修改这个代码目录，再重新检查。' }
    $statusArgs = @('-C', $RepoRoot, 'status', '--porcelain', '--untracked-files=normal', '--', '.')
    if ($TemporaryConfigPath) { $statusArgs += ':(exclude,literal)cloudflare/' + [System.IO.Path]::GetFileName($TemporaryConfigPath) }
    $dirty = Invoke-Captured $Git.Source $statusArgs 'Could not verify source cleanliness.'
    if ($dirty) { Stop-Deploy "待部署代码在检查期间发生了改动。请先处理这些改动，再重新检查。`n$dirty" }
    if ((Get-FileHash -LiteralPath $ResolvedConfigPath -Algorithm SHA256).Hash -ne $ConfigHash) {
        Stop-Deploy '部署目标配置在检查期间发生了变化。请重新检查后再部署。'
    }
}

function Configure-CloudflareAuth($Auth, [string]$TokenPath) {
    $profileName = [string](Get-Prop $Auth 'wranglerProfile' '')
    $allowEnvironmentToken = [bool](Get-Prop $Auth 'allowEnvironmentToken' $false)
    $allowOauthFallback = [bool](Get-Prop $Auth 'allowOauthFallback' $true)

    if ($UseOauth) {
        if (-not $allowOauthFallback) {
            Stop-Deploy 'OAuth is disabled by this deployment profile. Use its configured machine credential instead.'
        }
        if ([string]::IsNullOrWhiteSpace($profileName)) {
            Stop-Deploy 'OAuth was requested, but this deployment profile has no wranglerProfile.'
        }
        Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
        $script:WranglerAuthArgs = @('--profile', $profileName)
        Pass "Using Wrangler OAuth profile '$profileName' because -UseOauth was requested."
        return
    }

    if ($allowEnvironmentToken -and -not [string]::IsNullOrWhiteSpace($OriginalCloudflareApiToken)) {
        $env:CLOUDFLARE_API_TOKEN = $OriginalCloudflareApiToken
        $script:WranglerAuthArgs = @()
        Pass 'Using CLOUDFLARE_API_TOKEN present when the helper started.'
        return
    }

    if (-not [string]::IsNullOrWhiteSpace($TokenPath) -and (Test-Path -LiteralPath $TokenPath)) {
        $token = (Get-Content -Raw -LiteralPath $TokenPath).Trim()
        if ([string]::IsNullOrWhiteSpace($token)) {
            Stop-Deploy "API token file is empty: $TokenPath"
        }
        $env:CLOUDFLARE_API_TOKEN = $token
        $script:WranglerAuthArgs = @()
        Pass 'Using deployment API token from the configured local token file (value hidden).'
        return
    }

    if ($allowOauthFallback -and -not [string]::IsNullOrWhiteSpace($profileName)) {
        Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
        $script:WranglerAuthArgs = @('--profile', $profileName)
        Pass "Using Wrangler OAuth profile '$profileName'."
        return
    }

    Stop-Deploy 'No allowed Cloudflare authentication method is available for this profile.'
}

try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $logProfile = [System.IO.Path]::GetFileNameWithoutExtension($Profile) -replace '[^A-Za-z0-9._-]', '_'
    $LogPath = Join-Path $LogDir ("{0}-{1}-{2}.log" -f $logProfile, $Timestamp, $PID)
    "Poem Workshop requested profile: $Profile - $Timestamp" | Set-Content -Path $LogPath -Encoding utf8
    "PowerShell: $($PSVersionTable.PSVersion)" | Add-Content -Path $LogPath -Encoding utf8
    "Repo: $RepoRoot" | Add-Content -Path $LogPath -Encoding utf8
    "Mode: $(if ($CheckOnly) { 'CHECK ONLY' } else { 'DEPLOY' })" | Add-Content -Path $LogPath -Encoding utf8

    $ProfilePath = Resolve-ProfilePath $Profile
    $profileData = Get-Content -Raw -LiteralPath $ProfilePath | ConvertFrom-Json
    $profileId = [string](Get-Prop $profileData 'id' ([System.IO.Path]::GetFileNameWithoutExtension($ProfilePath)))
    $target = Get-Prop $profileData 'target'
    $bindings = Get-Prop $profileData 'bindings'
    $sourcePolicy = Get-Prop $profileData 'source'
    $gitPolicy = Get-Prop $profileData 'git'
    $auth = Get-Prop $profileData 'auth'

    if ($null -eq $target -or $null -eq $sourcePolicy -or $null -eq $gitPolicy) {
        Stop-Deploy "Profile '$profileId' is missing target/source/git sections."
    }

    Enter-DeploymentLock $target
    Enter-SourceLock
    "Profile: $ProfilePath" | Add-Content -Path $LogPath -Encoding utf8

    # Wrangler skips migration confirmation in CI; Git credential helpers must not open a login dialog.
    $env:CI = '1'
    $env:GIT_TERMINAL_PROMPT = '0'
    $env:GCM_INTERACTIVE = 'Never'

    Step 'Checking required tools'
    $Git = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Git) { $Git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if (-not $Git) { Stop-Deploy 'git was not found in PATH.' }

    $Npx = Get-Command npx.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Npx) { $Npx = Get-Command npx -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if (-not $Npx) { Stop-Deploy 'npx was not found in PATH.' }
    $Npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Npm) { $Npm = Get-Command npm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if (-not $Npm) { Stop-Deploy 'npm was not found in PATH.' }
    $Node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Node) { Stop-Deploy 'node.exe was not found in PATH.' }
    Pass 'git, npm, npx, and Node are available.'

    Set-Location $RepoRoot

    Step 'Checking repository identity'
    $expectedRemotes = Get-Prop $gitPolicy 'expectedRemotes'
    if ($null -eq $expectedRemotes) { Stop-Deploy "Profile '$profileId' has no git.expectedRemotes policy." }
    foreach ($remoteProperty in $expectedRemotes.PSObject.Properties) {
        $remoteName = $remoteProperty.Name
        $expectedUrl = [string]$remoteProperty.Value
        $actualUrl = Invoke-Captured $Git.Source @('remote', 'get-url', $remoteName) "Could not read $remoteName remote."
        if ($actualUrl -ne $expectedUrl) {
            Stop-Deploy "$remoteName is wrong. Expected $expectedUrl, got $actualUrl"
        }
    }
    Pass 'Git remote identities match the deployment profile.'

    Step 'Checking local worktree is clean'
    $cleanliness = [string](Get-Prop $sourcePolicy 'cleanliness' 'all')
    if ($cleanliness -eq 'tracked') {
        $dirty = Invoke-Captured $Git.Source @('status', '--porcelain', '--untracked-files=no') 'Could not read git status.'
    }
    else {
        $dirty = Invoke-Captured $Git.Source @('status', '--porcelain', '--untracked-files=normal') 'Could not read git status.'
    }
    if ($dirty) { Stop-Deploy "Worktree is not clean under '$cleanliness' policy.`n$dirty" }
    Pass "Worktree is clean under '$cleanliness' policy."

    Step 'Refreshing canonical owner main'
    Invoke-Streaming $Git.Source @('fetch', 'upstream', 'main:refs/remotes/upstream/main') 'Failed to refresh upstream/main.'

    $OriginalHead = Invoke-Captured $Git.Source @('rev-parse', 'HEAD') 'Could not resolve original HEAD.'
    $OriginalBranch = (& $Git.Source symbolic-ref --quiet --short HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) { $OriginalBranch = $null }

    $defaultSource = Get-Prop $sourcePolicy 'default'
    if ($null -eq $defaultSource) { Stop-Deploy "Profile '$profileId' has no source.default." }

    $resolvedSourceType = if ($SourceType) { $SourceType } else { [string](Get-Prop $defaultSource 'type' '') }
    $resolvedSourceRemote = if ($SourceRemote) { $SourceRemote } else { [string](Get-Prop $defaultSource 'remote' '') }
    $resolvedSourceName = if ($SourceName) { $SourceName } else { [string](Get-Prop $defaultSource 'name' '') }

    if ([string]::IsNullOrWhiteSpace($resolvedSourceType) -or [string]::IsNullOrWhiteSpace($resolvedSourceRemote) -or [string]::IsNullOrWhiteSpace($resolvedSourceName)) {
        Stop-Deploy 'Source selection is incomplete. Need type, remote, and name.'
    }
    if ($resolvedSourceType -notin @('branch', 'tag')) {
        Stop-Deploy "Unsupported source type '$resolvedSourceType'. Supported: branch, tag."
    }

    # Pinned candidates are staging-only, remote-fetched task branches.
    # Keep legacy origin/staging deploy available during the migration.
    $pinnedCandidate = -not [string]::IsNullOrWhiteSpace($SourceSha)
    if ($pinnedCandidate -and $SourceSha -notmatch '^[0-9a-fA-F]{40}$') {
        Stop-Deploy 'Candidate SourceSha must be a full 40-character commit SHA.'
    }
    if ($pinnedCandidate -and [string](Get-Prop $target 'class' '') -cne 'staging') {
        Stop-Deploy 'Pinned candidates are restricted to staging targets.'
    }
    if ($resolvedSourceType -eq 'branch' -and $resolvedSourceName -ne 'staging' -and
        [string](Get-Prop $target 'class' '') -ceq 'staging' -and -not $pinnedCandidate) {
        Stop-Deploy 'Task branch requires an explicit -SourceSha pin.'
    }

    $allowed = $false
    foreach ($rule in @(Get-Prop $sourcePolicy 'allowed' @())) {
        if ($null -eq $rule) { continue }
        $ruleRemote = [string](Get-Prop $rule 'remote' '')
        $ruleType = [string](Get-Prop $rule 'type' '')
        $rulePattern = [string](Get-Prop $rule 'pattern' '')
        if ($ruleRemote -eq $resolvedSourceRemote -and $ruleType -eq $resolvedSourceType -and $resolvedSourceName -match $rulePattern) {
            $allowed = $true
            break
        }
    }
    if (-not $allowed) {
        Stop-Deploy "Source is not allowed by profile '$profileId': $resolvedSourceRemote/$resolvedSourceType/$resolvedSourceName"
    }

    Step "Refreshing exact source $resolvedSourceRemote/$resolvedSourceType/$resolvedSourceName"
    if ($resolvedSourceType -eq 'branch') {
        $sourceRef = "refs/remotes/$resolvedSourceRemote/$resolvedSourceName"
        Invoke-Streaming $Git.Source @('fetch', $resolvedSourceRemote, "refs/heads/$resolvedSourceName`:$sourceRef") "Failed to fetch source branch $resolvedSourceRemote/$resolvedSourceName."
    }
    else {
        $sourceRef = "refs/tags/$resolvedSourceName"
        Invoke-Streaming $Git.Source @('fetch', $resolvedSourceRemote, "refs/tags/$resolvedSourceName`:$sourceRef") "Failed to fetch source tag $resolvedSourceName from $resolvedSourceRemote."
    }
    $sourceCommit = Invoke-Captured $Git.Source @('rev-parse', $sourceRef) "Could not resolve source ref $sourceRef."
    Pass "Exact deployment source resolved: $sourceCommit"
    if ($pinnedCandidate) {
        if ($resolvedSourceRemote -cne 'origin' -or $resolvedSourceType -cne 'branch' -or $resolvedSourceName -ceq 'staging') {
            Stop-Deploy 'Pinned candidate requires an origin task branch, not shared staging.'
        }
        if ($sourceCommit.ToLowerInvariant() -cne $SourceSha.ToLowerInvariant()) {
            Stop-Deploy "Candidate SHA mismatch: expected $SourceSha, fetched $sourceCommit"
        }
        # Refuse an old production baseline or divergent staging feature history.
        $null = & $Git.Source merge-base --is-ancestor upstream/main $sourceCommit 2>&1
        if ($LASTEXITCODE -ne 0) {
            Stop-Deploy 'Candidate does not descend from current upstream/main.'
        }
        Pass "Candidate exact SHA and production ancestry verified: $sourceCommit"
    }

    Step 'Switching temporarily to exact deployment source'
    if ($OriginalHead -ne $sourceCommit) {
        Invoke-Streaming $Git.Source @('switch', '--detach', $sourceCommit) 'Could not switch to exact deployment source.'
        $SwitchedForDeploy = $true
    }
    $deployHead = Invoke-Captured $Git.Source @('rev-parse', 'HEAD') 'Could not resolve deployment HEAD.'
    if ($deployHead -ne $sourceCommit) {
        Stop-Deploy "Deployment source mismatch. HEAD=$deployHead expected=$sourceCommit"
    }
    Pass "Deployment source locked to $resolvedSourceRemote/$resolvedSourceType/$resolvedSourceName at $deployHead"
    $ownerComparison = Invoke-Captured $Git.Source @('rev-list', '--left-right', '--count', 'upstream/main...HEAD') 'Could not compare source against owner main.'
    Pass "Owner main comparison (owner-only / source-only): $ownerComparison"

    $WorkshopManifestPath = Join-Path $RepoRoot 'config/workshop.json'
    $WorkshopConfigCheckPath = Join-Path $RepoRoot 'scripts/check-workshop-config.mjs'
    $hasWorkshopManifest = Test-Path -LiteralPath $WorkshopManifestPath -PathType Leaf
    $hasWorkshopConfigCheck = Test-Path -LiteralPath $WorkshopConfigCheckPath -PathType Leaf
    if ($hasWorkshopManifest -or $hasWorkshopConfigCheck) {
        if (-not ($hasWorkshopManifest -and $hasWorkshopConfigCheck)) {
            Stop-Deploy 'Workshop source-of-truth files are incomplete. Expected both config/workshop.json and scripts/check-workshop-config.mjs.'
        }
        Step 'Checking Workshop source of truth'
        Set-Location $RepoRoot
        Invoke-Streaming $Node.Source @($WorkshopConfigCheckPath) 'Workshop source-of-truth check failed.'
        $workshopManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $WorkshopManifestPath | ConvertFrom-Json
        $workshopClient = Get-Prop $workshopManifest 'client'
        $workshopStable = [string](Get-Prop $workshopClient 'stable' '')
        $workshopStaging = [string](Get-Prop $workshopClient 'staging' '')
        Pass "Workshop client config verified: stable=$workshopStable / staging=$workshopStaging"
    }

    $profileConfigPath = [string](Get-Prop $target 'configPath' '')
    $effectiveConfig = if ($ConfigPath) { $ConfigPath } else { $profileConfigPath }
    if ([string]::IsNullOrWhiteSpace($effectiveConfig)) { Stop-Deploy 'No Wrangler config path was configured.' }
    $ResolvedConfigPath = Resolve-LocalPath $effectiveConfig $RepoRoot
    if (-not (Test-Path -LiteralPath $ResolvedConfigPath)) { Stop-Deploy "Missing Wrangler config: $ResolvedConfigPath" }
    $ResolvedConfigPath = (Resolve-Path -LiteralPath $ResolvedConfigPath).Path

    # The selected Git source, not the location of a machine-local target config, must own
    # Wrangler's relative paths such as main=src/index.ts and migrations_dir. If an
    # external config is supplied, materialize an ephemeral copy inside the locked source
    # worktree so Wrangler cannot silently deploy code from another checkout.
    $SourceCloudflareDir = Join-Path $RepoRoot 'cloudflare'
    if (-not (Test-Path -LiteralPath $SourceCloudflareDir -PathType Container)) {
        Stop-Deploy "Source Cloudflare directory is unavailable: $SourceCloudflareDir"
    }
    $SourceCloudflareDir = (Resolve-Path -LiteralPath $SourceCloudflareDir).Path
    $ConfigDirectory = Split-Path -Parent $ResolvedConfigPath
    if (-not [string]::Equals($ConfigDirectory, $SourceCloudflareDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        $safeProfileId = $profileId -replace '[^A-Za-z0-9._-]', '_'
        $configCopyPath = Join-Path $SourceCloudflareDir (".cotel-deploy-$safeProfileId-$PID-" + [guid]::NewGuid().ToString('N') + '.jsonc')
        [System.IO.File]::Copy($ResolvedConfigPath, $configCopyPath, $false)
        $TemporaryConfigPath = $configCopyPath
        $ResolvedConfigPath = $TemporaryConfigPath
        Pass 'Materialized external Wrangler config inside the locked source worktree.'
    }
    $CloudflareDir = $SourceCloudflareDir

    $expectedWorker = [string](Get-Prop $target 'worker' '')
    $expectedAccountId = [string](Get-Prop $target 'accountId' '')
    if ([string]::IsNullOrWhiteSpace($expectedWorker) -or [string]::IsNullOrWhiteSpace($expectedAccountId)) {
        Stop-Deploy "Profile '$profileId' must define target.worker and target.accountId."
    }

    Step 'Checking Wrangler target profile'
    $ConfigHash = (Get-FileHash -LiteralPath $ResolvedConfigPath -Algorithm SHA256).Hash
    try { $parsedConfig = Get-Content -Raw -Encoding UTF8 -LiteralPath $ResolvedConfigPath | ConvertFrom-Json }
    catch { Stop-Deploy '部署配置无法读取。请修正配置文件后重试。' }
    Assert-ConfigValue $parsedConfig 'name' $expectedWorker 'Worker name'
    if ([bool](Get-Prop $target 'requireAccountIdInConfig' $false) -or (Get-Prop $parsedConfig 'account_id' '')) {
        Assert-ConfigValue $parsedConfig 'account_id' $expectedAccountId 'Cloudflare account'
    }
    $expectedDomain = [string](Get-Prop $target 'domain' '')
    if ($expectedDomain) {
        $routes = @(Get-Prop $parsedConfig 'routes' @()) + @(Get-Prop $parsedConfig 'route' @())
        if (-not ($routes | Where-Object { (Get-Prop $_ 'pattern' '') -ceq $expectedDomain -and (Get-Prop $_ 'custom_domain' $false) -eq $true })) {
            Stop-Deploy "Wrangler config target mismatch for custom domain: $expectedDomain"
        }
    }

    $d1 = Get-Prop $bindings 'd1'
    $kv = Get-Prop $bindings 'kv'
    $r2 = Get-Prop $bindings 'r2'
    if ($null -ne $d1) {
        $d1Binding = [string](Get-Prop $d1 'binding' '')
        if (-not $d1Binding) { Stop-Deploy 'Deployment profile must specify the D1 binding name.' }
        $actualDatabases = @(Get-Prop $parsedConfig 'd1_databases' @() | Where-Object { (Get-Prop $_ 'binding' '') -ceq $d1Binding })
        if ($actualDatabases.Count -ne 1) { Stop-Deploy 'D1 must match exactly one configured binding.' }
        Assert-ConfigValue $actualDatabases[0] 'database_name' ([string](Get-Prop $d1 'name' '')) 'D1 database name'
        Assert-ConfigValue $actualDatabases[0] 'database_id' ([string](Get-Prop $d1 'id' '')) 'D1 database ID'
    }
    if ($null -ne $kv) {
        $kvBinding = [string](Get-Prop $kv 'binding' '')
        if (-not $kvBinding) { Stop-Deploy 'Deployment profile must specify the KV binding name.' }
        $actualKv = @(Get-Prop $parsedConfig 'kv_namespaces' @() | Where-Object { (Get-Prop $_ 'binding' '') -ceq $kvBinding })
        if ($actualKv.Count -ne 1) { Stop-Deploy 'KV must match exactly one configured binding.' }
        Assert-ConfigValue $actualKv[0] 'id' ([string](Get-Prop $kv 'id' '')) 'KV namespace ID'
    }
    if ($null -ne $r2) {
        $r2Binding = [string](Get-Prop $r2 'binding' '')
        if (-not $r2Binding) { Stop-Deploy 'Deployment profile must specify the R2 binding name.' }
        $actualBuckets = @(Get-Prop $parsedConfig 'r2_buckets' @() | Where-Object { (Get-Prop $_ 'binding' '') -ceq $r2Binding })
        if ($actualBuckets.Count -ne 1) { Stop-Deploy 'R2 must match exactly one configured binding.' }
        Assert-ConfigValue $actualBuckets[0] 'bucket_name' ([string](Get-Prop $r2 'bucket' '')) 'R2 bucket'
    }
    $durableObjects = @(Get-Prop $bindings 'durableObjects' @())
    if ($durableObjects.Count -gt 0) {
        foreach ($expectedObject in $durableObjects) {
            $objectName = [string](Get-Prop $expectedObject 'name' '')
            $className = [string](Get-Prop $expectedObject 'className' '')
            $storageBackend = [string](Get-Prop $expectedObject 'storage' '')
            if (-not $objectName -or -not $className -or $storageBackend -ne 'sqlite') {
                Stop-Deploy 'Durable Object profiles must name a local class and its SQLite storage backend.'
            }
            $actualObjects = @(Get-Prop (Get-Prop $parsedConfig 'durable_objects') 'bindings' @() | Where-Object { (Get-Prop $_ 'name') -eq $objectName })
            if ($actualObjects.Count -ne 1 -or (Get-Prop $actualObjects[0] 'class_name') -ne $className -or (Get-Prop $actualObjects[0] 'script_name')) {
                Stop-Deploy "Durable Object binding mismatch: $objectName must use the local $className class."
            }
            $sqliteMigrations = @(Get-Prop $parsedConfig 'migrations' @() | Where-Object { (Get-Prop $_ 'new_sqlite_classes' @()) -contains $className })
            $classExport = Get-Prop (Get-Prop $parsedConfig 'exports') $className
            $sqliteExport = $null -ne $classExport -and (Get-Prop $classExport 'type') -eq 'durable-object' -and (Get-Prop $classExport 'storage') -eq 'sqlite'
            if ($sqliteMigrations.Count -eq 0 -and -not $sqliteExport) {
                Stop-Deploy "Durable Object $className is missing its SQLite namespace declaration."
            }
            Pass "Durable Object verified: $objectName / $className / SQLite (local namespace)."
        }
    }
    Pass "Target locked to account $expectedAccountId / Worker $expectedWorker."

    Step 'Ensuring source Cloudflare dependencies are ready'
    Ensure-CloudflareEnvironment
    Pass 'Source Cloudflare dependencies are ready.'
    Assert-SourceUnchanged

    Step 'Running D1 query cost guard'
    $D1CostDir = Join-Path $RepoRoot 'cloudflare'
    $D1CostPackage = Join-Path $D1CostDir 'package.json'
    if (-not (Test-Path -LiteralPath $D1CostPackage -PathType Leaf)) {
        Stop-Deploy "D1 cost guard package is unavailable: $D1CostPackage"
    }
    Set-Location $D1CostDir
    Invoke-Streaming $Npm.Source @('run', 'check:d1-cost') 'D1 query cost guard failed.'
    Pass 'D1 query cost guard passed.'
    Set-Location $RepoRoot

    $env:CLOUDFLARE_ACCOUNT_ID = $expectedAccountId
    $tokenFile = Resolve-LocalPath ([string](Get-Prop $auth 'apiTokenFile' '')) $RepoRoot
    Configure-CloudflareAuth $auth $tokenFile

    $WranglerVersion = [string](Get-Prop $profileData 'wranglerVersion' '4.131.1')
    $Wrangler = "wrangler@$WranglerVersion"
    Set-Location $CloudflareDir

    if ($null -ne $d1) {
        $d1Name = [string](Get-Prop $d1 'name' '')
        $d1Id = [string](Get-Prop $d1 'id' '')
        Step 'Verifying Cloudflare account can access expected D1'
        $d1InfoArgs = @('--yes', $Wrangler, 'd1', 'info', $d1Name, '--config', $ResolvedConfigPath) + $WranglerAuthArgs
        $d1Info = Invoke-Captured $Npx.Source $d1InfoArgs 'Cloudflare account/D1 verification failed.'
        if ($d1Id -and -not $d1Info.Contains($d1Id)) {
            Stop-Deploy "Cloudflare returned the wrong D1. Expected ID $d1Id"
        }
        Pass "D1 verified: $d1Name / $d1Id"

        if ([bool](Get-Prop $d1 'migrations' $false)) {
            Step 'Checking D1 migrations'
            $migrationListArgs = @('--yes', $Wrangler, 'd1', 'migrations', 'list', $d1Name, '--remote', '--config', $ResolvedConfigPath) + $WranglerAuthArgs
            $migrationList = Invoke-Captured $Npx.Source $migrationListArgs 'D1 migration check failed.'
            if ($migrationList) { Write-Host $migrationList }
            if ($CheckOnly) {
                Pass 'D1 migration state checked; CHECK ONLY made no database changes.'
            }
        }
    }

    Step 'Verifying Worker access'
    $deploymentListArgs = @('--yes', $Wrangler, 'deployments', 'list', '--config', $ResolvedConfigPath, '--json') + $WranglerAuthArgs
    $null = Invoke-Captured $Npx.Source $deploymentListArgs 'Worker access verification failed.'
    Pass 'Worker access verified.'

    Step 'Running Worker dry-run'
    $dryRunArgs = @('--yes', $Wrangler, 'deploy', '--dry-run', '--config', $ResolvedConfigPath) + $WranglerAuthArgs
    Invoke-Streaming $Npx.Source $dryRunArgs 'Worker dry-run failed.'
    Pass 'Worker dry-run passed.'
    Assert-SourceUnchanged

    if ($CheckOnly) {
        Write-DeployMessage "`n[CHECK ONLY] Deployment profile '$profileId' passed. Nothing was deployed." -ForegroundColor Green
        Write-DeployMessage "Source: $resolvedSourceRemote/$resolvedSourceType/$resolvedSourceName"
        Write-DeployMessage "Source commit: $deployHead"
        Write-DeployMessage "Cloudflare account: $expectedAccountId"
        Write-DeployMessage "Worker: $expectedWorker"
        Write-DeployMessage "Log: $LogPath"
    }
    else {
        if ($null -ne $d1 -and [bool](Get-Prop $d1 'migrations' $false)) {
            Step 'Applying D1 migrations after build preflight'
            $DatabaseChangesStarted = $true
            $migrationApplyArgs = @('--yes', $Wrangler, 'd1', 'migrations', 'apply', $d1Name, '--remote', '--config', $ResolvedConfigPath) + $WranglerAuthArgs
            Invoke-Streaming $Npx.Source $migrationApplyArgs 'D1 migration apply failed.'
            Pass 'D1 migrations are up to date.'
        }
        Assert-SourceUnchanged
        Step "DEPLOYING $profileId from $deployHead"
        $DeploymentStarted = $true
        $deployOutput = [System.Collections.Generic.List[string]]::new()
        $deployArgs = @('--yes', $Wrangler, 'deploy', '--config', $ResolvedConfigPath) + $WranglerAuthArgs
        Invoke-Streaming $Npx.Source $deployArgs 'Worker deploy failed.' |
            ForEach-Object {
                [void]$deployOutput.Add($_.ToString())
                $_
            }
        $versionLine = $deployOutput | Where-Object { $_ -match 'Current Version ID:' } | Select-Object -Last 1
        Write-DeployMessage "`n============================================================" -ForegroundColor Green
        Write-DeployMessage 'WORKER DEPLOYMENT SUCCESS' -ForegroundColor Green
        Write-DeployMessage "Profile: $profileId"
        Write-DeployMessage "Source: $resolvedSourceRemote/$resolvedSourceType/$resolvedSourceName"
        Write-DeployMessage "Source commit: $deployHead"
        Write-DeployMessage "Cloudflare account: $expectedAccountId"
        Write-DeployMessage "Worker: $expectedWorker"
        if ($versionLine) { Write-DeployMessage $versionLine }
        Write-DeployMessage "Log: $LogPath"
        Write-DeployMessage '============================================================' -ForegroundColor Green
    }
}
catch {
    if ($_.Exception.Message -match '^__DEPLOY_STOP__(\d+)__') {
        # Child exit codes remain in the log; helper exit 2 is reserved for cleanup.
        $ExitCode = 1
    }
    else {
        Write-DeployMessage "`n[STOP] $($_.Exception.Message)" -ForegroundColor Red
        if ($LogPath) { Write-DeployMessage "Log: $LogPath" -ForegroundColor DarkGray }
        $ExitCode = 1
    }
}
finally {
    try {
        Set-Location $RepoRoot
        if ($TemporaryConfigPath -and (Test-Path -LiteralPath $TemporaryConfigPath)) {
            Remove-Item -LiteralPath $TemporaryConfigPath -Force
            Pass 'Temporary source-local Wrangler config removed.'
        }
    }
    catch {
        Write-DeployMessage "[WARNING] 临时配置清理失败：$($_.Exception.Message)" -ForegroundColor Yellow
        if ($ExitCode -eq 0) { $ExitCode = 2 }
    }
    try {
        Set-Location $RepoRoot
        if ($SwitchedForDeploy -and $null -ne $Git) {
            Step 'Restoring original local checkout'
            if ($OriginalBranch) {
                & $Git.Source switch $OriginalBranch 2>&1 | Tee-Object -FilePath $LogPath -Append -Encoding utf8
            }
            else {
                & $Git.Source switch --detach $OriginalHead 2>&1 | Tee-Object -FilePath $LogPath -Append -Encoding utf8
            }
            if ($LASTEXITCODE -ne 0) {
                Write-DeployMessage '[WARNING] Deployment finished, but automatic checkout restore failed.' -ForegroundColor Yellow
                if ($ExitCode -eq 0) { $ExitCode = 2 }
            }
            else {
                Pass 'Original local checkout restored.'
            }
        }
    }
    catch {
        Write-DeployMessage "[WARNING] Checkout restore error: $($_.Exception.Message)" -ForegroundColor Yellow
        if ($ExitCode -eq 0) { $ExitCode = 2 }
    }

    if ($null -eq $OriginalCloudflareApiToken) {
        Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    }
    else {
        $env:CLOUDFLARE_API_TOKEN = $OriginalCloudflareApiToken
    }

    if ($null -eq $OriginalCloudflareAccountId) {
        Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
    }
    else {
        $env:CLOUDFLARE_ACCOUNT_ID = $OriginalCloudflareAccountId
    }

    if ($null -eq $OriginalCI) { Remove-Item Env:CI -ErrorAction SilentlyContinue }
    else { $env:CI = $OriginalCI }
    if ($null -eq $OriginalGitTerminalPrompt) { Remove-Item Env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue }
    else { $env:GIT_TERMINAL_PROMPT = $OriginalGitTerminalPrompt }
    if ($null -eq $OriginalGcmInteractive) { Remove-Item Env:GCM_INTERACTIVE -ErrorAction SilentlyContinue }
    else { $env:GCM_INTERACTIVE = $OriginalGcmInteractive }
    if ($null -ne $DeploymentLock) {
        $DeploymentLock.Dispose()
        Pass 'Exclusive deployment lock released.'
    }
    if ($null -ne $SourceLock) {
        $SourceLock.Dispose()
        Pass 'Exclusive source lock released.'
    }
}

if ($LogPath) { "Helper exit code: $ExitCode" | Add-Content -Path $LogPath -Encoding utf8 }
exit $ExitCode
