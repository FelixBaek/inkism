# Installer process management and UI automation share one Windows desktop.
# Fail immediately rather than letting concurrent acceptance corrupt evidence.
function Enter-InkismAcceptance {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mutex = New-Object System.Threading.Mutex($false, ('Global\InkismAcceptance-' + $sid))
    $acquired = $false
    try {
        try { $acquired = $mutex.WaitOne(0) }
        catch [System.Threading.AbandonedMutexException] { $acquired = $true }
        if (-not $acquired) { throw 'Another Inkism Windows acceptance is running for this user; run installer and native UI checks sequentially.' }
        return $mutex
    } catch { $mutex.Dispose(); throw }
}
function Exit-InkismAcceptance($mutex) {
    try { $mutex.ReleaseMutex() } finally { $mutex.Dispose() }
}
