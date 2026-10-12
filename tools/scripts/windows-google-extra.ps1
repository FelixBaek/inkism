# Actual Google provider; only public config is copied into the isolated profile.
if ($env:INKISM_TEST_GOOGLE_ONLY -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') { throw 'Explicit native Google session required' }
$googleDeadline = [DateTime]::Parse($env:INKISM_TEST_FOREGROUND_UNTIL).ToUniversalTime()
$googleState = Join-Path $root 'dist/google-live-state.json'
$googleBinding = Join-Path $env:APPDATA 'Inkism/google-account.dpapi'
$googleBaseline = Join-Path $scratch 'google-baseline.json'
function Assert-GoogleTime {
    if ([DateTime]::UtcNow.AddSeconds(20) -ge $googleDeadline) { throw 'Foreground authorization expired or too close to expiry' }
}
function Write-GooglePhase([string]$phase) {
    [System.IO.File]::WriteAllText($googleState,(@{phase=$phase;pid=$app.Id;utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json),[System.Text.UTF8Encoding]::new($false))
}
function Google-Element([string]$name) {
    Assert-GoogleTime
    $app.Refresh()
    if ($app.HasExited) { throw 'Google candidate exited' }
    try {
        $window=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
        $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
        return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
    } catch {
        if ($_.Exception.GetBaseException() -isnot [System.Windows.Automation.ElementNotAvailableException]) { throw }
        return $null
    }
}
function Wait-GoogleUnlocked([string]$phase) {
    Write-GooglePhase $phase
    $until=[DateTime]::UtcNow.AddSeconds(195)
    do {
        if (Google-Element '앱 잠그기') { return }
        if (Google-Element 'Google 인증을 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요') { throw 'Actual Google authentication failed; no account success claimed' }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $until)
    throw 'Actual user authentication did not finish before the provider timeout'
}
function Verify-GoogleNote([string]$mode) {
    node (Join-Path $PSScriptRoot 'verify-google-live-note.ts') $mode (Join-Path (Split-Path $binary) 'inkism-engine.exe') $db $googleBaseline
    if ($LASTEXITCODE) { throw 'Google flow changed the synthetic note or encrypted key' }
}
Assert-GoogleTime
$savedConfig=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $previousAppData 'Inkism/google-client.json') | ConvertFrom-Json
if (-not $env:INKISM_TEST_GOOGLE_CLIENT_ID) { throw 'Set INKISM_TEST_GOOGLE_CLIENT_ID to the expected saved public client ID' }
if ($savedConfig.client_id -ne $env:INKISM_TEST_GOOGLE_CLIENT_ID) { throw 'Expected previously saved public registration' }
$googleProfile=Join-Path $env:APPDATA 'Inkism'
New-Item -ItemType Directory -Path $googleProfile | Out-Null
[System.IO.File]::WriteAllText((Join-Path $googleProfile 'google-client.json'),(@{client_id=$savedConfig.client_id}|ConvertTo-Json -Compress),[System.Text.UTF8Encoding]::new($false))
$protectedCredential=Join-Path $previousAppData 'Inkism/google-client-secret.dpapi'
if (Test-Path -LiteralPath $protectedCredential) {
    Copy-Item -LiteralPath $protectedCredential -Destination (Join-Path $googleProfile 'google-client-secret.dpapi')
}
if (Test-Path -LiteralPath $googleBinding) { throw 'Google fixture must start without a binding' }
Open-Inkism
Invoke-Element (Find-Element '새 노트 만들기 (Ctrl+N)')
Paste-Text (Find-Element '노트 제목') 'Google 합성 노트'
$script:googleClipboardSequence = [InkismInput]::GetClipboardSequenceNumber()
Click-Element (Find-Element '노트 본문 (리치 텍스트 편집기)')
[InkismInput]::TypeAscii('google_live_saved')
Wait-WindowText 'google_live_saved' $true
Close-Inkism
Verify-GoogleNote 'baseline'
Open-Inkism
Invoke-Element (Find-Element 'Google 로그인 잠금 설정')
$consent=Find-Element 'Google 계정 연결과 이후 로그인 잠금 사용에 동의합니다.' ([System.Windows.Automation.ControlType]::CheckBox)
Click-Element $consent
Invoke-Element (Find-Element 'Google 로그인으로 잠금 설정')
Wait-GoogleUnlocked 'awaiting-initial-user-login'
if (-not (Test-Path -LiteralPath $googleBinding)) { throw 'Successful UI lacks the protected account binding' }
Save-Screenshot 'windows-ui-google-enrolled'
Write-Output 'PASS: actual Google enrollment, callback and protected binding in an isolated profile'

Assert-GoogleTime
Invoke-Element (Find-Element '앱 잠그기')
Find-Element 'Google로 잠금 해제' | Out-Null
Save-Screenshot 'windows-ui-google-locked'
Close-Inkism
Verify-GoogleNote 'verify'
Open-Inkism
Find-Element 'Google로 잠금 해제' | Out-Null
if (Google-Element '노트 제목') { throw 'Restart exposed the editor before Google authentication' }
Save-Screenshot 'windows-ui-google-restart-locked'
Invoke-Element (Find-Element 'Google로 잠금 해제')
Wait-GoogleUnlocked 'awaiting-restart-user-login'
Find-Element '노트 열기: Google 합성 노트' | Out-Null
Save-Screenshot 'windows-ui-google-restart-unlocked'

# Cancel only after both requested user authentications have completed. The
# canceled browser callback intentionally stops listening and cannot sign in.
Assert-GoogleTime
Invoke-Element (Find-Element '앱 잠그기')
Find-Element 'Google로 잠금 해제' | Out-Null
Invoke-Element (Find-Element 'Google로 잠금 해제')
Invoke-Element (Find-Element 'Google 로그인 취소')
Find-Element 'Google 로그인을 취소했습니다.' ([System.Windows.Automation.ControlType]::Text) | Out-Null
if (Google-Element '앱 잠그기') { throw 'Cancel unexpectedly unlocked the app' }
Write-Output 'PASS: actual login cancel keeps the app locked'
Close-Inkism
Verify-GoogleNote 'verify'
Write-GooglePhase 'pass'
Write-Output 'PASS: real Google enroll/lock/cancel/restart/same-account unlock; original note bytes and storage key preserved'
