const fs = require('fs');
let c = fs.readFileSync('c:/Jackpot/.amazonq/rules/project.md', 'utf8');

const old = "- `scrapeJackpot(game)` \u2014 reads `_jackpotCache` first; returns null immediately if cache is cold (never launches Chrome directly). Cache is populated as a **free side effect** of `scrapeFlDraws` whenever any user looks up a draw date \u2014 the same page load that fetches draw numbers also extracts the jackpot amount via `extractAndCacheJackpot`. **This function MUST be defined** \u2014 it is called by the `/jackpot` route. If removed accidentally, all three jackpot banners show `\u2014` and the route returns 500.\n- **`/jackpot` route returns `{ amount: null }` on error** (not 500) \u2014 frontend handles null gracefully by showing \"See FL Lottery\"";

const rep = "- `scrapeJackpot(game)` \u2014 three-tier cache lookup, never launches Chrome directly:\n  1. In-memory `_jackpotCache` (5 min TTL)\n  2. File `jackpot_cache.json` (6 hour TTL) \u2014 populated by `extractAndCacheJackpot` whenever `scrapeFlDraws` runs (draw lookups, post-draw refresh)\n  3. Returns null \u2014 frontend shows \"See FL Lottery\"\n- `saveJackpotCacheToFile()` \u2014 called inside `extractAndCacheJackpot` after caching a new amount; writes `_jackpotCache` to `jackpot_cache.json` so it survives server restarts\n- `jackpot_cache.json` \u2014 committed to repo (starts as `{}`); updated in-place on Fly.io; survives deploys via Docker image\n- **`/jackpot` route returns `{ amount: null }` on error** (not 500) \u2014 frontend handles null gracefully by showing \"See FL Lottery\"\n- **This function MUST be defined** \u2014 it is called by the `/jackpot` route. If removed accidentally, all three jackpot banners show `\u2014` and the route returns 500.";

process.stdout.write('found: ' + c.includes(old) + '\n');
if (c.includes(old)) {
  c = c.replace(old, rep);
  fs.writeFileSync('c:/Jackpot/.amazonq/rules/project.md', c, 'utf8');
  process.stdout.write('done\n');
} else { process.stdout.write('NOT FOUND\n'); }
