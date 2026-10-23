# Dot-sourced only in the disposable native runner, after the windowed IME gate.
if ($env:INKISM_TEST_WORKER_PASTE -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY' -or $env:INKISM_TEST_WINDOWED_ONLY -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
    throw 'Native worker clipboard gate requires the isolated runner session'
}
$workerVerifier=Join-Path $PSScriptRoot 'verify-windows-worker-paste.ts'
$priorWorkerWindowed=$windowed
function Verify-WorkerPaste([string]$mode) {
    $output=@(node $workerVerifier $imeEngine $db $imeFixture $mode)
    if($LASTEXITCODE){throw "Native large clipboard source verification failed: $mode"}
    return $output
}
function Focus-WorkerHistoryInput {
    # The restored final internal segment may have no pointer intersection in
    # UIA while its keyboard focus is already active. Preserve the restored
    # caret; use native accessibility focus rather than clicking a guessed area.
    [InkismInput]::ActivateWindow($app.MainWindowHandle)
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    $focused=$false
    $lastBounds=''
    do {
        $field=Find-Element '노트 본문 (리치 텍스트 편집기)'
        if($field.Current.HasKeyboardFocus -and [InkismInput]::GetForegroundWindow() -eq $app.MainWindowHandle){
            $rect=$field.Current.BoundingRectangle
            $bounds=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle).Current.BoundingRectangle
            $focused=$true
            $lastBounds="editor=$rect; window=$bounds; offscreen=$($field.Current.IsOffscreen)"
            if(-not $field.Current.IsOffscreen -and [Math]::Min($rect.Right,$bounds.Right)-[Math]::Max($rect.Left,$bounds.Left) -gt 4 -and [Math]::Min($rect.Bottom,$bounds.Bottom)-[Math]::Max($rect.Top,$bounds.Top) -gt 4){
                Write-Host 'WORKER_HISTORY_FOCUS: native UIA keyboard focus and visible editor intersection confirmed'
                return [InkismIme]::Focus($app.MainWindowHandle)
            }
            # Focus can precede the restored segment's first measured layout.
            # Wait for visibility without moving the caret or reapplying focus.
        }else{
            $field.SetFocus()
        }
        Start-Sleep -Milliseconds 25
    }while([DateTime]::UtcNow -lt $deadline)
    if($focused){throw "Restored worker history editor has no visible pointer intersection after layout deadline: $lastBounds"}
    throw 'Restored worker history editor did not obtain native keyboard focus'
}
function Set-WorkerRichClipboard {
    $text=('P' * (2 * 1024 * 1024))+' NATIVE_PASTE_MARKER'
    $fragment='<p><em>'+$text+'</em></p>'
    $prefix='<html><body><!--StartFragment-->'
    $suffix='<!--EndFragment--></body></html>'
    $format="Version:1.0`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
    $header=$format -f 0,0,0,0
    $startHTML=[Text.Encoding]::UTF8.GetByteCount($header)
    $startFragment=$startHTML+[Text.Encoding]::UTF8.GetByteCount($prefix)
    $endFragment=$startFragment+[Text.Encoding]::UTF8.GetByteCount($fragment)
    $endHTML=$endFragment+[Text.Encoding]::UTF8.GetByteCount($suffix)
    $header=$format -f $startHTML,$endHTML,$startFragment,$endFragment
    $data=New-Object System.Windows.Forms.DataObject
    $data.SetData([System.Windows.Forms.DataFormats]::Html,$header+$prefix+$fragment+$suffix)
    $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText,$text)
    [System.Windows.Forms.Clipboard]::SetDataObject($data,$true)
    if([System.Windows.Forms.Clipboard]::GetText() -cne $text -or -not [System.Windows.Forms.Clipboard]::ContainsData([System.Windows.Forms.DataFormats]::Html)){
        throw 'Native rich clipboard did not retain both HTML and Unicode text'
    }
}
try {
    $windowed=$true
    # The preceding gate leaves the original 10000-block fixture closed.
    Verify-WindowedInput 'original'
    Open-Inkism;Wait-WindowText 'nativeimeblock00000' $true
    $focus=Focus-WindowedInput;$priorLayout=[InkismIme]::Layout($focus)
    $english=$languages|Where-Object{$_.Culture.Name -eq 'en-US'}|Select-Object -First 1
    if(-not $english){throw 'English layout missing for native large clipboard gate'}
    try {
        [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$english.Handle)|Out-Null
        Set-WorkerRichClipboard
        Select-WholeWindowedDocument
        [InkismInput]::Shortcut(0x56)
        Wait-WindowText 'NATIVE_PASTE_MARKER' $true 30
        # Keys may arrive before or after the worker commit. Verify both valid
        # history groupings instead of assuming an unobserved timing boundary.
        [InkismInput]::TypeAscii('_native_follow')
        Wait-WindowText 'NATIVE_PASTE_MARKER_native_follow' $true 30
        Wait-WholeSelectionDone
        if((Read-Field (Find-Element '노트 본문 (리치 텍스트 편집기)')).Length -ge 40000){throw 'Native large paste mounted the full document'}
        Save-Screenshot 'windows-ui-worker-large-paste'
    }finally{[InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$priorLayout)|Out-Null}
    Close-Inkism;Verify-WorkerPaste 'pasted'|Write-Output
    Open-Inkism;Wait-WindowText 'NATIVE_PASTE_MARKER_native_follow' $true
    $focus=Focus-WorkerHistoryInput;Save-Screenshot 'windows-ui-worker-restored'
    [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$english.Handle)|Out-Null
    [InkismInput]::Shortcut(0x5A);Wait-WindowText '_native_follow' $false 30
    # Undo restores the original document selection as part of history. The
    # selection badge may remain; it is not a pending edit. Closing flushes,
    # and the verifier below requires exact original or paste-only bytes.
    Close-Inkism
    $undo=@(Verify-WorkerPaste 'undo');$undoSteps=1
    if($undo -contains 'STATE=paste'){
        Open-Inkism;$focus=Focus-WorkerHistoryInput
        [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$english.Handle)|Out-Null
        [InkismInput]::Shortcut(0x5A);Wait-WindowText 'nativeimeblock00000' $true 30
        Close-Inkism;$undoSteps=2
    }elseif($undo -notcontains 'STATE=original'){throw 'Native clipboard undo verifier returned no exact state'}
    Verify-WorkerPaste 'original'|Write-Output
    Open-Inkism;Wait-WindowText 'nativeimeblock00000' $true
    $focus=Focus-WorkerHistoryInput
    [InkismIme]::SendMessage($focus,0x50,[IntPtr]::Zero,$english.Handle)|Out-Null
    for($step=0;$step -lt $undoSteps;$step++){
        [InkismInput]::Shortcut(0x59)
        if($step -eq $undoSteps-1){Wait-WindowText 'NATIVE_PASTE_MARKER_native_follow' $true 30}
        else{Wait-WindowText 'NATIVE_PASTE_MARKER' $true 30}
        Wait-WholeSelectionDone
    }
    Close-Inkism;Verify-WorkerPaste 'pasted'|Write-Output
    Write-Output "PASS: actual WebView2/system HTML clipboard 2MiB rich paste and native follow-up keys, bounded editor, exact source/marks/search/metadata, restart undo/redo ($undoSteps groups); worker CPU path executes without a UI fallback; not physical human typing"
}finally{$windowed=$priorWorkerWindowed}
