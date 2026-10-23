param([Parameter(Mandatory=$true)][string]$Engine, [switch]$NativeUI)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-acceptance-lock.ps1')
$acceptanceLock=Enter-InkismAcceptance
$root=Join-Path $env:TEMP ('inkism-full-'+[guid]::NewGuid())
$vhd=Join-Path $root 'synthetic.vhd'
$attached=$false
try {
    $Engine=[System.IO.Path]::GetFullPath($Engine)
    if (-not (Test-Path -LiteralPath $Engine)) { throw 'Candidate engine missing' }
    New-Item -ItemType Directory $root | Out-Null
    Write-Output "Test-only VHD path (128 MiB maximum): $vhd"
    $create=Join-Path $root 'create.txt'
    @("create vdisk file=`"$vhd`" maximum=128 type=expandable","attach vdisk","exit") | Set-Content -Encoding ASCII $create
    & diskpart.exe /s $create | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'VHD creation/attachment failed' }
    $image=Get-DiskImage -ImagePath $vhd
    if (-not $image.Attached) { throw 'New test VHD is not attached' }
    $attached=$true
    $disk=$image | Get-Disk
    if ($disk.IsBoot -or $disk.IsSystem -or $disk.Size -gt 128MB -or $disk.PartitionStyle -ne 'RAW') { throw 'Refusing to initialize anything except the fresh 128 MiB test VHD' }
    # The disk object comes from this exact newly created image, never a guessed number.
    $disk | Initialize-Disk -PartitionStyle GPT
    $partition=New-Partition -DiskNumber $disk.Number -UseMaximumSize -AssignDriveLetter
    $partition | Format-Volume -FileSystem NTFS -NewFileSystemLabel 'InkismFullTest' -Confirm:$false | Out-Null
    $volume=$partition | Get-Volume
    if ($volume.FileSystemLabel -ne 'InkismFullTest' -or -not $partition.DriveLetter) { throw 'Test volume verification failed' }
    $drive=([string]$partition.DriveLetter)+':\'
    Write-Output "Verified new VHD volume: $drive (disk $($disk.Number))"
    $library=Join-Path $drive 'synthetic-library'
    $manifest=Join-Path $root 'expected.json'
    function Run-Fixture([string]$mode) {
        & node.exe (Join-Path $PSScriptRoot 'verify-windows-disk-full.ts') $mode $Engine $library $manifest
        if ($LASTEXITCODE) { throw "Disk-full fixture $mode failed" }
    }
    Run-Fixture 'seed'
    $filler=Join-Path $drive 'synthetic-filler.bin'
    $stream=[System.IO.File]::Open($filler,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
    $buffer=New-Object byte[] 65536
    $full=$false
    try {
        for($written=0;$written -lt 128MB;$written+=$buffer.Length){
            try {$stream.Write($buffer,0,$buffer.Length);$stream.Flush($true)}
            catch [System.IO.IOException] {if(($_.Exception.HResult -band 0xffff) -notin @(39,112)){throw};$full=$true;break}
        }
    } finally {$stream.Dispose()}
    if (-not $full) { throw 'Did not observe Windows disk-full error on the bounded VHD' }
    Write-Output 'Observed Windows disk-full error on synthetic VHD only'
    Run-Fixture 'fail'
    Write-Output "Removing test-only filler: $filler"
    Remove-Item -LiteralPath $filler
    Run-Fixture 'recover'
    $oldVolume=$env:INKISM_FULL_TEST_VOLUME
    try {$env:INKISM_FULL_TEST_VOLUME=$drive;Run-Fixture 'live'} finally {$env:INKISM_FULL_TEST_VOLUME=$oldVolume}
    if ($NativeUI) {
        $uiDirectory=Join-Path $drive 'native-ui-library'
        $fillStorage={
            $uiFiller=Join-Path $drive 'native-ui-filler.bin'
            $stream=[System.IO.File]::Open($uiFiller,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
            $full=$false
            try {
                $chunk=New-Object byte[] 65536
                for($n=0;$n -lt 128MB;$n+=$chunk.Length){
                    try {$stream.Write($chunk,0,$chunk.Length);$stream.Flush($true)}
                    catch [System.IO.IOException] {if(($_.Exception.HResult -band 0xffff) -notin @(39,112)){throw};$full=$true;break}
                }
            } finally {$stream.Dispose()}
            if (-not $full) {throw 'Native UI test did not observe actual disk exhaustion'}
            Write-Output 'PASS: actual Windows disk-full while native capture is open'
        }
        $releaseStorage={
            $uiFiller=Join-Path $drive 'native-ui-filler.bin'
            Write-Output "Removing verified VHD test-only filler: $uiFiller"
            Remove-Item -LiteralPath $uiFiller
        }
        $previousBinary=$env:INKISM_TEST_BINARY
        $previousEncrypted=$env:INKISM_TEST_ENCRYPTED
        try {
            $env:INKISM_TEST_BINARY=Join-Path (Split-Path $Engine) 'Inkism.exe'
            $env:INKISM_TEST_ENCRYPTED='1'
            & (Join-Path $PSScriptRoot 'test-windows-source-ui.ps1') -DiskFullDirectory $uiDirectory -FillStorage $fillStorage -ReleaseStorage $releaseStorage
        } finally {$env:INKISM_TEST_BINARY=$previousBinary;$env:INKISM_TEST_ENCRYPTED=$previousEncrypted}
    }

} finally {
    try {
        # Requery the exact owned image even if setup failed after attachment.
        if (Test-Path -LiteralPath $vhd) {
            $image=Get-DiskImage -ImagePath $vhd -ErrorAction SilentlyContinue
            if ($image -and $image.Attached) {Write-Output "Detaching test-only VHD: $vhd";Dismount-DiskImage -ImagePath $vhd}
        }
        Write-Output "Preserved test-only evidence and detached VHD: $root"
    } finally {Exit-InkismAcceptance $acceptanceLock}
}
