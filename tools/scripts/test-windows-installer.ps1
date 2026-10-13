param([switch]$SkipUI, [string]$PreviousValidationSetup = '')
# Compile with /DValidationBuild. The test scheme is separate from the installed note:// handler.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$target = Join-Path $env:TEMP ('inkism-install-' + [guid]::NewGuid())
$setup = Join-Path $root 'dist/Inkism-validation-setup.exe'
$installLog = Join-Path $root 'dist/installer-install.log'
$updateLog = Join-Path $root 'dist/installer-update.log'
$uninstallLog = Join-Path $root 'dist/installer-uninstall.log'
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
    } finally { $process.Dispose() }
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
$expectedProtocolCommand = '"' + (Join-Path $target 'Inkism.exe') + '" --open "%1"'
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
function Assert-InstalledProtocol {
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
try {
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
} finally {
    $env:INKISM_TEST_BINARY = $previous
    $env:INKISM_TEST_SCREENSHOT_SUFFIX = $previousSuffix
    $env:INKISM_TEST_ENCRYPTED = $previousEncrypted
    if (Test-Path -LiteralPath $uninstaller) {
        Run-Checked $uninstaller ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $uninstallLog + '"')
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
try {
    Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="notelinks" /DIR="' + $target + '" /LOG="' + $installLog + '.protocol"')
    Assert-InstalledProtocol
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testProtocol + '\shell\open\command', $true)
    try { $key.SetValue('', $foreignProtocolCommand) } finally { $key.Dispose() }
    Run-Checked $uninstaller ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $uninstallLog + '.protocol"')
    if ((Read-ProtocolCommand 'inkism-validation-note') -cne $foreignProtocolCommand) { throw 'Uninstall removed a later URL protocol handler' }
    Assert-PersonalProtocolPreserved
} finally {
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
    try {
        if ($withForeign) {
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
        Assert-OptOutProtocol $withForeign
        Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="" /DIR="' + $optOutTarget + '" /LOG="' + $optOutLogs + '-install.log"')
        Assert-InstalledPayload (Join-Path $root 'dist/windows') $optOutTarget
        Assert-OptOutProtocol $withForeign
        Set-Content -LiteralPath $optOutSentinel -Value 'preserve-optout'
        Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="" /DIR="' + $optOutTarget + '" /LOG="' + $optOutLogs + '-update.log"')
        Assert-InstalledPayload (Join-Path $root 'dist/windows') $optOutTarget
        Assert-OptOutProtocol $withForeign
        if ((Get-Content -LiteralPath $optOutSentinel) -cne 'preserve-optout') { throw 'Opt-out reinstall changed unowned user data' }
        Run-Checked $optOutUninstaller ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $optOutLogs + '-uninstall.log"')
        Assert-OptOutProtocol $withForeign
        foreach ($name in $payloadNames) {
            if (Test-Path -LiteralPath (Join-Path $optOutTarget $name)) { throw "Opt-out uninstall left an owned payload file behind: $name" }
        }
        if (-not (Test-Path -LiteralPath $optOutSentinel) -or (Get-Content -LiteralPath $optOutSentinel) -cne 'preserve-optout') { throw 'Opt-out uninstall changed unowned user data' }
        Write-Output ("PASS: unchecked note-link task with $caseName handler; fresh install/reinstall/uninstall preserves protocol state, exact payload hashes and unowned data")
    } finally {
        if (Test-Path -LiteralPath $optOutUninstaller) {
            Run-Checked $optOutUninstaller ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $optOutLogs + '-cleanup.log"')
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
if (-not (Test-Path $sentinel)) { throw 'Uninstall removed user data' }
Run-Fixture 'verify' (Join-Path $root 'dist/windows/inkism-engine.exe')
Write-Output ('Preserved synthetic library for inspection: ' + $fixture)
# Delete only this test-created sentinel and empty directory. Preserve unexpected files.
Remove-Item -LiteralPath $sentinel
if (-not (Get-ChildItem -LiteralPath $target -Force)) { Remove-Item -LiteralPath $target }
$upgrade = if ($PreviousValidationSetup) { 'previous-candidate upgrade' } else { 'same-candidate reinstall' }
if ($SkipUI) { Write-Output ("PASS: isolated install/$upgrade/uninstall, exact payload hashes, synthetic note/attachment bytes and unowned file preservation; UI NOT RUN") }
else { Write-Output ("PASS: isolated install/$upgrade/uninstall, exact payload hashes, default encrypted native editor, synthetic note/attachment bytes and unowned data preserved") }
