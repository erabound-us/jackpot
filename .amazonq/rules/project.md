# Jackpot Analyzer — Project Steering Rules

## Stack
- **Backend**: Node.js + Express 5, single file `server.js` (~1,900 lines)
- **Frontend**: `public/index.html`, vanilla JS, no framework, no bundler (~1,750 lines)
- **Hosting**: Fly.io — app `jackpot-ixupbg`, region `iad`, port `8080`, `shared-cpu-1x` 512MB
- **Deploy**: `deploy.ps1` → `git push` + `fly deploy` (Docker via `Dockerfile`) + restarts local PM2
- **Node heap**: `--max-old-space-size=192` set in Dockerfile CMD
- **Local dev only**: PM2 (`ecosystem.config.js`) on port 7000; `start_jackpot.ps1` to start
- **Email**: Resend API — `email.config.json` locally (never commit, never in Docker); on Fly.io set via `fly secrets set EMAIL_API_KEY=re_xxx -a jackpot-ixupbg`

## Architecture
```
Browser → jackpot.allaml.ai → Fly.io (Docker, node server.js, port 8080)
```
- PDFs are downloaded at runtime by the server; **all games now refresh via `schedulePostDrawRefreshes()` — 5 minutes after each draw on the game's schedule**. The `ensureDailyRefresh` guards on `/analyze` routes remain as a safety fallback only.
- No cloudflared tunnel in production — that was a previous architecture, now obsolete
- `jackpot-tunnel-config.yml` and `start_jackpot.ps1` are local-only dev tools

## Coding Standards
- Keep all backend logic in `server.js` — no module splitting unless >1500 lines
- Keep all frontend in `public/index.html` — no build tools, no npm frontend deps
- Vanilla JS only in the browser (no React, Vue, TypeScript)
- Minimize comments; write self-documenting code
- Dark theme CSS vars: `--bg:#0f1117` `--card:#1a1d27` `--accent:#4f8ef7` `--yellow:#f59e0b`
- Avoid Unicode bullet/arrow chars (•, →, ×) in JS string literals — use plain ASCII (--, x) to prevent Node.js parse issues

## Games
### Game 1: Jackpot Triple Play
- 6 numbers from 1–46, 3 lines per $1 ticket
- **Only line 1 can be player-selected** — lines 2 & 3 are always Quick Pick
- Draws: Tuesday & Friday 11:15 PM ET; sales close 10:55 PM ET
- Jackpot: $250K start (25-yr annuity); rolldown when pool reaches estimated cash equivalent of $2M annuity
- Combo add-on: +$1, fixed prizes on total matches across all 3 lines (duplicate numbers count separately)
- Tickets can be canceled within 2 hours of purchase, not after 10:55 PM; Combo tickets cannot be canceled

### Official JTP Odds (per line)
| Match | Odds |
|-------|------|
| 6 of 6 | 1 in 3,122,273 |
| 5 of 6 | 1 in 13,009 |
| 4 of 6 | 1 in 267 |
| 3 of 6 | 1 in 16.14 |
| Any prize | 1 in 15.24 |

### Combo Prize Table
| Total Matches | Prize |
|--------------|-------|
| 10+ | $10,000 |
| 9 | $500 |
| 8 | $50 |
| 7 | $20 |
| 6 | $10 |
| 5 | $5 |
| 4 | Free $2 Combo Quick Pick |

> Combo sort MUST use `parseInt()` comparison — string comparison breaks the 10+ tier.

### Game 2: Fantasy 5
- 5 numbers from 1–36, 1 line per $1 ticket
- Draws: **every day** at 1:05 PM ET (Midday) and 11:15 PM ET (Evening); sales close ~12:45 PM ET (Midday) and 10:55 PM ET (Evening)
- Jackpot: pari-mutuel, rolls until won (~$200K starting)
- EZMatch add-on: +$1, instant-win prizes $2–$500, odds 1 in 4.71, claim within 180 days; EZMatch tickets cannot be canceled
- Advance Play: up to 30 consecutive days (60 drawings if both draws selected); continuation ticket issued if win claimed early
- Cancellation: within 2 hours of purchase, not after sales cutoff; EZMatch and free Quick Pick prize tickets cannot be canceled

### Official Fantasy 5 Odds (per ticket)
| Match | Odds |
|-------|------|
| 5 of 5 | 1 in 376,992 |
| 4 of 5 | 1 in 2,432 |
| 3 of 5 | 1 in 81.07 |
| 2 of 5 | 1 in 8.39 |
| Any prize | 1 in 7.61 |

### Fantasy 5 Prize Table
| Match | Prize |
|-------|-------|
| 5 of 5 | Jackpot (pari-mutuel) |
| 4 of 5 | ~$500 |
| 3 of 5 | ~$10 |
| 2 of 5 | Free Quick Pick ticket |

### Game 3: Lotto X (Florida Lotto)
- 6 numbers from 1–53, 1 line per $2 ticket
- Draws: Wednesday & Saturday 11:15 PM ET; sales close 10:55 PM ET
- Jackpot rolls until won (no cap); pari-mutuel
- Multiplier: random **2×, 3×, 4×, 5×, or 10×** printed on every ticket at purchase
  - Applies to 2nd, 3rd, 4th prizes only (5-of-6, 4-of-6, 3-of-6)
  - Does NOT apply to jackpot or free ticket
- Frequency computed from history PDF (no separate freq PDF); pool top 35 of 53

### Official Lotto X Prizes & Odds
| Match | Starting Prize | Multiplied | Odds |
|-------|---------------|-----------|------|
| 6 of 6 | Jackpot | No | 1 in 22,957,480 |
| 5 of 6 | $3,000 | Yes | 1 in 81,409 |
| 4 of 6 | $50 | Yes | 1 in 1,415 |
| 3 of 6 | $5 | Yes | 1 in 70.79 |
| 2 of 6 | Free Ticket | No | 1 in 8.58 |
| Any prize | — | — | 1 in 7.61 |

### Lotto X Add-ons
- **EZMatch (+$1)**: 6 instant-win numbers on ticket; prizes $2–$500; odds 1 in 4.71; claim within 180 days; not available on Jackpot Combo
- **Double Play (+$1)**: same 6 numbers + multiplier in separate draw; top prize $250,000 fixed (not multiplied); 5-of-6 = $3,500×mult; 4-of-6 = $60×mult; 3-of-6 = $7×mult; 2-of-6 = Free Ticket; odds 1 in 7.61
- **Jackpot Combo ($9)**: bundle of FL Lotto ($2) + Powerball ($2) + Mega Millions ($5); no EZMatch; no Advance Play

### Multiplier Odds
| Multiplier | Odds |
|-----------|------|
| 10× | 1 in 26.00 |
| 5× | 1 in 8.67 |
| 4× | 1 in 5.20 |
| 3× | 1 in 3.25 |
| 2× | 1 in 2.89 |

### Game 4: Cash Pop
- Pick 1–15 numbers from 1–15; play amount $1/$2/$5/$10 per number
- Prize multiplier (5×–250×) printed on ticket at purchase; prize = play amount × multiplier
- 5 draws every day: Morning 7:29 AM, Matinee 11:29 AM, Afternoon 2:29 PM, Evening 6:29 PM, Late Night 10:29 PM ET
- Sales close ~5 minutes before each draw
- No add-ons

## Scoring Algorithm
- Frequency 40 pts | Recency (last 50 draws) 20 pts | Pair co-occurrence 15 pts
- Low/high balance 5 pts | Spread 10 pts
- JTP pool: top 30 of 46; balance midpoint ≤23; spread /45
- Lotto X pool: top 35 of 53; balance midpoint ≤26; spread /52
- Fantasy 5 pool: top 28 of 36; balance midpoint ≤18; spread /35; ideal 2 low / 3 high (5 numbers)
- 5000+ candidates; diversity filter (max 3 shared numbers between selected lines)
- Session dedup: seen lines penalized –30 pts

