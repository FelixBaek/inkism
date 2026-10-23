# Runs only in a fresh library on the bounded, verified test VHD.
function Read-LargeCapture {
    $field=Find-Element '기록할 내용' ([System.Windows.Automation.ControlType]::Edit)
    Click-Element $field
    [InkismInput]::Shortcut(0x41)
    $marker='clipboard-read-'+[guid]::NewGuid()
    Set-TestClipboard $marker
    [InkismInput]::Shortcut(0x43)
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    do {
        $value=[System.Windows.Forms.Clipboard]::GetText()
        if ($value -cne $marker) {return $value}
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Large capture clipboard read timed out'
}
Open-Inkism
Invoke-Element (Find-Element '빠른 기록' ([System.Windows.Automation.ControlType]::Button))
$fullTitle='Disk full capture '+$testID
$fullBody='한글 original '+('X'*262144)
# WebView UIA ValuePattern truncated this long textarea observation near 10,000 chars.
# Use real select/copy to compare all bytes; the engine checks them again later.
$field=Find-Element '기록할 내용' ([System.Windows.Automation.ControlType]::Edit)
Click-Element $field
Set-TestClipboard $fullBody
[InkismInput]::Shortcut(0x56)
$deadline=[DateTime]::UtcNow.AddSeconds(10)
do {
    if ((Read-LargeCapture) -ceq $fullBody) {break}
    if ([DateTime]::UtcNow -ge $deadline) {throw 'Large native capture paste mismatch'}
    Start-Sleep -Milliseconds 50
} while ($true)
Paste-Text (Find-Element '제목 (선택)' ([System.Windows.Automation.ControlType]::Edit)) $fullTitle
& $FillStorage
Invoke-Element (Find-Element '저장하고 열기' ([System.Windows.Automation.ControlType]::Button))
$deadline=[DateTime]::UtcNow.AddSeconds(30)
$observed=$false
while ([DateTime]::UtcNow -lt $deadline) {
    $window=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    foreach($element in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)) {
        if ($element.Current.Name -match 'database or disk is full|disk full|공간.*부족') {$observed=$true;break}
    }
    if ($observed) {break}
    Start-Sleep -Milliseconds 100
}
if (-not $observed) {throw 'Native capture did not display actual storage-full error'}
if ((Read-LargeCapture) -cne $fullBody) {throw 'Failed capture lost its input'}
Save-Screenshot 'windows-ui-disk-full'
Write-Output 'PASS: native storage-full error visible and exact draft retained'
& $ReleaseStorage
Invoke-Element (Find-Element '저장하고 열기' ([System.Windows.Automation.ControlType]::Button))
if (-not (Wait-TabActivated ('노트 탭: '+$fullTitle) 15000)) {throw 'Capture retry did not open saved note'}
$cases.Add([pscustomobject]@{title=$fullTitle;format='text';content=$fullBody})
Close-Inkism
Verify-SourceData
Open-Inkism
if (-not (Wait-TabActivated ('노트 탭: '+$fullTitle) 15000)) {throw 'Recovered capture did not restore after restart'}
Close-Inkism
Verify-SourceData
Write-Output 'PASS: native capture retries after actual disk exhaustion; exact plaintext survives restart'
