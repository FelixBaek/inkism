param([switch]$SkipUI, [string]$PreviousValidationSetup = '')
# Compile with /DValidationBuild. No production AppId, shortcuts or uninstall registry.
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
function Assert-InstalledPayload([string]$source) {
    foreach ($name in $payloadNames) {
        $expected = Get-FileHash -LiteralPath (Join-Path $source $name) -Algorithm SHA256
        $actual = Get-FileHash -LiteralPath (Join-Path $target $name) -Algorithm SHA256
        if ($expected.Hash -ne $actual.Hash) { throw "Installed payload differs from candidate: $name" }
    }
    Write-Output 'PASS: all four installed payload files match their candidate SHA256'
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
    Run-Checked $initialSetup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="' + $target + '" /LOG="' + $installLog + '"')
    foreach ($name in @('Inkism.exe', 'inkism-engine.exe', 'README.md', 'BUILD.txt', 'unins000.exe')) {
        if (-not (Test-Path (Join-Path $target $name))) { throw "Missing installed file: $name" }
    }
    Assert-InstalledPayload $initialPayload
    Set-Content $sentinel 'preserve'
    Run-Fixture 'seed' (Join-Path $target 'inkism-engine.exe')
    Run-Checked $setup ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="' + $target + '" /LOG="' + $updateLog + '"')
    Assert-InstalledPayload (Join-Path $root 'dist/windows')
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
        foreach ($name in $payloadNames) {
            if (Test-Path (Join-Path $target $name)) { throw "Uninstall left an owned payload file behind: $name" }
        }
        if ((Test-Path $sentinel) -and (Get-Content $sentinel) -ne 'preserve') { throw 'Uninstall changed user data' }
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
