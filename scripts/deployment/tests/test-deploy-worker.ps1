#requires -Version 7.2

# Exercise a byte-identical helper copy with isolated Git/npm/Wrangler doubles.
# No actual Git remote, Cloudflare command, credential, or dependency install runs.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
# Match the UTF-8 console contract explicitly; Windows' default Big5 corrupts child output.
$Utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
$enginePath = Join-Path $PSScriptRoot '..\deploy-worker.ps1'
$pwshPath = (Get-Process -Id $PID).Path
$testRoot = Join-Path $PSScriptRoot ('.fixture-' + [guid]::NewGuid().ToString('N'))
$failures = [Collections.Generic.List[string]]::new()

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$toolSource = @'
$ErrorActionPreference = 'Stop'
$statePath = Join-Path $env:HELPER_AUDIT_SOURCE 'state.json'
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$tool = [IO.Path]::GetFileNameWithoutExtension($PSCommandPath)
$arguments = @($args)
$state.calls += @([pscustomobject]@{ tool = $tool; args = $arguments })
$code = 0
switch ($tool) {
    'git' {
        $rootStatus = $arguments[0] -eq '-C'
        if ($rootStatus) { $arguments = $arguments[2..($arguments.Count - 1)] }
        switch ($arguments[0]) {
            'remote' { if ($arguments[2] -eq 'origin') { 'https://github.com/uikawinwing/myrepo.git' } else { 'https://github.com/AkabaneSaki/myrepo.git' } }
            'status' {
                if ($state.dirty -and ($state.scenario -ne 'root-source-dirtied' -or $rootStatus)) { ' M cloudflare/package.json' }
            }
            'rev-parse' { if ($arguments[1] -like 'refs/*') { $state.sourceHead } else { $state.head } }
            'symbolic-ref' { if ($state.branch) { $state.branch } else { $code = 1 } }
            'fetch' { }
            'merge-base' { if ($state.scenario -eq 'candidate-diverged') { $code = 1 } }
            'rev-list' { '0 1' }
            'switch' {
                if ($arguments[1] -eq '--detach') { $state.head = $arguments[2]; $state.branch = '' }
                else { $state.head = $state.originalHead; $state.branch = $arguments[1]; $state.restored = $true }
            }
            default { throw "Unexpected Git command: $arguments" }
        }
    }
    'node' {
        'fixture dependency bootstrap: ready'
        if ($state.scenario -eq 'source-dirtied') { $state.dirty = $true }
    }
    'npm' { if ($state.scenario -eq 'child-exit-two') { 'fixture D1 gate failed'; $code = 2 } else { 'D1 COST GATE PASSED (fixture)' } }
    'npx' {
        $command = $arguments -join ' '
        if ($command -match '\bd1 info\b') { 'audit-db-id' }
        elseif ($command -match '\bd1 migrations list\b') { 'No migrations to apply!' }
        elseif ($command -match '\bd1 migrations apply\b') { 'fixture migrations applied' }
        elseif ($command -match '\bdeployments list\b') { '[{"id":"audit-deployment","versions":[{"version_id":"audit-before-version","percentage":100}]}]' }
        elseif ($arguments -contains '--dry-run') {
            if ($state.scenario -eq 'dry-run-fails') { 'fixture build failed'; $code = 9 }
            else { '--dry-run: exiting now.' }
            if ($state.scenario -eq 'source-head-changed') { $state.head = 'cccccccccccccccccccccccccccccccccccccccc' }
            if ($state.scenario -eq 'root-source-dirtied') { $state.dirty = $true }
            if ($state.scenario -eq 'target-config-changed') {
                $configPath = $arguments[[array]::IndexOf($arguments, '--config') + 1]
                $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
                $config.name = 'changed-worker'
                $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding utf8
            }
        }
        elseif ($arguments -contains 'deploy') { 'Current Version ID: audit-after-version' }
        else { throw "Unexpected Wrangler command: $arguments" }
    }
    default { throw "Unexpected executable: $tool" }
}
$state | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $statePath -Encoding utf8
exit $code
'@

