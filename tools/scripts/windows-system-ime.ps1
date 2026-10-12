# Dot-sourced by the native UI gate only inside its isolated profile.
# Uses the installed Windows IME and virtual keys; no pasted Korean or synthetic composition.
if ($env:INKISM_TEST_SYSTEM_IME -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') { throw 'System IME requires approved isolated session' }
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class InkismIme {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential)] public struct INFO {public uint size,flags;public IntPtr active,focus,capture,menuOwner,moveSize,caret;public RECT rect;}
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref INFO info);
 [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 public static void Press(byte key){keybd_event(key,0,0,UIntPtr.Zero);keybd_event(key,0,2,UIntPtr.Zero);}
 public static IntPtr Focus(IntPtr app) {uint pid;var info=new INFO();info.size=(uint)Marshal.SizeOf(typeof(INFO));if(!GetGUIThreadInfo(GetWindowThreadProcessId(app,out pid),ref info)||info.focus==IntPtr.Zero||GetAncestor(info.focus,2)!=app)throw new Exception("IME focus outside the test app");return info.focus;}
 public static IntPtr Layout(IntPtr h){uint pid;return GetKeyboardLayout(GetWindowThreadProcessId(h,out pid));}
}
'@
$languages=@([System.Windows.Forms.InputLanguage]::InstalledInputLanguages)
Write-Output ('SYSTEM_IME_LAYOUTS '+(($languages|ForEach-Object{$_.Culture.Name+':'+$_.Handle.ToInt64().ToString('x')}) -join ','))
$korean=$languages|Where-Object{$_.Culture.Name -eq 'ko-KR'}|Select-Object -First 1
if ($env:INKISM_TEST_WINDOWED_ONLY -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
 . (Join-Path $PSScriptRoot 'windows-windowed-ime.ps1')
 if($env:INKISM_TEST_WORKER_PASTE -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
  . (Join-Path $PSScriptRoot 'windows-worker-paste.ps1')
 }
 return
}
if(-not $korean){Write-Output 'NOT RUN: Korean system IME layout not available';return}
foreach($format in @('text','html','markdown')) {
 Open-Inkism
 Invoke-Element (Find-Element '새 노트 만들기 (Ctrl+N)')
 $imeTitle='inkism-native-'+$testID+'-system-ime-'+$format
 Paste-Text (Find-Element '노트 제목') $imeTitle
 if($format -ne 'text') {
  Invoke-Element (Find-Element 'HTML' ([System.Windows.Automation.ControlType]::Button))
  Source-Field 'html' | Out-Null
  if($format -eq 'markdown') {
   Invoke-Element (Find-Element 'MARKDOWN' ([System.Windows.Automation.ControlType]::Button))
   Invoke-Element (Find-Element '형식 변경' ([System.Windows.Automation.ControlType]::Button))
  }
 }
 $label=switch($format){'text'{'노트 본문 (리치 텍스트 편집기)'}'html'{'노트 본문 (HTML 원문 편집기)'}'markdown'{'노트 본문 (Markdown 원문 편집기)'}}
 $field=Find-Element $label;Click-Element $field
 $focus=[InkismIme]::Focus($app.MainWindowHandle);$previous=[InkismIme]::Layout($focus)
 $toggles=0
 try {
  [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$korean.Handle)|Out-Null
  [InkismIme]::Press(0x15);$toggles++
  Write-Output ('SYSTEM_IME '+$format+' native Hangul-mode key (modern TSF)')
  if([InkismInput]::GetForegroundWindow() -ne $app.MainWindowHandle){throw 'IME foreground changed'}
  [InkismInput]::TypeAscii('rkskek ')
  Start-Sleep -Milliseconds 300
  $first=Read-Field (Find-Element $label)
  if($first.Trim() -eq 'rkskek') {
   [InkismInput]::Shortcut(0x41);[InkismIme]::Press(0x2E)
   [InkismIme]::Press(0x15);$toggles++
   [InkismInput]::TypeAscii('rkskek ')
  }
  Wait-WindowText '가나다' $true 10 $label
  $actual=Read-Field (Find-Element $label)
  if($actual.Trim() -ne '가나다'){throw 'System IME did not produce exact Korean text'}
  Save-Screenshot ('windows-ui-system-ime-'+$format)
 } finally {
  if($toggles%2 -eq 1 -and [InkismInput]::GetForegroundWindow() -eq $app.MainWindowHandle){[InkismIme]::Press(0x15)}
  [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$previous)|Out-Null
 }
 $content=if($format -eq 'text'){'<p>가나다 </p>'}else{'가나다 '}
 $storedFormat=if($format -eq 'text'){'html'}else{$format}
 $cases.Add([pscustomobject]@{title=$imeTitle;format=$storedFormat;content=$content})
 Close-Inkism;Verify-SourceData
 Open-Inkism;Wait-WindowText '가나다' $true 10 $label;Close-Inkism;Verify-SourceData
 Write-Output ('PASS: '+$format+' Windows Korean system IME via native virtual keys, committed Korean bytes, close/restart; not physical human typing')
}
