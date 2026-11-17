# deploy.ps1 — push to GitHub then deploy to Fly.io

Write-Host ""
Write-Host " Pushing to GitHub..." -ForegroundColor Cyan
git add .
git commit -m "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>$null
git push
if ($LASTEXITCODE -ne 0) { Write-Host " Git push failed." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host " Deploying to Fly.io..." -ForegroundColor Cyan
fly deploy
if ($LASTEXITCODE -ne 0) { Write-Host " Deploy failed." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host " Scaling down to 1 machine..." -ForegroundColor Cyan
fly scale count 1 --yes -a jackpot-ixupbg

Write-Host ""
fly status -a jackpot-ixupbg
Write-Host ""
Write-Host " Done. Live at https://jackpot.allaml.ai" -ForegroundColor Green
Write-Host ""
