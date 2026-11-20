<#
.SYNOPSIS
  Fetches the Folio server's newest nightly copy to this PC (docs/server.md, "Nightly copies").

.DESCRIPTION
  Asks the server for /var/backups/folio/last-copy.json, downloads that database copy unless it
  is here already (the server makes none on a night when nothing changed) (to a .partial file, renamed once its size is right), keeps the newest -Keep
  copies, and adds the photographed covers this PC doesn't have yet (covers/own, only added to).
  Every run writes a line to pull-backup.log in -Folder: what it fetched, or why it failed. It
  also says when the server's last copy is older than a day and a half: the timer may have
  stopped. Exit code 1 on failure, so a scheduled task shows it as failed.

  Needs OpenSSH (ssh, scp; part of Windows) and tar (part of Windows), and an SSH key that lets
  -Server in without a password prompt.

.EXAMPLE
  .\pull-backup.ps1 -Folder D:\Backups\Folio
  .\pull-backup.ps1 -Folder D:\Backups\Folio -Install    # also run it every day at 10:00
#>
param(
  [Parameter(Mandatory)] [string] $Folder,
  [string] $Server = 'yusupov',
  [int] $Port = 2708,
  [string] $Remote = '/var/backups/folio',
  [int] $Keep = 14,
  [switch] $Install,
  [string] $At = '10:00'
)
$ErrorActionPreference = 'Stop'
$null = New-Item -ItemType Directory -Force -Path $Folder, (Join-Path $Folder 'db'), (Join-Path $Folder 'covers\own')
$log = Join-Path $Folder 'pull-backup.log'
function Write-Log([string] $line) {
  $text = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $line
  Add-Content -Path $log -Value $text -Encoding utf8
  Write-Host $text
}

if ($Install) {
  $script = $MyInvocation.MyCommand.Path
  $taskArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Folder `"$Folder`" -Server $Server -Port $Port -Keep $Keep"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
  # Run at the next chance when the PC was off at that hour; give up after two hours.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName 'Folio backup pull' -Action $action -Trigger $trigger -Settings $settings `
    -Description "Fetches the Folio server's newest nightly copy to $Folder (log: pull-backup.log there)." -Force | Out-Null
  Write-Log "Scheduled: every day at $At (task 'Folio backup pull'), into $Folder"
}

$ssh = @('-p', $Port, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', $Server)
try {
  # 1. Which copy is the newest.
  $json = & ssh @ssh "cat $Remote/last-copy.json"
  if ($LASTEXITCODE -ne 0 -or -not $json) { throw "couldn't read $Remote/last-copy.json on $Server (ssh exit $LASTEXITCODE)" }
  $last = ($json -join "`n") | ConvertFrom-Json
  $made = [datetime]::Parse($last.made).ToUniversalTime()
  # A night with nothing changed makes no copy, but still says it checked.
  $checked = if ($last.checked) { [datetime]::Parse($last.checked).ToUniversalTime() } else { $made }
  $age = (Get-Date).ToUniversalTime() - $checked
  $stale = if ($age.TotalHours -gt 36) { "; WARNING: the server last checked $([int]$age.TotalHours) hours ago, its nightly timer may have stopped (journalctl -u folio-backup.service)" } else { '' }

  # 2. The database copy, unless it is here already.
  $target = Join-Path $Folder "db\$($last.file)"
  if ((Test-Path $target) -and (Get-Item $target).Length -eq [int64]$last.bytes) {
    $fetched = "already had $($last.file)"
  } else {
    $partial = "$target.partial"
    & scp -q -P $Port -o BatchMode=yes "${Server}:$Remote/db/$($last.file)" $partial
    if ($LASTEXITCODE -ne 0) { throw "scp of $($last.file) failed (exit $LASTEXITCODE)" }
    $size = (Get-Item $partial).Length
    if ($size -ne [int64]$last.bytes) { Remove-Item $partial; throw "$($last.file) arrived with $size bytes, not $($last.bytes)" }
    Move-Item -Force $partial $target
    $fetched = "fetched $($last.file) ($([math]::Round($size / 1MB)) MB)"
  }
  Get-ChildItem (Join-Path $Folder 'db') -Filter 'folio-*.sqlite3.zst' | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item

  # 3. The photographed covers this PC doesn't have yet.
  $coversDir = Join-Path $Folder 'covers\own'
  $have = @{}
  Get-ChildItem $coversDir -File | ForEach-Object { $have[$_.Name] = $_.Length }
  $theirs = & ssh @ssh "cd $Remote/covers/own && find . -maxdepth 1 -type f -printf '%f %s\n'"
  if ($LASTEXITCODE -ne 0) { throw "couldn't list the covers on $Server (ssh exit $LASTEXITCODE)" }
  $missing = @($theirs | Where-Object { $_ } | ForEach-Object { $name, $size = $_ -split ' ', 2; if ($have[$name] -ne [int64]$size) { $name } })
  if ($missing.Count) {
    $tar = Join-Path $Folder 'covers.partial.tar'
    $listFile = Join-Path $Folder 'covers.partial.txt'
    [IO.File]::WriteAllText($listFile, ($missing -join "`n") + "`n")
    # One stream for all of them: the names go in, a tar of those files comes out (through files:
    # a PowerShell pipe would turn the tar into text).
    $p = Start-Process -FilePath 'ssh' -ArgumentList ($ssh + "cd $Remote/covers/own && tar -cf - -T -") `
      -RedirectStandardInput $listFile -RedirectStandardOutput $tar -NoNewWindow -PassThru -Wait
    if ($p.ExitCode -ne 0) { throw "fetching $($missing.Count) covers failed (ssh exit $($p.ExitCode))" }
    & tar -xf $tar -C $coversDir
    if ($LASTEXITCODE -ne 0) { throw "unpacking the covers failed (tar exit $LASTEXITCODE)" }
    Remove-Item $tar, $listFile
    $covers = "$($missing.Count) new covers"
  } else { $covers = 'no new covers' }

  $since = if ($checked -gt $made.AddMinutes(1)) { ", unchanged up to $($checked.ToString('yyyy-MM-dd HH:mm')) UTC" } else { '' }
  Write-Log "OK: $fetched, made $($made.ToString('yyyy-MM-dd HH:mm')) UTC$since; $covers$stale"
  if ($stale) { exit 1 }
} catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  exit 1
}
