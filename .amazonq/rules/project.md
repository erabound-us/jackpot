# Jackpot Analyzer — Project Steering Rules

## Stack
- **Backend**: Node.js + Express 5, single file `server.js` (~1,850 lines)
- **Frontend**: `public/index.html`, vanilla JS, no framework, no bundler (~1,750 lines)
- **Process manager**: PM2 (`ecosystem.config.js`)
- **Tunnel**: cloudflared → `jackpot.allaml.ai` (`jackpot-tunnel-config.yml`)
- **Port**: 7000 (scans 7000–7020 on startup)
- **Email**: Resend API, config in `email.config.json` (never commit)

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
GET `/` `/nextdraw` `/nextdraw/lottox` `/nextdraw/fantasy5` `/nextdraw/cashpop` `/mode` `/analyze?count&sid` `/analyze/lottox?count&sid` `/analyze/fantasy5?count&sid` `/analyze/cashpop?count&sid`
POST `/refresh` `/refresh/lottox` `/refresh/fantasy5` `/refresh/cashpop` `/reset` `/check` `/check/lottox` `/check/fantasy5` `/chat` `/chat/lottox` `/chat/fantasy5` `/chat/cashpop` `/email` `/email/config` `/email/test`

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

### Email Card — Content Checkboxes (all games)
- Two checkboxes: **My Lines** (checked by default) and **Winning Numbers** (checked by default)
- **My Lines** is only included if lines/numbers have been generated (`lastLines`, `lxLastLines`, `f5LastLines`, `cpLastNumbers` are non-null/non-empty)
- **Winning Numbers** is only included if the winning number data is actually present:
  - JTP, Lotto X, Fantasy 5: `drawn` array populated via the Check My Numbers date lookup (`jtpDrawn`, `lxDrawn`, `f5Drawn`)
  - Cash Pop: the "Winning Number Drawn" field (`cpWinNum`) is filled with a valid 1–15 value
- If both checkboxes resolve to nothing (lines not generated AND no winning numbers available), send is blocked with an error
- `winningNumbers` field in POST body: array when included, `null` when not
- Server renders a green "Winning" row at the top of the HTML email table when `winningNumbers` is present; also appended to plain-text body
- Server validates: if `lines` is empty array AND `winningNumbers` is null/missing → 400 error

## Rate Limits (per IP/min)
`/analyze` 10 | `/refresh` 3 | `/email` 5 | `/check` 20 | `/chat` 30 | global cap 120 (all routes combined)
- Request body size capped at 20 KB — oversized payloads rejected with 413
- `/nextdraw/*` excluded from per-route limits but still subject to global cap
- Auto-blacklist: 5 rate-limit strikes within 10 min → 24h IP ban → 403 on all requests
- Blacklist bans and expirations are logged (`console.log`); blacklist is in-memory and resets on server restart

## Sessions
- Browser `sid` in `sessionStorage`; server `Map` TTL 2 h; purged every 30 min

## PDF Parse Cache
- PDFs > 1 MB (currently Lotto X ~1 MB, Fantasy 5 ~2.7 MB) use an mtime-based in-memory parse cache
- Cache stores `{ text, mtime }` — invalidates automatically when `fs.statSync().mtimeMs` changes
- `downloadFile()` writes atomically via `.tmp` rename so mtime only updates when the full file is committed — no partial-read risk
- Post-draw refresh downloads a new file, changing mtime, which invalidates the cache on the next `/analyze` call
- PDFs under 1 MB (JTP, JTP frequency, Cash Pop) are read and parsed fresh on every request — no cache
- Cache invalidation is logged (`console.log`) so stale-data issues are traceable; never silently serve stale
- When adding a new game with a PDF > 1 MB, add a `getXxxText()` cache function following the same pattern

- JTP History PDF: `https://files.floridalottery.com/exptkt/jtp.pdf`
- JTP Frequency PDF: `https://files.floridalottery.com/exptkt/jackpot-triple-play_number-frequency-chart.pdf`
- Lotto X History PDF: `https://files.floridalottery.com/exptkt/lotto_winning-numbers-history.pdf`
- Fantasy 5 History PDF: `https://files.floridalottery.com/exptkt/fantasy5_winning-numbers-history.pdf`
- Auto-refreshed once per day on first `/analyze` (or `/analyze/lottox`, `/analyze/fantasy5`) call
- Fantasy 5 and Cash Pop also auto-refresh via `schedulePostDrawRefreshes()` ~5 min after each draw completes (server-side `setTimeout` chain, no external scheduler needed)
- When adding a new multi-draw-per-day game, add its post-draw refresh times to `schedulePostDrawRefreshes()`

## Email Button Reset Pattern
When resetting an email send button in a `.finally()` block, always use `btn.innerHTML` (not `btn.textContent`) so HTML entities like `&#128140;` render as the emoji rather than literal text.

```js
.finally(function() { btn.disabled = false; btn.innerHTML = '&#128140; Send Lines'; });
```

Apply this to every game's `xSendEmail()` function when building a new game.

## Never Modify
`email.config.json` | `*.pdf` | `logs/*`

## Backups
Stable snapshots → `backups/stable-YYYY-MM-DD/`

## Knowledge Base
Full project docs in `vault/` (Obsidian). Amazon Q prompts: `@jackpot-wiki` (deep reference), `@jackpot-context` (quick context).

## File Encoding
- `public/index.html` MUST be saved and read as **UTF-8** at all times
- Never open/save it with Windows-1252 (or any non-UTF-8 encoding) — doing so remaps bytes 0x80-0x9F to wrong Unicode codepoints, bloating the file and corrupting all emojis and special chars (-- v ^ etc.)
- If the file grows unexpectedly (e.g. ~90 KB ballooning to ~150 KB+), encoding corruption is the likely cause
- Always verify encoding in your editor before saving; in VS Code the encoding is shown in the status bar (bottom right)

## PM2 / Startup
- On Windows, `EPERM \\.\pipe\rpc.sock` on restart means a zombie PM2 daemon node process is still holding the named pipe
- Fix: kill ALL `node` processes **before** attempting socket file cleanup or `pm2 kill` -- not after
- Correct order in `start_jackpot.ps1`: (1) kill node+cloudflared, (2) sleep, (3) delete socket files, (4) `pm2 kill`, (5) kill node again, (6) final socket cleanup
- `Remove-Item` on `.sock` files does NOT release a Windows named pipe -- only killing the owning process does
