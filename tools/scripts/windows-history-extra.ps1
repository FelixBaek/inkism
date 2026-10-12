# Runs only inside the source UI harness's isolated profile/clipboard/finally.
if ($env:INKISM_TEST_HISTORY_ONLY -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
    throw 'Native history checks require an approved isolated session'
}
$historyManifest = Join-Path $scratch 'history-fixture.json'
$historyVerifier = Join-Path $PSScriptRoot 'verify-windows-history.ts'
$historyStorage = if ($env:INKISM_TEST_ENCRYPTED -eq '1') {'encrypted'} else {'plaintext'}
function Verify-History([string]$mode) {
    node $historyVerifier $mode (Join-Path (Split-Path $binary) 'inkism-engine.exe') $db $historyManifest $historyStorage
    if ($LASTEXITCODE) { throw ('Native history verifier failed: ' + $mode) }
}
function Open-HistoryNote($entry) {
    Open-Inkism
    Invoke-Element (Find-Element ('노트 열기: ' + $entry.title))
    if ($entry.format -eq 'html') {
        Invoke-Element (Find-Element 'HTML' ([System.Windows.Automation.ControlType]::Button))
    }
    Wait-HistoryMarker $entry.format '현재원본'
    Invoke-Element (Find-Element '노트 속성 열기' ([System.Windows.Automation.ControlType]::Button))
}
function Wait-HistoryMarker([string]$format, [string]$marker) {
    # Legacy literal-text notes use a read-only rich preview in the current UI.
    if ($format -eq 'text') { Wait-WindowText $marker $true }
    else { Wait-SourceMarker $format $marker }
}
function History-RestoreButton {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
        $buttons = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition) | Where-Object {$_.Current.Name -like '버전 복원:*'})
        if ($buttons.Count -eq 1) { return $buttons[0] }
        if ($buttons.Count -gt 1) { throw 'Fixture unexpectedly exposes multiple restore targets' }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Native history restore button not found'
}
Verify-History 'seed'
$historyEntries = Get-Content -Raw -Encoding UTF8 $historyManifest | ConvertFrom-Json
foreach ($entry in $historyEntries) {
    Open-HistoryNote $entry
    Invoke-Element (History-RestoreButton)
    Find-Element '버전 복원' | Out-Null
    Invoke-Element (Find-Element '취소' ([System.Windows.Automation.ControlType]::Button))
    Invoke-Element (Find-Element '노트 속성 닫기' ([System.Windows.Automation.ControlType]::Button))
    Wait-HistoryMarker $entry.format '현재원본'
    Close-Inkism
}
Verify-History 'cancel'
foreach ($entry in $historyEntries) {
    Open-HistoryNote $entry
    Invoke-Element (History-RestoreButton)
    Find-Element '버전 복원' | Out-Null
    Invoke-Element (Find-Element '복원' ([System.Windows.Automation.ControlType]::Button))
    Invoke-Element (Find-Element '노트 속성 닫기' ([System.Windows.Automation.ControlType]::Button))
    if ($entry.format -eq 'html') {
        Invoke-Element (Find-Element 'HTML' ([System.Windows.Automation.ControlType]::Button))
    }
    Wait-HistoryMarker $entry.format '이전원본'
    Save-Screenshot ('windows-ui-history-' + $entry.format)
    Close-Inkism
    Open-Inkism
    if ($entry.format -eq 'html') {
        Invoke-Element (Find-Element 'HTML' ([System.Windows.Automation.ControlType]::Button))
    }
    Wait-HistoryMarker $entry.format '이전원본'
    Close-Inkism
}
Verify-History 'restored'
Write-Output 'PASS: native HTML/text/Markdown version restore/cancel, exact originals after restart and pre-restore version retention'