$runnerSource = @'
#requires -Version 7.2
param([string]$Engine, [string]$Profile, [string]$Source, [switch]$CheckOnly, [string]$ConfigPath, [string]$CandidateBranch, [string]$CandidateSha)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$env:HELPER_AUDIT_SOURCE = $Source
$env:CLOUDFLARE_ACCOUNT_ID = 'audit-account'
function Get-Command {
    [CmdletBinding()]
    param([string]$Name, $CommandType)
    $tool = $Name -replace '\.(exe|cmd)$', ''
    if ($tool -notin @('git', 'node', 'npm', 'npx')) { throw "Unexpected executable lookup: $Name" }
    [pscustomobject]@{ Source = (Join-Path $PSScriptRoot ('tools/' + $tool + '.ps1')) }
}
function Remove-Item {
    [CmdletBinding()]
    param([string[]]$LiteralPath, [string[]]$Path, [switch]$Force, [switch]$Recurse)
    $state = Get-Content -Raw -LiteralPath (Join-Path $Source 'state.json') | ConvertFrom-Json
    if ($state.scenario -eq 'cleanup-fails' -and (@($LiteralPath) + @($Path) -join '|') -match '\.cotel-deploy-') {
        throw 'fixture temporary config is locked'
    }
    Microsoft.PowerShell.Management\Remove-Item @PSBoundParameters
}
$invoke = @{ Profile = $Profile; SourceRepoRoot = $Source; CheckOnly = $CheckOnly; ConfigPath = $ConfigPath }
if ($CandidateBranch) { $invoke.SourceRemote = 'origin'; $invoke.SourceType = 'branch'; $invoke.SourceName = $CandidateBranch }
if ($CandidateSha) { $invoke.SourceSha = $CandidateSha }
& $Engine @invoke
exit $LASTEXITCODE
'@