## Ticket Cost Structure (Estimated)
All costs are based on the known Florida Lottery price structure and are **subject to change**. Always confirm at the retailer. The cost estimator in the UI and the chatbot both use these values.

| Game | Base Cost | Add-ons |
|------|-----------|---------|
| Jackpot Triple Play | $1 per ticket (3 lines) | Combo +$1/ticket |
| Lotto X (Florida Lotto) | $2 per ticket (1 line) | EZMatch +$1, Double Play +$1 |
| Fantasy 5 | $1 per ticket (1 line) | EZMatch +$1 |
| Cash Pop | $1/$2/$5/$10 per number | None |

### Cost Estimator Rules
- **JTP**: tickets = `ceil(lines / 3)`; total = tickets × $1 (+ $1 per ticket if Combo)
- **Lotto X**: tickets = lines; total = tickets × $2 (+ $1 per ticket per add-on selected)
- **Fantasy 5**: tickets = lines; total = tickets × $1 (+ $1 per ticket if EZMatch)
- **Cash Pop**: total = numbers × play amount ($1/$2/$5/$10)
- Estimator shown in UI above the Generate button, updates live on input change
- Disclaimer shown in UI and FAQ: *estimated, subject to change, confirm at retailer*

## Chatbot Math Capabilities
All chatbots (`/chat`, `/chat/lottox`, `/chat/fantasy5`, `/chat/cashpop`) support inline math:
- `"take-home on $30,000"` → 24% withholding, net take-home
- `"5 of 6 with 10x"` (Lotto X) → exact multiplied prize + withholding + net
- `"what do I win for 4 of 6"` → base prize + Double Play equivalent
- `"combo prize for 8 matches"` (JTP) → exact Combo tier
- `"ezmatch $50"` (Lotto X or Fantasy 5) → instant take-home
- `"how much does it cost"` / `"ticket price"` / `"how much to play"` → full cost breakdown with add-on examples and subject-to-change disclaimer (all four chatbots)

### Win/Loss & ROI Math (all four chatbots)
Three shared helpers in `server.js` handle spend/win analysis — they run **first** in every chatbot before any other pattern, so they work regardless of which game the user is asking about.

**`calcWinLoss(spent, won)`** — core engine, returns a formatted multi-line breakdown:
- Spent / Won (gross)
- Net profit or loss (signed: `+$` or `-$`)
- Return rate: `won / spent × 100` — percentage of spend recovered
- ROI: `(won - spent) / spent × 100`
- After-tax net (only shown when `won > $5,000`): applies 24% federal withholding to winnings, then subtracts spend
- Florida no-state-tax note always appended

**`tryWinLoss(q)`** — natural-language pattern matcher for spend + win pairs:
- `"spent $20 won $500"` / `"paid $10 and won $50"` / `"won $200 on $15 spend"`
- `"I lost $30"` (zero winnings — spend only)
- Detects which number is spend vs. win from surrounding verb context
- Caps: spend ≤ $1,000,000; winnings ≤ $100,000,000

**`tryReturnPct(q)`** — catches percentage/return-rate questions with two dollar amounts:
- `"what percent did I keep on $500 win $50 spend"`
- Assumes smaller value = spent, larger = won

**Withholding rule** (consistent across all math): prizes > $5,000 → 24% federal withholding; Florida state tax = $0. Additional federal tax may be owed at filing (up to 37%).

**Example outputs:**
```
"spent $50 won $25"
Spent:           $50
Won (gross):     $25
Net profit/loss: -$25
Return rate:     50.0% (got back 50.0% of what you spent)
ROI:             -50.0%
Florida has no state income tax.

"spent $10 won $30000"
Spent:           $10
Won (gross):     $30,000
Net profit/loss: +$29,990
Return rate:     300000.0%
ROI:             +299900.0%

After 24% federal withholding on winnings:
  Withholding: -$7,200
  Net after tax + spend: +$22,790
Florida has no state income tax.
```

**`tryContextualSpend(q, context)`** — resolves spend references when no explicit dollar amounts are present but lines were generated:
- Triggered by keywords: `win`, `loss`, `ratio`, `roi`, `return`, `spent`, `cost`, `paid`, `profit`, `break-even`, `how much did/have`, `my lines`, `generated`, `above`
- Skipped if `$` or `dollar` already appears in the query (those go to `tryWinLoss`)
- `context` object passed from frontend: `{ spend, lines, game, won }` — spend is the exact cost bar total; `won` is the last Check My Numbers result (null if no check run)
- `won` from context takes priority over any won amount parsed from the query text
- Optionally extracts a won amount from the query (e.g. `"won 25"` without `$`) if `context.won` is null
- Label in output: `"N tickets ($X spent)"` for line games; `"N numbers at $X each ($Y spent)"` for Cash Pop
- Example: `"what's my payout minus my 6 lines"` after a check showing $10,525 → full `calcWinLoss` breakdown using cost bar spend + check result win

**Frontend context injection** — each `sendChat` function computes and passes `context` in the POST body:
- **JTP**: `{ spend: tickets × $1 (or $2 with Combo), lines: lastLines.length, game: 'jtp', won: jtpLastWin }`
- **Lotto X**: `{ spend: tickets × ($2 + $1 per add-on checked), lines: lxLastLines.length, game: 'lottox', won: lxLastWin }`
- **Fantasy 5**: `{ spend: tickets × ($1 + $1 if EZMatch), lines: f5LastLines.length, game: 'fantasy5', won: f5LastWin }`
- **Cash Pop**: `{ spend: numbers × playAmount, lines: cpLastNumbers.length, game: 'cashpop', won: cpLastWin }`
- `context` is `null` when no lines have been generated yet; `won` is `null` until Check My Numbers is run
- `won` is cleared back to `null` when the check form is reset (clearCheck / cpClearCheck / etc.)
- All four `/chat/*` route handlers accept and forward `context` to their `chatReplyXxx(question, context)` function

**Frontend `xLastWin` variables** (one per game):
- `jtpLastWin` — set in `checkNumbers()` to `basePrizeTotal + comboPrize`; cleared in `clearCheck()` and `doReset()`
- `lxLastWin` — set in `lxCheckNumbers()` to `data.totalWin`; cleared in `lxClearCheck()`
- `f5LastWin` — set in `f5CheckNumbers()` to `data.prize` (0 for free ticket); cleared in `f5ClearCheck()`
- `cpLastWin` — set in `cpCheckNumbers()` to `data.takeHome` (match) or `0` (no match); cleared in `cpClearCheck()`

**JTP spend fix**: `sendChat` uses `lastLines.length` directly as ticket count (not `ceil(lastLines.length/3)`) — the API returns one entry per ticket, not per line.

**When adding a new game/chatbot**: call `tryWinLoss(q) || tryReturnPct(q) || tryContextualSpend(q, context)` as the **first** check inside the new `chatReplyXxx(question, context)` function. Pass `context` from the route handler. Compute spend in the frontend `sendChat` function and include `won: xLastWin` in the POST body. Store the check result win in `xLastWin` and clear it on form reset.

## Real-Time Draw Banners
- Every game panel has a live draw banner showing next draw date/time, countdown, and Sales Open/Closed badge
- On page load each panel fetches its `/nextdraw/*` endpoint once to populate the banner immediately
- A single shared `setInterval` (60 s) silently re-fetches all four `/nextdraw/*` endpoints in parallel and calls each game's `startCountdown` function to keep banners current across draw boundaries
- Poll errors are swallowed with `.catch(function(){})` — **no** `console.log` or `console.warn` on poll success or failure to prevent log spam
- `/nextdraw/*` routes are intentionally excluded from rate limiting (pure date math, no PDF I/O)
- When adding a new game, add its `/nextdraw/<game>` fetch to the shared poll interval

