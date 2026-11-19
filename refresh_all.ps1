# refresh_all.ps1 -- Force refresh all game PDFs on production
# Uses the serialized refresh queue -- jobs run one at a time server-side.
# Polls /refresh/status until each job completes before moving to the next.

$base    = "https://jackpot.allaml.ai"
$today   = (Get-Date).ToString("M/d/yyyy")
$yesterday = (Get-Date).AddDays(-1).ToString("M/d/yyyy")

function Get-LatestDrawDate($endpoint) {
  try {
    $r = Invoke-RestMethod -Uri ($base + $endpoint) -Method GET -TimeoutSec 15
    if ($r.evening) { return $r.evening.date }
    if ($r.midday)  { return $r.midday.date }
    if ($r.date)    { return $r.date }
    return $null
  } catch { return $null }
}

function Expand-Year($d) {
  if (-not $d) { return $null }
  $parts = $d -split "/"
  if ($parts.Count -ne 3) { return $d }
  if ($parts[2].Length -eq 2) { return "$($parts[0])/$($parts[1])/20$($parts[2])" }
  return $d
}

function Wait-ForRefresh($game, $timeoutSecs) {
  $deadline = (Get-Date).AddSeconds($timeoutSecs)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    try {
      $status = Invoke-RestMethod -Uri ($base + "/refresh/status") -Method GET -TimeoutSec 10
      $s = $status.$game
      if ($s) {
        if ($s.state -eq "done")     { return "done" }
        if ($s.state -eq "error")    { return "error: $($s.detail)" }
        if ($s.state -eq "retrying") { Write-Host "`r [ ] $game -- retrying after error...     " -NoNewline -ForegroundColor Yellow }
      }
    } catch {}
  }
  return "timeout"
}

$games = @(
  @{ name = "Jackpot Triple Play"; refresh = "/refresh";          latestdraw = "/latestdraw/jtp";      key = "jtp" },
  @{ name = "Lotto X";             refresh = "/refresh/lottox";   latestdraw = "/latestdraw/lottox";   key = "lottox" },
  @{ name = "Fantasy 5";           refresh = "/refresh/fantasy5"; latestdraw = "/latestdraw/fantasy5"; key = "fantasy5" },
  @{ name = "Cash Pop";            refresh = "/refresh/cashpop";  latestdraw = "/latestdraw/cashpop";  key = "cashpop" }
)

$results = @()

Write-Host ""
Write-Host " Jackpot Analyzer -- Manual PDF Refresh" -ForegroundColor Cyan
Write-Host " ======================================" -ForegroundColor Cyan
Write-Host " Target : $base" -ForegroundColor Gray
Write-Host " Today  : $today" -ForegroundColor Gray
Write-Host ""

foreach ($game in $games) {
  # -- Staleness check --
  Write-Host " [?] $($game.name) -- checking..." -NoNewline -ForegroundColor Gray
  $latestRaw = Get-LatestDrawDate $game.latestdraw
  $latest    = Expand-Year $latestRaw
  $isCurrent = $latest -and ($latest -eq $today -or $latest -eq $yesterday)

  if ($isCurrent) {
    Write-Host "`r [=] $($game.name) -- already current ($latest), skipping.     " -ForegroundColor DarkGreen
    $results += [PSCustomObject]@{ Game = $game.name; Status = "Skipped"; Detail = "Current: $latest"; Secs = 0 }
    continue
  }

  $freshLabel = if ($latest) { "stale: $latest" } else { "unknown" }
  Write-Host "`r [ ] $($game.name) -- $freshLabel, queuing...     " -NoNewline -ForegroundColor Yellow

  # -- Enqueue --
  $start = Get-Date
  try {
    Invoke-RestMethod -Uri ($base + $game.refresh) -Method POST -TimeoutSec 15 | Out-Null
  } catch {
    $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)
    Write-Host "`r [x] $($game.name) -- failed to queue ($($elapsed)s): $($_.Exception.Message)     " -ForegroundColor Red
    $results += [PSCustomObject]@{ Game = $game.name; Status = "Failed"; Detail = $_.Exception.Message; Secs = $elapsed }
    continue
  }

  # -- Poll for completion --
  Write-Host "`r [ ] $($game.name) -- downloading..." -NoNewline -ForegroundColor Yellow
  $outcome = Wait-ForRefresh $game.key 360
  $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)

  if ($outcome -eq "done") {
    # Verify new latest draw date
    $newLatest = Expand-Year (Get-LatestDrawDate $game.latestdraw)
    $detail = if ($newLatest) { "latest: $newLatest" } else { "ok" }
    Write-Host "`r [+] $($game.name) -- done in $($elapsed)s ($detail)     " -ForegroundColor Green
    $results += [PSCustomObject]@{ Game = $game.name; Status = "Refreshed"; Detail = $detail; Secs = $elapsed }
  } elseif ($outcome -like "error:*") {
    Write-Host "`r [!] $($game.name) -- $outcome ($($elapsed)s)     " -ForegroundColor Red
    $results += [PSCustomObject]@{ Game = $game.name; Status = "Error"; Detail = $outcome; Secs = $elapsed }
  } else {
    Write-Host "`r [x] $($game.name) -- timed out after $($elapsed)s     " -ForegroundColor Red
    $results += [PSCustomObject]@{ Game = $game.name; Status = "Timeout"; Detail = "No completion signal in 360s"; Secs = $elapsed }
  }
}

Write-Host ""
Write-Host " Summary" -ForegroundColor Cyan
Write-Host " -------" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$total     = [math]::Round(($results | Measure-Object -Property Secs -Sum).Sum, 2)
$refreshed = ($results | Where-Object { $_.Status -eq "Refreshed" }).Count
$skipped   = ($results | Where-Object { $_.Status -eq "Skipped" }).Count
$failed    = ($results | Where-Object { $_.Status -notin @("Refreshed","Skipped") }).Count

Write-Host " Total time : $($total)s" -ForegroundColor White
Write-Host " Refreshed  : $refreshed  |  Skipped (current): $skipped  |  Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
Write-Host ""
