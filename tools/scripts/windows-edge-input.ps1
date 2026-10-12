$engineBinary=Join-Path (Split-Path $binary) 'inkism-engine.exe'
$fixture=Join-Path $scratch 'edge.json'
node (Join-Path $PSScriptRoot 'verify-windows-windowed-ime.ts') $engineBinary $db $fixture seed
if($LASTEXITCODE){throw 'Edge fixture failed'}
function Click-Paragraph([string]$text) {
 $paragraph=Find-Element ($text+' original paragraph') ([System.Windows.Automation.ControlType]::Text)
 Click-Element $paragraph
 $field=Find-Element '노트 본문 (리치 텍스트 편집기)'
 if(-not $field.Current.HasKeyboardFocus){throw 'Editor did not receive click focus'}
}
Open-Inkism
Wait-WindowText 'nativeimeblock00004' $true
# Select English only for the isolated test application.
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class EdgeLayout {
 [DllImport("user32.dll")] public static extern IntPtr LoadKeyboardLayout(string id,uint flags);
 [DllImport("user32.dll")] public static extern bool UnloadKeyboardLayout(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
}
'@
$english=[System.Windows.Forms.InputLanguage]::InstalledInputLanguages | Where-Object {$_.Culture.Name -eq 'en-US'} | Select-Object -First 1
$loadedEnglish=$null
if(-not $english){$english=[pscustomobject]@{Handle=[EdgeLayout]::LoadKeyboardLayout('00000409',0)};$loadedEnglish=$english.Handle}
if($english.Handle -eq [IntPtr]::Zero){throw 'English test layout could not load'}
try {
[EdgeLayout]::SendMessage($app.MainWindowHandle,0x50,[IntPtr]::Zero,$english.Handle)|Out-Null
Click-Paragraph 'nativeimeblock00004'
[System.Windows.Forms.SendKeys]::SendWait('^{HOME}')
[InkismInput]::TypeAscii('edge_start')
Wait-WindowText 'edge_start' $true
Close-Inkism
node (Join-Path $PSScriptRoot 'verify-windows-edge-input.ts') $engineBinary $db $fixture start
if($LASTEXITCODE){throw 'Ctrl+Home exact source failed'}
Open-Inkism
Paste-Text (Find-Element '이동할 블록 번호') '9969'
Invoke-Element (Find-Element '이동' ([System.Windows.Automation.ControlType]::Button))
Wait-WindowText 'nativeimeblock09968' $true
[EdgeLayout]::SendMessage($app.MainWindowHandle,0x50,[IntPtr]::Zero,$english.Handle)|Out-Null
Click-Paragraph 'nativeimeblock09968'
[System.Windows.Forms.SendKeys]::SendWait('^{END}')
[InkismInput]::TypeAscii('edge_end')
Wait-WindowText 'edge_end' $true
Close-Inkism
node (Join-Path $PSScriptRoot 'verify-windows-edge-input.ts') $engineBinary $db $fixture both
if($LASTEXITCODE){throw 'Ctrl+End exact source failed'}
Open-Inkism
Wait-WindowText 'edge_end' $true
Close-Inkism
node (Join-Path $PSScriptRoot 'verify-windows-edge-input.ts') $engineBinary $db $fixture both
if($LASTEXITCODE){throw 'Edge restart source failed'}
Write-Output 'PASS: Windows WebView2 click, immediate Ctrl+Home/End typing, close-save and restart'

} finally {
 if($null -ne $loadedEnglish){[EdgeLayout]::UnloadKeyboardLayout($loadedEnglish)|Out-Null}
}