## API Surface
GET `/` `/nextdraw` `/nextdraw/lottox` `/nextdraw/fantasy5` `/nextdraw/cashpop` `/latestdraw/jtp` `/latestdraw/lottox` `/latestdraw/fantasy5` `/latestdraw/cashpop` `/draws/jtp` `/draws/lottox` `/draws/fantasy5` `/draws/cashpop` `/draws/jtp/available` `/draws/lottox/available` `/draws/fantasy5/available` `/draws/cashpop/available` `/mode` `/analyze?count&sid` `/analyze/lottox?count&sid` `/analyze/fantasy5?count&sid` `/analyze/cashpop?count&sid`
POST `/refresh` `/refresh/lottox` `/refresh/fantasy5` `/refresh/cashpop` `/reset` `/check` `/check/lottox` `/check/fantasy5` `/chat` `/chat/lottox` `/chat/fantasy5` `/chat/cashpop` `/email` `/email/config` `/email/test`

### /latestdraw/* endpoints
- Return the most recent draw **from PDF only** — no puppeteer, no `getAvailableDates` call
- PDF is always up to date within 5 minutes of a draw (via `schedulePostDrawRefreshes`)
- `/latestdraw/jtp` → `{ date, numbers }` (6 numbers, most recent draw)
- `/latestdraw/lottox` → `{ date, numbers }` (6 numbers, most recent draw)
- `/latestdraw/fantasy5` → `{ evening: { date, numbers } | null, midday: { date, numbers } | null }` (most recent of each type)
- `/latestdraw/cashpop` → `{ date, numbers }` (5 numbers from PDF — one per session)
- On page load the frontend fetches all four and auto-populates `xDrawn`, the date input, and the drawn balls display in **gold**
- `/latestdraw/*` excluded from rate limiting
- **NEVER call `getAvailableDates()` or `scrapeFlDraws()` from `/latestdraw/*`** — these run on every page load and will OOM the server

### POST /check/lottox body
```json
{
  "drawn": [5,12,23,31,44,50],
  "line": [5,12,19,31,44,53],
  "multiplier": 5,
  "doublePlayDrawn": [2,12,23,31,44,50],
  "ezMatch": 20
}
```
- `multiplier`: valid values 2, 3, 4, 5, 10 only
- `doublePlayDrawn`: 6 numbers from DP draw, or null/omit
- `ezMatch`: 0–500, or omit

### POST /check/fantasy5 body
```json
{
  "drawn": [3,12,19,27,34],
  "line": [3,12,19,22,34]
}
```
- `drawn`: 5 numbers from 1–36
- `line`: 5 numbers from 1–36

## Email
- Single `POST /email` endpoint shared by all games
- `game` field in body: `"jtp"` (default) | `"lottox"` | `"fantasy5"` | `"cashpop"` — controls subject, header emoji, game label
- Subject format: `{Game Name} — {Day} {Date} Best Odds Lines`
- Email card shown after line generation in all game panels
- Local mode: Email Settings card visible for API key config; hidden in public mode
- **`getEmailConfig()` reads `email.config.json` first, then falls back to `process.env.EMAIL_API_KEY` + `EMAIL_FROM`**
- **`/email/config` GET route MUST call `getEmailConfig()` — never check `fs.existsSync` directly**, otherwise the env var fallback is bypassed and the route incorrectly returns `configured: false` in production
- Production email secret: `fly secrets set EMAIL_API_KEY=re_xxx -a jackpot-ixupbg` (no redeploy needed — Fly restarts the machine automatically)

### Email Card — Content Checkboxes (all games)
- Two checkboxes: **My Lines** (checked by default) and **Winning Numbers** (checked by default)
- **My Lines** is only included if lines/numbers have been generated (`lastLines`, `lxLastLines`, `f5LastLines`, `cpLastNumbers` are non-null/non-empty)
- **Winning Numbers** is only included if the winning number data is actually present:
  - JTP, Lotto X, Fantasy 5: `drawn` array populated via the Check My Numbers date lookup (`jtpDrawn`, `lxDrawn`, `f5Drawn`)
  - Cash Pop: the "Winning Number Drawn" field (`cpWinNum`) is filled with a valid 1–15 value
- **Winning Numbers checked but unavailable must NOT block sending** — silently omit them and send lines only. Only block if lines themselves haven't been generated.
- Frontend validation pattern for every `xSendEmail()`: error if `!incLines`, never error solely because `!incWinning`
- `winningNumbers` field in POST body: array when included, `null` when not
- Server renders a green "Winning" row at the top of the HTML email table when `winningNumbers` is present; also appended to plain-text body
- Server validates: if `lines` is empty array AND `winningNumbers` is null/missing → 400 error

## Rate Limits (per IP/min)
`/analyze` 10 | `/refresh` 3 | `/email` 5 | `/check` 20 | `/chat` 30 | global cap 120 (all routes combined)
- Request body size capped at 20 KB — oversized payloads rejected with 413
- `/nextdraw/*` and `/latestdraw/*` excluded from per-route limits but still subject to global cap
- Auto-blacklist: 5 rate-limit strikes within 10 min → 24h IP ban → 403 on all requests
- Blacklist bans and expirations are logged (`console.log`); blacklist is in-memory and resets on server restart

## Sessions
- Browser `sid` in `sessionStorage`; server `Map` TTL 2 h; purged every 30 min

## Serialized Refresh Queue
- All PDF downloads (scheduled and manual) go through a single global queue -- **one job at a time, never concurrent**
- Prevents OOM from concurrent large PDF operations (Fantasy 5 = 2.7MB, Lotto X = 1MB)
- `enqueueRefresh(game, downloadFn)` -- adds a job; `processRefreshQueue()` runs them serially
- Each job: **download PDF + invalidate cache only** -- parse happens lazily on next `/analyze` or `/latestdraw` call
- **Single 30s retry**: on failure waits 30s then tries once more; if retry fails marks `error` and moves on
- Status values: `queued` | `running` | `retrying` | `done` | `error`
- `GET /refresh/status` -- returns current status of all games; excluded from rate limiting
- `/refresh/*` routes return `{ queued: true, game }` immediately -- never block waiting for download
- **When adding a new game**: call `enqueueRefresh(game, downloadFn)` in the `/refresh/<game>` route AND in `schedulePostDrawRefreshes()`
- **Never call `downloadFile()` directly from a refresh route** -- always go through `enqueueRefresh`

## PDF Parsing -- Memory Rules
- `extractPDFText(pathOrBuffer)` accepts a **file path string** (preferred) or a Buffer
- **Always pass the file path directly**: `extractPDFText(PDF_PATH_X)` -- never `extractPDFText(fs.readFileSync(PDF_PATH_X))`
- Passing a path uses `loadPDF()` internally, avoiding a full Buffer copy of the file in memory before parsing
- `p.destroy()` is called after every parse to free PDFParser internal state immediately
- Large PDFs (>1MB) use mtime-based parse cache with serialized `parsePromise` -- see PDF Parse Cache section
- Node heap: `--max-old-space-size=192` in Dockerfile
- Fly.io machine: `512mb` -- validated stable with queue serialization
- **Path to 256MB**: possible if Chrome and PDF parse never overlap -- queue serialization makes this likely; monitor memory before reducing further
- **`fs.readFileSync` is ONLY permitted for text files** (`email.config.json`, log files) -- never for PDFs

- PDFs > 1 MB (currently Lotto X ~1 MB, Fantasy 5 ~2.7 MB) use an mtime-based in-memory parse cache with **serialized parsing**
- Cache stores `{ text, mtime }` — invalidates automatically when `fs.statSync().mtimeMs` changes
- **Serialized parse**: `lxParsePromise` and `f5ParsePromise` prevent concurrent parses — if a parse is already in progress, subsequent requests wait for it instead of starting a new one. This prevents OOM from multiple simultaneous 2.7MB PDF parses.
- Pattern: `if (cache && cache.mtime === mtime) return cache.text; if (!parsePromise) { parsePromise = extractPDFText(...).then(text => { cache = {text, mtime}; parsePromise = null; return text; }); } return parsePromise;`
- `downloadFile()` writes atomically via `.tmp` rename so mtime only updates when the full file is committed — no partial-read risk
- PDFs under 1 MB (JTP, JTP frequency, Cash Pop) are read and parsed fresh on every request — no cache
- Cache invalidation is logged (`console.log`) so stale-data issues are traceable; never silently serve stale
- When adding a new game with a PDF > 1 MB, add a `getXxxText()` cache function with serialized parse following the same pattern

