# Dot-sourced only by the isolated native UI harness.
if ($env:INKISM_TEST_WINDOWED -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') { throw 'Windowed gate requires the approved isolated session' }
$previousWindowed=$windowed
try {
    $windowed=$true
    $expectedLarge=Join-Path $scratch 'large-expected.json'
    $largeVerifier=Join-Path $PSScriptRoot 'verify-windows-windowed.ts'
    $engineBinary=Join-Path (Split-Path $binary) 'inkism-engine.exe'
    node $largeVerifier $engineBinary $db $expectedLarge seed
    if($LASTEXITCODE){throw 'Windowed seed failed'}
    Open-Inkism
    Find-Element '이동할 블록 번호' | Out-Null
    Paste-Text (Find-Element '이동할 블록 번호') '5001'
    Invoke-Element (Find-Element '이동' ([System.Windows.Automation.ControlType]::Button))
    Wait-BlockNumber '5001'
    Wait-WindowText 'nativeblock05000' $true
    $field=Find-Element '노트 본문 (리치 텍스트 편집기)'
    Click-Element $field
    $focusDeadline=[DateTime]::UtcNow.AddSeconds(5)
    do { $field=Find-Element '노트 본문 (리치 텍스트 편집기)';if($field.Current.HasKeyboardFocus){break};Start-Sleep -Milliseconds 20 }while([DateTime]::UtcNow -lt $focusDeadline)
    if([InkismInput]::GetForegroundWindow() -ne $app.MainWindowHandle -or -not $field.Current.HasKeyboardFocus){throw 'Windowed input focus changed'}
    [InkismInput]::TypeAscii('chunk_typed')
    Wait-WindowText 'chunk_typed' $true
    [InkismInput]::Shortcut(0x5A);Wait-WindowText 'chunk_typed' $false
    [InkismInput]::Shortcut(0x59);Wait-WindowText 'chunk_typed' $true
    Save-Screenshot 'windows-ui-windowed-10000'
    Close-Inkism
    node $largeVerifier $engineBinary $db $expectedLarge verify
    if($LASTEXITCODE){throw 'Windowed exact source verification failed'}
    Open-Inkism
    Wait-WindowText 'chunk_typed' $true
    Close-Inkism
    node $largeVerifier $engineBinary $db $expectedLarge verify
    if($LASTEXITCODE){throw 'Windowed restart verification failed'}
    Write-Output 'PASS native RC7 experimental lazy editor: 10000 blocks, mid-document virtual-key typing/undo/redo, close/restart, all original bytes preserved; single huge block and input pixel latency NOT RUN'
} finally { $windowed=$previousWindowed }
