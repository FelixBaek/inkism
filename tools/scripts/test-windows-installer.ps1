param([switch]$SkipUI, [string]$PreviousValidationSetup = '')
# Compile with /DValidationBuild. The test scheme is separate from the installed note:// handler.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$target = Join-Path $env:TEMP ('inkism-install-' + [guid]::NewGuid())
$setup = Join-Path $root 'dist/Inkism-validation-setup.exe'
$installLog = Join-Path $root 'dist/installer-install.log'
$updateLog = Join-Path $root 'dist/installer-update.log'
$uninstallLog = Join-Path $root 'dist/installer-uninstall.log'
function Write-InstallerLogDiagnostic([string]$arguments) {
    $match = [regex]::Match($arguments, '(?:^|\s)/LOG="([^"]+)"')
    if (-not $match.Success) { return }
    $logPath = [System.IO.Path]::GetFullPath($match.Groups[1].Value)
    $ownedLogDirectory = [System.IO.Path]::GetFullPath((Join-Path $root 'dist'))
    if ([System.IO.Path]::GetDirectoryName($logPath) -ine $ownedLogDirectory -or
        [System.IO.Path]::GetFileName($logPath) -notlike 'installer-*.log') { return }
    Write-Output ("Installer diagnostic log: $logPath")
    if (Test-Path -LiteralPath $logPath) {
        try { Get-Content -LiteralPath $logPath -Tail 40 | Write-Output }
        catch { Write-Warning ("Could not read installer log: " + $_.Exception.Message) }
    } else { Write-Output 'Installer did not create its diagnostic log' }
}
function Run-Checked([string]$binary, [string]$arguments) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $binary
    $info.Arguments = $arguments
    $info.UseShellExecute = $false
    $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $process = [System.Diagnostics.Process]::Start($info)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    try {
        if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'Installer timed out' }
        if ($stdout.Result) { Write-Output $stdout.Result }
        if ($stderr.Result) { Write-Output $stderr.Result }
        if ($process.ExitCode -ne 0) { throw "Validation process failed ($binary): $($process.ExitCode)" }
    } catch {
        Write-InstallerLogDiagnostic $arguments
        throw
    } finally { $process.Dispose() }
}
function Run-Uninstall([string]$binary, [string]$logPath) {
    Run-Checked $binary ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $logPath + '"')
    # Inno's clone can still be deleting the original EXE after exit 0. Observe
    # only this fixture's uninstall files; never launch the uninstaller twice.
    $data = [System.IO.Path]::ChangeExtension($binary, '.dat')
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ((Test-Path -LiteralPath $binary) -or (Test-Path -LiteralPath $data)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            Write-InstallerLogDiagnostic ('/LOG="' + $logPath + '"')
            throw "Uninstaller exited successfully but its owned EXE/DAT did not disappear: $binary"
        }
        Start-Sleep -Milliseconds 50
    }
}
function Invoke-InstallerCase([scriptblock]$test, [scriptblock]$cleanup) {
    $testFailure = $null
    $cleanupFailure = $null
    try { . $test } catch { $testFailure = $_ } finally {
        try { . $cleanup } catch { $cleanupFailure = $_ }
    }
    if ($null -ne $testFailure -and $null -ne $cleanupFailure) {
        throw [System.AggregateException]::new(
            ('Installer case failed: ' + $testFailure.Exception.Message + '; cleanup also failed: ' + $cleanupFailure.Exception.Message),
            [System.Exception[]]@($testFailure.Exception, $cleanupFailure.Exception))
    }
    if ($null -ne $cleanupFailure) { throw $cleanupFailure }
    if ($null -ne $testFailure) { throw $testFailure }
}
$previous = $env:INKISM_TEST_BINARY
$previousSuffix = $env:INKISM_TEST_SCREENSHOT_SUFFIX
$previousEncrypted = $env:INKISM_TEST_ENCRYPTED
$uninstaller = Join-Path $target 'unins000.exe'
$sentinel = Join-Path $target 'preserve-user-data.txt'
$fixture = Join-Path $target 'synthetic-library'
$fixtureScript = Join-Path $root 'tools/scripts/test-installed-data.ts'
function Run-Fixture([string]$mode, [string]$engine) {
    Run-Checked 'node.exe' ('"' + $fixtureScript + '" ' + $mode + ' "' + $engine + '" "' + $fixture + '"')
}
$payloadNames = @('Inkism.exe', 'inkism-engine.exe', 'README.md', 'BUILD.txt')
function Assert-InstalledPayload([string]$source, [string]$destination = $target) {
    foreach ($name in $payloadNames) {
        $expected = Get-FileHash -LiteralPath (Join-Path $source $name) -Algorithm SHA256
        $actual = Get-FileHash -LiteralPath (Join-Path $destination $name) -Algorithm SHA256
        if ($expected.Hash -ne $actual.Hash) { throw "Installed payload differs from candidate: $name" }
    }
    Write-Output 'PASS: all four installed payload files match their candidate SHA256'
}
$testProtocol = 'Software\Classes\inkism-validation-note'
$testProtocolKey = 'HKCU:\' + $testProtocol
function Read-ProtocolCommand([string]$scheme) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\' + $scheme + '\shell\open\command')
    if ($null -eq $key) { return $null }
    try { return $key.GetValue('') } finally { $key.Dispose() }
}
$personalProtocolBefore = Read-ProtocolCommand 'note'
if (Test-Path -LiteralPath $testProtocolKey) { throw 'Validation protocol already exists; refusing to overwrite it' }
function Assert-PersonalProtocolPreserved {
    if ((Read-ProtocolCommand 'note') -cne $personalProtocolBefore) { throw 'Validation changed the installed note:// handler' }
}
function Assert-InstalledProtocol([string]$destination = $target) {
    $expectedProtocolCommand = '"' + (Join-Path $destination 'Inkism.exe') + '" --open "%1"'
    if ((Read-ProtocolCommand 'inkism-validation-note') -cne $expectedProtocolCommand) { throw 'Installed protocol command does not quote the app and URL correctly' }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testProtocol)
    try { if ($null -eq $key -or $key.GetValueNames() -notcontains 'URL Protocol') { throw 'Installed URL protocol marker is missing' } }
    finally { if ($null -ne $key) { $key.Dispose() } }
    Assert-PersonalProtocolPreserved
}
$initialSetup = $setup
$initialPayload = Join-Path $root 'dist/windows'
if ($PreviousValidationSetup) {
    # The caller must verify the old ValidationBuild's provenance/hash before
    # passing it. A filename is not proof of isolated installer behavior.
    $initialSetup = [System.IO.Path]::GetFullPath($PreviousValidationSetup)
    if ([System.IO.Path]::GetFileName($initialSetup) -ne 'Inkism-validation-setup.exe') {
        throw 'Previous installer must be an independently verified ValidationBuild'
    }
    $initialPayload = Join-Path (Split-Path $initialSetup -Parent) 'windows'
}
Invoke-InstallerCase {
    Run-Checked $initialSetup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="notelinks" /DIR="' + $target + '" /LOG="' + $installLog + '"')
    foreach ($name in @('Inkism.exe', 'inkism-engine.exe', 'README.md', 'BUILD.txt', 'unins000.exe')) {
        if (-not (Test-Path (Join-Path $target $name))) { throw "Missing installed file: $name" }
    }
    Assert-InstalledPayload $initialPayload
    if (-not $PreviousValidationSetup) { Assert-InstalledProtocol }
    Set-Content $sentinel 'preserve'
    Run-Fixture 'seed' (Join-Path $target 'inkism-engine.exe')
    Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="notelinks" /DIR="' + $target + '" /LOG="' + $updateLog + '"')
    Assert-InstalledPayload (Join-Path $root 'dist/windows')
    Assert-InstalledProtocol
    if ((Get-Content $sentinel) -ne 'preserve') { throw 'Update changed unowned file' }
    Run-Fixture 'verify' (Join-Path $target 'inkism-engine.exe')
    $env:INKISM_TEST_BINARY = Join-Path $target 'Inkism.exe'
    $env:INKISM_TEST_SCREENSHOT_SUFFIX = '-installed'
    $env:INKISM_TEST_ENCRYPTED = '1'
    if (-not $SkipUI) {
        node (Join-Path $root 'frontend/scripts/windows-ui-test.ts')
        if ($LASTEXITCODE) { throw 'Installed application UI test failed' }
    }
} {
    $env:INKISM_TEST_BINARY = $previous
    $env:INKISM_TEST_SCREENSHOT_SUFFIX = $previousSuffix
    $env:INKISM_TEST_ENCRYPTED = $previousEncrypted
    if (Test-Path -LiteralPath $uninstaller) {
        Run-Uninstall $uninstaller $uninstallLog
        if (Test-Path -LiteralPath $testProtocolKey) { throw 'Uninstall left its owned URL protocol behind' }
        Assert-PersonalProtocolPreserved
        foreach ($name in $payloadNames) {
            if (Test-Path (Join-Path $target $name)) { throw "Uninstall left an owned payload file behind: $name" }
        }
        if ((Test-Path $sentinel) -and (Get-Content $sentinel) -ne 'preserve') { throw 'Uninstall changed user data' }
    }
}
# A handler selected after installation must survive Inkism's uninstall.
$foreignProtocolCommand = '"C:\InkismValidationOtherHandler.exe" "%1"'
Invoke-InstallerCase {
    Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="notelinks" /DIR="' + $target + '" /LOG="' + (Join-Path $root 'dist/installer-protocol-install.log') + '"')
    Assert-InstalledProtocol
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testProtocol + '\shell\open\command', $true)
    try { $key.SetValue('', $foreignProtocolCommand) } finally { $key.Dispose() }
    Run-Uninstall $uninstaller (Join-Path $root 'dist/installer-protocol-uninstall.log')
    if ((Read-ProtocolCommand 'inkism-validation-note') -cne $foreignProtocolCommand) { throw 'Uninstall removed a later URL protocol handler' }
    Assert-PersonalProtocolPreserved
} {
    # This scheme did not exist before this test. Remove only our sentinel handler.
    if ((Read-ProtocolCommand 'inkism-validation-note') -ceq $foreignProtocolCommand) {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($testProtocol, $false)
    }
}
Write-Output 'PASS: optional HKCU URL protocol, quoted link argument, owned cleanup, later-handler preservation and installed note:// handler preserved'
# A fresh install with the unchecked task must leave both an absent handler
# and an existing foreign handler untouched through reinstall and removal.
$optOutForeignCommand = '"C:\InkismValidationOptOutOtherHandler.exe" "%1"'
$optOutMarker = [guid]::NewGuid().ToString()
function Set-OptOutForeignProtocol {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($testProtocol)
    try {
        $key.SetValue('', 'URL:Validation foreign sentinel')
        $key.SetValue('URL Protocol', '')
        $key.SetValue('InkismValidationSentinel', $optOutMarker)
    } finally { $key.Dispose() }
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($testProtocol + '\shell\open\command')
    try { $key.SetValue('', $optOutForeignCommand) } finally { $key.Dispose() }
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($testProtocol + '\DefaultIcon')
    try { $key.SetValue('', 'C:\InkismValidationOptOutOtherHandler.exe,0') } finally { $key.Dispose() }
}
function Assert-OptOutProtocol([bool]$withForeign) {
    if (-not $withForeign) {
        if (Test-Path -LiteralPath $testProtocolKey) { throw 'Unchecked note-link task created a URL protocol' }
    } else {
        if ((Read-ProtocolCommand 'inkism-validation-note') -cne $optOutForeignCommand) { throw 'Unchecked note-link task changed the foreign handler' }
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testProtocol)
        try {
            if ($null -eq $key -or $key.GetValue('') -cne 'URL:Validation foreign sentinel' -or
                $key.GetValueNames() -notcontains 'URL Protocol' -or
                $key.GetValue('URL Protocol') -cne '' -or
                $key.GetValue('InkismValidationSentinel') -cne $optOutMarker) {
                throw 'Unchecked note-link task changed foreign protocol metadata'
            }
        } finally { if ($null -ne $key) { $key.Dispose() } }
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testProtocol + '\DefaultIcon')
        try {
            if ($null -eq $key -or $key.GetValue('') -cne 'C:\InkismValidationOptOutOtherHandler.exe,0') { throw 'Unchecked note-link task changed the foreign icon' }
        } finally { if ($null -ne $key) { $key.Dispose() } }
    }
    Assert-PersonalProtocolPreserved
}
foreach ($withForeign in @($false, $true)) {
    if (Test-Path -LiteralPath $testProtocolKey) { throw 'Opt-out validation protocol already exists; refusing to overwrite it' }
    $caseName = if ($withForeign) { 'foreign' } else { 'absent' }
    $optOutTarget = Join-Path $env:TEMP ('inkism-install-optout-' + [guid]::NewGuid())
    $optOutUninstaller = Join-Path $optOutTarget 'unins000.exe'
    $optOutSentinel = Join-Path $optOutTarget 'preserve-optout-user-data.txt'
    $optOutLogs = Join-Path $root ('dist/installer-optout-' + $caseName)
    $optOutUninstallAttempted = $false
    Invoke-InstallerCase {
        if ($withForeign) { Set-OptOutForeignProtocol }
        Assert-OptOutProtocol $withForeign
        Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="" /DIR="' + $optOutTarget + '" /LOG="' + $optOutLogs + '-install.log"')
        Assert-InstalledPayload (Join-Path $root 'dist/windows') $optOutTarget
        Assert-OptOutProtocol $withForeign
        Set-Content -LiteralPath $optOutSentinel -Value 'preserve-optout'
        Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="" /DIR="' + $optOutTarget + '" /LOG="' + $optOutLogs + '-update.log"')
        Assert-InstalledPayload (Join-Path $root 'dist/windows') $optOutTarget
        Assert-OptOutProtocol $withForeign
        if ((Get-Content -LiteralPath $optOutSentinel) -cne 'preserve-optout') { throw 'Opt-out reinstall changed unowned user data' }
        $optOutUninstallAttempted = $true
        Run-Uninstall $optOutUninstaller ($optOutLogs + '-uninstall.log')
        Assert-OptOutProtocol $withForeign
        foreach ($name in $payloadNames) {
            if (Test-Path -LiteralPath (Join-Path $optOutTarget $name)) { throw "Opt-out uninstall left an owned payload file behind: $name" }
        }
        if (-not (Test-Path -LiteralPath $optOutSentinel) -or (Get-Content -LiteralPath $optOutSentinel) -cne 'preserve-optout') { throw 'Opt-out uninstall changed unowned user data' }
        Write-Output ("PASS: unchecked note-link task with $caseName handler; fresh install/reinstall/uninstall preserves protocol state, exact payload hashes and unowned data")
    } {
        if (-not $optOutUninstallAttempted -and (Test-Path -LiteralPath $optOutUninstaller)) {
            $optOutUninstallAttempted = $true
            Run-Uninstall $optOutUninstaller ($optOutLogs + '-cleanup.log')
        }
        # Remove only the foreign registry fixture created by this case.
        if ($withForeign -and (Read-ProtocolCommand 'inkism-validation-note') -ceq $optOutForeignCommand) {
            $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testProtocol)
            $owned = $false
            try { if ($null -ne $key) { $owned = $key.GetValue('InkismValidationSentinel') -ceq $optOutMarker } }
            finally { if ($null -ne $key) { $key.Dispose() } }
            if ($owned) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($testProtocol, $false) }
        }
        if ((Test-Path -LiteralPath $optOutSentinel) -and (Get-Content -LiteralPath $optOutSentinel) -ceq 'preserve-optout') { Remove-Item -LiteralPath $optOutSentinel }
        if ((Test-Path -LiteralPath $optOutTarget) -and -not (Get-ChildItem -LiteralPath $optOutTarget -Force)) { Remove-Item -LiteralPath $optOutTarget }
    }
}
# Upgrading after opt-in must apply the newly unchecked task. A later foreign
# handler still belongs to its owner even when the old installer registered first.
foreach ($withForeign in @($false, $true)) {
    if (Test-Path -LiteralPath $testProtocolKey) { throw 'Opt-in upgrade validation protocol already exists; refusing to overwrite it' }
    $caseName = if ($withForeign) { 'foreign' } else { 'owned' }
    $upgradeTarget = Join-Path $env:TEMP ('inkism-install-upgrade-optout-' + [guid]::NewGuid())
    $upgradeUninstaller = Join-Path $upgradeTarget 'unins000.exe'
    $upgradeSentinel = Join-Path $upgradeTarget 'preserve-upgrade-user-data.txt'
    $upgradeLogs = Join-Path $root ('dist/installer-upgrade-optout-' + $caseName)
    $upgradeUninstallAttempted = $false
    Invoke-InstallerCase {
        Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="notelinks" /DIR="' + $upgradeTarget + '" /LOG="' + $upgradeLogs + '-install.log"')
        Assert-InstalledPayload (Join-Path $root 'dist/windows') $upgradeTarget
        Assert-InstalledProtocol $upgradeTarget
        Set-Content -LiteralPath $upgradeSentinel -Value 'preserve-upgrade'
        if ($withForeign) { Set-OptOutForeignProtocol }
        Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="" /DIR="' + $upgradeTarget + '" /LOG="' + $upgradeLogs + '-update.log"')
        Assert-InstalledPayload (Join-Path $root 'dist/windows') $upgradeTarget
        Assert-OptOutProtocol $withForeign
        if ((Get-Content -LiteralPath $upgradeSentinel) -cne 'preserve-upgrade') { throw 'Task deselection upgrade changed unowned user data' }
        $upgradeUninstallAttempted = $true
        Run-Uninstall $upgradeUninstaller ($upgradeLogs + '-uninstall.log')
        Assert-OptOutProtocol $withForeign
        foreach ($name in $payloadNames) {
            if (Test-Path -LiteralPath (Join-Path $upgradeTarget $name)) { throw "Task deselection uninstall left an owned payload file behind: $name" }
        }
        if (-not (Test-Path -LiteralPath $upgradeSentinel) -or (Get-Content -LiteralPath $upgradeSentinel) -cne 'preserve-upgrade') { throw 'Task deselection uninstall changed unowned user data' }
        $protocolResult = if ($withForeign) { 'later foreign handler and metadata preserved' } else { 'owned registration removed' }
        Write-Output ("PASS: opt-in to opt-out upgrade; $protocolResult; exact payload hashes, personal protocol and unowned data preserved")
    } {
        if (-not $upgradeUninstallAttempted -and (Test-Path -LiteralPath $upgradeUninstaller)) {
            $upgradeUninstallAttempted = $true
            Run-Uninstall $upgradeUninstaller ($upgradeLogs + '-cleanup.log')
        }
        if ($withForeign -and (Read-ProtocolCommand 'inkism-validation-note') -ceq $optOutForeignCommand) {
            $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testProtocol)
            $owned = $false
            try { if ($null -ne $key) { $owned = $key.GetValue('InkismValidationSentinel') -ceq $optOutMarker } }
            finally { if ($null -ne $key) { $key.Dispose() } }
            if ($owned) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($testProtocol, $false) }
        }
        if ((Test-Path -LiteralPath $upgradeSentinel) -and (Get-Content -LiteralPath $upgradeSentinel) -ceq 'preserve-upgrade') { Remove-Item -LiteralPath $upgradeSentinel }
        if ((Test-Path -LiteralPath $upgradeTarget) -and -not (Get-ChildItem -LiteralPath $upgradeTarget -Force)) { Remove-Item -LiteralPath $upgradeTarget }
    }
}
if (-not (Test-Path $sentinel)) { throw 'Uninstall removed user data' }
Run-Fixture 'verify' (Join-Path $root 'dist/windows/inkism-engine.exe')
Write-Output ('Preserved synthetic library for inspection: ' + $fixture)
# Delete only this test-created sentinel and empty directory. Preserve unexpected files.
Remove-Item -LiteralPath $sentinel
if (-not (Get-ChildItem -LiteralPath $target -Force)) { Remove-Item -LiteralPath $target }
$upgrade = if ($PreviousValidationSetup) { 'previous-candidate upgrade' } else { 'same-candidate reinstall' }
if ($SkipUI) { Write-Output ("PASS: isolated install/$upgrade/uninstall, exact payload hashes, synthetic note/attachment bytes and unowned file preservation; UI NOT RUN") }
else { Write-Output ("PASS: isolated install/$upgrade/uninstall, exact payload hashes, default encrypted native editor, synthetic note/attachment bytes and unowned data preserved") }