- JTP History PDF: `https://files.floridalottery.com/exptkt/jtp.pdf`
- JTP Frequency PDF: `https://files.floridalottery.com/exptkt/jackpot-triple-play_number-frequency-chart.pdf`
- Lotto X History PDF: `https://files.floridalottery.com/exptkt/lotto_winning-numbers-history.pdf`
- Fantasy 5 History PDF: `https://files.floridalottery.com/exptkt/fantasy5_winning-numbers-history.pdf`
- Cash Pop History PDF: `https://files.floridalottery.com/exptkt/cash-pop_winning-numbers-history.pdf`
- **All PDF URL and path constants are declared at the top of `server.js`** (lines ~94–107) — never declare them inline inside a game section. When adding a new game, add its `PDF_URL_X` and `PDF_PATH_X` constants to that block.
- **`downloadPDFs()` downloads ALL game PDFs at startup** — JTP (sequential), then Lotto X + Fantasy 5 + Cash Pop in parallel. This ensures no game is missing on a fresh container after deploy. When adding a new game, add it to the `Promise.all` block in `downloadPDFs()`.
- **`downloadPDFs()` runs INSIDE the `server.listen()` callback as a non-blocking fire-and-forget** — the server starts listening immediately so Fly.io health checks pass, then downloads all PDFs in the background. Grace period in `fly.toml` is 30s to allow downloads to complete before health checks begin.
- **Readiness gate**: `_serverReady` flag starts `false`. A middleware blocks all non-`/health` routes with 503 until `_serverReady = true`. The flag is set only after `downloadPDFs()` + `getLottoXText()` + `getFantasy5Text()` all complete. This prevents Fly's proxy from timing out on cold PDF parses -- users get a clean 503 "warming up" instead of a 502 Bad Gateway.
- **`_serverReady` MUST always be set to `true`** -- the final `.catch()` in the startup chain must also set it, otherwise any failure in the chain leaves the server permanently in warming-up state. Pattern: `.then(() => { _serverReady = true; }).catch(() => { _serverReady = true; })`
- **When adding a new game with PDF > 1 MB**: add its `getXxxText()` to the warming chain before `_serverReady = true` is set.
- **After downloads complete, large PDF caches are warmed sequentially** — `getLottoXText()` then `getFantasy5Text()` are called in the startup chain so the first user request hits the in-memory cache instead of triggering a cold 6-10s parse. Sequential (not parallel) to avoid OOM. When adding a new game with a PDF > 1 MB, add its `getXxxText()` call to this chain.

## PDF Parse Performance -- Decision Table
Every PDF used by the server must be benchmarked before deciding whether it needs a cache. Fly.io shared-cpu-1x is ~3-4x slower than a local dev machine. Fly's proxy cuts connections at ~8s.

### Benchmark rule
Run this locally to measure parse time before adding a new game:
```js
node -e "const {performance}=require('perf_hooks');const PDFParser=require('pdf2json');const t=performance.now();const p=new PDFParser(null,1);const _w=console.warn;console.warn=()=>{};p.on('pdfParser_dataReady',()=>{console.warn=_w;console.log(Math.round(performance.now()-t)+'ms len:'+p.getRawTextContent().length);p.destroy();});p.on('pdfParser_dataError',e=>{console.warn=_w;console.error(e.parserError);});p.loadPDF('path/to/file.pdf');"
```
Multiply local time by 4 to estimate Fly.io time. If estimated Fly time > 3s, the PDF needs a cache + startup warming.

### Current PDF parse times (measured locally, Nov 2026)
| PDF | Local parse time | Est. Fly time | Needs cache | Needs startup warm |
|-----|-----------------|---------------|-------------|-------------------|
| jtp.pdf (~65KB text) | ~280ms | ~1s | No | No |
| jackpot-triple-play_number-frequency-chart.pdf (~1KB text) | ~68ms | <1s | No | No |
| cash-pop_winning-numbers-history.pdf (~126KB text) | ~686ms | ~2.5s | No | No |
| lotto_winning-numbers-history.pdf (~1MB) | ~1-2s | ~4-8s | Yes | Yes |
| fantasy5_winning-numbers-history.pdf (~2.7MB) | ~6s | ~8-10s+ | Yes | Yes |

### Decision rules
- Local parse < 750ms (est. Fly < 3s): direct `extractPDFText(path)` on every request, no cache
- Local parse 750ms-2s (est. Fly 3-8s): add mtime cache (`getXxxText()`) but startup warming optional
- Local parse > 2s (est. Fly > 8s): **must** add mtime cache + startup warming or users get 502 on first request after deploy

### Startup warming chain (server.js listen callback)
```
downloadPDFs()
  .then(() => getLottoXText())    // ~1-2s, warms lxCache
  .then(() => getFantasy5Text())  // ~6s, warms f5Cache
```
- Always sequential -- never parallel -- to avoid concurrent large PDF parses causing OOM
- Each step swallows errors with `.catch(() => {})` so a failed warm doesn't crash startup
- When adding a new game with local parse > 2s: add `getXxxText()` call at the END of this chain

### When adding a new game -- PDF checklist
1. Benchmark the PDF parse time locally using the node command above
2. If est. Fly time < 3s: use direct `extractPDFText(PDF_PATH_X)` -- no cache needed
3. If est. Fly time > 3s: add `getXxxText()` cache function with `xxxParsePromise` serialization and `fs.statSync` try/catch guard
4. If est. Fly time > 8s (or > 2s local): add `getXxxText()` to the startup warming chain in `server.listen()` callback
5. Always add `PDF_URL_X` and `PDF_PATH_X` to the top constants block and `downloadPDFs()` Promise.all
- **`getXxxText()` cache functions wrap `fs.statSync` in try/catch** — if a PDF is somehow missing, throw a clean Error (caught by route try/catch) instead of crashing the process with an unhandled exception. Pattern: `try { mtime = fs.statSync(PDF_PATH_X).mtimeMs; } catch(e) { throw new Error('X PDF not yet downloaded. Try again in a moment.'); }`
- **Direct `extractPDFText(path)` calls** (JTP, Cash Pop) are safe without a guard — `loadPDF()` emits `pdfParser_dataError` on a missing file, which rejects the promise and is caught by the route-level try/catch. Only `fs.statSync` needs explicit guarding because it throws synchronously before any async boundary.
- Auto-refreshed once per day on first `/analyze` (or `/analyze/lottox`, `/analyze/fantasy5`) call
- Fantasy 5 and Cash Pop also auto-refresh via `schedulePostDrawRefreshes()` ~5 min after each draw completes (server-side `setTimeout` chain, no external scheduler needed)
- **JTP and Lotto X also refresh via `schedulePostDrawRefreshes()` at 11:20 PM ET, gated on draw day** — JTP fires on Tue/Fri (days 2,5), Lotto X fires on Wed/Sat (days 3,6)
- `ensureDailyRefresh` / `ensureDailyRefreshLottoX` remain as fallback only (fire on first `/analyze` call if scheduled refresh was missed)
- When adding any new game, add its post-draw refresh to `schedulePostDrawRefreshes()` — **always 5 minutes after the draw time, every game, no exceptions**

## Email Button Reset Pattern
When resetting an email send button in a `.finally()` block, always use `btn.innerHTML` (not `btn.textContent`) so HTML entities like `&#128140;` render as the emoji rather than literal text.

```js
.finally(function() { btn.disabled = false; btn.innerHTML = '&#128140; Send Lines'; });
```

- **`textContent` with HTML entities like `&#128140;` renders as literal text** — the entity is never parsed. Always use `innerHTML` for any string containing `&#...;` entities.
- Raw emoji chars (e.g. `'🍀'`) and Unicode escapes (e.g. `'\u{1F4B0}'`) are safe with `textContent`.
- Apply `innerHTML` to every game's `xSendEmail()` `.finally()` reset when building a new game.

