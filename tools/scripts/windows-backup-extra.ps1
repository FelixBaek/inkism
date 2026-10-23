# Native backup/restore gate using the shared isolated profile and lifecycle.
    if ($null -eq $InstalledUpgrade) { Verify-NativeBackup 'seed' }
    # Exercise the file-backed native backup command, including cancellation.
    Open-Inkism
    Invoke-Element (Find-Element '설정 열기' ([System.Windows.Automation.ControlType]::Button))
    Invoke-Element (Find-Element '백업과 복원' ([System.Windows.Automation.ControlType]::Button))
    $backupPath = Join-Path $scratch 'native-backup.zip'
    Invoke-Element (Find-Element '노트·첨부파일 백업 다운로드' ([System.Windows.Automation.ControlType]::Button))
    Complete-TestSave '' $true @('노트·첨부파일 백업 다운로드')
    if (Test-Path -LiteralPath $backupPath) { throw 'Cancelled backup created a file' }
    Invoke-Element (Find-Element '노트·첨부파일 백업 다운로드' ([System.Windows.Automation.ControlType]::Button))
    Complete-TestSave $backupPath $false @('노트·첨부파일 백업 다운로드')
    Wait-TestExport $backupPath {param([byte[]]$data) $data.Length -gt 4 -and $data[0] -eq 80 -and $data[1] -eq 75} | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $backupZip = [System.IO.Compression.ZipFile]::OpenRead($backupPath)
    try {
        $reader = New-Object System.IO.StreamReader($backupZip.GetEntry('notes.json').Open(), [System.Text.Encoding]::UTF8)
        try { $backupNotes = ($reader.ReadToEnd() | ConvertFrom-Json).notes } finally { $reader.Dispose() }
        foreach ($case in $cases) {
            $row = @($backupNotes | Where-Object { $_.title -ceq $case.title })
            if ($row.Count -ne 1 -or (Remove-BlockIds $row[0].content) -cne (Remove-BlockIds $case.content)) { throw "Native backup changed source bytes: $($case.title)" }
        }
    } finally { $backupZip.Dispose() }
    Invoke-Element (Find-Element '설정 닫기' ([System.Windows.Automation.ControlType]::Button))
    Close-Inkism
    if ($cases.Count -gt 0) { Verify-SourceData }
    Write-Output 'PASS: native backup picker cancellation, file save and canonical source bytes in ZIP'
    $sourceDb = $db
    $db = Join-Path $scratch 'restored-backup.db'
    if (Test-Path -LiteralPath $db) { throw 'Restore target must be a fresh synthetic library' }
    Open-Inkism
    Invoke-Element (Find-Element '설정 열기' ([System.Windows.Automation.ControlType]::Button))
    Invoke-Element (Find-Element '백업과 복원' ([System.Windows.Automation.ControlType]::Button))
    # The empty workspace has the same restore label behind the modal. Scope
    # the real pointer action to the settings dialog, never that inert button.
    $restoreCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '백업 파일에서 복원')
    $restoreButton = $null
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    foreach ($candidate in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $restoreCondition)) {
        $ancestor = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($candidate)
        for ($depth = 0; $depth -lt 20 -and $null -ne $ancestor; $depth++) {
            if ($ancestor.Current.Name -eq '설정') { $restoreButton = $candidate; break }
            $ancestor = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($ancestor)
        }
        if ($null -ne $restoreButton) { break }
    }
    if ($null -eq $restoreButton) { throw 'Restore button inside settings dialog not found' }
    $scroll = $null
    if ($restoreButton.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scroll)) { $scroll.ScrollIntoView() }
    [InkismInput]::ActivateWindow($app.MainWindowHandle)
    $restoreButton.SetFocus()
    if (-not [System.Windows.Automation.Automation]::Compare([System.Windows.Automation.AutomationElement]::FocusedElement, $restoreButton)) { throw 'Restore button did not receive keyboard focus' }
    if ([InkismInput]::GetForegroundWindow() -ne $app.MainWindowHandle) { throw 'Restore app lost foreground before Enter' }
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Select-NativeFile $backupPath ''
    Find-Element '백업 가져오기 완료' | Out-Null
    Invoke-Element (Find-Element '확인' ([System.Windows.Automation.ControlType]::Button))
    Invoke-Element (Find-Element '설정 닫기' ([System.Windows.Automation.ControlType]::Button))
    Close-Inkism
    if ($cases.Count -gt 0) { Verify-SourceData }
    Verify-NativeBackup 'verify'
    Open-Inkism
    Find-Element '새 노트 만들기 (Ctrl+N)' | Out-Null
    Close-Inkism
    if ($cases.Count -gt 0) { Verify-SourceData }
    Verify-NativeBackup 'verify'
    $db = $sourceDb
    Write-Output 'PASS: native ZIP restore into fresh encrypted library, source bytes, attachment bytes and restart persistence'
