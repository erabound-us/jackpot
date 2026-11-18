const fs = require('fs');
const lines = fs.readFileSync('server.js', 'utf8').split('\n');
// Find the goto line in getAvailableDates (after line 1911 which is scrapeFlDraws)
const idx = lines.findIndex((l, i) => i > 1915 && l.includes("page.goto(GAME_URLS[game]"));
if (idx === -1) { console.error('not found'); process.exit(1); }
console.log('Found at line', idx+1);
// Insert waitForSelector after the goto line
lines.splice(idx + 1, 0, "    try { await page.waitForSelector('.game-numbers__number', { timeout: 5000 }); } catch(_) {}");
fs.writeFileSync('server.js', lines.join('\n'), 'utf8');
console.log('Done');
