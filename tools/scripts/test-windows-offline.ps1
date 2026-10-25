param([Parameter(Mandatory=$true)][string]$CandidateDirectory, [Parameter(Mandatory=$true)][string]$WebViewRuntime)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-acceptance-lock.ps1')
$offlineLock=Enter-InkismAcceptance
$offlineRoot=Join-Path $env:TEMP ('inkism-offline-'+[guid]::NewGuid())
$offlineGroup='Inkism-offline-'+[guid]::NewGuid()
$oldBinary=$env:INKISM_TEST_BINARY
$oldRuntime=$env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER
$oldEncrypted=$env:INKISM_TEST_ENCRYPTED
try {
    if (@(Get-NetFirewallProfile | Where-Object {-not $_.Enabled}).Count) {throw 'All firewall profiles must already be enabled'}
    $CandidateDirectory=[System.IO.Path]::GetFullPath($CandidateDirectory)
    $WebViewRuntime=[System.IO.Path]::GetFullPath($WebViewRuntime)
    if (-not (Test-Path (Join-Path $WebViewRuntime 'msedgewebview2.exe'))) {throw 'WebView runtime missing'}
    New-Item -ItemType Directory $offlineRoot | Out-Null
    $offlineApp=Join-Path $offlineRoot 'app'
    $offlineRuntime=Join-Path $offlineRoot 'runtime'
    Copy-Item -LiteralPath $CandidateDirectory -Destination $offlineApp -Recurse
    Copy-Item -LiteralPath $WebViewRuntime -Destination $offlineRuntime -Recurse
    # Block only private copies: never register a rule for the shared runtime.
    $blockedPrograms=@(Get-ChildItem $offlineRoot -Filter '*.exe' -Recurse -File | ForEach-Object {$_.FullName})
    foreach($program in $blockedPrograms){
        New-NetFirewallRule -DisplayName ($offlineGroup+' '+[System.IO.Path]::GetFileName($program)) -Group $offlineGroup -Direction Outbound -Program $program -Action Block -Profile Any -Enabled True | Out-Null
    }
    $offlineCheck={param($processId)
        $processes=@(Get-CimInstance Win32_Process)
        $ids=@([int]$processId)
        do {
            $next=@($processes | Where-Object {$ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId} | ForEach-Object {[int]$_.ProcessId})
            $ids+=$next
        } while($next.Count)
        $owned=@($processes | Where-Object {$ids -contains [int]$_.ProcessId})
        if (-not @($owned | Where-Object {$_.Name -eq 'msedgewebview2.exe'}).Count) {throw 'Offline run has no observable WebView process'}
        $rules=@(Get-NetFirewallRule -PolicyStore ActiveStore -Group $offlineGroup)
        if ($rules.Count -ne $blockedPrograms.Count -or @($rules | Where-Object {$_.Action -ne 'Block' -or $_.Direction -ne 'Outbound' -or $_.Enabled -ne 'True'}).Count) {throw 'Offline firewall rules not effective'}
        $paths=@($rules | Get-NetFirewallApplicationFilter | ForEach-Object {$_.Program})
        $blockedCount=0
        foreach($process in $owned){
            # Windows creates its own console host for the engine's stdio.
            # It is not an Inkism network client; never block the shared OS exe.
            if ($process.ExecutablePath -ieq (Join-Path $env:SystemRoot 'System32\conhost.exe')) {continue}
            $blockedCount++
            if (-not $process.ExecutablePath -or $paths -notcontains $process.ExecutablePath) {throw "Unblocked test child process: $($process.Name)"}
        }
        Write-Output "PASS: $blockedCount app/engine/WebView processes use private copies with active outbound block rules"
    }
    $env:INKISM_TEST_BINARY=Join-Path $offlineApp 'Inkism.exe'
    $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=$offlineRuntime
    $env:INKISM_TEST_ENCRYPTED='1'
    & (Join-Path $PSScriptRoot 'test-windows-source-ui.ps1') -OfflineCheck $offlineCheck
    Write-Output 'PASS: offline native capture and encrypted backup/restore under app-scoped outbound firewall blocks'
} finally {
    try {
        $env:INKISM_TEST_BINARY=$oldBinary
        $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=$oldRuntime
        $env:INKISM_TEST_ENCRYPTED=$oldEncrypted
        Write-Output "Removing test-only firewall group: $offlineGroup"
        Get-NetFirewallRule -Group $offlineGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        if (Get-NetFirewallRule -Group $offlineGroup -ErrorAction SilentlyContinue) {throw 'Test firewall rules remain'}
        if (Test-Path -LiteralPath $offlineRoot) {
            $tempPrefix=[System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
            if (-not $offlineRoot.StartsWith($tempPrefix,[System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($offlineRoot) -notmatch '^inkism-offline-[0-9a-f-]{36}$') {throw 'Unsafe offline cleanup path'}
            Write-Output "Removing test-only runtime and app copies: $offlineRoot"
            Remove-Item -LiteralPath $offlineRoot -Recurse -Force
        }
    } finally {Exit-InkismAcceptance $offlineLock}
}
