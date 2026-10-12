# Native rich attachment gate; synthetic bytes only, shared isolated lifecycle.
if ($env:INKISM_TEST_ATTACHMENT_ONLY -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') { throw 'Approved native attachment session required' }
$attachmentName = 'Inkism-native-' + [Guid]::NewGuid().ToString('N') + '.bin'
$attachmentPath = Join-Path $scratch $attachmentName
$attachmentBytes = New-Object byte[] 600017
for ($i = 0; $i -lt $attachmentBytes.Length; $i++) { $attachmentBytes[$i] = $i % 251 }
[System.IO.File]::WriteAllBytes($attachmentPath,$attachmentBytes)
$downloadedFile = Join-Path ([InkismInput]::Downloads()) $attachmentName
if (Test-Path $downloadedFile) { throw 'Unique synthetic download path already exists' }
$attachmentHash = Get-Sha256 $attachmentPath
function Assert-AttachmentPicker {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $foreground = [InkismInput]::GetForegroundWindow()
        if ($foreground -ne [IntPtr]::Zero) {
            $dialog = [System.Windows.Automation.AutomationElement]::FromHandle($foreground)
            if ($dialog.Current.ClassName -eq '#32770' -and $dialog.Current.Name -in @('Open','열기')) {
                $pidToCheck = $dialog.Current.ProcessId
                for ($depth=0; $depth -lt 8 -and $pidToCheck -gt 0; $depth++) {
                    if ($pidToCheck -eq $app.Id) { return $dialog.Current.Name }
                    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$pidToCheck"
                    if (-not $processInfo) { break }
                    $pidToCheck = $processInfo.ParentProcessId
                }
                throw 'Attachment picker does not belong to this test app or its WebView child'
            }
        }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Owned attachment picker did not appear'
}
function Verify-AttachmentSave {
    node (Join-Path $PSScriptRoot 'verify-attachment-ui-save.ts') (Join-Path (Split-Path $binary) 'inkism-engine.exe') $db $attachmentPath
    if ($LASTEXITCODE) { throw 'Native attachment reference or stored bytes changed' }
}
try {
    Open-Inkism
    Invoke-Element (Find-Element '새 노트 만들기 (Ctrl+N)')
    Paste-Text (Find-Element '노트 제목') 'Windows 첨부 검사'
    Click-Element (Find-Element '파일 첨부')
    $attachmentPickerTitle = Assert-AttachmentPicker
    Select-NativeFile $attachmentPath $attachmentPickerTitle
    $fileLink = Find-Element ($attachmentName + ' 다운로드')
    Save-Screenshot 'windows-ui-native-attachment'
    Click-Element $fileLink
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    $matches = $false
    do {
        if (Test-Path $downloadedFile) { try { $matches = (Get-Sha256 $downloadedFile) -eq $attachmentHash } catch {} }
        if ($matches) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $matches) { throw 'Actual downloaded attachment bytes differ' }
    Close-Inkism
    Verify-AttachmentSave
    Open-Inkism
    Find-Element ($attachmentName + ' 다운로드') | Out-Null
    Close-Inkism
    Verify-AttachmentSave
    Write-Output 'PASS: actual native file selection, rich attachment card, 600017 exact downloaded bytes, immediate close-save and restart persistence'
} finally {
    # Delete only this run's uniquely named synthetic download if unmodified.
    if ((Test-Path $downloadedFile) -and (Get-Sha256 $downloadedFile) -eq $attachmentHash) {
        Remove-Item -LiteralPath $downloadedFile
    }
}
