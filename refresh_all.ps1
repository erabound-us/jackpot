# refresh_all.ps1 -- Force refresh all game PDFs on production
# Checks each game's latest draw date first -- skips if already current

$base = "https://jackpot.allaml.ai"

# Get today's date and yesterday in ET-friendly format
$today     = (Get-Date).ToString("M/d/yyyy")
$yesterday = (Get-Date).AddDays(-1).ToString("M/d/yyyy")

function Get-LatestDrawDate($endpoint) {
  try {
    $r = Invoke-RestMethod -Uri ($base + $endpoint) -Method GET -TimeoutSec 15
    # Fantasy 5 returns { evening, midday } -- pick whichever is present
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

$games = @(
  @{ name = "Jackpot Triple Play"; refresh = "/refresh";         latestdraw = "/latestdraw/jtp";     drawDays = "Tue/Fri" },
  @{ name = "Lotto X";             refresh = "/refresh/lottox";  latestdraw = "/latestdraw/lottox";  drawDays = "Wed/Sat" },
  @{ name = "Fantasy 5";           refresh = "/refresh/fantasy5";latestdraw = "/latestdraw/fantasy5";drawDays = "Daily" },
  @{ name = "Cash Pop";            refresh = "/refresh/cashpop"; latestdraw = "/latestdraw/cashpop"; drawDays = "Daily (5x)" }
)

$results = @()

Write-Host ""
Write-Host " Jackpot Analyzer -- Manual PDF Refresh" -ForegroundColor Cyan
Write-Host " ======================================" -ForegroundColor Cyan
Write-Host " Target : $base" -ForegroundColor Gray
Write-Host " Today  : $today" -ForegroundColor Gray
Write-Host ""

foreach ($game in $games) {
  # -- Check current data freshness --
  Write-Host " [?] $($game.name) -- checking current data..." -NoNewline -ForegroundColor Gray
  $latestRaw  = Get-LatestDrawDate $game.latestdraw
  $latest     = Expand-Year $latestRaw
  $freshLabel = if ($latest) { "latest draw in PDF: $latest" } else { "could not determine" }

  # Consider data current if latest draw date is today or yesterday
  $isCurrent = $latest -and ($latest -eq $today -or $latest -eq $yesterday)

  if ($isCurrent) {
    Write-Host "`r [=] $($game.name) -- already current ($latest), skipping.     " -ForegroundColor DarkGreen
    $results += [PSCustomObject]@{ Game = $game.name; Status = "Skipped"; Detail = "Already current: $latest"; Secs = 0 }
    continue
  }

  Write-Host "`r [ ] $($game.name) -- stale ($freshLabel), refreshing...     " -NoNewline -ForegroundColor Yellow

  # -- Refresh --
  $start = Get-Date
  try {
    $response = Invoke-RestMethod -Uri ($base + $game.refresh) -Method POST -TimeoutSec 300
    $elapsed  = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)

    if ($response.error) {
      Write-Host "`r [!] $($game.name) -- ERROR ($($elapsed)s): $($response.error)     " -ForegroundColor Red
      $results += [PSCustomObject]@{ Game = $game.name; Status = "Error"; Detail = $response.error; Secs = $elapsed }
    } else {
      $draws   = if ($response.totalDraws) { "$($response.totalDraws) draws" } else { "ok" }
      $updated = if ($response.lastUpdated) { "  | as of: $($response.lastUpdated)" } else { "" }
      Write-Host "`r [+] $($game.name) -- done in $($elapsed)s ($draws)$updated     " -ForegroundColor Green
      $results += [PSCustomObject]@{ Game = $game.name; Status = "Refreshed"; Detail = $draws; Secs = $elapsed }
    }
  } catch {
    $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)
    $msg = $_.Exception.Message
    Write-Host "`r [x] $($game.name) -- FAILED after $($elapsed)s     " -ForegroundColor Red
    Write-Host "     $msg" -ForegroundColor Red
    $results += [PSCustomObject]@{ Game = $game.name; Status = "Failed"; Detail = $msg; Secs = $elapsed }
  }
}

Write-Host ""
Write-Host " Summary" -ForegroundColor Cyan
Write-Host " -------" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$total     = [math]::Round(($results | Measure-Object -Property Secs -Sum).Sum, 2)
$refreshed = ($results | Where-Object { $_.Status -eq "Refreshed" }).Count
$skipped   = ($results | Where-Object { $_.Status -eq "Skipped" }).Count
$failed    = ($results | Where-Object { $_.Status -eq "Failed" -or $_.Status -eq "Error" }).Count

Write-Host " Total time : $($total)s" -ForegroundColor White
Write-Host " Refreshed  : $refreshed  |  Skipped (current): $skipped  |  Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
Write-Host ""
