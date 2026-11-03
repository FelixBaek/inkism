# Native new-note input in the shared disposable profile. No real user notes.
Open-Inkism
New-TestNote
$captureTitle='Windows 새 노트 '+$testID
$captureBody="<p>  한글 &lt;p&gt;문자 그대로&lt;/p&gt;</p>`n<p>둘째 줄 😀  </p>"
Paste-Text (Find-Element '노트 제목') $captureTitle
Invoke-Element (Find-Element 'HTML' ([System.Windows.Automation.ControlType]::Button))
Paste-Source 'html' $captureBody '둘째 줄'
if ((Read-Field (Find-Element '노트 제목')) -cne $captureTitle) { throw 'New note title lost before close' }
$cases.Add([pscustomobject]@{title=$captureTitle;format='html';content=$captureBody})
# No autosave wait: the WM_CLOSE path must flush the final input.
Close-Inkism
Verify-SourceData
Open-Inkism
if (-not (Wait-TabActivated ('노트 탭: '+$captureTitle) 10000)) { throw 'New note did not restore after restart' }
Save-Screenshot 'windows-ui-new-note'
Close-Inkism
Verify-SourceData
Write-Output 'PASS: native new-note input, close-save and exact HTML source after restart'