### Frontend Fetch -- AbortController Timeouts
Every user-triggered fetch() in index.html MUST have an AbortController with an appropriate timeout. This prevents mobile connections from hanging indefinitely on slow or dropped requests.

### Timeout values by endpoint type
| Endpoint type | Timeout | Rationale |
|---|---|---|
| /analyze/* | 30s | PDF parse + line generation can take 10-15s |
| /email | 30s | Resend API call + server processing |
| /refresh/* | 10s | Just enqueues a job, returns immediately |
| /check/* | 15s | Pure math, should be fast |
| /chat/* | 15s | String matching, no I/O |
| /email/config GET/POST | 10s | File read/write only |
| /email/test | 10s | Single Resend API call |
| /draws/* (lookup) | 60s | Already had this -- puppeteer can take 15s+ |

### Endpoints that do NOT need AbortController
- /nextdraw/* -- pure date math, instant; poll errors swallowed with .catch(function(){})
- /latestdraw/* -- page-load only; errors swallowed with .catch(function(){})
- /draws/*/available -- page-load chips; errors swallowed with .catch(function(){})
- /reset -- fire-and-forget; .catch(function(){}) already present
- /mode -- startup only, tiny

### AbortController pattern
Use a unique variable name per call site (_ac0, _acLX, _acF5E, etc.) to avoid closure collisions inside loops. For loops (e.g. allLines.forEach), declare the AbortController inside the loop body so each request gets its own controller.

### Fantasy 5 draw lookup -- sequential fetch (not parallel)
- f5LookupDraw() fetches the selected draw type first, then falls back to the other if not found -- never both in parallel
- Parallel dual-fetch was the root cause of mobile timeouts: two simultaneous requests each triggering a PDF parse
- Pattern: _f5Fetch(_primary).then(function(r){ if (r && !r.error) return r; return _f5Fetch(_fallback); }).then(...)
- Each _f5Fetch(dt) creates its own AbortController with 60s timeout

### When adding a new game -- fetch checklist
1. Every fetch() in user-triggered functions gets an AbortController with the appropriate timeout from the table above
2. Add xAppendMsg(role, text) for the game chat panel (copies pattern from appendMsg, lxAppendMsg, cpAppendMsg)
3. Add xSendChat() with AbortController (15s), context injection, and .finally() re-enable
4. Add xQuickAsk(q) function
5. For multi-draw games: use sequential fetch with fallback, not Promise.all

## When Adding a New Game — Email Checklist
1. Add `xEmailCard` div (hidden by default, shown after line generation)
2. Add `xEmailIncLines` and `xEmailIncWinning` checkboxes (both checked by default)
3. Add `xEmailTo` input and send button calling `xSendEmail()`
4. Implement `xSendEmail()` following this pattern:
   - Block only if `!incLines` (lines not generated) — never block solely on `!incWinning`
   - Pass `winningNumbers: incWinning ? xDrawn : null` in POST body
   - Use `btn.innerHTML` (not `btn.textContent`) in `.finally()` reset
5. Set `xLastWin` from Check My Numbers result; clear on form reset
6. Pass `context: { spend, lines, game, won: xLastWin }` in `xSendChat()` POST body

## Timezones
- All draw times are displayed in the **local timezone of the state where the game is operated**
- Current games are all Florida Lottery → **Eastern Time (ET)**
- Florida observes EST (UTC-5) Nov–Mar and EDT (UTC-4) Mar–Nov
- The state row in the UI shows the timezone label: e.g. `🦎 FLORIDA  🕐 Eastern Time (ET)`
- When adding a game from another state, use that state's `timeZone` string in all `toLocaleString()` calls in `getNextDrawXxx()`, and update the state row label accordingly
- **Draw day validation** (`isValidDrawDay`) uses `Date.UTC()` + `getUTCDay()` — pure calendar math, timezone-independent. Never use `new Date(y, m, d).getDay()` — it depends on server local time and will give wrong results on Fly.io (UTC)
- **`getNextDrawXxx()` functions** use `new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })` — always use the game state's IANA timezone string here
- When adding a game from another state, replace `'America/New_York'` with the appropriate IANA zone (e.g. `'America/Chicago'` for CT, `'America/Los_Angeles'` for PT)

## Chatbot Timezone Handling
- `TZ_RE` — shared regex constant, checked **first** in every `chatReplyXxx()` function before any other pattern
- `TZ_REPLY` — shared response string explaining state-local time, EST/EDT dates, CT/MT/PT conversions with examples
- Both defined once above `chatReply()` and reused across all 4 chatbots
- Regex uses `\b` word boundaries to avoid false positives on short tokens (e.g. `ct` in "ticket", `pt` in "point")
- When adding a new game chatbot: call `if (TZ_RE.test(q)) return TZ_REPLY;` as the **first line** after `const q = ...`
- If the new game is in a different state/timezone, update `TZ_REPLY` to be a function or map keyed by game, so each chatbot returns the correct state's timezone info


`email.config.json` | `*.pdf` | `logs/*`

## Page Load — latestdraw Fetch Pattern
Each game fetches `/latestdraw/<game>` on page load to auto-populate Check My Numbers date, drawn balls (gold), and session selector.

**JTP and Lotto X** (no session selector):
- Set `xLatestDate`, set date input, set `xDrawn`, render gold balls directly from response — no second fetch needed

**Fantasy 5** (draw type selector, not session):
- Same as JTP/Lotto X but also sets the draw type dropdown from `d.evening ? 'EVENING' : 'MIDDAY'`

**Cash Pop** (5-session selector):
- Set `cpLatestDate`, set date input, then call `cpLookupDraw()` — do NOT manually render balls or set session
- `cpLookupDraw()` fetches `/draws/cashpop?date=...`, gets `allSessions`, resolves correct session, sets dropdown, renders gold balls, stores `cpLatestSession`
- **Why different**: 5 sessions per day — correct latest session must be resolved from `allSessions`, not assumed
- Never manually set `cpLatestSession` in the page load fetch — let `cpLookupDraw()` do it

**Rule for new games with session selectors**: always call `xLookupDraw()` from the page load fetch instead of manually rendering. Only skip the second fetch for single-draw-per-date games (no session selector).

## Backups
Stable snapshots → `backups/stable-YYYY-MM-DD/`
Latest stable: `backups/stable-2026-11-19b`

## Fly.io Machine
- Account: `baysphoton2@gmail.com` — requires credit card (free trial limits machines to 5 min)
- Machine ID: `857444c4722408`, region `iad`
- Memory: `512mb` -- reduced from 1GB; stable with serialized refresh queue and path-based PDF parsing. Queue ensures Chrome and PDF parse never run concurrently.
- Node heap: `--max-old-space-size=192` in Dockerfile CMD -- leaves headroom for Chrome (~150MB) within 512MB total
- Path to 256MB: monitor memory usage; if Chrome + Node peak stays under 200MB, `fly scale memory 256 -a jackpot-ixupbg` is viable
- Health check: `GET /health` every 15s, 5s timeout, 30s grace — `/health` returns 200 instantly
- `auto_stop_machines = "off"`, `min_machines_running = 1` — machine stays running permanently
- If machine gets stuck in crash loop: `flyctl machine restart 857444c4722408 -a jackpot-ixupbg`
- To check memory: `flyctl ssh console -a jackpot-ixupbg -C "cat /proc/meminfo"`
- Idle memory usage: ~280MB used, ~700MB free on 1GB

## Knowledge Base
Full project docs in `vault/` (Obsidian). Amazon Q prompts: `@jackpot-wiki` (deep reference), `@jackpot-context` (quick context).

