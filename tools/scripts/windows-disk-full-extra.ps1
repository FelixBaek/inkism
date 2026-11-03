# Runs only in a fresh library on the bounded, verified test VHD.
function Read-LargeSource {
    Click-Element (Source-Field 'html')
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
    throw 'Large source clipboard read timed out'
}
function Find-StorageFullError {
    $window=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    foreach($element in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)) {
        if ($element.Current.Name -match 'database or disk is full|disk full|공간.*부족') {return $true}
    }
    return $false
}
Open-Inkism
New-TestNote
$fullTitle='Disk full note '+$testID
$fullBody='<p>한글 original '+('X'*262144)+'</p>'
Paste-Text (Find-Element '노트 제목') $fullTitle
Invoke-Element (Find-Element 'HTML' ([System.Windows.Automation.ControlType]::Button))
Source-Field 'html' | Out-Null
& $FillStorage
# WebView UIA ValuePattern truncates long fields near 10,000 chars.
# Use real select/copy to compare all bytes; the engine checks them again later.
Paste-Source 'html' $fullBody '한글 original'
$deadline=[DateTime]::UtcNow.AddSeconds(30)
$observed=$false
while ([DateTime]::UtcNow -lt $deadline) {
    if (Find-StorageFullError) {$observed=$true;break}
    Start-Sleep -Milliseconds 100
}
if (-not $observed) {throw 'Native editor did not display actual storage-full error'}
if ((Read-LargeSource) -cne $fullBody) {throw 'Failed save lost its input'}
Save-Screenshot 'windows-ui-disk-full'
Write-Output 'PASS: native storage-full error visible and exact draft retained'
& $ReleaseStorage
Invoke-Element (Find-Element '다시 저장' ([System.Windows.Automation.ControlType]::Button))
$deadline=[DateTime]::UtcNow.AddSeconds(15)
while (Find-StorageFullError) {
    if ([DateTime]::UtcNow -ge $deadline) {throw 'Retry did not clear the storage-full error'}
    Start-Sleep -Milliseconds 100
}
$cases.Add([pscustomobject]@{title=$fullTitle;format='html';content=$fullBody})
Close-Inkism
Verify-SourceData
Open-Inkism
if (-not (Wait-TabActivated ('노트 탭: '+$fullTitle) 15000)) {throw 'Recovered note did not restore after restart'}
Close-Inkism
Verify-SourceData
Write-Output 'PASS: native editor retries after actual disk exhaustion; exact HTML source survives restart'
