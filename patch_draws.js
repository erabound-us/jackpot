const fs = require('fs');
const file = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(file, 'utf8');

// Replace the entire scrapeFlDraws function with a URL builder
const oldStart = 'function scrapeFlDraws(game, dateStr, drawType) {';
const oldEnd = '}\n\nconst FL_RESULTS_URLS';

const startIdx = src.indexOf(oldStart);
const endIdx = src.indexOf(oldEnd);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find scrapeFlDraws bounds');
  process.exit(1);
}

const newFn = `function buildResultsUrl(game, dateStr) {
  const GAME_IDS = { jtp: 'jackpottripleplay', lottox: 'lotto', fantasy5: 'fantasy5' };
  const gameId = GAME_IDS[game] || game;
  return 'https://floridalottery.com/games/winning-numbers?game=' + gameId + '&searchBy=date&date=' + encodeURIComponent(dateStr) + '&doSubmit=1';
}

const FL_RESULTS_URLS`;

src = src.slice(0, startIdx) + newFn + src.slice(endIdx + oldEnd.length);

// Now update the three draw routes to use buildResultsUrl instead of scrapeFlDraws
src = src.replace(
  /const scraped = await scrapeFlDraws\('jtp', date, null\);\n  if \(scraped\) return res\.json\(\{ date, numbers: scraped\.numbers \}\);\n  res\.status\(404\)\.json\(\{ error: 'No draw found for that date\.', resultsUrl: FL_RESULTS_URLS\.jtp \}\);/,
  "res.status(404).json({ error: 'No draw found for that date.', resultsUrl: buildResultsUrl('jtp', date) });"
);
src = src.replace(
  /const scraped = await scrapeFlDraws\('lottox', date, null\);\n  if \(scraped\) return res\.json\(\{ date, numbers: scraped\.numbers \}\);\n  res\.status\(404\)\.json\(\{ error: 'No draw found for that date\.', resultsUrl: FL_RESULTS_URLS\.lottox \}\);/,
  "res.status(404).json({ error: 'No draw found for that date.', resultsUrl: buildResultsUrl('lottox', date) });"
);
src = src.replace(
  /const scraped = await scrapeFlDraws\('fantasy5', date, type\);\n  if \(scraped\) return res\.json\(\{ date, drawType: scraped\.drawType \|\| type, numbers: scraped\.numbers \}\);\n  res\.status\(404\)\.json\(\{ error: 'No draw found for that date\.', resultsUrl: FL_RESULTS_URLS\.fantasy5 \}\);/,
  "res.status(404).json({ error: 'No draw found for that date.', resultsUrl: buildResultsUrl('fantasy5', date) });"
);

fs.writeFileSync(file, src, 'utf8');
console.log('Done');