## File Encoding
- `public/index.html` MUST be saved and read as **UTF-8** at all times
- Never open/save it with Windows-1252 (or any non-UTF-8 encoding) — doing so remaps bytes 0x80-0x9F to wrong Unicode codepoints, bloating the file and corrupting all emojis and special chars (-- v ^ etc.)
- If the file grows unexpectedly (e.g. ~90 KB ballooning to ~150 KB+), encoding corruption is the likely cause
- Always verify encoding in your editor before saving; in VS Code the encoding is shown in the status bar (bottom right)
- **Recovery**: if emojis appear as mojibake (e.g. `ðŸŽ±` instead of 🎱), the file was decoded as Windows-1252 then re-encoded as UTF-8. Fix by reversing the cp1252 mapping: read as UTF-8, map each codepoint back to its original byte using the cp1252 reverse table, write as UTF-8. See `fix_encoding.js` pattern used in Nov 2026.

## PM2 / Local Dev
- PM2 is for **local development only** — not used in production (Fly.io runs `node server.js` directly)
- On Windows, `EPERM \\.\pipe\rpc.sock` on restart means a zombie PM2 daemon node process is still holding the named pipe
- Fix: kill ALL `node` processes **before** attempting socket file cleanup or `pm2 kill` -- not after
- Correct order in `start_jackpot.ps1`: (1) kill node+cloudflared, (2) sleep, (3) delete socket files, (4) `pm2 kill`, (5) kill node again, (6) final socket cleanup
- `Remove-Item` on `.sock` files does NOT release a Windows named pipe -- only killing the owning process does

## Draw Date Lookup (/draws/* routes)

### Lookup strategy — 3 steps in this order
1. **PDF first** — checks the already-parsed daily PDF using `normDateForPDF(date)`. Instant, no Chrome. This handles the vast majority of lookups.
2. **Puppeteer scraper** — only runs if the date is NOT in the PDF (gap period right after a draw before PDF updates). Fetches the FL Lottery game page with headless Chrome, finds the article by ISO date ID, extracts numbers. Chrome is closed immediately after via `closeBrowser()`.
3. **Official site link** — if neither finds it, return `{ error, resultsUrl }`. Frontend renders as a clickable "View official results" link.

**CRITICAL order**: PDF must be checked FIRST. Never call puppeteer for dates that are already in the PDF — it wastes memory and causes OOM crashes on 512MB.

### Why puppeteer is required
- The FL Lottery website is **JavaScript-rendered** — a plain `https.get()` returns an empty shell with no draw data
- The FL Lottery Azure API (`apim-website-prod-eastus.azure-api.net`) requires browser-generated auth tokens — cannot be called server-side
- Only headless Chrome (puppeteer) gets the fully rendered HTML with draw results

### Puppeteer setup
- Package: `puppeteer` (full, not `puppeteer-core`) — bundles its own Chrome locally
- Dockerfile: `node:22-slim` + `apt-get install chromium`; env var `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`
- Launch args: `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` only — **do NOT add `--single-process` or `--no-zygote`** as these prevent JS from executing in the renderer, breaking the FL Lottery SPA
- **`getBrowser()` launches Chrome fresh each time** — `_browser` is set to null after each scrape via `closeBrowser()`
- **`closeBrowser()`** — called after every successful scrape to free memory immediately. Critical on 1GB — Chrome must not stay resident between requests.
- Both `scrapeFlDraws` and `getAvailableDates` use a **2-attempt retry loop** — on first failure, reset `_browser = null` then retry
- **No request interception** — do NOT use `page.setRequestInterception(true)`. Blocking resources (even just images/CSS) prevents the FL Lottery Vue.js SPA from executing its JavaScript, so draw numbers never render into the DOM.
- **Result cache**: `_scrapeCache` stores results keyed by `game|date|drawType` — subsequent lookups for the same date are instant without launching Chrome
- Never cache empty results from `getAvailableDates` — only cache when `converted.length > 0`
- `waitUntil: 'domcontentloaded'` with 15s timeout — stops waiting as soon as DOM is ready
- **FL Lottery site is a Vue.js SPA** — raw HTTP returns an empty shell. The Azure API (`apim-website-prod-eastus.azure-api.net`) requires browser-generated auth tokens and cannot be called server-side. Puppeteer is the only viable approach.

### scrapeFlDraws(game, dateStr, drawType)
- Converts `MM/DD/YYYY` to `YYYY-MM-DD`, builds article ID `YYYY-MM-DD-<gameId>`
- Fetches game page, slices 2000 chars around article ID (4000 for Fantasy 5), extracts numbers
- Uses a **2-attempt retry loop** — on failure resets `_browser` and retries once
- **Lotto X**: slice chunk to before `'Double Play'` string before extracting numbers — the article contains both main draw and Double Play numbers; stripping must happen BEFORE the regex runs, not after
- **Fantasy 5**: chunk size 4000; find draw type label (`Midday`/`Evening`), slice to next label occurrence to isolate that draw's numbers
- **CRITICAL**: the regex `/class="game-numbers__number"><span>(\d+)<\/span>/g` must be a real JS regex literal — never write it through a template or patch script that HTML-encodes `>` to `&gt;` or `<` to `&lt;`
- When patching server.js regex lines, always use `node -e` with `split().join()` or a `.js` patch file — never PowerShell string replacement

### FL Lottery game IDs (confirmed)
| Game | Page URL | Article game ID | Notes |
|------|----------|-----------------|-------|
| JTP | `/games/draw-games/jackpot-triple-play` | `jackpottripleplay` | Single draw per date |
| Lotto X | `/games/draw-games/florida-lotto` | `lotto` | Has Double Play — strip it (see below) |
| Fantasy 5 | `/games/draw-games/fantasy5` | `fantasy5` | Two draws per date (Midday + Evening) |

### Game-specific scraper notes
- **Lotto X**: article contains both main draw AND Double Play numbers. Slice chunk to before `'Double Play'` to get only the 6 main draw numbers. Chunk size 2000 is sufficient.
- **Lotto X PDF**: each date has TWO lines — `LOTTO DP` (Double Play) first, then `LOTTO` (main draw). The parse regex MUST use a negative lookahead `LOTTO(?!\s+DP)` to skip DP lines. Without it, the lazy `[\d\s]+?` captures DP numbers and anchors on the next line's `LOTTO \d`, returning wrong numbers. Current regex: `/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d\s]+?)\s+LOTTO(?!\s+DP)\s+\d/g`
- **Fantasy 5**: article contains both Midday and Evening draws. Use chunk size 4000 (Evening label appears ~2583 chars in). Find the target draw type label (`Midday` or `Evening`), then slice to the next occurrence of the other label to isolate that draw's numbers. Default to Midday if no drawType specified.
- **Fantasy 5 latestdraw**: filter draws to `ts > 2019-01-01` to exclude corrupt sentinel entries (e.g. `12/31/99`) that appear at the top of the PDF.
- **Fantasy 5 available dates**: use `/games/draw-games/fantasy5` (no hyphen) — `/games/draw-games/fantasy-5` returns 404.
- **Cash Pop**: does NOT use date-based article IDs like other games. The page shows all sessions for a date in one block. Skip the article ID lookup entirely — search the whole page HTML. Use `shortDate` (e.g. `"Nov 18"`) to find the right date's section. Regex: `/<li[^>]*>.*?<div[^>]*>([^<]+)<\/div>.*?game-numbers__number[^>]*>(\d+)/gs` extracts session name + number. Numbers are in `<span class="game-numbers__number mt-2 text-black">3</span>` (no inner `<span>`).
- **Cash Pop article ID**: `if (idx === -1 && game !== 'cashpop') return null` — Cash Pop bypasses the article ID check and uses the full page HTML.

### Available dates — PDF-based (no puppeteer on page load)
- `/draws/<game>/available` endpoints return the last 5 dates from the PDF — **no puppeteer call**
- Uses `expandYear(date)` helper to normalize 2-digit years (`MM/DD/YY` → `MM/DD/YYYY`) and 4-digit years (Cash Pop PDF already uses 4-digit)
- JTP dates filtered to Tue/Fri only (days 2,5); LottoX filtered to Wed/Sat only (days 3,6); Fantasy5/CashPop draw every day
- `getAvailableDates(game)` still exists for puppeteer-based scraping (used by `schedulePostDrawRefreshes`) with 1-hour cache in `_availCache`
- **Never cache empty results** from `getAvailableDates` — only cache when `converted.length > 0`
- **Cache invalidation on 404**: when `/draws/<game>` returns 404, `delete _availCache[game]`

