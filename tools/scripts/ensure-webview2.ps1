# Official Evergreen Runtime detection/bootstrap for an isolated Windows test host.
# https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
$ErrorActionPreference = 'Stop'
function Get-WebView2Version {
    $locations = @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    )
    foreach ($location in $locations) {
        $value = Get-ItemPropertyValue -Path $location -Name pv -ErrorAction SilentlyContinue
        $version = $null
        if ([version]::TryParse($value, [ref]$version) -and $version -gt [version]'0.0.0.0') {
            return $version
        }
    }
    return $null
}
$installed = Get-WebView2Version
if ($installed) {
    Write-Output "WebView2 Runtime: $installed"
    exit 0
}
$installer = Join-Path $env:TEMP ('inkism-webview2-' + [guid]::NewGuid() + '.exe')
try {
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installer
    $signature = Get-AuthenticodeSignature $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation(?:,|$)') {
        throw 'Microsoft WebView2 installer signature could not be verified'
    }
    $process = Start-Process -FilePath $installer -ArgumentList '/silent', '/install' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "WebView2 installer exited $($process.ExitCode)" }
    $installed = Get-WebView2Version
    if (-not $installed) { throw 'WebView2 Runtime is still missing after installation' }
    Write-Output "WebView2 Runtime installed: $installed"
} finally {
    Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
}