function Run-Case([string]$Name, [scriptblock]$Check, [switch]$Deploy, [switch]$ExternalConfig, [switch]$WrongWorker) {
    $caseRoot = Join-Path $testRoot $Name
    $source = Join-Path $caseRoot 'source'
    New-Item -ItemType Directory -Force -Path (Join-Path $source 'cloudflare') | Out-Null
    $profileId = 'audit-' + $Name
    $worker = 'audit-worker-' + $Name
    $config = [ordered]@{
        name = $(if ($WrongWorker) { 'wrong-worker' } else { $worker })
        account_id = 'audit-account'
        main = 'src/index.ts'
        d1_databases = @(@{ binding = 'DB'; database_name = 'audit-db'; database_id = 'audit-db-id' })
    }
    if ($WrongWorker) { $config.vars = @{ name = $worker } }
    if ($Name -eq 'wrong-d1-pair') {
        $config.d1_databases = @(@{ binding = 'DB'; database_name = 'audit-db'; database_id = 'wrong-id' }, @{ binding = 'OTHER'; database_name = 'other-db'; database_id = 'audit-db-id' })
    }
    if ($Name -eq 'wrong-key-case') { $config.Remove('name'); $config['Name'] = $worker }
    $configPath = Join-Path $source 'cloudflare/wrangler.jsonc'
    $configText = $config | ConvertTo-Json -Depth 10
    if ($Name -eq 'jsonc') { $configText = '/* fixture comment */' + $configText.Substring(0, $configText.Length - 1) + ",`n}" }
    $configText | Set-Content -LiteralPath $configPath -Encoding utf8
    '{}' | Set-Content -LiteralPath (Join-Path $source 'cloudflare/package.json') -Encoding utf8
    $existingConfig = Join-Path $source ('cloudflare/.cotel-deploy-' + $profileId + '.jsonc')
    if ($ExternalConfig) {
        'existing local config must survive' | Set-Content -LiteralPath $existingConfig -Encoding utf8
        $configPath = Join-Path $caseRoot 'external.jsonc'
        $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding utf8
    }
    $profile = @{
        id = $profileId
        wranglerVersion = '4.131.1'
        git = @{ expectedRemotes = @{ origin = 'https://github.com/uikawinwing/myrepo.git'; upstream = 'https://github.com/AkabaneSaki/myrepo.git' } }
        source = @{ cleanliness = 'all'; default = @{ remote = 'origin'; type = 'branch'; name = 'staging' }; allowed = @(@{ remote = 'origin'; type = 'branch'; pattern = '^staging$' }, @{ remote = 'origin'; type = 'branch'; pattern = '^(fix|feature|hotfix|refactor|release)/[A-Za-z0-9][A-Za-z0-9._/-]*$' }) }
        target = @{ class = 'staging'; configPath = 'cloudflare/wrangler.jsonc'; worker = $worker; accountId = 'audit-account'; requireAccountIdInConfig = $true }
        bindings = @{ d1 = @{ binding = 'DB'; name = 'audit-db'; id = 'audit-db-id'; migrations = $true }; kv = $null; r2 = $null }
        auth = @{ wranglerProfile = 'fixture-only'; allowEnvironmentToken = $false; allowOauthFallback = $true }
    }
    if ($Name -eq 'candidate-production') { $profile.target.class = 'production' }
    $profilePath = Join-Path $caseRoot ($profileId + '.json')
    $profile | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $profilePath -Encoding utf8
    $state = @{ scenario = $Name; dirty = ($Name -eq 'dirty-start'); head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; originalHead = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; sourceHead = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; branch = 'fixture-main'; restored = $false; calls = @() }
    $state | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $source 'state.json') -Encoding utf8
    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $testRoot 'runner.ps1'), '-Engine', (Join-Path $testRoot 'engine/deploy-worker.ps1'), '-Profile', $profilePath, '-Source', $source, '-ConfigPath', $configPath)
    if (-not $Deploy) { $arguments += '-CheckOnly' }
    if ($Name -like 'candidate-*') {
        $candidateBranch = if ($Name -eq 'candidate-forbidden') { 'staging-danger' } else { 'fix/pilot-issue' }
        $arguments += @('-CandidateBranch', $candidateBranch)
        if ($Name -ne 'candidate-no-pin') {
            $pin = if ($Name -eq 'candidate-sha-mismatch') { 'dddddddddddddddddddddddddddddddddddddddd' } elseif ($Name -eq 'candidate-short-sha') { 'bbbbbbb' } else { 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
            $arguments += @('-CandidateSha', $pin)
        }
    }
    $output = & $pwshPath @arguments 2>&1
    $exitCode = $LASTEXITCODE
    $state = Get-Content -Raw -LiteralPath (Join-Path $source 'state.json') | ConvertFrom-Json
    $logPath = Get-ChildItem -LiteralPath (Join-Path $testRoot 'engine/logs') -Filter ($profileId + '-*.log') | Select-Object -Last 1
    $log = if ($logPath) { [IO.File]::ReadAllText($logPath.FullName) } else { '' }
    $calls = @($state.calls | ForEach-Object { $_.tool + ' ' + ($_.args -join ' ') })
    try {
        & $Check ([pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join "`n"); State = $state; Log = $log; Calls = $calls; ExistingConfig = $existingConfig })
        Write-Host "[PASS] $Name"
    }
    catch {
        $failures.Add("${Name}: $($_.Exception.Message)")
        Write-Host "[FAIL] ${Name}: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Run-BoundaryChecks {
    $installedSource = [IO.File]::ReadAllText($enginePath)
    $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($installedSource, [ref]$null, [ref]$parseErrors)
    Assert ($parseErrors.Count -eq 0) 'Helper syntax error'
    foreach ($name in @('Get-Prop', 'Write-DeployMessage', 'Step', 'Pass', 'Stop-Deploy', 'Enter-SourceLock', 'Assert-ConfigValue', 'Invoke-Captured', 'Invoke-Streaming')) {
        $definition = $ast.Find({ param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $name }, $true)
        Assert ($null -ne $definition) "Missing helper boundary: $name"
        Invoke-Expression $definition.Extent.Text
    }
    $script:LogPath = $null
    $script:DeploymentStarted = $false
    $script:DatabaseChangesStarted = $false
    $script:SourceLock = $null
    $EngineDir = Join-Path $testRoot 'engine'
    $Utf8 = [Text.UTF8Encoding]::new($false)
    $RepoRoot = Join-Path $testRoot 'source-lock-test'
    $heldLock = $null
    try {
        Enter-SourceLock 6>$null
        $heldLock = $script:SourceLock
        $script:SourceLock = $null
        $RepoRoot += '\'
        $blocked = $false
        try { Enter-SourceLock 6>$null } catch { $blocked = $_.Exception.Message -match '^__DEPLOY_STOP__1__' }
        Assert $blocked 'Same source directory could be used by concurrent helpers'
        $RepoRoot = Join-Path $testRoot 'different-source'
        Enter-SourceLock 6>$null
        Assert ($null -ne $script:SourceLock) 'Different source directories unnecessarily blocked one another'
    }
    finally {
        if ($heldLock) { $heldLock.Dispose() }
        if ($script:SourceLock) { $script:SourceLock.Dispose(); $script:SourceLock = $null }
    }
    Write-Host '[PASS] source-directory-lock'

    $start = $installedSource.IndexOf("    Step 'Checking Wrangler target profile'")
    $end = $installedSource.IndexOf("    Step 'Ensuring source Cloudflare dependencies are ready'")
    Assert ($start -ge 0 -and $end -gt $start) 'Target validation seam not found'
    $targetValidation = $installedSource.Substring($start, $end - $start)
    $RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
    $installedProfilesDir = Join-Path $PSScriptRoot '../profiles'
    if (Test-Path -LiteralPath $installedProfilesDir -PathType Container) {
        foreach ($profilePath in Get-ChildItem -LiteralPath $installedProfilesDir -Filter '*.json') {
            $profile = Get-Content -Raw -LiteralPath $profilePath.FullName | ConvertFrom-Json
            $target = $profile.target
            $bindings = $profile.bindings
            $expectedWorker = $target.worker
            $expectedAccountId = $target.accountId
            $ResolvedConfigPath = if ([IO.Path]::IsPathRooted($target.configPath)) { $target.configPath } else { Join-Path $RepoRoot $target.configPath }
            Invoke-Expression $targetValidation 6>$null
            Write-Host "[PASS] installed-profile-$($profile.id)"
        }
    }
    else {
        # Tracked source intentionally has no machine credentials or account-specific profiles.
        Write-Host '[SKIP] installed profiles: run this test again after machine-local installation'
    }

    $script:LogPath = Join-Path $testRoot 'native-output.log'
    '日志头' | Set-Content -LiteralPath $script:LogPath -Encoding utf8
    $nodePath = (Get-Command node.exe).Source
    $captured = Invoke-Captured $nodePath @('-e', "console.log('捕获输出：随机发现');process.emitWarning('捕获警告',{type:'ExperimentalWarning'})") 'native captured failure'
    Assert ($captured.Contains('随机发现') -and $captured.Contains('ExperimentalWarning')) 'Native captured stdout/stderr missing'
    $streamed = @(Invoke-Streaming $nodePath @('-e', "console.log('流式输出：世界书');process.emitWarning('流式警告',{type:'ExperimentalWarning'})") 'native streaming failure')
    Assert (($streamed -join "`n").Contains('流式输出：世界书')) 'Native streaming stdout missing'
    foreach ($invokeName in @('Invoke-Captured', 'Invoke-Streaming')) {
        $failed = $false
        try { & $invokeName $nodePath @('-e', 'process.exit(7)') 'native failure' | Out-Null } catch { $failed = $_.Exception.Message -match '^__DEPLOY_STOP__7__' }
        Assert $failed "$invokeName ignored a native failure"
    }
    $logBytes = [IO.File]::ReadAllBytes($script:LogPath)
    $log = [Text.UTF8Encoding]::new($false, $true).GetString($logBytes)
    Assert ([array]::IndexOf($logBytes, [byte]0) -lt 0 -and $log.Contains('捕获输出：随机发现') -and $log.Contains('流式输出：世界书')) 'Log encoding corrupted Chinese output'
    $script:LogPath = $null
    Write-Host '[PASS] native-output-and-utf8'
}