### Draw day validation
- `isValidDrawDay(dateStr, days)` — checks if a date falls on a valid draw day before hitting PDF or scraper
- JTP: days `[2, 5]` (Tue, Fri); LottoX: days `[3, 6]` (Wed, Sat)
- Returns 404 immediately for invalid draw days — no PDF read, no puppeteer
- Fantasy 5 and Cash Pop draw every day — no day filter needed

### Date format rules — CRITICAL
- PDFs store dates **without zero-padding** — `11/7/26` not `11/07/26`. Always use `stripLeadingZeros(d.date)` when comparing PDF dates to avoid mismatches.
- `normDateForPDF(date)` converts `MM/DD/YYYY` to `MM/DD/YY` (2-digit year, no zero-padding)
- `stripLeadingZeros(date)` removes leading zeros from month/day: `11/07/26` → `11/7/26`
- All draw route PDF matches use: `stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date`
- `expandYear(date)` normalizes 2-digit years to 4-digit: `11/7/26` → `11/7/2026`; 4-digit years pass through unchanged
- Cash Pop PDF uses 4-digit years (`MM/DD/YYYY`); all other PDFs use 2-digit years (`MM/DD/YY`)
- `<input type="date">` returns `YYYY-MM-DD` — frontend converts to `MM/DD/YYYY` using `parts[0]` (NOT `parts[0].slice(2)`)
- Scraper converts `MM/DD/YYYY` to `YYYY-MM-DD` for article ID matching
- **Never use `.slice(2)` on the year** — always send 4-digit year to the server

### Frontend date chips pattern (all games)
- Add `<div id="xDateChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;"></div>` above the date input
- Add `xPickDate(d)` function: splits `MM/DD/YYYY`, sets input value as `YYYY-MM-DD`, calls `xLookupDraw()`
- On page load: `fetch('/draws/<game>/available').then(...).then(function(d){ renderDateChips('xDateChips', d.dates, 'xPickDate'); })`
- `renderDateChips` builds spans with `onclick="pickFn('MM/DD/YYYY')"` — single quotes inside double-quoted attribute
- **onclick quote rule**: the date arg uses single quotes inside the double-quoted onclick attr: `'<span onclick="' + pickFn + '(\'' + d + '\')">'`

### When adding a new game
1. Add to `GAME_URLS` and `GAME_IDS` in both `scrapeFlDraws` and `getAvailableDates`
2. Add to `FL_RESULTS_URLS`
3. Add `/draws/<game>/available` endpoint — **PDF-based using `expandYear()`**, filtered by draw days
4. Add `/draws/<game>` route: **PDF first**, puppeteer fallback, official link last
5. Add draw day validation using `isValidDrawDay(date, days)` for games that don't draw every day
6. Add `/latestdraw/<game>` — **PDF only**, no scraper calls
7. Frontend: add `<div id="xDateChips">`, `xPickDate()`, and page-load fetch for available dates
8. Frontend date conversion: `parts[0]` not `parts[0].slice(2)`

## Log Rotation
- PM2 log files in `logs/` are trimmed automatically: any file over 1 MB is truncated to the last 500 lines
- Rotation runs on server startup and every 24 hours via `setInterval`
- Fly.io has no local log files — rotation only affects local PM2 logs (`combined.log`, `out.log`, `error.log`)
- Never use `fly logs` in an agent tool call — it never completes and produces too much output; check logs via the Fly.io dashboard instead

## Check My Numbers — Winning Ball Colors
- **Gold** (`rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)`) — latest draw auto-populated on page load via `/latestdraw/*`, AND when the user selects that same date via chip or calendar
- **Green** (`rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)`) — any other date the user looks up
- This applies to ALL games consistently — never use blue (accent) for winning number balls in Check My Numbers
- The color decision happens in `xLookupDraw()` by comparing the selected date against `xLatestDate` (set during page-load latestdraw fetch)

### Implementation pattern (must follow for every game)
1. Declare `var xLatestDate = null;` alongside other game state variables
2. In the `/latestdraw/<game>` page-load fetch, store the date: `xLatestDate = mmddyyToInputDate(d.date);` before setting the input value
3. In `xLookupDraw()`, after getting data back, compare dates to pick color:
```js
var _isLatest = xLatestDate && document.getElementById('xDrawDate').value === xLatestDate;
var _ballStyle = _isLatest
  ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)'
  : 'background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)';
document.getElementById('xDrawnBalls').innerHTML = data.numbers.map(function(n) {
  return '<div class="hball" style="' + _ballStyle + ';width:36px;height:36px;font-size:13px;">' + n + '</div>';
}).join('');
```
4. The `/latestdraw/<game>` page-load fetch always renders gold directly (hardcoded, no comparison needed)
5. For multi-draw-per-day games (Fantasy 5): `xLatestDate` stores the date of the most recent draw regardless of draw type

## Check My Numbers — Full Checklist (when adding a new game)
1. Add `<div id="xDateChips">` above the date input
2. Add `xPickDate(d)` function — converts `MM/DD/YYYY` to `YYYY-MM-DD` for the input, calls `xLookupDraw()`
3. On page load: fetch `/draws/<game>/available` → `renderDateChips('xDateChips', d.dates, 'xPickDate')`
4. Declare `var xLatestDate = null;` alongside other game state vars
5. On page load: fetch `/latestdraw/<game>` → store `xLatestDate = mmddyyToInputDate(d.date)`, populate `xDrawn`, date input, drawn balls in **gold** (hardcoded)
6. `xLookupDraw()` — converts date picker value to `MM/DD/YYYY` using `parts[0]` (4-digit year, never `.slice(2)`), fetches `/draws/<game>?date=...`, compares selected date to `xLatestDate` to pick **gold** (latest) or **green** (other)
7. Error handler checks `data.resultsUrl` and renders as `<a>` link when present
8. Server `/draws/<game>` route: **PDF first**, puppeteer fallback, official link last
9. Server `/draws/<game>/available`: **PDF-based** using `expandYear()`, filtered by draw days — no puppeteer
10. Server `/latestdraw/<game>`: **PDF only** — never call `getAvailableDates()` or `scrapeFlDraws()` here
11. Add draw day validation with `isValidDrawDay()` for games that don't draw every day
12. Add game to `scrapeFlDraws` `GAME_URLS` and `GAME_IDS`; add to `FL_RESULTS_URLS`
13. For multi-draw-per-day games (like Fantasy 5): use chunk size 4000; slice between draw type labels to isolate numbers; strip secondary draw data (like Lotto X Double Play) before extracting numbers

## Scraper Verification
- Always verify scraper output against known correct values from the FL Lottery website before deploying
- Use a standalone `.js` test script with hardcoded expected values for each game/date/drawType
- Fantasy 5 requires 6 tests minimum: 3 dates x 2 draw types (Midday + Evening)
- Lotto X requires verifying Double Play numbers are NOT included (only 6 numbers returned, not 12)
- Delete test scripts after verification (`del verify_*.js`)

