# deploy.ps1 — push to GitHub then deploy to Fly.io

Write-Host ""
Write-Host " Pushing to GitHub..." -ForegroundColor Cyan
git add .
git commit -m "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>$null
git push
if ($LASTEXITCODE -ne 0) { Write-Host " Git push failed." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host " Deploying to Fly.io..." -ForegroundColor Cyan
fly deploy --local-only
if ($LASTEXITCODE -ne 0) { Write-Host " Deploy failed." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host " Scaling down to 1 machine..." -ForegroundColor Cyan
fly scale count 1 --yes -a jackpot-ixupbg

# Verify machine is running — restart if stopped
Write-Host ""
Write-Host " Verifying machine is running..." -ForegroundColor Cyan
$maxWait = 30
$waited = 0
$state = ""
do {
    Start-Sleep -Seconds 3
    $waited += 3
    $statusJson = fly status -a jackpot-ixupbg --json 2>$null
    $status = $statusJson | ConvertFrom-Json
    $state = $status.Machines[0].state
    Write-Host "  Machine state: $state" -ForegroundColor Gray
    if ($state -eq "stopped") {
        Write-Host " Machine stopped - starting it..." -ForegroundColor Yellow
        fly machine start $status.Machines[0].id -a jackpot-ixupbg 2>$null
    }
} while ($state -ne "started" -and $waited -lt $maxWait)

if ($state -eq "started") {
    Write-Host " Machine is running." -ForegroundColor Green
} else {
    Write-Host " WARNING: Machine did not reach started state. Check Fly.io dashboard." -ForegroundColor Red
}

Write-Host ""
fly status -a jackpot-ixupbg
Write-Host ""
$liveUrl = "https://jackpot.allaml.ai"
Write-Host " Done. Live at $liveUrl" -ForegroundColor Green
Write-Host ""
Write-Host " Restarting local PM2 server..." -ForegroundColor Cyan
try { pm2 restart ecosystem.config.js --update-env 2>$null; Write-Host " Local server updated." -ForegroundColor Green } catch { Write-Host " Local restart skipped (PM2 not running)." -ForegroundColor Gray }
Write-Host ""
