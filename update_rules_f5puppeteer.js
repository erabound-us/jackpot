const fs = require('fs');
const path = 'C:\\Jackpot\\.amazonq\\rules\\project.md';
let src = fs.readFileSync(path, 'utf8');

const insertAfter = `## JSON Draw Cache (Lotto X and Fantasy 5)`;

const newSection = `## Fantasy 5 — Puppeteer-Based Refresh (Nov 2026)

Fantasy 5 PDF parse was replaced with a Puppeteer scraper because:
- PDF parse peaks at 535MB RSS, blocks event loop for 2.5 minutes
- Puppeteer scrape uses only ~108MB RSS, completes in ~20 seconds
- FL Lottery Vue SPA renders draw results fully with \`networkidle0\` + \`waitForSelector('.draw-results-item')\`

### How it works
\`_appendFantasy5DeltasImpl()\` now:
1. Launches Chrome with \`networkidle0\` + waits for \`.draw-results-item\` selector (15s timeout)
2. Extracts article IDs matching \`/([0-9]{4}-[0-9]{2}-[0-9]{2})-fantasy5/g\`
3. For each new date, slices HTML between Midday/Evening labels, extracts numbers via \`game-numbers__number\` class
4. Uses \`existingKeys\` Set (date+drawType) to skip already-cached draws — avoids ts comparison issues with 2-digit vs 4-digit year dates
5. Appends new draws to \`f5DrawsCache\` (in-memory) and \`fantasy5_draws.json\` (disk)
6. Calls \`extractAndCacheJackpot('fantasy5', html)\` as a side effect

### Schedule (unchanged)
- Primary: 13:10 ET (after Midday draw) and 23:20 ET (after Evening draw)
- Retry: 13:25 ET and 23:35 ET
- All 3 schedule wiring points call \`appendFantasy5Deltas()\` directly — no PDF download

### Key rules
- **NEVER use \`String.replace()\` with regex literals in replacement strings** — backslashes get eaten. Always use \`String.raw\` or character classes like \`[0-9]\` instead of \`\\d\` when writing regex via scripts
- **existingKeys Set** uses normalized 4-digit year keys — handles mixed 2/4-digit year dates in cache
- **\`generate_draw_cache.js\` still uses PDF parser** — for local cache generation only, not deployed
- **\`ensureDailyRefreshF5\`** still downloads the PDF (fire-and-forget) — kept for potential future use but parse is no longer called from it
- **Test endpoint** \`GET /test/f5scrape\` — read-only diagnostic, does not modify cache

### Memory comparison
| Method | RSS Peak | Time | Event loop blocked? |
|--------|----------|------|---------------------|
| PDF parse | 535MB | 2.5 min | Yes |
| Puppeteer scrape | 108MB | 20s | No |

`;

const idx = src.indexOf(insertAfter);
if (idx !== -1) {
  src = src.slice(0, idx) + newSection + src.slice(idx);
  console.log('Section inserted before JSON Draw Cache at idx', idx);
} else {
  src += '\n\n' + newSection;
  console.log('Section appended at end');
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done.');
