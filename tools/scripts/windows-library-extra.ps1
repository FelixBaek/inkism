# Only test-created libraries and an isolated installation are eligible.
if ($env:INKISM_TEST_LIBRARY_ONLY -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') { throw 'Approved library test session required' }
$libraryBinaryDirectory = [System.IO.Path]::GetFullPath((Split-Path $binary))
$libraryTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
if (-not $libraryBinaryDirectory.StartsWith($libraryTemp,[System.StringComparison]::OrdinalIgnoreCase) -or
    [System.IO.Path]::GetFileName($libraryBinaryDirectory) -notlike 'inkism-library-ui-*') {
    throw 'Library transition gate requires its own isolated TEMP installation'
}
$binary = [System.IO.Path]::GetFullPath($binary)
$libraryManifest = Join-Path $scratch 'library-fixture.json'
$libraryVerifier = Join-Path $PSScriptRoot 'verify-windows-library.ts'
$libraryPreference = Join-Path $env:APPDATA 'Inkism/library.json'
function Verify-Libraries([string]$mode) {
    node $libraryVerifier $mode (Join-Path (Split-Path $binary) 'inkism-engine.exe') $db $libraryManifest
    if ($LASTEXITCODE) { throw ('Native library verifier failed: ' + $mode) }
}
function Wait-LibraryWindow {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $app.Refresh()
        if ($app.HasExited) { throw 'Library candidate exited before opening' }
        if ($app.MainWindowHandle -ne [IntPtr]::Zero) {
            try {
                $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
                if ($window.Current.Name -eq 'inkism') { return }
            } catch {}
        }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Library candidate did not reach its own Inkism window'
}
function Wait-LibraryTitle([string]$expected) {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        if ((Read-Field (Find-Element '노트 제목')) -ceq $expected) { return }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Selected library note did not finish loading'
}
function Owned-LibraryDialog([string]$title) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    $condition = [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$title),
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$app.Id))
    do {
        $dialog = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
        if ($dialog) { return $dialog }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw ('Owned library dialog not found: ' + $title)
}
function Select-LibraryFile([string]$title,[string]$path) {
    if (-not [System.IO.Path]::GetFullPath($path).StartsWith([System.IO.Path]::GetFullPath($scratch) + '\',[System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to select a file outside the synthetic profile'
    }
    $picker = Owned-LibraryDialog $title
    $handle = [IntPtr]$picker.Current.NativeWindowHandle
    [InkismInput]::ActivateWindow($handle)
    if ([InkismInput]::GetForegroundWindow() -ne $handle) { throw 'Owned picker is not foreground' }
    [System.Windows.Forms.SendKeys]::SendWait('%n')
    Set-TestClipboard $path
    if ([InkismInput]::GetForegroundWindow() -ne $handle) { throw 'Owned picker lost foreground' }
    [InkismInput]::Shortcut(0x41)
    [InkismInput]::Shortcut(0x56)
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
}
function Confirm-LibraryRecovery([string]$buttonId) {
    $dialog = Owned-LibraryDialog 'Inkism 저장소 복구'
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$buttonId)
    $label = if ($buttonId -eq '7') {'^(No|아니요)(\([^)]*\))?$'} else {'^(Yes|예)(\([^)]*\))?$'}
    $buttons = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition) | Where-Object {$_.Current.Name -match $label})
    if ($buttons.Count -ne 1) {
        $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) |
            ForEach-Object { Write-Output ('RECOVERY OWNED UI: '+$_.Current.ControlType.ProgrammaticName+' '+$_.Current.AutomationId+' '+$_.Current.Name) }
        throw 'Recovery choice is missing or ambiguous'
    }
    $button = $buttons[0]
    # Before Wails starts, this machine reports the native Yes/No controls as
    # Pane 6/7, with no InvokePattern. Match ID + localized label within the
    # owned dialog, then activate it and bound the real pointer click.
    Click-Element $button
}
try {
    Verify-Libraries 'seed'
    $libraryFixture = Get-Content -Raw -Encoding UTF8 $libraryManifest | ConvertFrom-Json
    Open-Inkism
    Invoke-Element (Find-Element '노트 열기: 원본 저장소 확인')
    Wait-LibraryTitle '원본 저장소 확인'
    Invoke-Element (Find-Element '텍스트' ([System.Windows.Automation.ControlType]::Button))
    $field = Find-Element '노트 본문 (리치 텍스트 편집기)'
    Click-Element $field
    [InkismInput]::Shortcut(0x23)
    [InkismInput]::TypeAscii('switch_saved')
    Wait-WindowText 'switch_saved' $true
    Invoke-Element (Find-Element '기기 동기화' ([System.Windows.Automation.ControlType]::Button))
    $parent = $app
    Invoke-Element (Find-Element '다른 저장소 열기' ([System.Windows.Automation.ControlType]::Button))
    Select-LibraryFile '열 저장소 파일 선택' $libraryFixture.target
    if (-not $parent.WaitForExit(30000) -or $parent.ExitCode -ne 0) { throw 'Switch source did not close cleanly' }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $child = $null
    do {
        $children = @(Get-Process Inkism -ErrorAction SilentlyContinue | Where-Object {$_.Id -ne $parent.Id -and $_.Path -eq $binary})
        if ($children.Count -eq 1) {
            $child=[System.Diagnostics.Process]::GetProcessById($children[0].Id)
            # Acquire the handle while the child is alive. Waiting only after
            # WM_CLOSE can lose its exit status for an externally found process.
            $child.Handle | Out-Null
            break
        }
        if ($children.Count -gt 1) { throw 'Multiple isolated switch candidates appeared' }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $child) { throw 'No replacement app after native library switch' }
    $script:app = $child
    Wait-LibraryWindow
    Invoke-Element (Find-Element '노트 열기: 암호화 대상 확인')
    Wait-LibraryTitle '암호화 대상 확인'
    $pref = Get-Content -Raw -Encoding UTF8 $libraryPreference | ConvertFrom-Json
    if ($pref.path -ne $libraryFixture.target) { throw 'Switch did not persist the chosen library' }
    Save-Screenshot 'windows-ui-library-switched'
    Close-Inkism
    Verify-Libraries 'verify'
    Open-Inkism $true
    Find-Element '노트 열기: 암호화 대상 확인' | Out-Null
    Close-Inkism
    Write-Output 'PASS: real native plain-to-encrypted library switch, pending input saved, chosen path remembered and reopened'

    $missing = Join-Path $scratch 'missing/notes.db'
    [System.IO.File]::WriteAllText($libraryPreference,(@{path=$missing} | ConvertTo-Json),[System.Text.UTF8Encoding]::new($false))
    $preferenceBefore = [System.IO.File]::ReadAllText($libraryPreference)
    Open-Inkism $true
    Confirm-LibraryRecovery '7'
    if (-not $app.WaitForExit(15000) -or $app.ExitCode -ne 0) { throw 'Recovery decline did not exit cleanly' }
    if (Test-Path $missing) { throw 'Missing library was silently created' }
    if ([System.IO.File]::ReadAllText($libraryPreference) -cne $preferenceBefore) { throw 'Recovery decline changed preference' }
    Write-Output 'PASS: missing-library recovery decline creates no empty replacement and preserves preference'

    Open-Inkism $true
    Confirm-LibraryRecovery '6'
    Select-LibraryFile '복구할 저장소 파일 선택' $db
    Wait-LibraryWindow
    Invoke-Element (Find-Element '노트 열기: 원본 저장소 확인')
    Wait-LibraryTitle '원본 저장소 확인'
    Invoke-Element (Find-Element '텍스트' ([System.Windows.Automation.ControlType]::Button))
    Wait-WindowText 'switch_saved' $true
    $pref = Get-Content -Raw -Encoding UTF8 $libraryPreference | ConvertFrom-Json
    if ($pref.path -ne $db) { throw 'Recovery did not remember the selected original' }
    Save-Screenshot 'windows-ui-library-recovered'
    Close-Inkism
    Verify-Libraries 'verify'
    Open-Inkism $true
    Find-Element '노트 열기: 원본 저장소 확인' | Out-Null
    Close-Inkism
    Write-Output 'PASS: actual startup recovery picker opens existing original, persists preference and survives restart; both library bytes and attachment/key preserved'
} catch {
    if ($null -ne $app -and -not $app.HasExited) {
        try {
            Save-Screenshot 'windows-ui-library-failure'
            $window=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
            $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) |
                ForEach-Object { Write-Output ('LIBRARY OWNED UI: '+$_.Current.ControlType.ProgrammaticName+' '+$_.Current.Name) }
        } catch {}
    }
    throw
} finally {
    # This path is a uniquely allocated test installation, validated above.
    # Catch even a replacement child that failed before being adopted by $app.
    Get-Process Inkism -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $binary} | Stop-Process -Force -ErrorAction SilentlyContinue
}