## Cash Pop Check My Numbers
- Cash Pop has 5 draws per day — Check My Numbers uses a date picker + session selector (Morning/Matinee/Afternoon/Evening/Late Night)
- `/draws/cashpop?date=MM/DD/YYYY&session=Morning` — checks PDF first, falls back to puppeteer scraper
- **PDF fallback**: `parseCashPopHistoryPDF` returns 5 numbers per date (one per session in order: Morning/Matinee/Afternoon/Evening/Late Night). PDF uses 4-digit years (`MM/DD/YYYY`). Session names are assigned by position.
- **Puppeteer fallback**: only runs if date not in PDF. Cash Pop page shows ALL sessions for a date in one block — no per-session article IDs. The scraper skips the article ID lookup (`if (idx === -1 && game !== 'cashpop') return null`) and searches the full page HTML. Converts date to short form (e.g. `"Nov 18"`) to find the right date's section. Regex: `/<li[^>]*>.*?<div[^>]*>([^<]+)<\/div>.*?game-numbers__number[^>]*>(\d+)/gs`
- **CRITICAL**: Do NOT use `--single-process` or `--no-zygote` Chrome flags — they prevent JS execution and the Cash Pop numbers never render. Do NOT use `setRequestInterception` — same problem.
- The cashpop block in `scrapeFlDraws` must come **before** the `if (!nums.length) return null` check
- When a session hasn't drawn yet, the route returns `{ error, allSessions, resultsUrl }` — frontend shows available sessions
- **Frontend always fetches without session param first** to get `allSessions`, then picks the requested session or falls back to latest
- `/draws/cashpop/available` — returns last 5 dates from PDF (no puppeteer)
- `/latestdraw/cashpop` — PDF only, returns `{ date, numbers }` (5 numbers)
- Frontend on page load: sets date input + session dropdown to latest draw, shows winning number in **gold**
- Reset button restores to latest draw (not blank) — `cpLatestDate` and `cpLatestSession` store the latest values

## Draw Session / Draw Type Selectors — Rules
- **Never add a "Latest" option** to any draw type or session dropdown — it confuses players who expect to see results for a specific draw
- All dropdowns must list only the actual named sessions/draw types for that game
- Fantasy 5: `Midday` | `Evening` (labeled "Session", no default/latest option)
- Cash Pop: `Morning` | `Matinee` | `Afternoon` | `Evening` | `Late Night` (labeled "Session", no default/latest option)
- On page load, set the dropdown to the actual latest draw's session/type name (from `/latestdraw/<game>`)
- Reset button must restore to the latest draw's date + session/type, not clear to blank

## Patching index.html — Safety Rules
- **Never use string slicing (`src.slice(start, end)`) to replace a function** — if the start marker appears at position 0 (file corrupted) or the end marker isn't found, the entire file gets replaced with just the new function
- **Always verify the file starts with `<!DOCTYPE html>`** after any patch: `node -e "const s=require('fs').readFileSync('public/index.html','utf8');console.log(s.slice(0,20))"`
- **Use line-number replacement** (`lines.splice(startIdx, count, ...newLines)`) for replacing entire functions — safer than string matching
- **Use `src.replace(exactString, newString)`** only for small targeted changes where the exact string is unique and verified to exist first
- **Always read and write in one script** — never split into multiple scripts that each read/write the same file, or intermediate saves will be lost
- **After any patch, verify key strings are present**: `node -e "const s=require('fs').readFileSync('public/index.html','utf8');console.log(s.includes('renderDateChips'), s.slice(0,20))"`
- **Keep git as the recovery mechanism** — `git show <commit>:public/index.html > public/index.html` restores the last deployed version

## When Adding a New Game — Complete Checklist

### Server (server.js)
1. Add `PDF_URL_X` and `PDF_PATH_X` constants to the **top of the file** in the PDF constants block (lines ~94-107) -- never declare them inline inside the game section
2. Add the new game download to the `Promise.all` block in `downloadPDFs()` so it downloads on every server startup -- include cache bust (`xCache = null`) if the game has a parse cache
3. Add game URL to `GAME_URLS` and game ID to `GAME_IDS` in `scrapeFlDraws`
4. Add game URL to `GAME_URLS` and game ID to `GAME_IDS` in `getAvailableDates`
5. Add game URL to `FL_RESULTS_URLS`
4. Add `/draws/<game>/available` endpoint — **PDF-based** using `expandYear()`, filtered by draw days
5. Add `/draws/<game>` route: **PDF first** using `stripLeadingZeros()` comparison, puppeteer fallback, `delete _availCache['<game>']` + official link on 404
6. Add draw day validation: `if (!isValidDrawDay(date, [days])) return 404` before PDF/scraper
7. Add `/latestdraw/<game>` endpoint: **PDF only**, filter sentinel dates (`ts > 2019-01-01`), return `{ date, numbers }`
8. Add `/nextdraw/<game>` endpoint (pure date math, no scraping)
9. Add `/analyze/<game>`, `/refresh/<game>`, `/check/<game>`, `/chat/<game>` endpoints
10. Add game to `schedulePostDrawRefreshes()` — **all games must have a scheduled refresh 5 min after every draw**, regardless of draw frequency. For games that don't draw every day, gate the download on draw day using `getDay()` check inside the callback.
11. For multi-draw games: handle draw type in `scrapeFlDraws` (slice between labels, use chunk size 4000)
12. For games with secondary draw data (like Lotto X Double Play): use a **negative lookahead** in the PDF parse regex to skip secondary rows (e.g. `LOTTO(?!\s+DP)`); also strip the secondary section from the scraper chunk before extracting numbers
13. For games with non-standard page structure (like Cash Pop): add game-specific block BEFORE `if (!nums.length) return null`; skip article ID lookup with `if (idx === -1 && game !== '<game>') return null`
14. For PDFs > 1 MB: add serialized `getXxxText()` cache function with `xxxParsePromise` variable

### Frontend (public/index.html)
1. Add `var xLatestDate = null;` and `var xLastWin = null;` with other game state vars
2. Add `<div id="xDateChips">` above the date input in Check My Numbers
3. Add session/draw-type selector if game has multiple draws per day — label it **"Session"**, never "Draw" or "Latest"
4. Add `xPickDate(d)` function — converts `MM/DD/YYYY` to `YYYY-MM-DD`, calls `xLookupDraw()`
5. Add `xLookupDraw()` — fetches without session param first to get all available sessions, then picks requested or falls back to latest; uses `_isLatest` comparison for gold/green color
6. For multi-session games: fetch all sessions in parallel (like Fantasy 5) or fetch without session and use `allSessions` (like Cash Pop)
7. On page load: fetch `/draws/<game>/available` → `renderDateChips('xDateChips', d.dates, 'xPickDate')`
8. On page load: fetch `/latestdraw/<game>` → store `xLatestDate`, set date input + session dropdown, show gold balls
9. Reset button restores to latest draw (not blank) using `xLatestDate` and `xLatestSession`
10. Add `xEmailCard`, `xEmailIncLines`, `xEmailIncWinning`, `xSendEmail()` following email checklist
11. Add `xSendChat()` with `context: { spend, lines, game, won: xLastWin }`
12. Add `/nextdraw/<game>` fetch to the shared `setInterval` poll

### Consistency Rules (apply to every game)
- Gold balls = latest draw (page load + when user selects that same date)
- Green balls = any other date user looks up
- Session/draw-type label always says **"Session"** not "Draw"
- No "Latest" option in any dropdown
- Reset always restores to latest, never clears to blank
- Date chips show `MM/DD` format, clickable, above the date input
- `xLookupDraw()` always sends 4-digit year (`parts[0]` not `parts[0].slice(2)`)
- Error handler always checks `data.resultsUrl` and renders as clickable link

## Mobile Layout — Line Input Rows
- `.line-input-row` uses `flex-direction:column` so the line label sits **above** the number inputs, not beside them — prevents wrapping on narrow screens (iPhone 12 etc.)
- `.line-row-label` has no `min-width` — label is just text above the inputs
- The number inputs inside each row are wrapped in `<div style="display:flex;gap:6px;flex-wrap:wrap;">` so they stay horizontal as a group
- This pattern applies to games with **5+ inputs per row** — JTP (6 inputs), Lotto X (6 inputs), Fantasy 5 (5 inputs)
- **Do NOT apply to games with 1-2 inputs per row** (e.g. Cash Pop) — label beside input is fine and more compact on those
- When adding a new game, build line rows with this structure:
```js
html += '<div class="line-input-row" id="xLineRow' + i + '">' +
  '<span class="line-row-label">Line ' + (i+1) + '</span>' +
  '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
  '<input class="num-input" placeholder="#1" maxlength="2">...' +
  '</div></div>';
```
