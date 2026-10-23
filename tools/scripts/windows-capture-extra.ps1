# Native quick capture in the shared disposable profile. No real user notes.
Open-Inkism
Invoke-Element (Find-Element '빠른 기록' ([System.Windows.Automation.ControlType]::Button))
$captureTitle='Windows 빠른 기록 '+$testID
$captureBody="  한글 <p>문자 그대로</p>`n둘째 줄 😀  "
Paste-Text (Find-Element '기록할 내용' ([System.Windows.Automation.ControlType]::Edit)) $captureBody
Paste-Text (Find-Element '제목 (선택)' ([System.Windows.Automation.ControlType]::Edit)) $captureTitle
Paste-Text (Find-Element '태그 (쉼표로 구분)' ([System.Windows.Automation.ControlType]::Edit)) 'native, 기록, native'
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
[System.Windows.Forms.SendKeys]::SendWait('^+n')
if ((Read-Field (Find-Element '기록할 내용' ([System.Windows.Automation.ControlType]::Edit))) -cne $captureBody) { throw 'Capture body lost after native Escape/shortcut reopen' }
if ((Read-Field (Find-Element '제목 (선택)' ([System.Windows.Automation.ControlType]::Edit))) -cne $captureTitle) { throw 'Capture title lost after reopen' }
Invoke-Element (Find-Element '저장하고 열기' ([System.Windows.Automation.ControlType]::Button))
if (-not (Wait-TabActivated ('노트 탭: '+$captureTitle) 10000)) { throw 'Native captured note did not open' }
$cases.Add([pscustomobject]@{title=$captureTitle;format='text';content=$captureBody})
Close-Inkism
Verify-SourceData
Open-Inkism
if (-not (Wait-TabActivated ('노트 탭: '+$captureTitle) 10000)) { throw 'Captured note did not restore after restart' }
Save-Screenshot 'windows-ui-quick-capture'
Close-Inkism
Verify-SourceData
Write-Output 'PASS: native quick capture input, Escape/reopen shortcut, save/open and exact plaintext after restart'