try {
    New-Item -ItemType Directory -Force -Path (Join-Path $testRoot 'engine'), (Join-Path $testRoot 'tools') | Out-Null
    Copy-Item -LiteralPath $enginePath -Destination (Join-Path $testRoot 'engine/deploy-worker.ps1')
    Assert ((Get-FileHash $enginePath).Hash -eq (Get-FileHash (Join-Path $testRoot 'engine/deploy-worker.ps1')).Hash) 'Helper fixture differs from installed helper'
    $toolSource | Set-Content -LiteralPath (Join-Path $testRoot 'tools/git.ps1') -Encoding utf8
    foreach ($tool in @('node', 'npm', 'npx')) { $toolSource | Set-Content -LiteralPath (Join-Path $testRoot ('tools/' + $tool + '.ps1')) -Encoding utf8 }
    $runnerSource | Set-Content -LiteralPath (Join-Path $testRoot 'runner.ps1') -Encoding utf8

    Run-Case 'check-only' {
        param($r)
        Assert ($r.ExitCode -eq 0) $r.Output
        Assert (-not ($r.Calls -match 'migrations apply|npx .* deploy --config')) 'CheckOnly performed a remote mutation'
        Assert ($r.Log.Contains('[CHECK ONLY]')) 'CheckOnly result absent from log'
    }
    Run-Case 'dirty-start' {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Dirty source was accepted'
        Assert ($r.Log -match '\[STOP\].*Worktree is not clean') 'Stop reason absent from log'
        Assert (-not ($r.Calls -match 'npx ')) 'Dirty source reached Cloudflare'
    }
    Run-Case 'wrong-worker' -WrongWorker {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Nested name bypassed target check'
        Assert (-not ($r.Calls -match 'npx ')) 'Wrong target reached Cloudflare'
    }
    foreach ($name in @('wrong-d1-pair', 'wrong-key-case')) {
        Run-Case $name {
            param($r)
            Assert ($r.ExitCode -eq 1) 'Invalid target configuration was accepted'
            Assert (-not ($r.Calls -match 'npx ')) 'Invalid target reached Cloudflare'
        }
    }
    Run-Case 'jsonc' { param($r); Assert ($r.ExitCode -eq 0) $r.Output }
    Run-Case 'external-config' -ExternalConfig {
        param($r)
        Assert ($r.ExitCode -eq 0) $r.Output
        Assert ((Test-Path -LiteralPath $r.ExistingConfig) -and [IO.File]::ReadAllText($r.ExistingConfig).Contains('must survive')) 'Existing local config was overwritten or deleted'
    }
    Run-Case 'cleanup-fails' -ExternalConfig {
        param($r)
        Assert ($r.ExitCode -eq 2) 'Cleanup failure was not reported'
        Assert $r.State.restored 'Config cleanup failure skipped checkout restoration'
        Assert ($r.Log.Contains('fixture temporary config is locked')) 'Cleanup failure absent from log'
    }
    Run-Case 'dry-run-fails' -Deploy {
        param($r)
        Assert ($r.ExitCode -eq 1 -and $r.Log.Contains('(exit 9)')) 'Build failure result or child exit code lost'
        Assert (-not ($r.Calls -match 'migrations apply')) 'Database changed before failed build'
        Assert (-not ($r.Calls -match 'npx .* deploy --config')) 'Failed build reached deployment'
    }
    Run-Case 'source-dirtied' -Deploy {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Dependency step dirtied source but deployment continued'
        Assert (-not ($r.Calls -match 'migrations apply|npx .* deploy --config')) 'Changed source reached remote mutation'
    }
    Run-Case 'source-head-changed' -Deploy {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Source HEAD changed during dry-run but deployment continued'
        Assert (-not ($r.Calls -match 'migrations apply|npx .* deploy --config')) 'Changed commit reached remote mutation'
    }
    Run-Case 'root-source-dirtied' -Deploy {
        param($r)
        Assert ($r.ExitCode -eq 1) 'Changes outside cloudflare escaped source validation'
        Assert (-not ($r.Calls -match 'migrations apply|npx .* deploy --config')) 'Changed root source reached remote mutation'
    }
    Run-Case 'target-config-changed' -Deploy {
        param($r)
        Assert ($r.ExitCode -eq 1) 'Target configuration changed during dry-run but deployment continued'
        Assert (-not ($r.Calls -match 'migrations apply|npx .* deploy --config')) 'Changed target reached remote mutation'
    }
    Run-Case 'child-exit-two' -Deploy {
        param($r)
        Assert ($r.ExitCode -eq 1 -and $r.Log.Contains('(exit 2)')) 'Child exit 2 was confused with successful deployment and cleanup failure'
        Assert (-not ($r.Calls -match 'migrations apply|npx .* deploy --config')) 'Failed cost gate reached remote mutation'
    }
    Run-Case 'deploy-order' -Deploy {
        param($r)
        Assert ($r.ExitCode -eq 0) $r.Output
        $dryRun = [array]::FindIndex([string[]]$r.Calls, [Predicate[string]]{ param($s) $s.Contains('--dry-run') })
        $migration = [array]::FindIndex([string[]]$r.Calls, [Predicate[string]]{ param($s) $s.Contains('migrations apply') })
        Assert ($dryRun -ge 0 -and $migration -gt $dryRun) 'Migrations ran before build preflight'
        Assert ($r.Log.Contains('WORKER DEPLOYMENT SUCCESS')) 'Deployment outcome absent from log'
    }
    Run-Case 'candidate-check-only' {
        param($r)
        Assert ($r.ExitCode -eq 0) $r.Output
        Assert (@($r.Calls | Where-Object { $_ -match 'merge-base --is-ancestor upstream/main b{40}' }).Count -gt 0) 'Candidate ancestry guard did not run'
        Assert (-not ($r.Calls -match 'migrations apply|npx .* deploy --config')) 'Check-only touched remote'
    }
    Run-Case 'candidate-no-pin' {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Unpinned branch was allowed'
        Assert (-not ($r.Calls -match 'npx ')) 'Unpinned branch reached Cloudflare'
    }
    Run-Case 'candidate-short-sha' {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Short SHA was accepted'
        Assert (-not ($r.Calls -match 'npx ')) 'Short SHA reached Cloudflare'
    }
    Run-Case 'candidate-production' {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Pinned SHA was allowed against production target'
        Assert (-not ($r.Calls -match 'npx ')) 'Pinned production candidate reached Cloudflare'
    }
    Run-Case 'candidate-sha-mismatch' {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Moved branch did not fail closed'
        Assert (-not ($r.Calls -match 'npx ')) 'Mismatched SHA reached Cloudflare'
    }
    Run-Case 'candidate-diverged' {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Divergent candidate passed ancestry guard'
        Assert (-not ($r.Calls -match 'npx ')) 'Divergent candidate reached Cloudflare'
    }
    Run-Case 'candidate-forbidden' {
        param($r)
        Assert ($r.ExitCode -ne 0) 'Forbidden branch passed allowlist'
        Assert (-not ($r.Calls -match 'npx ')) 'Forbidden branch reached Cloudflare'
    }
    Run-Case 'candidate-deploy' -Deploy {
        param($r)
        Assert ($r.ExitCode -eq 0) $r.Output
        Assert (@($r.Calls | Where-Object { $_ -match 'merge-base --is-ancestor upstream/main b{40}' }).Count -gt 0) 'Candidate ancestry guard did not run'
        Assert ($r.Log.Contains('WORKER DEPLOYMENT SUCCESS')) 'Fixture success missing'
    }
    Run-BoundaryChecks
}
finally {
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    $expectedParent = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/')
    if ([IO.Path]::GetDirectoryName($resolvedRoot) -ne $expectedParent -or [IO.Path]::GetFileName($resolvedRoot) -notmatch '^\.fixture-[0-9a-f]{32}$') { throw 'Unsafe test cleanup path' }
    if (Test-Path -LiteralPath $resolvedRoot) { Remove-Item -LiteralPath $resolvedRoot -Recurse -Force }
}
if ($failures.Count) { throw ($failures -join "`n") }
Write-Host 'Deployment helper regression checks passed; no real deployment was performed.'
