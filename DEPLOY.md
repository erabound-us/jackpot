# Jackpot Analyzer — Deployment Guide

## Architecture
```
Browser → jackpot.allaml.ai → Fly.io (Docker, node server.js, port 8080)
```
- Hosted on Fly.io, app name `jackpot-ixupbg`, region `iad`
- Docker image built from `Dockerfile` (node:22-alpine)
- PDFs downloaded at runtime on first `/analyze` call each day — not baked into image
- No cloudflared tunnel in production (previous architecture, now obsolete)

---

## Deploying

```powershell
cd C:\Jackpot
.\deploy.ps1
```

This runs `git push` then `fly deploy` and scales to 1 machine. Done.

---

## Secrets (environment variables on Fly.io)

`email.config.json` is excluded from Docker. Email is configured via Fly secret:

```powershell
fly secrets set EMAIL_API_KEY=re_xxxxxxxxxxxxxxxxxxxx -a jackpot-ixupbg
fly secrets set EMAIL_FROM="Florida Jackpot Analyzer <noreply@allaml.ai>" -a jackpot-ixupbg
```

No redeploy needed — Fly restarts the machine automatically when secrets are updated.

To verify:
```powershell
fly secrets list -a jackpot-ixupbg
```

---

## Useful Fly.io Commands

```powershell
fly status -a jackpot-ixupbg          # machine status
fly logs -a jackpot-ixupbg            # tail live logs
fly ssh console -a jackpot-ixupbg     # shell into running container
fly deploy                             # redeploy current code
fly secrets list -a jackpot-ixupbg    # list secrets
fly secrets set KEY=value -a jackpot-ixupbg
```

---

## Local Development

```powershell
cd C:\Jackpot
.\start_jackpot.ps1     # starts PM2 on port 7000
```

Local runs on `http://localhost:7000`. Email uses `email.config.json` locally.
PM2 is local-only — Fly.io runs `node server.js` directly.

---

## Files

| File | Purpose |
|------|---------|
| `fly.toml` | Fly.io app config (port 8080, region iad, 1 machine) |
| `Dockerfile` | Docker image definition |
| `.dockerignore` | Excludes `email.config.json`, PDFs, logs, backups, vault |
| `deploy.ps1` | One-command deploy: git push + fly deploy |
| `ecosystem.config.js` | PM2 config for local dev (port 7000) |
| `start_jackpot.ps1` | Local dev startup script |

---

## Knowledge Base
Full project docs: `vault/` (open in Obsidian)
Amazon Q prompts: `@jackpot-wiki` | `@jackpot-context`
Steering rules: `.amazonq/rules/project.md`

## Backups
Stable snapshots: `backups/stable-YYYY-MM-DD/`
