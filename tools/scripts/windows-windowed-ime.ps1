# Dot-sourced only by the isolated native harness, after InkismIme is loaded.
if ($env:INKISM_TEST_WINDOWED_ONLY -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') { throw 'Windowed IME gate requires an isolated approved session' }
$priorWindowed=$windowed
$imeFixture=Join-Path $scratch 'windowed-ime.json'
$imeVerifier=Join-Path $PSScriptRoot 'verify-windows-windowed-ime.ts'
$imeEngine=Join-Path (Split-Path $binary) 'inkism-engine.exe'
function Verify-WindowedInput([string]$mode) {
 node $imeVerifier $imeEngine $db $imeFixture $mode
 if($LASTEXITCODE){throw "Windowed input data verification failed: $mode"}
}
function Wait-WholeSelectionDone {
 $deadline=[DateTime]::UtcNow.AddSeconds(30)
 $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'선택 취소')
 do {
  $window=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
  if($null -eq $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)){return}
  Start-Sleep -Milliseconds 30
 }while([DateTime]::UtcNow -lt $deadline)
 throw 'Selected offscreen input did not finish'
}
function Assert-WholeSelectionStarted {
 # A Korean IME can consume a malformed Ctrl+A injection as the letter ㅁ.
 # Never send the replacement keys unless the actual app selected the range.
 Find-Element '선택 취소' ([System.Windows.Automation.ControlType]::Button) | Out-Null
}
function Select-WholeWindowedDocument {
 $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'선택 취소')
 $window=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
 if($null -ne $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)){
  throw 'Selection already active before native Ctrl+A'
 }
 # Keep Ctrl held until the editor really reports the new selection. The
 # callback is synchronous; Shortcut finally releases Ctrl even on timeout.
 [InkismInput]::Shortcut(0x41,[Action]{Assert-WholeSelectionStarted})
}
function Focus-WindowedInput {
 $field=Find-Element '노트 본문 (리치 텍스트 편집기)';Click-Element $field
 $deadline=[DateTime]::UtcNow.AddSeconds(5)
 do {
  $field=Find-Element '노트 본문 (리치 텍스트 편집기)'
  if($field.Current.HasKeyboardFocus -and [InkismInput]::GetForegroundWindow() -eq $app.MainWindowHandle){return [InkismIme]::Focus($app.MainWindowHandle)}
  Start-Sleep -Milliseconds 25
 }while([DateTime]::UtcNow -lt $deadline)
 throw 'Windowed native input focus missing'
}
function Wait-KoreanOrEnglishProbe {
 $deadline=[DateTime]::UtcNow.AddSeconds(30)
 do {
  $actual=(Read-Field (Find-Element '노트 본문 (리치 텍스트 편집기)')).Trim()
  if($actual -eq '가나다' -or $actual -eq 'rkskek'){return}
  Start-Sleep -Milliseconds 30
 }while([DateTime]::UtcNow -lt $deadline)
 throw 'IME probe did not receive all native keys'
}
try {
 $windowed=$true
 Verify-WindowedInput 'seed'
 Open-Inkism;Wait-WindowText 'nativeimeblock00000' $true
 $focus=Focus-WindowedInput;$priorLayout=[InkismIme]::Layout($focus)
 $english=$languages|Where-Object{$_.Culture.Name -eq 'en-US'}|Select-Object -First 1
 if(-not $english){throw 'English layout missing for native sequential-key gate'}
 try {
  [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$english.Handle)|Out-Null
  Select-WholeWindowedDocument
  [InkismInput]::TypeAscii('native_typed')
  Wait-WindowText 'native_typed' $true;Wait-WholeSelectionDone
  if((Read-Field (Find-Element '노트 본문 (리치 텍스트 편집기)')).Trim() -ne 'native_typed'){throw 'Successive native keys lost or changed after Ctrl+A'}
  Save-Screenshot 'windows-ui-windowed-selected-typing'
 }finally{[InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$priorLayout)|Out-Null}
 Close-Inkism;Verify-WindowedInput 'typed'
 Open-Inkism;Wait-WindowText 'native_typed' $true
 $focus=Focus-WindowedInput;[InkismInput]::Shortcut(0x5A)
 Wait-WindowText 'nativeimeblock00000' $true;Close-Inkism;Verify-WindowedInput 'original'
 Write-Output 'PASS: native successive ASCII keys replace all 10000 blocks exactly; restart then one undo restores every original byte and metadata'

 if(-not $korean){
  Write-Output 'NOT RUN: selected-range Korean system IME layout not available'
  if($env:INKISM_TEST_REQUIRE_SYSTEM_IME -eq '1'){throw 'Required Korean system IME acceptance was not run'}
  return
 }
 Open-Inkism;Wait-WindowText 'nativeimeblock00000' $true
 $focus=Focus-WindowedInput;$priorLayout=[InkismIme]::Layout($focus);$toggles=0
 try {
  [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$korean.Handle)|Out-Null
  [InkismIme]::Press(0x15);$toggles++
  Select-WholeWindowedDocument;[InkismInput]::TypeAscii('rkskek ')
  Wait-KoreanOrEnglishProbe;Wait-WholeSelectionDone
  $actual=(Read-Field (Find-Element '노트 본문 (리치 텍스트 편집기)')).Trim()
  if($actual -eq 'rkskek'){
   # An initially Hangul-enabled layout was toggled to English. Undo the entire
   # probe before retrying, so one undo of the real Korean word restores 10k.
   [InkismInput]::Shortcut(0x5A);Wait-WindowText 'nativeimeblock00000' $true
   [InkismIme]::Press(0x15);$toggles++
   Select-WholeWindowedDocument;[InkismInput]::TypeAscii('rkskek ')
   Wait-KoreanOrEnglishProbe;Wait-WholeSelectionDone
  }
  Wait-WindowText '가나다' $true
  if((Read-Field (Find-Element '노트 본문 (리치 텍스트 편집기)')).Trim() -ne '가나다'){throw 'Selected-range system IME did not produce exact Korean word'}
  Save-Screenshot 'windows-ui-windowed-selected-system-ime'
 }finally{
  if($toggles%2 -eq 1 -and [InkismInput]::GetForegroundWindow() -eq $app.MainWindowHandle){[InkismIme]::Press(0x15)}
  [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$priorLayout)|Out-Null
 }
 Close-Inkism;Verify-WindowedInput 'committed'
 Open-Inkism;Wait-WindowText '가나다' $true
 $focus=Focus-WindowedInput;[InkismInput]::Shortcut(0x5A)
 Wait-WindowText 'nativeimeblock00000' $true;Close-Inkism;Verify-WindowedInput 'original'
 Write-Output 'PASS: Windows Korean system IME virtual keys replace 10000 selected blocks exactly; small-result restart then one undo restores original bytes and metadata; not physical human typing'
}finally{$windowed=$priorWindowed}
