# Real Win32 input + UI Automation, without browser flags or a test-only application.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InkismInput {
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public MOUSEINPUT mouse; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION value; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint kind);
    static INPUT ScanKey(ushort key, bool up) {
        uint scan=MapVirtualKey(key,4); // MAPVK_VK_TO_VSC_EX retains extended keys.
        if(scan==0)throw new InvalidOperationException("No scan code for test key "+key);
        var input=new INPUT();input.type=1;input.value.keyboard.scan=(ushort)(scan&0xff);
        input.value.keyboard.flags=8u | ((scan&0xff00)!=0?1u:0u) | (up?2u:0u);
        return input;
    }
    public static void Shortcut(ushort key) {
        Shortcut(key,null);
    }
    public static void Shortcut(ushort key, Action acknowledged) {
        var keys=new ushort[]{0x11,key,key,0x11}; var events=new INPUT[4];
        for(int i=0;i<events.Length;i++)events[i]=ScanKey(keys[i],i>=2);
        int size=Marshal.SizeOf(typeof(INPUT));
        if(SendInput(1,new INPUT[]{events[0]},size)!=1)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {
            // Keep Ctrl physically down while the Korean TSF processes A/C/etc.
            // A single instantaneous down/A/up batch can be decoded as Hangul
            // after Ctrl has already been released in the async IME path.
            System.Threading.Thread.Sleep(40);
            if(SendInput(2,new INPUT[]{events[1],events[2]},size)!=2)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            // Under load a fixed 40ms delay still releases Ctrl before TSF
            // consumes the shortcut. Native selection gates acknowledge the
            // actual app response before finally releasing the modifier.
            if(acknowledged!=null)acknowledged();
            else System.Threading.Thread.Sleep(40);
        } finally {
            if(SendInput(1,new INPUT[]{events[3]},size)!=1)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
    public static void TypeAscii(string text) {
        foreach(char ch in text) {
            bool shift=ch=='_' || (ch>='A' && ch<='Z');
            ushort key=ch=='_'?(ushort)0xBD:(ushort)char.ToUpperInvariant(ch);
            var events=new INPUT[shift?4:2];
            for(int i=0;i<events.Length;i++) {
                events[i]=ScanKey(shift && (i==0 || i==3)?(ushort)0x10:key,i>=events.Length/2);
            }
            if(SendInput((uint)events.Length,events,Marshal.SizeOf(typeof(INPUT)))!=events.Length)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("shell32.dll")] private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
    public static string Downloads() {
        var id=new Guid("374DE290-123F-4565-9164-39C4925E467B"); IntPtr path;
        int status=SHGetKnownFolderPath(ref id,0,IntPtr.Zero,out path);
        if(status!=0)Marshal.ThrowExceptionForHR(status);
        try{return Marshal.PtrToStringUni(path);}finally{Marshal.FreeCoTaskMem(path);}
    }
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out RECT rect);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
    public static void ActivateWindow(IntPtr window) {
        if(GetForegroundWindow()==window || SetForegroundWindow(window))return;
        uint process;uint foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out process);
        uint current=GetCurrentThreadId();
        bool attached=foregroundThread!=0 && foregroundThread!=current && AttachThreadInput(current,foregroundThread,true);
        try { SetForegroundWindow(window); }
        finally { if(attached)AttachThreadInput(current,foregroundThread,false); }
        if(GetForegroundWindow()==window)return;
        // Task Scheduler does not grant foreground activation to this runner.
        // Raise only the candidate, then use a real click on its verified title
        // bar. Never deliver input to a window merely occupying its old bounds.
        ShowWindow(window,9);
        SetWindowPos(window,IntPtr.Zero,0,0,0,0,0x0013);
        RECT rect;
        if(!GetWindowRect(window,out rect)||rect.right-rect.left<200||rect.bottom-rect.top<30)return;
        var point=new POINT {x=rect.left+100,y=rect.top+15};
        if(GetAncestor(WindowFromPoint(point),2)!=window)return;
        SetCursorPos(point.x,point.y);
        mouse_event(0x0002,0,0,0,UIntPtr.Zero);
        mouse_event(0x0004,0,0,0,UIntPtr.Zero);
    }
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
}
'@
# UIA bounds are physical pixels. Keep pointer coordinates in the same space
# on scaled or mixed-DPI monitors without changing the user's display settings.
[InkismInput]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$binary = Join-Path $root 'dist/windows/Inkism.exe'
if ($env:INKISM_TEST_BINARY) { $binary = $env:INKISM_TEST_BINARY }
$scratch = Join-Path $env:TEMP ('inkism-ui-' + [guid]::NewGuid())
New-Item -ItemType Directory $scratch | Out-Null
# All default-launch and library-recovery paths must stay in this test profile.
# --db alone does not isolate the remembered library preference.
$previousAppData = $env:APPDATA
$previousLocalAppData = $env:LOCALAPPDATA
$env:APPDATA = Join-Path $scratch 'Roaming'
$env:LOCALAPPDATA = Join-Path $scratch 'Local'
New-Item -ItemType Directory $env:APPDATA, $env:LOCALAPPDATA | Out-Null
$clipboardSnapshot = New-Object System.Windows.Forms.DataObject
$clipboardOriginal = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($null -ne $clipboardOriginal) {
    foreach ($format in $clipboardOriginal.GetFormats($false)) {
        $data = $clipboardOriginal.GetData($format, $false)
        if ($null -ne $data) { $clipboardSnapshot.SetData($format, $false, $data) }
    }
}
$db = Join-Path $scratch '한글 노트.db'
$title = 'Windows 실사용 저장 검사'
$body = '닫기 직전에도 이 문장을 보존합니다'
$app = $null
$launch = 0
$windowed = $false

