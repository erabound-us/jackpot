# Jackpot Analyzer — Deployment Guide
# jackpot.allaml.ai via Cloudflare Tunnel + PM2

## Architecture
```
Windows PC
  └─ PM2  →  node server.js  (port 7000, 0.0.0.0)
  └─ cloudflared  →  Cloudflare edge  →  jackpot.allaml.ai
```
No router port forwarding. No static IP required.

---

## Step 1: Install cloudflared (Windows)
Download: https://github.com/cloudflare/cloudflared/releases/latest
Get: `cloudflared-windows-amd64.msi` — installs cloudflared.exe to PATH.

## Step 2: Authenticate
```powershell
cloudflared tunnel login
```
Browser opens → select allaml.ai → authorize.

## Step 3: Create the tunnel
```powershell
cloudflared tunnel create jackpot
```
Note the Tunnel ID shown.

## Step 4: Configure the tunnel
Copy `jackpot-tunnel-config.yml` to:
`C:\Users\Upstairs\.cloudflared\config.yml`

## Step 5: Add DNS record
```powershell
cloudflared tunnel route dns jackpot jackpot.allaml.ai
```

## Step 6: Install PM2
```powershell
npm install -g pm2
npm install -g pm2-windows-startup
pm2-startup install
```

## Step 7: Start everything
```powershell
cd C:\Jackpot
npm start                          # starts PM2
cloudflared tunnel run jackpot     # or: cloudflared service start
```

## Step 8: Configure email (optional)
Edit `email.config.json` (copy from `email.config.example.json`):
```json
{
  "provider": "resend",
  "apiKey": "re_xxxxxxxxxxxxxxxxxxxx",
  "from": "Florida Jackpot Analyzer <noreply@allaml.ai>"
}
```
Or use the Email Settings card in the UI (local mode only).

---

## Useful Commands
```powershell
pm2 status                  # check app status
pm2 logs jackpot            # tail logs
pm2 restart jackpot         # restart server
pm2 save                    # persist after reboot
cloudflared tunnel list     # list tunnels
```

## Logs
`logs/out.log` | `logs/error.log` | `logs/combined.log`

---

## Knowledge Base
Full project docs: `vault/` (open in Obsidian)
Amazon Q prompts: `@jackpot-wiki` | `@jackpot-context`
Steering rules: `.amazonq/rules/project.md`

## Backups
Stable snapshots: `backups/stable-YYYY-MM-DD/`
Current stable: `backups/stable-2025-07-14/`
