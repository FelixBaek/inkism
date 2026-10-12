# Dot-sourced only by the source UI harness inside its isolated profile/lifecycle.
# Preparing/parsing this file does not interact with Windows.
if ($env:INKISM_TEST_EXTENDED_NATIVE -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
    throw 'Extended native checks require the explicit approved-session marker'
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InkismDisplayEvidence {
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
}
'@
function Cancel-OwnedPicker([string]$title) {
    $condition = [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$title),
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$app.Id))
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    $picker=$null
    do {
        $picker=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
        if($picker){break}; Start-Sleep -Milliseconds 100
    } while([DateTime]::UtcNow -lt $deadline)
    if(-not $picker){throw "Owned native picker not found: $title"}
    $handle=[IntPtr]$picker.Current.NativeWindowHandle
    if($handle -eq [IntPtr]::Zero){throw 'Picker has no native handle; refusing unscoped input'}
    [InkismInput]::SetForegroundWindow($handle) | Out-Null
    if([InkismInput]::GetForegroundWindow() -ne $handle){throw 'Picker is not foreground; no input sent'}
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    do {
        $found=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
        if(-not $found){return}; Start-Sleep -Milliseconds 100
    } while([DateTime]::UtcNow -lt $deadline)
    throw 'Native picker remained open after cancel'
}

Open-Inkism
$window=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
$display=[pscustomobject]@{dpi=[InkismDisplayEvidence]::GetDpiForWindow($app.MainWindowHandle);bounds=$window.Current.BoundingRectangle.ToString();scope='current monitor only; no OS scaling changes'}
$display | ConvertTo-Json | Set-Content (Join-Path $scratch 'display-evidence.json')
Invoke-Element (Find-Element '기기 동기화' ([System.Windows.Automation.ControlType]::Button))
foreach($attempt in 1..2) {
    Invoke-Element (Find-Element '다른 저장소 열기' ([System.Windows.Automation.ControlType]::Button))
    Cancel-OwnedPicker '열 저장소 파일 선택'
    Find-Element '다른 저장소 열기' ([System.Windows.Automation.ControlType]::Button) | Out-Null
}
if($env:INKISM_TEST_ENCRYPTED -ne '1') {
    foreach($attempt in 1..2) {
        Invoke-Element (Find-Element '암호화 사본 만들기' ([System.Windows.Automation.ControlType]::Button))
        Cancel-OwnedPicker '암호화 사본을 보관할 폴더 선택'
        Find-Element '폴더 선택을 취소했습니다.' | Out-Null
    }
} else { Write-Output 'NOT RUN: encrypted-copy picker; available only for plaintext source libraries' }
Invoke-Element (Find-Element '동기화 설정 닫기' ([System.Windows.Automation.ControlType]::Button))
Close-Inkism
Verify-SourceData
Write-Output 'PASS: repeated native library-picker cancel preserves source; plaintext run also cancels encrypted-copy picker'

Open-Inkism
Invoke-Element (Find-Element '분할 편집' ([System.Windows.Automation.ControlType]::Button))
$panel=Find-Element '분할 편집기'
$label='노트 본문 (Markdown 원문 편집기)'
$condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$label)
$field=$panel.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
if(-not $field -or -not (Read-Field $field).Contains('native_typed')){throw 'Split source did not show persisted Markdown bytes'}
Close-Inkism
Verify-SourceData
Open-Inkism
$panel=Find-Element '분할 편집기'
$field=$panel.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
if(-not $field -or -not (Read-Field $field).Contains('native_typed')){throw 'Split workspace did not restore after restart'}
Invoke-Element (Find-Element '분할 닫기' ([System.Windows.Automation.ControlType]::Button))
Invoke-Element (Find-Element '노트 속성 열기' ([System.Windows.Automation.ControlType]::Button))
Find-Element '버전 기록' | Out-Null
Find-Element '전체 버전 기록 보기' ([System.Windows.Automation.ControlType]::Button) | Out-Null
Save-Screenshot 'windows-ui-source-inspector'
# Escape closes the overlay without ambiguous duplicate close-button labels.
[InkismInput]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
if([InkismInput]::GetForegroundWindow() -ne $app.MainWindowHandle){throw 'App foreground lost before inspector dismissal'}
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Close-Inkism
Verify-SourceData
Write-Output 'PASS: split view survives restart; inspector history entry points visible; source bytes unchanged'
Write-Output 'NOT RUN: physical IME, alternate OS DPI, version restore action, split concurrent conflict, attachment UI, missing-library recovery and successful native library switching'