# Do not depend on PowerShell module discovery in a child Windows PowerShell process.
# GitHub's pwsh environment may expose only PowerShell 7 module paths.
function Get-Sha256([string]$path) {
    $stream = [System.IO.File]::OpenRead($path)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [System.BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '')
    } finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

function Open-Inkism([bool]$remembered = $false) {
    $script:launch++
    # Own the Process handle directly. Windows PowerShell Start-Process
    # -PassThru can lose ExitCode after the GUI has already exited.
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $binary
    $info.Arguments = ''
    if (-not $remembered) { $info.Arguments = '--db "' + $db + '"' }
    if ($windowed) { $info.Arguments += ' --experimental-lazy-editor' }
    # Encrypted runs exercise the Windows default; plaintext coverage opts out.
    if (-not $remembered -and $env:INKISM_TEST_ENCRYPTED -ne '1') { $info.Arguments += ' --create-plaintext' }
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $script:app = New-Object System.Diagnostics.Process
    $app.StartInfo = $info
    if (-not $app.Start()) { throw 'Inkism process could not start' }
    $script:stdoutTask = $app.StandardOutput.ReadToEndAsync()
    $script:stderrTask = $app.StandardError.ReadToEndAsync()
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        $app.Refresh()
        if ($app.HasExited) { throw "Inkism exited during launch ($($app.ExitCode))" }
        if ($app.MainWindowHandle -ne [IntPtr]::Zero) {
            [InkismInput]::ShowWindow($app.MainWindowHandle, 9) | Out-Null
            [InkismInput]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
            return
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'Native Inkism window did not appear'
}
function Find-Element([string]$name, $controlType = $null) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
    if ($null -ne $controlType) {
        $typeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $controlType)
        $condition = [System.Windows.Automation.AndCondition]::new($condition, $typeCondition)
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        $app.Refresh()
        if ($app.HasExited) { throw "Inkism exited while finding $name" }
        try {
            $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
            $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        } catch {
            # WebView startup can invalidate a UIA root between acquisition and
            # traversal. Reacquire this same live process, within the deadline.
            if ($_.Exception.GetBaseException() -isnot [System.Windows.Automation.ElementNotAvailableException]) { throw }
            Start-Sleep -Milliseconds 50
            continue
        }
        if ($null -ne $element) { return $element }
        Start-Sleep -Milliseconds 100
    }
    throw "Accessible element not found: $name"
}
function Wait-BlockNumber([string]$expected) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $field = Find-Element '이동할 블록 번호' ([System.Windows.Automation.ControlType]::Edit)
        $actual = $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
        if ($actual -eq $expected) { return }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Window position mismatch: expected $expected, got $actual"
}
function Wait-WindowText([string]$text, [bool]$present, [int]$timeoutSeconds = 10, [string]$editorName = '노트 본문 (리치 텍스트 편집기)') {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    do {
        $field = Find-Element $editorName
        $pattern = $null
        if ($field.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
            $value = $pattern.Current.Value
        } else {
            $value = $field.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(-1)
        }
        if ($value.Contains($text) -eq $present) { return }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Window text state mismatch: $text expected presence $present"
}
function Wait-TabActivated([string]$name, [int]$timeoutMs = 5000) {
    $expectedTitle = $name.Substring('노트 탭: '.Length)
    $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '노트 제목')
    do {
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
        $titleField = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        $value = $null
        if ($null -ne $titleField -and $titleField.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
            if ($value.Current.Value -eq $expectedTitle) { return $true }
        }
        Start-Sleep -Milliseconds 25
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}
function Invoke-Element($element) {
    # A restored editor can expose its toolbar before history is ready. Wait for
    # the real enabled state; never click around a persistently disabled action.
    $actionName = $element.Current.Name
    $actionType = $element.Current.ControlType
    $enabledDeadline = [DateTime]::UtcNow.AddSeconds(5)
    while (-not $element.Current.IsEnabled) {
        if ([DateTime]::UtcNow -ge $enabledDeadline) { throw "Action stayed disabled: $actionName" }
        Start-Sleep -Milliseconds 25
        $element = Find-Element $actionName $actionType
    }
    # WebView2 may ignore UIA SetFocus on an inactive tab. Prefer real pointer
    # activation, but only inside the intersection with the visible tab strip:
    # offscreen buttons can report nonempty, unclipped bounds.
    if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem) {
        $name = $element.Current.Name
        # WebView2 can expose semantic tab selection even when pointer bounds
        # move during the tab strip's scrollIntoView layout.
        $selection = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) {
            try {
                $selection.Select()
                if (Wait-TabActivated $name 1000) { return }
            } catch { Write-Output ("Tab semantic selection unavailable: " + $_.Exception.Message) }
        }
        $strip = Find-Element '열린 노트'
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            [InkismInput]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
            $rect = $element.Current.BoundingRectangle
            $clip = $strip.Current.BoundingRectangle
            $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle).Current.BoundingRectangle
            $left = [Math]::Max($rect.Left, [Math]::Max($clip.Left, $window.Left))
            $right = [Math]::Min($rect.Right, [Math]::Min($clip.Right, $window.Right))
            $top = [Math]::Max($rect.Top, [Math]::Max($clip.Top, $window.Top))
            $bottom = [Math]::Min($rect.Bottom, [Math]::Min($clip.Bottom, $window.Bottom))
            if ($right - $left -gt 4 -and $bottom - $top -gt 4) {
                [InkismInput]::SetCursorPos([int](($left + $right) / 2), [int](($top + $bottom) / 2)) | Out-Null
                [InkismInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
                [InkismInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
                if (Wait-TabActivated $name 500) { return }
                $element = Find-Element $name
                continue
            }
            $element.SetFocus()
            if ($element.Current.HasKeyboardFocus) {
                [System.Windows.Forms.SendKeys]::SendWait(' ')
                if (Wait-TabActivated $name 500) { return }
            }
            $scrollPattern = $null
            if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scrollPattern)) {
                $scrollPattern.ScrollIntoView()
            }
            Start-Sleep -Milliseconds 50
        } while ([DateTime]::UtcNow -lt $deadline)
        $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
        throw "Tab could not be activated: $name; focused: $($focused.Current.Name); bounds: $rect; strip: $clip"
    }
    # aria-expanded menu triggers may expose ExpandCollapse rather than Invoke.
    # Use the advertised semantic action before falling back to a pointer.
    $expand = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$expand) -and
        $expand.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::LeafNode) {
        if ($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) {
            $expand.Collapse()
        } else {
            $expand.Expand()
        }
        return
    }
    # WebView2 buttons with aria-expanded (and role=tab) can expose a different
    # UIA pattern. Use real pointer input when InvokePattern is unavailable.
    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
    } else {
        $scrollPattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scrollPattern)) {
            $scrollPattern.ScrollIntoView()
        }
        Click-Element $element
    }
}
function Click-Element($element) {
    # A first pointer click can be consumed solely by window activation. Do not
    # send the actual action until the intended app owns the foreground.
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    while ([InkismInput]::GetForegroundWindow() -ne $app.MainWindowHandle) {
        [InkismInput]::ActivateWindow($app.MainWindowHandle)
        if ([DateTime]::UtcNow -ge $deadline) { throw "App could not be activated before clicking: $($element.Current.Name)" }
        Start-Sleep -Milliseconds 25
    }
    $rect = $element.Current.BoundingRectangle
    if ($rect.Width -le 0 -or $rect.Height -le 0) { throw 'Menu item has no visible bounds' }
    $windowBounds = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle).Current.BoundingRectangle
    # A virtualized editor can extend below the visible window. Click the
    # visible intersection instead of the center of its entire content area.
    $left=[Math]::Max($rect.Left,$windowBounds.Left)
    $right=[Math]::Min($rect.Right,$windowBounds.Right)
    $top=[Math]::Max($rect.Top,$windowBounds.Top)
    $bottom=[Math]::Min($rect.Bottom,$windowBounds.Bottom)
    if ($right-$left -le 4 -or $bottom-$top -le 4) { throw "Action has no visible area in the app: $($element.Current.Name)" }
    [InkismInput]::SetCursorPos([int](($left+$right)/2), [int](($top+$bottom)/2)) | Out-Null
    [InkismInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [InkismInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}
function Select-NativeFile([string]$path, [string]$dialogTitle = 'Open') {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        # WebView2's owned picker need not be a direct desktop UIA child.
        # The click opened it in the foreground; inspect that HWND directly.
        $fileDialog = $null
        $foreground = [InkismInput]::GetForegroundWindow()
        if ($foreground -ne [IntPtr]::Zero) {
            $candidate = [System.Windows.Automation.AutomationElement]::FromHandle($foreground)
            if ($candidate.Current.ClassName -eq '#32770' -and $candidate.Current.Name -eq $dialogTitle) {
                $fileDialog = $candidate
                break
            }
        }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($null -eq $fileDialog) { throw 'Native file picker did not open' }
    [InkismInput]::SetForegroundWindow([IntPtr]$fileDialog.Current.NativeWindowHandle) | Out-Null
    # Windows runner uses the English common file dialog: Alt+N targets File name.
    [System.Windows.Forms.SendKeys]::SendWait('%n')
    [System.Windows.Forms.Clipboard]::SetText($path)
    [InkismInput]::Shortcut(0x56)
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
}
# Read-only observations inside the explicitly invoked native UI gate. Never log
# clipboard contents or other applications' UI. This does not alter focus/input.
function Trace-PasteState([string]$phase, $element) {
    try {
        $state = [ordered]@{
            phase = $phase; utc = [DateTime]::UtcNow.ToString('o')
            target = $element.Current.Name
            foregroundMatches = ([InkismInput]::GetForegroundWindow() -eq $app.MainWindowHandle)
            focused = $element.Current.HasKeyboardFocus
            focusable = $element.Current.IsKeyboardFocusable
            enabled = $element.Current.IsEnabled
            bounds = $element.Current.BoundingRectangle.ToString()
            ctrlDown = ([InkismInput]::GetAsyncKeyState(17) -lt 0)
            shiftDown = ([InkismInput]::GetAsyncKeyState(16) -lt 0)
            altDown = ([InkismInput]::GetAsyncKeyState(18) -lt 0)
            clipboardSequence = [InkismInput]::GetClipboardSequenceNumber()
        }
        $value = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
            $state.valueLength = $value.Current.Value.Length
            $state.readOnly = $value.Current.IsReadOnly
        }
        # Do not dereference TextPattern selection ranges for optional tracing.
        # Windows 2022's UIA provider can terminate this process with a native
        # AccessViolation in RawTextRange_GetText while enumerating a range.
        # Required input/content checks below still read the actual field and
        # the engine verifier still compares every persisted byte.
        $line = $state | ConvertTo-Json -Depth 4 -Compress
        Add-Content -LiteralPath (Join-Path $root "dist/windows-ui-input-trace$($env:INKISM_TEST_SCREENSHOT_SUFFIX).jsonl") -Value $line -Encoding UTF8
    } catch { Write-Output ('Input diagnostic unavailable: ' + $_.Exception.Message) }
}
function Set-TestClipboard([string]$text) {
    $deadline=[DateTime]::UtcNow.AddSeconds(3)
    do {
        try {
            [System.Windows.Forms.Clipboard]::SetText($text)
            if ([System.Windows.Forms.Clipboard]::GetText() -ne $text) { throw 'Test clipboard text changed before input' }
            return
        } catch {
            if ([DateTime]::UtcNow -ge $deadline) { throw }
            Start-Sleep -Milliseconds 30
        }
    } while ($true)
}
function Paste-Text($element, [string]$text, [bool]$replaceAll = $true) {
    [InkismInput]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
    # WebView2 UIA focus on contenteditable does not necessarily establish a
    # DOM caret. A real click exercises the same selection path as the user.
    Click-Element $element
    # WebView2 focus crosses processes; pointer delivery does not mean the
    # browser has applied focus yet. Do not send keys to the previous field.
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (-not $element.Current.HasKeyboardFocus) {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Input field did not receive keyboard focus' }
        Start-Sleep -Milliseconds 20
    }
    Set-TestClipboard $text
    if ([System.Windows.Forms.Clipboard]::GetText() -ne $text) { throw 'Native clipboard did not retain the test input' }
    if ([InkismInput]::GetForegroundWindow() -ne $app.MainWindowHandle) { throw 'Foreground changed before native paste' }
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $focused -or $focused.Current.Name -ne $element.Current.Name) { throw 'UIA focused element changed before native paste' }
    Trace-PasteState 'before-select' $element
    if ($replaceAll) { [InkismInput]::Shortcut(0x41) }
    Trace-PasteState 'after-select' $element
    [InkismInput]::Shortcut(0x56)
    Trace-PasteState 'after-paste' $element
    # SendWait does not guarantee another process has consumed the paste.
    # Verify accepted input, not autosave, before changing focus or closing.
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $pattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
            $actual = $pattern.Current.Value
        } else {
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
            $actual = $pattern.DocumentRange.GetText(-1).Trim()
        }
        # An empty trailing paragraph is exposed as a newline by WebView2's
        # ValuePattern. Ignore only that structural suffix for in-block paste;
        # full-field replacement still requires an exact value.
        if ($actual -eq $text -or (-not $replaceAll -and $actual.TrimEnd([char[]]"`r`n") -eq $text)) { return }
        Start-Sleep -Milliseconds 20
    } while ([DateTime]::UtcNow -lt $deadline)
    Trace-PasteState 'paste-timeout' $element
    throw "Native paste was not accepted by the focused field: [$actual]"
}
function Save-Screenshot([string]$name) {
    if ($null -eq $app -or $app.HasExited -or $app.MainWindowHandle -eq [IntPtr]::Zero) { return }
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    $rect = $window.Current.BoundingRectangle
    if ($rect.Width -le 0 -or $rect.Height -le 0) { return }
    $image = New-Object System.Drawing.Bitmap([int]$rect.Width, [int]$rect.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    try {
        # Capture only our HWND. Screen copying can include an overlapping
        # unrelated window even when cropped to the app's bounding rectangle.
        $dc = $graphics.GetHdc()
        try {
            if (-not [InkismInput]::PrintWindow($app.MainWindowHandle, $dc, 2)) {
                throw 'App-only PrintWindow capture failed; no screen fallback'
            }
        } finally { $graphics.ReleaseHdc($dc) }
        $image.Save((Join-Path $root "dist/$name$($env:INKISM_TEST_SCREENSHOT_SUFFIX).png"))
    } finally { $graphics.Dispose(); $image.Dispose() }
}
function Close-Inkism {
    # Already loaded Win32 call avoids launching another shell while autosave
    # runs. WM_CLOSE must flush the final paste before exiting.
    if (-not [InkismInput]::PostMessage($app.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
        throw 'Native WM_CLOSE failed'
    }
    if (-not $app.WaitForExit(15000)) { throw 'Inkism did not finish save and close' }
    if ($app.ExitCode -ne 0) { throw "Inkism close failed ($($app.ExitCode))" }
}
function Source-Field([string]$format) {
    $label = switch ($format) { 'html' { '노트 본문 (HTML 원문 편집기)' } 'markdown' { '노트 본문 (Markdown 원문 편집기)' } default { '노트 본문 (텍스트 원문 편집기)' } }
    return Find-Element $label
}
function Read-Field($element) {
    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { return $pattern.Current.Value }
    return $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(-1)
}
function Wait-SourceMarker([string]$format,[string]$marker,[bool]$present=$true) {
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    do { $actual=Read-Field (Source-Field $format); if($actual.Contains($marker) -eq $present){return}; Start-Sleep -Milliseconds 30 } while([DateTime]::UtcNow -lt $deadline)
    throw "Source input observation failed: format=$format marker presence=$present"
}
function Paste-Source([string]$format,[string]$text,[string]$marker) {
    $element=Source-Field $format
    [InkismInput]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
    Click-Element $element
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    while(-not $element.Current.HasKeyboardFocus){ if([DateTime]::UtcNow -ge $deadline){throw 'Source field focus failed'}; Start-Sleep -Milliseconds 20 }
    Set-TestClipboard $text
    if([System.Windows.Forms.Clipboard]::GetText() -ne $text){throw 'Source clipboard mismatch'}
    if([InkismInput]::GetForegroundWindow() -ne $app.MainWindowHandle){throw 'Source foreground mismatch'}
    Trace-PasteState 'source-before-select' $element
    [InkismInput]::Shortcut(0x41)
    [InkismInput]::Shortcut(0x56)
    Trace-PasteState 'source-after-paste' $element
    # UIA can append structural line breaks or expose only virtualized lines.
    # This is input acknowledgement, not exact-content acceptance. The runtime
    # verifier below requires byte-for-byte content after native close/reopen.
    try { Wait-SourceMarker $format $marker } catch { Trace-PasteState 'source-timeout' $element; throw }
}
function Verify-SourceData {
    [System.IO.File]::WriteAllText($expectedPath,(ConvertTo-Json -InputObject $cases.ToArray() -Depth 5),[System.Text.UTF8Encoding]::new($false))
    node (Join-Path $root 'tools/scripts/verify-source-ui.ts') (Join-Path (Split-Path $binary) 'inkism-engine.exe') $db $expectedPath
    if($LASTEXITCODE){throw 'Source bytes/format/restart verification failed'}
}
function Wait-TestDownload([string]$title,[string]$extension,[DateTime]$since,[scriptblock]$ready = $null) {
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    do {
        $matches=Get-ChildItem -LiteralPath ([InkismInput]::Downloads()) -Filter ($title+'*.'+$extension) -ErrorAction SilentlyContinue | Where-Object {$_.LastWriteTimeUtc -ge $since} | Sort-Object LastWriteTimeUtc -Descending
        foreach($file in $matches){try{
            $bytes=[System.IO.File]::ReadAllBytes($file.FullName)
            # Raw HTML and rendered HTML share a download filename. An old
            # file may still be visible while WebView2 completes its successor.
            # Require this request's actual content before returning a path.
            if($bytes.Length -gt 0 -and ($null -eq $ready -or (& $ready $bytes))){return $file.FullName}
        }catch{}}
        Start-Sleep -Milliseconds 100
    }while([DateTime]::UtcNow -lt $deadline)
    throw "Native download absent: $title.$extension"
}
$cases = New-Object System.Collections.Generic.List[object]
$expectedPath=Join-Path $scratch 'expected-source.json'
$testID=[guid]::NewGuid().ToString('N').Substring(0,10)
try {
    if ($env:INKISM_TEST_EDGE_ONLY -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-edge-input.ps1')
        return
    }
    if ($env:INKISM_TEST_WINDOWED_ONLY -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-windowed-extra.ps1')
        . (Join-Path $PSScriptRoot 'windows-system-ime.ps1')
        return
    }
    if ($env:INKISM_TEST_GOOGLE_ONLY -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-google-extra.ps1')
        return
    }
    if ($env:INKISM_TEST_ATTACHMENT_ONLY -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-attachment-extra.ps1')
        return
    }
    if ($env:INKISM_TEST_LIBRARY_ONLY -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-library-extra.ps1')
        return
    }
    if ($env:INKISM_TEST_HISTORY_ONLY -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-history-extra.ps1')
        return
    }
    Write-Output 'Current native acceptance: visual TEXT saves HTML; HTML/MARKDOWN preserve source.'
    # The shared isolated profile/clipboard/WM_CLOSE harness now covers the
    # default rich note before the two source formats. This is not physical IME.
    Open-Inkism
    Invoke-Element (Find-Element '새 노트 만들기')
    $richTitle='inkism-native-'+$testID+'-rich'
    $richBody='리치검증-'+$testID+' 한글 😀 블록 편집'
    Paste-Text (Find-Element '노트 제목') $richTitle
    Paste-Text (Find-Element '노트 본문 (리치 텍스트 편집기)') $richBody
    Wait-WindowText $richBody $true
    [System.Windows.Forms.SendKeys]::SendWait('^{END}')
    [InkismInput]::TypeAscii('native_typed')
    Wait-WindowText 'native_typed' $true
    [InkismInput]::Shortcut(0x5A)
    Wait-WindowText 'native_typed' $false
    [InkismInput]::Shortcut(0x59)
    Wait-WindowText 'native_typed' $true
    $cases.Add([pscustomobject]@{title=$richTitle;format='html';content='<p>'+$richBody+'native_typed</p>'})
    Close-Inkism
    Verify-SourceData
    Open-Inkism
    Wait-WindowText ($richBody+'native_typed') $true
    Invoke-Element (Find-Element 'HTML' ([System.Windows.Automation.ControlType]::Button))
    Wait-SourceMarker 'html' $richBody
    Invoke-Element (Find-Element '텍스트' ([System.Windows.Automation.ControlType]::Button))
    Wait-WindowText ($richBody+'native_typed') $true
    Save-Screenshot 'windows-ui-rich-text'
    Close-Inkism
    Verify-SourceData
    Write-Output 'PASS: default rich paste/type/undo/redo, immediate close-save/restart and HTML/TEXT views preserve canonical HTML'
    if ($env:INKISM_TEST_RICH_ONLY -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') { return }
    foreach($format in @('html','markdown')) {
        Open-Inkism
        Find-Element '새 노트 만들기' | Out-Null
        if($env:INKISM_TEST_ENCRYPTED -eq '1') {
            if(-not [System.IO.File]::Exists($db+'.storage-key')){throw 'Encrypted source fixture has no key envelope'}
            $stream=[System.IO.File]::Open($db,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
            try{$header=New-Object byte[] 16;if($stream.Read($header,0,16)-ne 16 -or [System.Text.Encoding]::ASCII.GetString($header).StartsWith('SQLite format 3')){throw 'Encrypted source fixture has plaintext/missing header'}}finally{$stream.Dispose()}
        }
        Invoke-Element (Find-Element '새 노트 만들기')
        $title='inkism-native-'+$testID+'-'+$format
        Paste-Text (Find-Element '노트 제목') $title
        # HTML is a view of the new HTML note; only Markdown designates a
        # different source format and therefore asks for explicit confirmation.
        Invoke-Element (Find-Element 'HTML' ([System.Windows.Automation.ControlType]::Button))
        Source-Field 'html' | Out-Null
        if($format -eq 'markdown') {
            Invoke-Element (Find-Element 'MARKDOWN' ([System.Windows.Automation.ControlType]::Button))
            Find-Element '원문 형식 변경' | Out-Null
            Invoke-Element (Find-Element '취소' ([System.Windows.Automation.ControlType]::Button))
            Source-Field 'html' | Out-Null
            Invoke-Element (Find-Element 'MARKDOWN' ([System.Windows.Automation.ControlType]::Button))
            Invoke-Element (Find-Element '형식 변경' ([System.Windows.Automation.ControlType]::Button))
        }
        $marker='원문검증-'+$format
        $content=switch($format){
            'html' { "<h2>$marker</h2>`n<p data-unused=`"preserve`">한글 &amp; &lt;원문&gt;</p>`n<!-- 그대로 보존 -->" }
            'markdown' { "# $marker`n`n**한글**  두 칸`n- 목록`n`n``````txt`n<tag> & raw`n``````" }
            default { "  $marker`n한글 😀 <b>문자 그대로</b>`n`t들여쓰기와  두 칸`n" }
        }
        Paste-Source $format $content $marker
        # A second replacement must not duplicate content. Real ASCII typing
        # separately exercises keyboard delivery, not only the clipboard path.
        Paste-Source $format $content $marker
        [System.Windows.Forms.SendKeys]::SendWait('^{END}')
        [InkismInput]::TypeAscii('native_typed')
        Wait-SourceMarker $format 'native_typed'
        [InkismInput]::Shortcut(0x5A)
        Wait-SourceMarker $format 'native_typed' $false
        [InkismInput]::Shortcut(0x59)
        Wait-SourceMarker $format 'native_typed'
        $content+='native_typed'
        $cases.Add([pscustomobject]@{title=$title;format=$format;content=$content})
        # No autosave wait: the WM_CLOSE path must flush the final input.
        Close-Inkism
        Verify-SourceData
        Open-Inkism
        Find-Element ('노트 탭: '+$title) | Out-Null
        if((Read-Field (Find-Element '노트 제목')) -ne $title){throw 'Active source tab did not restore'}
        Wait-SourceMarker $format 'native_typed'
        $before=[DateTime]::UtcNow
        Invoke-Element (Find-Element '원문 내보내기' ([System.Windows.Automation.ControlType]::Button))
        $extension=switch($format){'html'{'html'}'markdown'{'md'}default{'txt'}}
        $download=Wait-TestDownload $title $extension $before {param([byte[]]$data) [System.Text.Encoding]::UTF8.GetString($data) -ceq $content}
        if([System.IO.File]::ReadAllText($download,[System.Text.Encoding]::UTF8) -cne $content){throw 'Downloaded source differs from canonical content'}
        # Observe preview open/close without silently reinterpreting the source.
        Invoke-Element (Find-Element '미리보기' ([System.Windows.Automation.ControlType]::Button))
        Find-Element '미리보기 · 내보내기' | Out-Null
        Find-Element '저장된 원문의 미리보기' | Out-Null
        $before=[DateTime]::UtcNow
        Invoke-Element (Find-Element '서식 HTML 내보내기' ([System.Windows.Automation.ControlType]::Button))
        $rendered=Wait-TestDownload $title 'html' $before {param([byte[]]$data)
            $text=[System.Text.Encoding]::UTF8.GetString($data)
            $text.Contains($marker) -and $text -match '(?i)<!doctype html|<html' -and $text.TrimEnd().EndsWith('</html>')
        }
        $renderedText=[System.IO.File]::ReadAllText($rendered,[System.Text.Encoding]::UTF8)
        if(-not $renderedText.Contains($marker) -or $renderedText -notmatch '(?i)<!doctype html|<html'){throw 'Rendered HTML export missing source snapshot'}
        if($format -eq 'html') {
            $before=[DateTime]::UtcNow
            Invoke-Element (Find-Element 'PDF 내보내기' ([System.Windows.Automation.ControlType]::Button))
            $pdf=Wait-TestDownload $title 'pdf' $before {param([byte[]]$data) $data.Length -ge 8 -and [System.Text.Encoding]::ASCII.GetString($data,0,5) -eq '%PDF-'}
            $bytes=[System.IO.File]::ReadAllBytes($pdf)
            if($bytes.Length -lt 8 -or [System.Text.Encoding]::ASCII.GetString($bytes,0,5) -ne '%PDF-'){throw 'Native PDF download is invalid'}
        }
        Invoke-Element (Find-Element '미리보기 닫기' ([System.Windows.Automation.ControlType]::Button))
        Wait-SourceMarker $format 'native_typed'
        # Cancel a fresh preview request; regardless of request timing the
        # current canonical source must remain unchanged after dismissal.
        Invoke-Element (Find-Element '미리보기' ([System.Windows.Automation.ControlType]::Button))
        Invoke-Element (Find-Element '미리보기 닫기' ([System.Windows.Automation.ControlType]::Button))
        Wait-SourceMarker $format 'native_typed'
        Save-Screenshot ('windows-ui-source-'+$format)
        Close-Inkism
        Verify-SourceData
        Write-Output ('PASS: '+$format+' native paste/type/undo/redo, close-save/restart, raw/rendered export and preview cancel preserve bytes')
    }
    if ($env:INKISM_TEST_EXTENDED_NATIVE -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-source-extra.ps1')
    }
    if ($env:INKISM_TEST_WINDOWED -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-windowed-extra.ps1')
    }
    if ($env:INKISM_TEST_SYSTEM_IME -eq 'APPROVED_SYNTHETIC_PROFILE_ONLY') {
        . (Join-Path $PSScriptRoot 'windows-system-ime.ps1')
    }
    Write-Output 'PASS: current rich/source native acceptance subset; storage-switch recovery, attachments, reminders, host authentication and large-document native flows are separate pending gates.'
} catch {
    Write-Output ("UI failure: " + $_.Exception.Message)
    Write-Output $_.ScriptStackTrace
    try { Save-Screenshot 'windows-ui-failure' } catch {}
    if ($null -ne $app -and -not $app.HasExited) {
        try {
            $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
            $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
                ForEach-Object {
                    Write-Output ("UI: " + $_.Current.ControlType.ProgrammaticName + ' ' + $_.Current.Name)
                    if ($_.Current.Name -like '* 옵션') {
                        $patterns = ($_.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ', '
                        Write-Output ("UI action patterns: " + $patterns + '; bounds: ' + $_.Current.BoundingRectangle + '; focused: ' + $_.Current.HasKeyboardFocus)
                    }
                }
        } catch {}
    }
    if ($null -ne $app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    foreach ($task in @($stdoutTask, $stderrTask)) {
        if ($null -ne $task -and $task.Wait(2000)) { Write-Output $task.Result }
    }
    throw
} finally {
    if ($null -ne $app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    # User authentication can take minutes. Preserve a clipboard the user changed
    # while signing in instead of restoring the test's earlier snapshot over it.
    if ($env:INKISM_TEST_GOOGLE_ONLY -ne 'APPROVED_SYNTHETIC_PROFILE_ONLY' -or
        ($null -ne $googleClipboardSequence -and [InkismInput]::GetClipboardSequenceNumber() -eq $googleClipboardSequence)) {
        [System.Windows.Forms.Clipboard]::SetDataObject($clipboardSnapshot, $true)
    }
    $env:APPDATA = $previousAppData
    $env:LOCALAPPDATA = $previousLocalAppData
    $resolvedScratch = [System.IO.Path]::GetFullPath($scratch)
    $resolvedTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $resolvedScratch.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($resolvedScratch) -notlike 'inkism-ui-*') {
        throw 'Refusing cleanup outside the isolated UI test directory'
    }
    for ($i = 0; $i -lt 10; $i++) {
        try { Remove-Item -LiteralPath $scratch -Recurse -Force; break }
        catch { Start-Sleep -Milliseconds 200 }
    }
}
