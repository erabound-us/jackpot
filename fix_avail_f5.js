const fs = require('fs');
const lines = fs.readFileSync('server.js', 'utf8').split('\n');

// Find getAvailableDates GAME_URLS fantasy5 line
const idx = lines.findIndex((l, i) => {
  // Must be inside getAvailableDates (after it), not scrapeFlDraws
  const fnIdx = lines.findIndex(l => l.includes('async function getAvailableDates'));
  return i > fnIdx && l.includes("fantasy5:") && l.includes('floridalottery.com');
});

if (idx === -1) { console.error('not found'); process.exit(1); }
console.log('Found at line', idx+1, ':', lines[idx]);

// Replace with null — no available dates scraping for fantasy5
lines[idx] = "    fantasy5: null  // no draw list on game page; chips not shown";
fs.writeFileSync('server.js', lines.join('\n'), 'utf8');

// Also need to handle null url in getAvailableDates
let src = fs.readFileSync('server.js', 'utf8');
src = src.replace(
  'async function getAvailableDates(game) {\n  const now = Date.now();\n  if (_availCache[game] && now - _availCache[game].ts < 10 * 60 * 1000) return _availCache[game].dates;',
  'async function getAvailableDates(game) {\n  const now = Date.now();\n  if (_availCache[game] && now - _availCache[game].ts < 10 * 60 * 1000) return _availCache[game].dates;\n  if (!GAME_URLS_AVAIL[game]) return [];'
);
// Rename GAME_URLS inside getAvailableDates to avoid conflict
src = src.replace(
  'async function getAvailableDates(game) {',
  'async function getAvailableDates(game) {\n  // GAME_URLS_AVAIL defined below'
);
fs.writeFileSync('server.js', src, 'utf8');
console.log('Done');
